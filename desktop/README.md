# Region Snap Desktop

Windows desktop app kept beside the Chrome extension so both products can share geometry logic.

## Run

```powershell
npm install
npm run desktop:start
```

Region Snap stays in the system tray. Press `Alt+Shift+S` or double-click the tray icon, drag a region, then press **Capture** or `Enter`. The transparent overlay keeps video and other dynamic content visible while selecting. At capture time the overlay is hidden and a fresh desktop frame is cropped, copied to the clipboard, and saved under `Pictures/Region Snap`.

To copy the text in a region instead of the image, select the region and press **Copy text** or
`T`. Region Snap recognises English and Vietnamese, puts the text on the clipboard, and shows how many
lines it copied; when the region has no readable text, the overlay stays open so you can adjust the
selection. Recognition runs on your device with Tesseract (WebAssembly) and the English and
Vietnamese models bundled in the app. Nothing is downloaded or uploaded; on first use the two models
(about 4.4 MB) are copied to `ocr-languages` in the app data folder.

To keep a capture on screen while you work, select the region and press **Pin** or `P`. The
capture opens in a small frameless window that stays on top of other windows, exactly over the
region you selected:

- Drag it to move it.
- Scroll to zoom (around the pointer); `Ctrl`+scroll changes its opacity. `Ctrl+0` returns to the
  actual size.
- Right-click for **Copy**, **Save** (to the screenshot folder), **Save as…**, opacity presets,
  **Actual size**, **Close** and **Close all pins**. `Ctrl+C`, `Ctrl+S` and `Ctrl+Shift+S` do the
  same from the keyboard.
- `Esc`, a double-click or the × button in the corner closes the pin.

Several pins can be open at once. The tray menu has **Pin last capture** (the last saved or pinned
capture, at the place it was taken) and **Close all pins**. In Settings you can give **Pin last
capture** its own global shortcut, such as `Alt+Shift+P`; it is off until you set one.

Open **Cài đặt…** from the tray menu to change the shortcuts, output directory, clipboard behavior, or Windows login startup.

## Package for Windows

```powershell
npm run desktop:dist
```

The NSIS installer is written to `release/`.

## Features

- Configurable global capture shortcut
- Cross-monitor selection and mixed-DPI image stitching
- Drag, resize, and move a region
- Keyboard move and resize controls (arrow keys, or `Shift` for 10 px steps)
- Fresh-frame capture for video and other dynamic content
- Crops each display before transferring image data to keep multi-monitor memory use bounded
- Configurable PNG output directory and clipboard copy
- Offline Copy text (OCR) for English and Vietnamese, from the toolbar or `T`
- Pin captures as always-on-top windows with zoom, opacity, copy and save, from the toolbar or `P`
- Optional startup with Windows in packaged builds
- Vietnamese and English desktop UI based on the Windows locale
- Success notification containing the saved file path
- Millisecond filenames with collision protection
- Warning for captures that are almost entirely black

Protected/DRM surfaces and the Windows secure desktop may not be capturable. macOS permission handling and Linux portals are intentionally deferred until after the Windows MVP is validated.

## Signed releases

Tagged GitHub releases sign the installer when an Authenticode certificate is configured in these repository secrets:

- `WINDOWS_CSC_LINK`: a base64-encoded `.pfx` certificate or a certificate URL supported by electron-builder
- `WINDOWS_CSC_KEY_PASSWORD`: the certificate password

The release workflow builds the Chrome Web Store ZIP and Windows NSIS installer separately. When signing secrets are available, it verifies both the packaged executable and installer signatures before publishing them. Without a certificate the installer is attached unsigned, and Windows SmartScreen warns before it runs (More info, then Run anyway).
