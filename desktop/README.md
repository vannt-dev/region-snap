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

Open **Cài đặt…** from the tray menu to change the shortcut, output directory, clipboard behavior, or Windows login startup.

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
