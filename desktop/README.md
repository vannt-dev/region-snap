# Region Snap Desktop

Windows desktop app kept beside the Chrome extension so both products can share geometry logic.

## Run

```powershell
npm install
npm run desktop:start
```

Region Snap stays in the system tray. Press `Alt+Shift+S` or double-click the tray icon, drag a region, then press **Capture** or `Enter`. The transparent overlay keeps video and other dynamic content visible while selecting. At capture time the overlay is hidden and a fresh desktop frame is cropped, copied to the clipboard, and saved under `Pictures/Region Snap`.

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
- Optional startup with Windows in packaged builds
- Vietnamese and English desktop UI based on the Windows locale
- Success notification containing the saved file path
- Millisecond filenames with collision protection
- Warning for captures that are almost entirely black

Protected/DRM surfaces and the Windows secure desktop may not be capturable. macOS permission handling and Linux portals are intentionally deferred until after the Windows MVP is validated.

## Signed releases

Tagged GitHub releases require an Authenticode certificate. Configure these repository secrets:

- `WINDOWS_CSC_LINK`: a base64-encoded `.pfx` certificate or a certificate URL supported by electron-builder
- `WINDOWS_CSC_KEY_PASSWORD`: the certificate password

The release workflow builds the Chrome Web Store ZIP and Windows NSIS installer separately. When signing secrets are available, it verifies both the packaged executable and installer signatures before publishing them. Without a certificate, the Chrome package is released first and the unsigned Windows installer is omitted; rerunning the workflow after configuring the secrets attaches the signed installer to the same release. Manual workflow runs may still produce unsigned test artifacts.
