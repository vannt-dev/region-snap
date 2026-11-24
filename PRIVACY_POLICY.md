# Privacy Policy for Region Snap

Last updated: November 24, 2026

## Overview

Region Snap captures a user-selected portion of the currently visible browser tab. All image processing happens locally in the browser.

## Data handling

- Region Snap does not collect, transmit, sell, or share personal information.
- Region Snap does not use analytics, advertising, telemetry, or tracking scripts.
- Region Snap does not store browsing history, page URLs, page content, screenshots, or form data.
- A screenshot is held in memory only long enough to crop the selected region and create the image requested by the user.
- The resulting image is downloaded directly to the user's device, or placed on the clipboard when the user chooses to copy it.
- When the user picks Text from image, the text in the selected region is recognised inside the browser by the text recognition that ships with the extension, and only the text is placed on the clipboard. The image is not sent anywhere.
- When the user picks QR code, the code in the selected region is decoded inside the browser by the decoder that ships with the extension. Its text is only shown to the user; it is copied, or a web address opened in a new tab, only when the user clicks to do so.
- To capture the last region again, Region Snap keeps, for each tab, the position and size of the last region captured there in the browser's session storage, which is held in memory and cleared when the browser closes. No page address, page content or image is kept with it.
- Region Snap stores its preferences on the device (image format, rounded corners, file name prefix, default action, capture delay, burst and capture-on-change counts, and the last mark and highlighter colours). They never leave the device.

## Permission usage

- `activeTab` gives temporary access to the current tab only after the user clicks the extension or invokes its keyboard shortcut. It is required to capture the visible tab selected by the user.
- `scripting` injects the region-selection interface into the active tab only after an explicit user action.
- `offscreen` opens a hidden extension page that runs the bundled text recognition while Text from image reads a region, and closes it right after.
- `storage` keeps the preferences listed above in the browser's local extension storage, and the last captured region of each tab in its session storage.

## Remote services

Region Snap does not communicate with external servers and does not execute remotely hosted code.

## Contact and source code

Source code and issue tracking: <https://github.com/vannt-dev/region-snap>
