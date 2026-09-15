# Architecture

Region Snap deliberately uses plain JavaScript and Chrome Manifest V3 APIs. There is no runtime
framework or bundler, which keeps the Store package small and makes its contents auditable.

## Runtime boundaries

- `shared.js` is the communication contract. Add message names, selection states, command mappings,
  and default shortcuts here before using them in another context.
- `background.js` owns Chrome-only operations: active-tab validation, on-demand injection, command
  routing, and visible-tab capture.
- `geometry.js` contains pure rectangle and crop calculations. Keep DOM and Chrome APIs out of this
  module so it remains straightforward to unit test.
- `content.js` owns the selection lifecycle, overlay events, crop rendering, and local download. Its
  controller must remove every listener it creates when `destroy()` is called.
- `popup.js` only renders current state and sends commands. It does not inject scripts or capture tabs
  directly.
- `overlay.css` and `popup.css` contain their respective visual systems. Shared visual values use the
  `--rs-*` naming convention.

## Adding a feature

1. Extend the contract in `shared.js` if a new context-to-context message or state is needed.
2. Put pure calculations in `geometry.js` and add unit tests first.
3. Keep privileged Chrome API calls in `background.js`.
4. Add user-facing text to every `_locales/*/messages.json` file instead of hardcoding it.
5. Add new runtime files to `RUNTIME_FILES` in `scripts/project-config.mjs`.
6. Run `npm run ci`, `npm run smoke`, and `npm run package:store`.

## Adding a locale

Copy `_locales/en/messages.json` to a valid Chrome locale directory and translate only the `message`
values. Validation enforces identical keys and non-empty messages across every locale directory.

## Release invariant

`dist/` and the Store ZIP contain only files listed by `RUNTIME_FILES`. Tests, documentation,
dependencies, and source maps cannot enter a release accidentally. The manifest and package version
must remain aligned.
