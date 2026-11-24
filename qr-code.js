/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// Reading a QR code in a captured region: the pixels go to the bundled jsQR decoder, and the
// decoded text is described so the overlay can show it safely. The text comes from whatever
// the region shows, so it is untrusted: it is only ever shown as plain text, and only an http
// or https address may be opened.
((scope) => {
  // A huge region is scaled down first: jsQR reads every pixel, and a code that fills a few
  // hundred pixels is still read at this size.
  const MAX_DECODE_PIXELS = 4_000_000;
  const OPENABLE_PROTOCOLS = Object.freeze(["http:", "https:"]);

  function qrScale({ width, height }) {
    const pixels = Math.max(1, width) * Math.max(1, height);
    return pixels > MAX_DECODE_PIXELS ? Math.sqrt(MAX_DECODE_PIXELS / pixels) : 1;
  }

  // `decoder` is jsQR. Light-on-dark codes are read too. Returns the text, or null when the
  // pixels hold no readable code.
  function decodeQrPixels(decoder, { data, width, height }) {
    if (typeof decoder !== "function" || !width || !height) return null;
    const code = decoder(data, width, height, { inversionAttempts: "attemptBoth" });
    return typeof code?.data === "string" && code.data ? code.data : null;
  }

  // A link is offered only for a whole http or https address. `href` is the address as the
  // browser will open it, with an international host in its punycode form, and `host` is the
  // part to read before opening: user names put in front of it cannot hide the real host.
  function describeQrText(raw) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    let link = null;
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        if (OPENABLE_PROTOCOLS.includes(url.protocol) && url.hostname) {
          link = { href: url.href, host: url.host };
        }
      } catch {
        link = null;
      }
    }
    return { text, link };
  }

  // Checked again by the service worker before it opens a tab.
  function openableUrl(value) {
    try {
      const url = new URL(String(value ?? ""));
      return OPENABLE_PROTOCOLS.includes(url.protocol) && url.hostname ? url.href : null;
    } catch {
      return null;
    }
  }

  const api = Object.freeze({
    MAX_DECODE_PIXELS,
    decodeQrPixels,
    describeQrText,
    openableUrl,
    qrScale,
  });
  scope.RegionSnapQrCode = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
