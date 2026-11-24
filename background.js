/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
importScripts("shared.js");

const { ALLOWED_PROTOCOLS, COMMAND_TO_MESSAGE, MESSAGE, OFFSCREEN_TARGET, STATE } =
  globalThis.RegionSnapShared;
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
        files: ["shared.js", "geometry.js", "annotations.js", "schedule.js", "content.js"],
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

  if (type === MESSAGE.START_PICKING || type === MESSAGE.CAPTURE_FULL_PAGE) {
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

// Text is read from an image in an offscreen document: a service worker cannot start the
// dedicated worker Tesseract runs in, and the document holds Tesseract's memory only while it
// works. Reads take turns, and the document closes after the last one.
const OFFSCREEN_URL = "ocr.html";
let textReads = Promise.resolve();
let waitingTextReads = 0;

function canReadImageText() {
  return (
    typeof chrome.offscreen?.createDocument === "function" &&
    "WORKERS" in (chrome.offscreen.Reason || {})
  );
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime.getContexts !== "function") return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function openOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Recognise the text in a captured region with the bundled Tesseract worker.",
    });
  } catch (error) {
    // Without getContexts (before Chrome 116) a document left open by a service worker that
    // has since restarted is only found this way.
    if (!/single offscreen document/i.test(error?.message || "")) throw error;
  }
}

async function readTextNow(dataUrl) {
  await openOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: OFFSCREEN_TARGET,
    type: MESSAGE.RECOGNIZE_TEXT,
    dataUrl,
  });
  if (!response || response.error) throw new Error(response?.error || t("errorReadText"));
  return { text: String(response.text || ""), lineCount: Number(response.lineCount) || 0 };
}

async function readImageText(dataUrl) {
  if (!canReadImageText()) return { error: t("errorReadTextUnsupported") };
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return { error: t("errorReadText") };
  }
  waitingTextReads += 1;
  const turn = textReads.then(async () => {
    try {
      return await readTextNow(dataUrl);
    } catch (error) {
      console.warn("Region Snap text recognition failed:", error);
      return { error: error?.message || t("errorReadText") };
    } finally {
      waitingTextReads -= 1;
      if (!waitingTextReads) await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  textReads = turn;
  return turn;
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

  if (message?.type === MESSAGE.READ_IMAGE_TEXT && sender.tab) {
    readImageText(message.dataUrl).then(sendResponse);
    return true;
  }

  if (message?.type === MESSAGE.CAPTURE_TAB) {
    captureSenderTab(sender).then(sendResponse);
    return true;
  }

  return false;
});
