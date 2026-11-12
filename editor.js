/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// The editor page: opens an image file, a pasted image or a dropped one, and hands it to the
// overlay's marking tools. Everything stays in this tab; nothing is uploaded.
const Geometry = globalThis.RegionSnapGeometry;
const fileInput = document.getElementById("file-input");
const stage = document.getElementById("stage");
const errorMessage = document.getElementById("error-message");

// Pictures a canvas can draw and save; vector and document formats are left out.
const IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);
// The header, then room above the image for the marking toolbar.
const IMAGE_TOP = 112;
const IMAGE_MARGIN = 24;

let imageUrl = null;
// Counts opened images, so an image still decoding does not replace a newer one.
let openCount = 0;

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}

function clearImage() {
  stage.replaceChildren();
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
}

// Back to the start screen when the image is closed with Esc or ×.
function showStart() {
  clearImage();
  document.body.dataset.view = "start";
}

function imageFile(files) {
  return Array.from(files || []).find((file) => file && file.type.startsWith("image/")) || null;
}

async function openFile(file) {
  if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) {
    showError(t("editorNotImage"));
    return;
  }
  openCount += 1;
  const opened = openCount;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.className = "stage__image";
  image.alt = file.name || "";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    if (opened === openCount) showError(t("editorReadError"));
    return;
  }
  if (opened !== openCount) {
    URL.revokeObjectURL(url);
    return;
  }
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  if (!Geometry.fitsCanvas(size)) {
    URL.revokeObjectURL(url);
    showError(t("editorTooLarge"));
    return;
  }

  showError("");
  clearImage();
  imageUrl = url;
  const box = Geometry.fitImage(
    size,
    { width: window.innerWidth, height: window.innerHeight },
    { pixelRatio: window.devicePixelRatio || 1, top: IMAGE_TOP, margin: IMAGE_MARGIN },
  );
  image.style.left = `${box.left}px`;
  image.style.top = `${box.top}px`;
  image.style.width = `${box.width}px`;
  image.style.height = `${box.height}px`;
  stage.appendChild(image);
  document.body.dataset.view = "image";
  if (!window.__regionSnapController?.openImage(image, { onClose: showStart })) {
    showStart();
    showError(t("editorReadError"));
  }
}

function chooseFile() {
  fileInput.value = "";
  fileInput.click();
}

fileInput.accept = IMAGE_TYPES.join(",");
fileInput.addEventListener("change", () => openFile(fileInput.files?.[0]));
document.getElementById("open-image").addEventListener("click", chooseFile);
document.getElementById("open-image-start").addEventListener("click", chooseFile);

// Ctrl+V anywhere on the page opens an image from the clipboard; text pasted into a note is
// left alone.
document.addEventListener("paste", (event) => {
  const file = imageFile(event.clipboardData?.files);
  if (!file) {
    if (!(event.target instanceof HTMLTextAreaElement)) showError(t("editorNoClipboardImage"));
    return;
  }
  event.preventDefault();
  openFile(file);
});

document.addEventListener("dragover", (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) openFile(file);
});

localizeDocument();
