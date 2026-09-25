# Region Snap

[![Downloads](https://img.shields.io/github/downloads/vannt-dev/region-snap/total)](https://github.com/vannt-dev/region-snap/releases)

_[Đọc bằng tiếng Việt](README.vi.md)_

A private screenshot utility for Chrome and Windows. The Chrome extension can lock onto live page
content, while the desktop app captures regions across multiple displays with mixed DPI.

## Features

- Quick-select a single element with a click.
- Drag to select a free-form region.
- Move and resize a locked region.
- The page underneath stays fully interactive after the region locks.
- Capture from the toolbar, `Enter`, or `Alt+Shift+C`.
- While a move handle `⠿` is focused, use arrow keys to nudge it; hold `Shift` to move 10 px.
- Crops against the real screenshot dimensions so zoom and display scaling stay accurate.
- Exports a PNG with 12 px rounded corners and four transparent corners.
- English UI by default; automatically switches to Vietnamese based on the Chrome language.
- Only injects into a tab on explicit user request; the extension never runs persistently on every
  site.

## Windows desktop app

- Lives in the system tray with a configurable global shortcut.
- Selects across multiple monitors and preserves mixed-DPI output quality.
- Captures a fresh frame after hiding the overlay, suitable for video and other dynamic content.
- Saves PNG files locally and can copy them directly to the clipboard.
- Supports English and Vietnamese UI, keyboard movement/resizing, and optional startup with Windows.

Run `npm run desktop:start` during development or `npm run desktop:dist` to create the NSIS
installer. See [`desktop/README.md`](desktop/README.md) for desktop usage, packaging, and code-signing
details.

## Development setup

Requires Node.js 22 or later.

```powershell
npm ci
npm run ci
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Run `npm run build`.
4. Choose **Load unpacked** and point it at the `dist/` folder.
5. Pin Region Snap to the toolbar if you want to use the popup.

After every source change, click **Reload** on the extension card before testing again.

## Usage

1. Click the extension icon or press `Alt+Shift+S`.
2. Click an element, or drag to select a free-form region.
3. Use the round handles to resize; drag the `⠿` handle to move the region.
4. Interact with the page as needed to reach the exact state you want to capture.
5. Click **Capture**, press `Enter`, or use `Alt+Shift+C`.
6. Press `Esc` or the **×** button to close the overlay.

Keyboard shortcuts can be changed at `chrome://extensions/shortcuts`.

## Permissions

- `activeTab`: access to the current tab only after a direct user action.
- `scripting`: injects the region-selection UI into the active tab.

The extension processes images entirely in the browser and never sends images to a server.

Public privacy policy: <https://vannt-dev.github.io/region-snap/privacy-policy.html>

## Architecture and performance

Module boundaries and extension guidelines live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- `background.js` routes commands, prevents duplicate injection on the same tab, and calls Chrome's
  capture API.
- `shared.js` is the single contract for messages, state, commands, and shortcuts across contexts.
- `geometry.js` holds all region, resize, move, and crop-scaling math; it never touches the DOM and
  is unit tested in isolation.
- `content.js` only exists in a tab after the user requests region selection.
- High-frequency pointer events are coalesced and rendered at most once per animation frame.
- The overlay uses CSS custom properties and hardware-accelerated transforms, and never reads layout
  inside the drag/resize loop.
- After teardown, the content script keeps only a lightweight message listener; no pointer, scroll,
  or resize listeners remain.

## Chrome limitations

Chrome does not allow extensions to inject into certain internal pages such as `chrome://`, the
Chrome Web Store, and some PDF/special tabs. For `file://` URLs, users may need to enable
**Allow access to file URLs** in the extension's details.

## Pre-release checks

```powershell
npm run ci
npm run smoke
npm run package:store
npm run desktop:test
npm run desktop:dist
```

A file ready to upload to the Chrome Web Store is produced at
`release/region-snap-interactive-screenshot-v<version>-store.zip`. The pipeline verifies the ZIP
contents against an allowlist so tests, source maps, internal docs, and dev dependencies never leak
into the release package.

The Windows installer is produced at `release/Region-Snap-Setup-<version>.exe`. Tagged releases
publish it only when the Authenticode secrets documented in [`desktop/README.md`](desktop/README.md)
are configured; otherwise the Chrome package is released first and the unsigned installer is omitted.

## Chrome Web Store

- Run `npm run store:assets` to regenerate icons, the promo tile, and screenshots at the correct
  sizes.
- Listing copy, permission justifications, and the submission checklist live in
  `store-assets/STORE_LISTING.md`.
- Privacy policy: [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md), published at
  <https://vannt-dev.github.io/region-snap/privacy-policy.html>.
- CI checks format, lint, test, build, manifest, and assets; the release workflow creates a GitHub
  Release when a `v<version>` tag is pushed.

Per current Chrome Web Store requirements, the asset set includes a 128×128 icon, a 440×280 small
promo tile, two 1280×800 screenshots, and an optional 1400×560 marquee.
