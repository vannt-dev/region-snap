/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// Runs in the offscreen document the service worker opens while text is read from an image.
// Tesseract's worker, its WebAssembly cores and the language models are all files of the
// extension (vendor/tesseract/); every path is given, so nothing is fetched from the network.
(() => {
  const { MESSAGE, OFFSCREEN_TARGET } = globalThis.RegionSnapShared;
  const { OCR_LANGUAGES, formatRecognizedText, ocrScale } = globalThis.RegionSnapOcrText;
  const VENDOR = chrome.runtime.getURL("vendor/tesseract/");

  async function decodeImage(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("Not an image.");
    }
    return createImageBitmap(await (await fetch(dataUrl)).blob());
  }

  // Small text is read far better once enlarged, as on the desktop app.
  async function prepareImage(dataUrl) {
    const bitmap = await decodeImage(dataUrl);
    try {
      const scale = ocrScale(bitmap);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      bitmap.close();
    }
  }

  async function recognize(dataUrl) {
    const image = await prepareImage(dataUrl);
    // One worker per request, as on the desktop app: the document is closed right after.
    const worker = await Tesseract.createWorker([...OCR_LANGUAGES], Tesseract.OEM.LSTM_ONLY, {
      workerPath: `${VENDOR}worker.min.js`,
      corePath: VENDOR,
      langPath: `${VENDOR}lang`,
      // Spawn the worker from its extension URL: the default blob-URL wrapper has an opaque
      // origin and cannot load the extension's core script.
      workerBlobURL: false,
      gzip: true,
      cacheMethod: "none",
    });
    try {
      const { data } = await worker.recognize(image);
      return formatRecognizedText(data.text);
    } finally {
      await worker.terminate();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== OFFSCREEN_TARGET || message.type !== MESSAGE.RECOGNIZE_TEXT) {
      return false;
    }
    recognize(message.dataUrl).then(sendResponse, (error) =>
      sendResponse({ error: error?.message || String(error) }),
    );
    return true;
  });
})();
