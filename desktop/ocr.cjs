/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// Offline text recognition for the desktop app. Tesseract runs in a Node worker thread with the
// English and Vietnamese models shipped inside the app; nothing is fetched over the network.
const fs = require("node:fs/promises");
const path = require("node:path");

const { OCR_LANGUAGES, formatRecognizedText, ocrScale } = require("../ocr-text.js");

const MODEL_VARIANT = "4.0.0_best_int";

function languageModelFiles(resolve = require.resolve) {
  return OCR_LANGUAGES.map((language) => ({
    language,
    file: path.join(
      path.dirname(resolve(`@tesseract.js-data/${language}/package.json`)),
      MODEL_VARIANT,
      `${language}.traineddata.gz`,
    ),
  }));
}

// Tesseract reads every model from one folder, but each model ships in its own npm package.
// Copy them once into a single folder on disk (this also keeps them out of the asar archive).
async function prepareLanguageModels(directory, models = languageModelFiles(), fileSystem = fs) {
  await fileSystem.mkdir(directory, { recursive: true });
  for (const { language, file } of models) {
    const target = path.join(directory, `${language}.traineddata.gz`);
    const source = await fileSystem.stat(file);
    const existing = await fileSystem.stat(target).catch(() => null);
    if (existing?.size === source.size) continue;
    const temporary = `${target}.tmp`;
    await fileSystem.copyFile(file, temporary);
    await fileSystem.rename(temporary, target);
  }
  return directory;
}

function createTesseractRecognizer({
  languageDirectory,
  prepare = prepareLanguageModels,
  loadTesseract = () => require("tesseract.js"),
}) {
  // One worker per request: start-up takes a few hundred milliseconds and the tray app
  // does not keep the recogniser's memory when it is idle.
  return async function recognize(imageBuffer) {
    const { createWorker, OEM } = loadTesseract();
    const langPath = await prepare(languageDirectory);
    const worker = await createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, {
      langPath,
      cacheMethod: "none",
    });
    try {
      const { data } = await worker.recognize(imageBuffer);
      return data.text;
    } finally {
      await worker.terminate();
    }
  };
}

async function copyTextFromImage(imageBuffer, { recognize, writeText }) {
  const result = formatRecognizedText(await recognize(imageBuffer));
  if (result.lineCount) writeText(result.text);
  return result;
}

module.exports = {
  OCR_LANGUAGES,
  copyTextFromImage,
  createTesseractRecognizer,
  formatRecognizedText,
  languageModelFiles,
  ocrScale,
  prepareLanguageModels,
};
