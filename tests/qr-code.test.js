const assert = require("node:assert/strict");
const test = require("node:test");
const QRCode = require("qrcode");
const jsQR = require("jsqr");
const QrCode = require("../qr-code.js");

// Draws a QR code as RGBA pixels, `scale` pixels a module, with a quiet zone around it.
function renderQr(text, { scale = 4, margin = 4, inverted = false } = {}) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = (modules.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / scale) - margin;
      const column = Math.floor(x / scale) - margin;
      const inside = row >= 0 && column >= 0 && row < modules.size && column < modules.size;
      const dark = inside && modules.get(row, column) === 1;
      const value = dark !== inverted ? 0 : 255;
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

test("a QR code in the pixels is decoded, light-on-dark ones too", () => {
  assert.equal(
    QrCode.decodeQrPixels(jsQR, renderQr("https://example.com/a?b=1")),
    "https://example.com/a?b=1",
  );
  assert.equal(
    QrCode.decodeQrPixels(jsQR, renderQr("Wi-Fi: Guest", { inverted: true })),
    "Wi-Fi: Guest",
  );
  assert.equal(QrCode.decodeQrPixels(jsQR, renderQr("Xin chào thế giới")), "Xin chào thế giới");
});

test("pixels without a code, or without a decoder, give nothing", () => {
  const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
  assert.equal(QrCode.decodeQrPixels(jsQR, blank), null);
  assert.equal(QrCode.decodeQrPixels(undefined, renderQr("x")), null);
  assert.equal(QrCode.decodeQrPixels(jsQR, { data: new Uint8ClampedArray(0), width: 0 }), null);
});

test("only an http or https address is offered as a link, shown by its real host", () => {
  assert.deepEqual(QrCode.describeQrText("https://example.com/path"), {
    text: "https://example.com/path",
    link: { href: "https://example.com/path", host: "example.com" },
  });
  // A user name in front of the host does not hide it, and an international host shows in
  // punycode, so a look-alike cannot pass for the real site.
  assert.equal(QrCode.describeQrText("https://bank.com@evil.test/").link.host, "evil.test");
  // A Cyrillic a in place of the Latin one.
  const lookAlike = `https://ex${String.fromCodePoint(0x430)}mple.com/`;
  assert.equal(QrCode.describeQrText(lookAlike).link.host, "xn--exmple-4nf.com");
  assert.equal(
    QrCode.describeQrText("  HTTP://Example.COM:8080  ").link.href,
    "http://example.com:8080/",
  );

  for (const text of [
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///C:/Windows",
    "example.com",
    "https://example.com/ and more text",
    "WIFI:S:Guest;T:WPA;P:secret;;",
    "",
  ]) {
    assert.equal(QrCode.describeQrText(text).link, null, text);
  }
  assert.equal(
    QrCode.describeQrText("<img src=x onerror=alert(1)>").text,
    "<img src=x onerror=alert(1)>",
  );
});

test("the service worker opens only http and https addresses", () => {
  assert.equal(QrCode.openableUrl("https://example.com"), "https://example.com/");
  assert.equal(QrCode.openableUrl("javascript:alert(1)"), null);
  assert.equal(QrCode.openableUrl("chrome://settings"), null);
  assert.equal(QrCode.openableUrl(undefined), null);
});

test("huge regions are scaled down before decoding, others are read as they are", () => {
  assert.equal(QrCode.qrScale({ width: 800, height: 600 }), 1);
  const scale = QrCode.qrScale({ width: 4000, height: 4000 });
  assert.ok(scale < 1);
  assert.ok(4000 * scale * 4000 * scale <= QrCode.MAX_DECODE_PIXELS + 1);
});
