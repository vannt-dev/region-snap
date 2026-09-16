(() => {
  const messages = {
    en: {
      settingsTitle: "Region Snap Settings",
      settingsSubtitle: "Customize how screenshots are captured and saved.",
      shortcutLabel: "System-wide shortcut",
      shortcutHelp: "Example: Alt+Shift+S or CommandOrControl+Shift+S",
      outputLabel: "Screenshot folder",
      choose: "Choose…",
      outputHelp: "Leave blank to use Pictures\\Region Snap.",
      clipboard: "Automatically copy screenshots to the clipboard",
      login: "Start with Windows",
      loginNote: "Start with Windows takes effect after installing the packaged app.",
      save: "Save settings",
      saving: "Saving…",
      saved: "Settings saved.",
      saveFailed: "Could not save settings.",
      resizeNw: "Resize from top left",
      resizeNe: "Resize from top right",
      resizeSw: "Resize from bottom left",
      resizeSe: "Resize from bottom right",
      toolbar: "Region capture tools",
      move: "Drag or use arrow keys to move the selection",
      capture: "Capture",
      cancel: "Cancel",
      hint: "Drag to select · Selections can cross displays · Esc to cancel",
      stitchingFailed: "Could not compose the display images.",
      outsideDisplays: "The selection is outside all displays.",
      capturing: "Capturing…",
      captureFailed: "Could not save the screenshot.",
    },
    vi: {
      settingsTitle: "Cài đặt Region Snap",
      settingsSubtitle: "Tùy chỉnh cách chụp và lưu ảnh.",
      shortcutLabel: "Phím tắt toàn hệ thống",
      shortcutHelp: "Ví dụ: Alt+Shift+S hoặc CommandOrControl+Shift+S",
      outputLabel: "Thư mục lưu ảnh",
      choose: "Chọn…",
      outputHelp: "Để trống để dùng Pictures\\Region Snap.",
      clipboard: "Tự động copy ảnh vào clipboard",
      login: "Khởi động cùng Windows",
      loginNote: "Tùy chọn khởi động cùng Windows có hiệu lực sau khi cài bản đóng gói.",
      save: "Lưu cài đặt",
      saving: "Đang lưu…",
      saved: "Đã lưu cài đặt.",
      saveFailed: "Không thể lưu cài đặt.",
      resizeNw: "Đổi kích thước góc trên trái",
      resizeNe: "Đổi kích thước góc trên phải",
      resizeSw: "Đổi kích thước góc dưới trái",
      resizeSe: "Đổi kích thước góc dưới phải",
      toolbar: "Công cụ chụp vùng",
      move: "Kéo hoặc dùng phím mũi tên để di chuyển vùng",
      capture: "Chụp",
      cancel: "Hủy",
      hint: "Kéo chuột để chọn vùng · Có thể kéo xuyên nhiều màn hình · Esc để hủy",
      stitchingFailed: "Không thể ghép ảnh từ màn hình.",
      outsideDisplays: "Vùng chụp không nằm trên màn hình nào.",
      capturing: "Đang chụp ảnh…",
      captureFailed: "Không thể lưu ảnh.",
    },
  };

  const requested = new URLSearchParams(globalThis.location.search).get("lang") || "en";
  const locale = requested.toLowerCase().startsWith("vi") ? "vi" : "en";
  const translate = (key) => messages[locale][key] || messages.en[key] || key;

  document.documentElement.lang = locale;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-title]")) {
    element.title = translate(element.dataset.i18nTitle);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
  }
  document.title = translate(document.body.dataset.titleKey || "settingsTitle");

  globalThis.RegionSnapI18n = Object.freeze({ locale, translate });
})();
