(() => {
  const Geometry = globalThis.RegionSnapGeometry;
  const { translate } = globalThis.RegionSnapI18n;
  const api = globalThis.regionSnapDesktop;
  const selector = document.getElementById("selector");
  const sizeLabel = document.getElementById("size");
  const moveButton = document.getElementById("move");
  const captureButton = document.getElementById("capture");
  const cancelButton = document.getElementById("cancel");
  const status = document.getElementById("status");
  const MIN_SIZE = 8;
  const TOOLBAR_WIDTH = 230;
  const TOOLBAR_HEIGHT = 42;

  let rect = null;
  let dragStart = null;
  let activeHandle = null;
  let moveOffset = null;
  let ready = false;

  const bounds = () => ({ width: window.innerWidth, height: window.innerHeight });
  const ownControl = (target) => target.closest?.("button, .toolbar");

  function render() {
    if (!rect) {
      selector.dataset.hasSelection = "false";
      return;
    }
    selector.dataset.hasSelection = "true";
    selector.style.setProperty("--x", `${rect.left}px`);
    selector.style.setProperty("--y", `${rect.top}px`);
    selector.style.setProperty("--w", `${rect.width}px`);
    selector.style.setProperty("--h", `${rect.height}px`);
    const preferredTop =
      rect.top > TOOLBAR_HEIGHT + 16 ? rect.top - TOOLBAR_HEIGHT - 8 : rect.top + rect.height + 8;
    const toolbarLeft = Geometry.clamp(rect.left, 8, window.innerWidth - TOOLBAR_WIDTH - 8);
    const toolbarTop = Geometry.clamp(preferredTop, 8, window.innerHeight - TOOLBAR_HEIGHT - 8);
    selector.style.setProperty("--tx", `${toolbarLeft}px`);
    selector.style.setProperty("--ty", `${toolbarTop}px`);
    sizeLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  function showStatus(message) {
    status.textContent = message;
    status.classList.toggle("visible", Boolean(message));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const sourceImage = new Image();
      sourceImage.onload = () => resolve(sourceImage);
      sourceImage.onerror = () => reject(new Error(translate("stitchingFailed")));
      sourceImage.src = dataUrl;
    });
  }

  async function stitchCapture(capture) {
    const selection = capture.selection.rect;
    const pieces = capture.pieces;
    if (!pieces.length) throw new Error(translate("outsideDisplays"));

    const scaleX = Math.max(...pieces.map((piece) => piece.scale.x));
    const scaleY = Math.max(...pieces.map((piece) => piece.scale.y));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(selection.width * scaleX));
    canvas.height = Math.max(1, Math.ceil(selection.height * scaleY));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await Promise.all(
      pieces.map(async (piece) => {
        const sourceImage = await loadImage(piece.dataUrl);
        context.drawImage(
          sourceImage,
          piece.sourceRect.left,
          piece.sourceRect.top,
          piece.sourceRect.width,
          piece.sourceRect.height,
          (piece.bounds.left - selection.left) * scaleX,
          (piece.bounds.top - selection.top) * scaleY,
          piece.bounds.width * scaleX,
          piece.bounds.height * scaleY,
        );
      }),
    );
    return canvas.toDataURL("image/png");
  }

  function onPointerDown(event) {
    if (event.button !== 0 || selector.dataset.state === "saving") return;
    const handle = event.target.closest?.(".handle");
    if (handle && rect) {
      activeHandle = handle.dataset.handle;
      event.preventDefault();
      return;
    }
    if (ownControl(event.target)) return;
    dragStart = { x: event.clientX, y: event.clientY };
    rect = { left: event.clientX, top: event.clientY, width: 0, height: 0 };
    render();
  }

  function onPointerMove(event) {
    if (activeHandle && rect) {
      rect = Geometry.resizeRect(
        rect,
        activeHandle,
        { x: event.clientX, y: event.clientY },
        bounds(),
        MIN_SIZE,
      );
      render();
    } else if (moveOffset && rect) {
      rect = Geometry.moveRectTo(
        rect,
        event.clientX - moveOffset.x,
        event.clientY - moveOffset.y,
        bounds(),
      );
      render();
    } else if (dragStart) {
      rect = Geometry.fitRectToBounds(
        Geometry.rectFromPoints(dragStart, { x: event.clientX, y: event.clientY }),
        bounds(),
      );
      render();
    }
  }

  function onPointerUp() {
    if (dragStart && (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE)) rect = null;
    dragStart = null;
    activeHandle = null;
    moveOffset = null;
    render();
  }

  function arrowDelta(event) {
    const amount = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") return { x: -amount, y: 0 };
    if (event.key === "ArrowRight") return { x: amount, y: 0 };
    if (event.key === "ArrowUp") return { x: 0, y: -amount };
    if (event.key === "ArrowDown") return { x: 0, y: amount };
    return null;
  }

  function moveWithKeyboard(event) {
    const delta = arrowDelta(event);
    if (!rect || !delta) return;
    event.preventDefault();
    rect = Geometry.moveRectTo(rect, rect.left + delta.x, rect.top + delta.y, bounds());
    render();
  }

  function resizeWithKeyboard(event, handle) {
    const delta = arrowDelta(event);
    if (!rect || !delta) return;
    event.preventDefault();
    const point = {
      x: (handle.endsWith("e") ? rect.left + rect.width : rect.left) + delta.x,
      y: (handle.startsWith("s") ? rect.top + rect.height : rect.top) + delta.y,
    };
    rect = Geometry.resizeRect(rect, handle, point, bounds(), MIN_SIZE);
    render();
  }

  async function saveSelection() {
    if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE || !ready) return;
    selector.dataset.state = "saving";
    showStatus(translate("capturing"));
    try {
      const capture = await api.captureSources({
        rect,
        viewport: bounds(),
      });
      const dataUrl = await stitchCapture(capture);
      await api.save(dataUrl);
    } catch (error) {
      api.restore();
      selector.dataset.state = "ready";
      showStatus(error?.message || translate("captureFailed"));
    }
  }

  selector.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  moveButton.addEventListener("mousedown", (event) => {
    if (!rect || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    moveOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });
  moveButton.addEventListener("keydown", moveWithKeyboard);
  for (const handle of selector.querySelectorAll(".handle")) {
    handle.addEventListener("keydown", (event) => resizeWithKeyboard(event, handle.dataset.handle));
  }
  captureButton.addEventListener("click", saveSelection);
  cancelButton.addEventListener("click", api.cancel);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") api.cancel();
    if (event.key === "Enter") saveSelection();
  });
  window.addEventListener("resize", () => {
    if (rect) rect = Geometry.fitRectToBounds(rect, bounds());
    render();
  });

  api.onCaptureReady(() => {
    ready = true;
  });
})();
