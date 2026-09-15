importScripts("shared.js");

const { ALLOWED_PROTOCOLS, COMMAND_TO_MESSAGE, MESSAGE, STATE } = globalThis.RegionSnapShared;
const allowedProtocols = new Set(ALLOWED_PROTOCOLS);
const validCommands = new Set(Object.values(COMMAND_TO_MESSAGE));
const injectionTasks = new Map();
const CONTENT_VERSION = chrome.runtime.getManifest().version;

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function getFriendlyError(error) {
  const message = error?.message || String(error || t("errorUnknown"));
  if (/Cannot access|Receiving end does not exist|Missing host permission/i.test(message)) {
    return t("errorRestricted");
  }
  return message;
}

function assertSupportedTab(tab) {
  if (!tab?.id) throw new Error(t("errorNoTab"));

  let protocol;
  try {
    protocol = new URL(tab.url || "").protocol;
  } catch {
    throw new Error(t("errorInvalidUrl"));
  }

  if (!allowedProtocols.has(protocol)) {
    throw new Error(t("errorUnsupportedPage"));
  }
}

async function isInjected(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE.PING });
    return response?.ready === true && response.version === CONTENT_VERSION;
  } catch {
    return false;
  }
}

async function ensureInjected(tabId) {
  if (injectionTasks.has(tabId)) return injectionTasks.get(tabId);
  if (await isInjected(tabId)) return;

  if (injectionTasks.has(tabId)) return injectionTasks.get(tabId);

  const task = (async () => {
    let cssInserted = false;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["overlay.css"],
      });
      cssInserted = true;
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["shared.js", "geometry.js", "content.js"],
      });
    } catch (error) {
      if (cssInserted) {
        await chrome.scripting
          .removeCSS({
            target: { tabId },
            files: ["overlay.css"],
          })
          .catch(() => {});
      }
      throw error;
    }
  })();

  injectionTasks.set(tabId, task);
  try {
    await task;
  } finally {
    injectionTasks.delete(tabId);
  }
}

async function sendCommandToTab(tab, type) {
  assertSupportedTab(tab);

  if (type === MESSAGE.START_PICKING) {
    await ensureInjected(tab.id);
  } else if (!(await isInjected(tab.id))) {
    return { ok: false, error: t("errorNoSelection") };
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type });
  return response || { ok: true };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runPopupCommand(type) {
  try {
    if (!validCommands.has(type)) {
      return { ok: false, error: t("errorInvalidCommand") };
    }
    return await sendCommandToTab(await getActiveTab(), type);
  } catch (error) {
    return { ok: false, error: getFriendlyError(error) };
  }
}

async function getActiveStatus() {
  try {
    const tab = await getActiveTab();
    assertSupportedTab(tab);
    let response = null;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.PING });
    } catch {
      // A missing receiver simply means this tab has no active selection session yet.
    }
    if (!response?.ready || response.version !== CONTENT_VERSION) {
      return { ok: true, supported: true, state: STATE.IDLE, rect: null };
    }
    return {
      ok: true,
      supported: true,
      state: response.state || STATE.IDLE,
      rect: response.rect || null,
    };
  } catch (error) {
    return {
      ok: false,
      supported: false,
      state: STATE.UNSUPPORTED,
      rect: null,
      error: getFriendlyError(error),
    };
  }
}

async function captureSenderTab(sender) {
  const sourceTab = sender.tab;
  if (!sourceTab?.id || sourceTab.windowId == null) {
    return { error: t("errorUnknownCaptureTab") };
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: sourceTab.windowId,
  });
  if (activeTab?.id !== sourceTab.id) {
    return { error: t("errorTabChanged") };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sourceTab.windowId, {
      format: "png",
    });
    return { dataUrl };
  } catch (error) {
    return { error: getFriendlyError(error) };
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  const type = COMMAND_TO_MESSAGE[command];
  if (!type) return;

  try {
    const result = await sendCommandToTab(tab, type);
    if (!result?.ok) console.warn("Region Snap:", result?.error);
  } catch (error) {
    console.warn("Region Snap:", getFriendlyError(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE.GET_ACTIVE_STATUS) {
    getActiveStatus().then(sendResponse);
    return true;
  }

  if (message?.type === MESSAGE.RUN_COMMAND) {
    runPopupCommand(message.command).then(sendResponse);
    return true;
  }

  if (message?.type === MESSAGE.CAPTURE_TAB) {
    captureSenderTab(sender).then(sendResponse);
    return true;
  }

  return false;
});
