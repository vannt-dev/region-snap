/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// What the desktop app and the extension share about text recognition: the bundled languages,
// how much a small capture is enlarged before it is read, and how the result is tidied.
((scope) => {
  // Both models ship with the app and the extension; nothing is downloaded when text is read.
  const OCR_LANGUAGES = Object.freeze(["vie", "eng"]);
  // Small screen text is recognised far better after upscaling; larger regions stay as they are.
  const MAX_UPSCALE = 2;
  const MAX_UPSCALED_PIXELS = 8_000_000;

  function ocrScale({ width, height }) {
    const pixels = Math.max(1, width) * Math.max(1, height);
    const scale = Math.min(MAX_UPSCALE, Math.sqrt(MAX_UPSCALED_PIXELS / pixels));
    return scale >= 1.25 ? Math.round(scale * 100) / 100 : 1;
  }

  function formatRecognizedText(raw) {
    const lines = String(raw ?? "")
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim());
    const kept = [];
    for (const line of lines) {
      if (line || (kept.length && kept[kept.length - 1])) kept.push(line);
    }
    while (kept.length && !kept[kept.length - 1]) kept.pop();
    return { text: kept.join("\n"), lineCount: kept.filter(Boolean).length };
  }

  const api = Object.freeze({ OCR_LANGUAGES, formatRecognizedText, ocrScale });
  scope.RegionSnapOcrText = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
