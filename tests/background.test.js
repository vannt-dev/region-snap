const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBackground({
  activeTab,
  injected = false,
  contentState = "idle",
  contentRect = null,
} = {}) {
  const calls = [];
  let contentReady = injected;
  let commandListener;
  let messageListener;
  const tab = activeTab || { id: 7, windowId: 3, url: "https://example.com/" };

  const chrome = {
    i18n: {
      getMessage(key) {
        const messages = {
          errorUnknown: "Unknown error",
          errorRestricted: "Chrome does not allow Region Snap to run on this page.",
          errorNoTab: "No active tab was found.",
          errorInvalidUrl: "The current tab URL is invalid.",
          errorUnsupportedPage: "This page cannot be captured.",
          errorNoSelection: "No region has been selected on this tab.",
          errorInvalidCommand: "Invalid command.",
          errorUnknownCaptureTab: "The capture tab could not be identified.",
          errorTabChanged: "The active tab changed before the screenshot was captured.",
        };
        return messages[key] || key;
      },
    },
    commands: {
      onCommand: {
        addListener(listener) {
          commandListener = listener;
        },
      },
    },
    runtime: {
      getManifest() {
        return { version: "1.0.0" };
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    scripting: {
      async insertCSS(details) {
        calls.push(["insertCSS", details]);
      },
      async removeCSS(details) {
        calls.push(["removeCSS", details]);
      },
      async executeScript(details) {
        calls.push(["executeScript", details]);
        contentReady = true;
      },
    },
    tabs: {
      async query() {
        return [tab];
      },
      async sendMessage(tabId, message) {
        calls.push(["sendMessage", tabId, message]);
        if (message.type === "PING") {
          if (!contentReady) throw new Error("Receiving end does not exist");
          return { ready: true, state: contentState, rect: contentRect, version: "1.0.0" };
        }
        return { ok: true };
      },
      async captureVisibleTab(windowId, options) {
        calls.push(["captureVisibleTab", windowId, options]);
        return "data:image/png;base64,test";
      },
    },
  };

  const sharedSource = fs.readFileSync(path.resolve(__dirname, "../shared.js"), "utf8");
  const source = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");
  const context = { chrome, console, URL, Set };
  context.globalThis = context;
  context.importScripts = (file) => {
    assert.equal(file, "shared.js");
    vm.runInNewContext(sharedSource, context);
  };
  vm.runInNewContext(source, context);
  return {
    calls,
    getCommandListener: () => commandListener,
    getMessageListener: () => messageListener,
    tab,
  };
}

function sendRuntimeMessage(listener, message, sender = {}) {
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test("picker command injects CSS and script only when needed", async () => {
  const runtime = loadBackground();
  const response = await sendRuntimeMessage(runtime.getMessageListener(), {
    type: "RUN_COMMAND",
    command: "START_PICKING",
  });

  assert.equal(response.ok, true);
  assert.equal(runtime.calls.filter(([name]) => name === "insertCSS").length, 1);
  assert.equal(runtime.calls.filter(([name]) => name === "executeScript").length, 1);
  const injection = runtime.calls.find(([name]) => name === "executeScript");
  assert.deepEqual(Array.from(injection[1].files), ["shared.js", "geometry.js", "content.js"]);
  assert.equal(
    runtime.calls.some(([, , message]) => message?.type === "START_PICKING"),
    true,
  );
});

test("concurrent picker commands share one injection task", async () => {
  const runtime = loadBackground();
  const message = { type: "RUN_COMMAND", command: "START_PICKING" };

  const responses = await Promise.all([
    sendRuntimeMessage(runtime.getMessageListener(), message),
    sendRuntimeMessage(runtime.getMessageListener(), message),
  ]);

  assert.equal(
    responses.every((response) => response.ok),
    true,
  );
  assert.equal(runtime.calls.filter(([name]) => name === "insertCSS").length, 1);
  assert.equal(runtime.calls.filter(([name]) => name === "executeScript").length, 1);
});

test("capture command does not inject when no selection session exists", async () => {
  const runtime = loadBackground();
  const response = await sendRuntimeMessage(runtime.getMessageListener(), {
    type: "RUN_COMMAND",
    command: "DO_CAPTURE",
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /No region/);
  assert.equal(
    runtime.calls.some(([name]) => name === "executeScript"),
    false,
  );
});

test("unsupported pages return a user-facing error", async () => {
  const runtime = loadBackground({
    activeTab: { id: 9, windowId: 3, url: "chrome://extensions/" },
  });
  const response = await sendRuntimeMessage(runtime.getMessageListener(), {
    type: "RUN_COMMAND",
    command: "START_PICKING",
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /cannot be captured/);
  assert.equal(runtime.calls.length, 0);
});

test("capture requests are limited to the sender's active tab", async () => {
  const runtime = loadBackground({ injected: true });
  const response = await sendRuntimeMessage(
    runtime.getMessageListener(),
    { type: "CAPTURE_TAB" },
    { tab: runtime.tab },
  );

  assert.equal(response.dataUrl, "data:image/png;base64,test");
  assert.equal(
    runtime.calls.some(([name]) => name === "captureVisibleTab"),
    true,
  );
});

test("popup status reports the active locked region", async () => {
  const rect = { left: 10, top: 20, width: 640, height: 360 };
  const runtime = loadBackground({ injected: true, contentState: "locked", contentRect: rect });
  const response = await sendRuntimeMessage(runtime.getMessageListener(), {
    type: "GET_ACTIVE_STATUS",
  });

  assert.equal(response.ok, true);
  assert.equal(response.state, "locked");
  assert.deepEqual(response.rect, rect);
});

test("popup status treats a supported uninjected tab as idle", async () => {
  const runtime = loadBackground();
  const response = await sendRuntimeMessage(runtime.getMessageListener(), {
    type: "GET_ACTIVE_STATUS",
  });

  assert.equal(response.ok, true);
  assert.equal(response.supported, true);
  assert.equal(response.state, "idle");
  assert.equal(response.rect, null);
});
