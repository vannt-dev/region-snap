/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
(() => {
  const api = globalThis.regionSnapPin;
  const image = document.getElementById("image");
  const closeButton = document.getElementById("close");
  const notice = document.getElementById("notice");
  let dragging = false;
  let pendingMove = null;
  let noticeTimer = 0;

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.add("visible");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove("visible"), 1200);
  }

  function flushMove() {
    if (pendingMove) api.dragMove(pendingMove.x, pendingMove.y);
    pendingMove = null;
  }

  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target === closeButton) return;
    dragging = true;
    document.body.setPointerCapture(event.pointerId);
    api.dragStart(event.screenX, event.screenY);
  });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (!pendingMove) requestAnimationFrame(flushMove);
    pendingMove = { x: event.screenX, y: event.screenY };
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    flushMove();
    api.dragEnd();
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("dblclick", (event) => {
    if (event.button === 0) api.close();
  });
  window.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        api.opacity(event.deltaY);
      } else {
        api.zoom(
          event.deltaY,
          event.clientX / Math.max(1, window.innerWidth),
          event.clientY / Math.max(1, window.innerHeight),
        );
      }
    },
    { passive: false },
  );
  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    api.menu();
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const command = event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === "Escape") api.close();
    else if (command && key === "c") api.copy();
    else if (command && key === "s" && event.shiftKey) api.saveAs();
    else if (command && key === "s") api.save();
    else if (command && key === "0") api.resetZoom();
    else return;
    event.preventDefault();
  });
  closeButton.addEventListener("click", () => api.close());
  api.onNotice(showNotice);

  api
    .image()
    .then(({ dataUrl }) => {
      image.src = dataUrl;
    })
    .catch(() => api.close());
})();
