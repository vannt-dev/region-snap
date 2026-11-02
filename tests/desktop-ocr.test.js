const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  OCR_LANGUAGES,
  copyTextFromImage,
  createTesseractRecognizer,
  formatRecognizedText,
  languageModelFiles,
  ocrScale,
  prepareLanguageModels,
} = require("../desktop/ocr.cjs");

const fixture = path.join(__dirname, "fixtures", "ocr-en-vi.png");

test("formats recognised text into trimmed lines and counts them", () => {
  assert.deepEqual(formatRecognizedText("  Hello   world \r\n\n\n\nSecond\tline  \n\n"), {
    text: "Hello world\n\nSecond line",
    lineCount: 2,
  });
  assert.deepEqual(formatRecognizedText("\n \n"), { text: "", lineCount: 0 });
  assert.deepEqual(formatRecognizedText(undefined), { text: "", lineCount: 0 });
});

test("normalises Vietnamese diacritics to composed characters", () => {
  const decomposed = "Tiếng Việt";
  const { text } = formatRecognizedText(decomposed);
  assert.equal(text, "Tiếng Việt");
  assert.equal(text, text.normalize("NFC"));
});

test("upscales small captures and leaves large ones alone", () => {
  assert.equal(ocrScale({ width: 320, height: 90 }), 2);
  assert.equal(ocrScale({ width: 2000, height: 2000 }), 1.41);
  assert.equal(ocrScale({ width: 3840, height: 2160 }), 1);
  assert.equal(ocrScale({ width: 0, height: 0 }), 2);
});

test("copies recognised text to the clipboard through a stubbed OCR backend", async () => {
  const images = [];
  const clipboard = [];
  const result = await copyTextFromImage(Buffer.from("png"), {
    recognize: async (image) => {
      images.push(image.toString());
      return "Xin chào\n\nRegion Snap\n";
    },
    writeText: (text) => clipboard.push(text),
  });
  assert.deepEqual(images, ["png"]);
  assert.deepEqual(clipboard, ["Xin chào\n\nRegion Snap"]);
  assert.deepEqual(result, { text: "Xin chào\n\nRegion Snap", lineCount: 2 });
});

test("leaves the clipboard alone when no text is found", async () => {
  const clipboard = [];
  const result = await copyTextFromImage(Buffer.from("png"), {
    recognize: async () => "  \n",
    writeText: (text) => clipboard.push(text),
  });
  assert.deepEqual(clipboard, []);
  assert.equal(result.lineCount, 0);
});

test("passes OCR failures to the caller without touching the clipboard", async () => {
  const clipboard = [];
  await assert.rejects(
    copyTextFromImage(Buffer.from("png"), {
      recognize: async () => {
        throw new Error("engine failed");
      },
      writeText: (text) => clipboard.push(text),
    }),
    /engine failed/,
  );
  assert.deepEqual(clipboard, []);
});

test("bundles English and Vietnamese models as local files", () => {
  assert.deepEqual(OCR_LANGUAGES, ["vie", "eng"]);
  for (const { language, file } of languageModelFiles()) {
    assert.ok(fs.statSync(file).size > 100_000, `${language} model is missing: ${file}`);
  }
});

test("collects the language models into one folder and copies them only once", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "region-snap-ocr-"));
  try {
    const models = languageModelFiles();
    const copies = [];
    const fileSystem = {
      ...fs.promises,
      copyFile: (source, target) => {
        copies.push(path.basename(source));
        return fs.promises.copyFile(source, target);
      },
    };
    await prepareLanguageModels(directory, models, fileSystem);
    await prepareLanguageModels(directory, models, fileSystem);
    assert.deepEqual(copies.sort(), ["eng.traineddata.gz", "vie.traineddata.gz"]);
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      "eng.traineddata.gz",
      "vie.traineddata.gz",
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("starts Tesseract offline with local models and stops the worker", async () => {
  const calls = [];
  const recognize = createTesseractRecognizer({
    languageDirectory: "models",
    prepare: async (directory) => `${directory}-ready`,
    loadTesseract: () => ({
      OEM: { LSTM_ONLY: 1 },
      createWorker: async (languages, oem, options) => {
        calls.push({ languages, oem, options });
        return {
          recognize: async () => ({ data: { text: "ok" } }),
          terminate: async () => calls.push("terminated"),
        };
      },
    }),
  });
  assert.equal(await recognize(Buffer.from("png")), "ok");
  assert.deepEqual(calls, [
    {
      languages: ["vie", "eng"],
      oem: 1,
      options: { langPath: "models-ready", cacheMethod: "none" },
    },
    "terminated",
  ]);
});

test("reads English and Vietnamese text from an image with the bundled models", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "region-snap-ocr-"));
  try {
    const recognize = createTesseractRecognizer({ languageDirectory: directory });
    const { text, lineCount } = formatRecognizedText(await recognize(fs.readFileSync(fixture)));
    assert.equal(lineCount, 4);
    assert.match(text, /Region Snap copies text offline\./);
    assert.match(text, /Invoice total: 1,250\.00 USD/);
    assert.match(text, /Tiếng Việt có dấu: Xin chào thế giới/);
    assert.match(text, /Ảnh chụp màn hình được lưu\./);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
