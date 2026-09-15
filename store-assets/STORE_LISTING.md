# Chrome Web Store Listing — Region Snap

## Product details

**Name:** Region Snap - Interactive Screenshot

**Category:** Productivity

**Language:** English (add Vietnamese as a localized listing)

### Summary

Select a page region, keep interacting with the live page, and capture the exact moment as a private local PNG.

### Detailed description

Region Snap gives you precise control over browser screenshots without interrupting the page state.

Choose any visible element with one click or drag a custom region. After the region is locked, the page remains interactive—open a menu, trigger a hover state, type into a field, or wait for the right animation frame. Capture only when the moment is right.

Key features:

- One-click element selection and free-form region selection
- Move and resize controls with keyboard fine-tuning
- Live page interaction while the capture region stays locked
- Accurate cropping across browser zoom and display scaling
- Rounded PNG output with transparent corners
- Keyboard shortcuts for fast selection and capture
- Fully local processing with no uploads, analytics, or tracking

Region Snap requests access only after a direct user action and does not run continuously on every website.

## Privacy dashboard answers

### Single purpose

Region Snap's single purpose is to let users select and save a precise region of the currently visible browser tab as a PNG screenshot.

### Permission justifications

**`activeTab`:** Required to capture the currently visible tab only after the user explicitly clicks the extension action or invokes a Region Snap keyboard shortcut.

**`scripting`:** Required to inject the region-selection overlay into the active tab after an explicit user action. The extension does not inject into every page at load time.

### Data-use disclosure

The extension handles website content only to create the screenshot requested by the user. Screenshot pixels are processed temporarily in local browser memory, are not stored by the extension, and are never transmitted to the developer or a third party. No data is collected or sold.

### Privacy policy

Enter this public URL in the Privacy tab of the Developer Dashboard:

<https://vannt-dev.github.io/region-snap/privacy-policy.html>

## Graphic assets

- Store icon: `store-assets/icon-128.png` — 128×128 PNG
- Small promo tile: `store-assets/small-promo-440x280.png` — 440×280 PNG
- Marquee promo tile: `store-assets/marquee-promo-1400x560.png` — 1400×560 PNG (optional)
- Screenshot 1: `store-assets/screenshots/01-select-region-1280x800.png`
- Screenshot 2: `store-assets/screenshots/02-popup-1280x800.png`

Regenerate all images with `npm run store:assets`.

## Submission checklist

- [ ] Run `npm ci` on a clean checkout.
- [ ] Run `npm run ci`.
- [ ] Run `npm run smoke` after installing Playwright Chromium.
- [ ] Run `npm run package:store` and upload the versioned ZIP from `release/`.
- [ ] Verify package version is higher than the currently published version.
- [ ] Upload the required Store icon, small promo tile, and at least one screenshot.
- [ ] Enter the single-purpose and permission justifications above.
- [ ] Declare local handling of website content in the Privacy tab.
- [x] Publish the privacy policy at a public HTTPS URL.
- [ ] Confirm no remote code, analytics, ads, or data transmission were added.
- [ ] Test selection, page interaction, resize, capture, transparent corners, keyboard shortcuts, zoom, and restricted-page errors.
