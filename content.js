(() => {
  const CONTENT_VERSION = chrome.runtime.getManifest().version;
  const previousController = window.__regionSnapController;
  if (previousController?.version === CONTENT_VERSION) return;
  previousController?.destroy?.();
  document.getElementById("region-snap-root")?.remove();

  const Geometry = globalThis.RegionSnapGeometry;
  const Shared = globalThis.RegionSnapShared;
  if (!Geometry || !Shared) {
    console.error("Region Snap: required modules are unavailable.");
    return;
  }

  const { MESSAGE, STATE } = Shared;
  const MIN_SIZE = 8;
  const t = (key) => chrome.i18n.getMessage(key) || key;

  let state = STATE.IDLE;
  let rect = null;
  let hoveredElement = null;
  let pickTarget = null;
  let dragStart = null;
  let dragged = false;
  let activeHandle = null;
  let moving = false;
  let moveOffset = null;
  let capturing = false;
  let sessionId = 0;
  let clickCleanupTimer = null;
  let toastTimer = null;
  let renderFrame = null;
  let pendingRect = null;
  let pendingHoverElement = null;
  let previousCursor = "";
  let hasShownSelectHint = false;
  let hasShownLockedHint = false;

  let root;
  let dim;
  let border;
  let toolbar;
  let gripButton;
  let sizeLabel;
  let toast;
  const handles = {};

  const TOOLBAR_WIDTH = 224;
  const TOOLBAR_HEIGHT = 40;
  const CORNER_RADIUS = 12;

  function viewportBounds() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function fitRectToViewport(value) {
    return Geometry.fitRectToBounds(value, viewportBounds());
  }

  function elementRect(element) {
    if (!(element instanceof Element) || !element.isConnected) return null;
    const bounds = element.getBoundingClientRect();
    return fitRectToViewport({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  }

  function injectOverlay() {
    if (root) return;

    root = document.createElement("div");
    root.id = "region-snap-root";
    root.dataset.mode = state;
    root.dataset.hasRect = "false";
    root.dataset.interacting = "false";

    dim = document.createElement("div");
    dim.className = "region-snap-dim";

    border = document.createElement("div");
    border.className = "region-snap-border";

    toolbar = document.createElement("div");
    toolbar.className = "region-snap-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", t("overlayToolbarLabel"));
    toolbar.innerHTML = `
      <button class="region-snap-grip" type="button" title="${t("overlayMove")}" aria-label="${t("overlayMove")}">⠿</button>
      <span class="region-snap-size" aria-live="polite"></span>
      <button class="region-snap-capture" type="button">${t("overlayCapture")}</button>
      <button class="region-snap-cancel" type="button" title="${t("overlayCancel")}" aria-label="${t("overlayCancel")}">×</button>
    `;
    gripButton = toolbar.querySelector(".region-snap-grip");
    sizeLabel = toolbar.querySelector(".region-snap-size");

    toast = document.createElement("div");
    toast.className = "region-snap-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    root.append(dim, border, toolbar, toast);
    for (const position of ["nw", "ne", "sw", "se"]) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `region-snap-handle ${position}`;
      handle.dataset.handle = position;
      handle.setAttribute("aria-label", `${t("overlayResize")} ${position.toUpperCase()}`);
      handles[position] = handle;
      root.appendChild(handle);
    }

    document.documentElement.appendChild(root);
    toolbar.querySelector(".region-snap-capture").addEventListener("click", (event) => {
      if (event.isTrusted) doCapture();
    });
    toolbar.querySelector(".region-snap-cancel").addEventListener("click", (event) => {
      if (event.isTrusted) reset();
    });
    gripButton.addEventListener("mousedown", onMoveGripDown);
    Object.values(handles).forEach((handle) => handle.addEventListener("mousedown", onHandleDown));
  }

  function removeOverlay() {
    root?.remove();
    root = dim = border = toolbar = gripButton = sizeLabel = toast = null;
    for (const position of Object.keys(handles)) delete handles[position];
  }

  function positionToolbar(value) {
    const viewport = viewportBounds();
    const left = Geometry.clamp(value.left, 8, viewport.width - TOOLBAR_WIDTH - 8);
    const preferredTop =
      value.top >= TOOLBAR_HEIGHT + 12
        ? value.top - TOOLBAR_HEIGHT - 8
        : value.top + value.height + 8;
    return {
      left,
      top: Geometry.clamp(preferredTop, 8, viewport.height - TOOLBAR_HEIGHT - 8),
    };
  }

  function applyRect(value) {
    if (!value || !root) return;
    root.dataset.mode = state;
    root.dataset.hasRect = "true";
    const toolbarPosition = positionToolbar(value);
    root.style.setProperty("--rs-left", `${value.left}px`);
    root.style.setProperty("--rs-top", `${value.top}px`);
    root.style.setProperty("--rs-width", `${value.width}px`);
    root.style.setProperty("--rs-height", `${value.height}px`);
    root.style.setProperty("--rs-toolbar-left", `${toolbarPosition.left}px`);
    root.style.setProperty("--rs-toolbar-top", `${toolbarPosition.top}px`);

    const nextSize = `${Math.round(value.width)} × ${Math.round(value.height)}`;
    if (sizeLabel.textContent !== nextSize) sizeLabel.textContent = nextSize;
  }

  function flushRender() {
    renderFrame = null;
    let value = pendingRect;
    if (pendingHoverElement && state === STATE.HOVERING) {
      value = elementRect(pendingHoverElement);
    }
    pendingRect = null;
    pendingHoverElement = null;
    if (value) applyRect(value);
  }

  function requestRender() {
    if (renderFrame == null) renderFrame = requestAnimationFrame(flushRender);
  }

  function renderRect(value) {
    pendingHoverElement = null;
    pendingRect = value;
    requestRender();
  }

  function renderHoveredElement(element) {
    pendingRect = null;
    pendingHoverElement = element;
    requestRender();
  }

  function showToast(message, kind = "info") {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast?.classList.remove("is-visible"), 2600);
  }

  function setCursor(value) {
    document.documentElement.style.cursor = value;
  }

  function isOwnElement(target) {
    return Boolean(root?.contains(target));
  }

  function startPicking() {
    const pageCursor =
      state === STATE.IDLE ? document.documentElement.style.cursor : previousCursor;
    reset();
    state = STATE.HOVERING;
    previousCursor = pageCursor;
    injectOverlay();
    root.dataset.mode = state;
    setCursor("crosshair");
    document.addEventListener("mousemove", onHoverMove, true);
    document.addEventListener("mousedown", onPickMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onPickingScroll, true);
    window.addEventListener("resize", onViewportResize);
    if (!hasShownSelectHint) {
      showToast(t("overlaySelectHint"));
      hasShownSelectHint = true;
    }
  }

  function onHoverMove(event) {
    if (state !== STATE.HOVERING || isOwnElement(event.target)) return;
    if (event.target === hoveredElement) return;
    hoveredElement = event.target;
    renderHoveredElement(hoveredElement);
  }

  function onPickingScroll() {
    if (state === STATE.HOVERING && hoveredElement) renderHoveredElement(hoveredElement);
  }

  function stopPageEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPickMouseDown(event) {
    if (
      !event.isTrusted ||
      state !== STATE.HOVERING ||
      isOwnElement(event.target) ||
      event.button !== 0
    )
      return;
    stopPageEvent(event);
    state = STATE.DRAGGING;
    root.dataset.mode = state;
    pickTarget = event.target;
    dragStart = { x: event.clientX, y: event.clientY };
    dragged = false;
    document.addEventListener("mousemove", onDragMove, true);
    document.addEventListener("mouseup", onDragUp, true);
    document.addEventListener("click", onPickingClick, true);
  }

  function onDragMove(event) {
    if (!event.isTrusted || state !== STATE.DRAGGING || !dragStart) return;
    stopPageEvent(event);
    const dx = Math.abs(event.clientX - dragStart.x);
    const dy = Math.abs(event.clientY - dragStart.y);
    if (dx > 4 || dy > 4) {
      dragged = true;
      renderRect(
        fitRectToViewport(
          Geometry.rectFromPoints(dragStart, {
            x: event.clientX,
            y: event.clientY,
          }),
        ),
      );
    }
  }

  function onDragUp(event) {
    if (!event.isTrusted || state !== STATE.DRAGGING) return;
    stopPageEvent(event);
    document.removeEventListener("mousemove", onDragMove, true);
    document.removeEventListener("mouseup", onDragUp, true);

    const selectedRect =
      dragged && dragStart
        ? fitRectToViewport(
            Geometry.rectFromPoints(dragStart, { x: event.clientX, y: event.clientY }),
          )
        : elementRect(pickTarget || hoveredElement);

    lockRegion(selectedRect);
    clearTimeout(clickCleanupTimer);
    clickCleanupTimer = window.setTimeout(() => {
      document.removeEventListener("click", onPickingClick, true);
    }, 0);
  }

  function onPickingClick(event) {
    if (!event.isTrusted) return;
    stopPageEvent(event);
    clearTimeout(clickCleanupTimer);
    document.removeEventListener("click", onPickingClick, true);
  }

  function lockRegion(value) {
    if (!value || value.width < MIN_SIZE || value.height < MIN_SIZE) {
      state = STATE.HOVERING;
      root.dataset.mode = state;
      root.dataset.hasRect = "false";
      hoveredElement = null;
      pendingRect = null;
      showToast(t("overlayTooSmall"), "error");
      return;
    }

    rect = fitRectToViewport(value);
    dragStart = null;
    pickTarget = null;
    dragged = false;
    state = STATE.LOCKED;
    setCursor(previousCursor);
    document.removeEventListener("mousemove", onHoverMove, true);
    document.removeEventListener("mousedown", onPickMouseDown, true);
    document.removeEventListener("scroll", onPickingScroll, true);
    document.addEventListener("mousedown", onLockedPageMouseDown, true);
    root.dataset.mode = state;
    renderRect(rect);
    gripButton?.focus({ preventScroll: true });
    if (!hasShownLockedHint) {
      showToast(t("overlayLockedHint"));
      hasShownLockedHint = true;
    }
  }

  function onLockedPageMouseDown(event) {
    if (!event.isTrusted) return;
    if (!isOwnElement(event.target) && isOwnElement(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function onHandleDown(event) {
    if (!event.isTrusted || !rect || state !== STATE.LOCKED || event.button !== 0) return;
    stopPageEvent(event);
    activeHandle = event.currentTarget.dataset.handle;
    root.dataset.interacting = "true";
    document.addEventListener("mousemove", onHandleMove, true);
    document.addEventListener("mouseup", onHandleUp, true);
  }

  function onHandleMove(event) {
    if (!event.isTrusted || !activeHandle || !rect) return;
    stopPageEvent(event);
    rect = Geometry.resizeRect(
      rect,
      activeHandle,
      { x: event.clientX, y: event.clientY },
      viewportBounds(),
      MIN_SIZE,
    );
    renderRect(rect);
  }

  function onHandleUp(event) {
    if (event && !event.isTrusted) return;
    if (event) stopPageEvent(event);
    activeHandle = null;
    if (root) root.dataset.interacting = "false";
    document.removeEventListener("mousemove", onHandleMove, true);
    document.removeEventListener("mouseup", onHandleUp, true);
  }

  function onMoveGripDown(event) {
    if (!event.isTrusted || !rect || state !== STATE.LOCKED || event.button !== 0) return;
    stopPageEvent(event);
    moving = true;
    root.dataset.interacting = "true";
    moveOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    document.addEventListener("mousemove", onMoveMove, true);
    document.addEventListener("mouseup", onMoveUp, true);
  }

  function onMoveMove(event) {
    if (!event.isTrusted || !moving || !rect || !moveOffset) return;
    stopPageEvent(event);
    rect = Geometry.moveRectTo(
      rect,
      event.clientX - moveOffset.x,
      event.clientY - moveOffset.y,
      viewportBounds(),
    );
    renderRect(rect);
  }

  function onMoveUp(event) {
    if (event && !event.isTrusted) return;
    if (event) stopPageEvent(event);
    moving = false;
    if (root) root.dataset.interacting = "false";
    moveOffset = null;
    document.removeEventListener("mousemove", onMoveMove, true);
    document.removeEventListener("mouseup", onMoveUp, true);
  }

  function moveWithKeyboard(event) {
    if (!rect || state !== STATE.LOCKED || event.target !== gripButton) return false;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return false;

    const step = event.shiftKey ? 10 : 1;
    rect = Geometry.moveRectTo(
      rect,
      rect.left + direction[0] * step,
      rect.top + direction[1] * step,
      viewportBounds(),
    );
    renderRect(rect);
    return true;
  }

  function onKeyDown(event) {
    if (!event.isTrusted) return;
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
      return;
    }
    if (event.key === "Enter" && state === STATE.LOCKED && event.target === gripButton) {
      event.preventDefault();
      doCapture();
      return;
    }
    if (moveWithKeyboard(event)) event.preventDefault();
  }

  function onViewportResize() {
    if (state === STATE.HOVERING && hoveredElement) {
      renderHoveredElement(hoveredElement);
      return;
    }
    if (!rect) return;
    rect = fitRectToViewport(rect);
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
      reset();
    } else {
      renderRect(rect);
    }
  }

  function removeInteractionListeners() {
    document.removeEventListener("mousemove", onHoverMove, true);
    document.removeEventListener("mousedown", onPickMouseDown, true);
    document.removeEventListener("mousedown", onLockedPageMouseDown, true);
    document.removeEventListener("mousemove", onDragMove, true);
    document.removeEventListener("mouseup", onDragUp, true);
    document.removeEventListener("click", onPickingClick, true);
    document.removeEventListener("mousemove", onHandleMove, true);
    document.removeEventListener("mouseup", onHandleUp, true);
    document.removeEventListener("mousemove", onMoveMove, true);
    document.removeEventListener("mouseup", onMoveUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onPickingScroll, true);
    window.removeEventListener("resize", onViewportResize);
  }

  function reset() {
    sessionId += 1;
    removeInteractionListeners();
    clearTimeout(clickCleanupTimer);
    clearTimeout(toastTimer);
    if (renderFrame != null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    pendingRect = null;
    pendingHoverElement = null;
    setCursor(previousCursor);
    state = STATE.IDLE;
    rect = null;
    hoveredElement = null;
    pickTarget = null;
    dragStart = null;
    dragged = false;
    activeHandle = null;
    moving = false;
    moveOffset = null;
    capturing = false;
    removeOverlay();
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  async function loadImage(dataUrl) {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(t("overlayImageReadError")));
    });
    image.src = dataUrl;
    return loaded;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(t("overlayPngError")));
      }, "image/png");
    });
  }

  function clipRoundedRect(context, width, height, radius) {
    const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
    context.beginPath();
    context.moveTo(safeRadius, 0);
    context.lineTo(width - safeRadius, 0);
    context.quadraticCurveTo(width, 0, width, safeRadius);
    context.lineTo(width, height - safeRadius);
    context.quadraticCurveTo(width, height, width - safeRadius, height);
    context.lineTo(safeRadius, height);
    context.quadraticCurveTo(0, height, 0, height - safeRadius);
    context.lineTo(0, safeRadius);
    context.quadraticCurveTo(0, 0, safeRadius, 0);
    context.closePath();
    context.clip();
  }

  function downloadBlob(blob) {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `region-snap-${stamp}.png`;
    anchor.style.display = "none";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function cropToBlob(dataUrl, selectedRect) {
    if (!dataUrl?.startsWith("data:image/")) throw new Error(t("overlayInvalidImage"));
    const image = await loadImage(dataUrl);
    const metrics = Geometry.getCropMetrics(selectedRect, viewportBounds(), {
      width: image.naturalWidth,
      height: image.naturalHeight,
    });

    const canvas = document.createElement("canvas");
    canvas.width = metrics.output.width;
    canvas.height = metrics.output.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("overlayCanvasError"));

    const cornerScale = Math.min(
      image.naturalWidth / window.innerWidth,
      image.naturalHeight / window.innerHeight,
    );
    clipRoundedRect(context, canvas.width, canvas.height, CORNER_RADIUS * cornerScale);

    context.drawImage(
      image,
      metrics.source.x,
      metrics.source.y,
      metrics.source.width,
      metrics.source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    try {
      return await canvasToBlob(canvas);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      image.src = "";
    }
  }

  async function doCapture() {
    if (state !== STATE.LOCKED || !rect) {
      showToast(t("overlaySelectFirst"), "error");
      return false;
    }
    if (capturing) return false;

    capturing = true;
    const captureSession = sessionId;
    const selectedRect = { ...rect };
    root.dataset.capturing = "true";

    try {
      await nextFrame();
      await nextFrame();
      if (captureSession !== sessionId) return false;
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.CAPTURE_TAB });
      if (!response || response.error) {
        throw new Error(response?.error || t("overlayCaptureMissing"));
      }
      if (captureSession !== sessionId) return false;
      const blob = await cropToBlob(response.dataUrl, selectedRect);
      if (captureSession !== sessionId) return false;
      downloadBlob(blob);
      if (root && captureSession === sessionId) {
        root.dataset.capturing = "false";
        showToast(t("overlaySaved"), "success");
      }
      return true;
    } catch (error) {
      if (root && captureSession === sessionId) {
        root.dataset.capturing = "false";
        showToast(error?.message || t("overlayCaptureError"), "error");
      }
      console.error("Region Snap capture failed:", error);
      return false;
    } finally {
      if (captureSession === sessionId) capturing = false;
    }
  }

  function onRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === MESSAGE.PING) {
      sendResponse({
        ready: true,
        state,
        rect: rect ? { ...rect } : null,
        version: CONTENT_VERSION,
      });
      return false;
    }
    if (message?.type === MESSAGE.START_PICKING) {
      startPicking();
      sendResponse({ ok: true, state });
      return false;
    }
    if (message?.type === MESSAGE.DO_CAPTURE) {
      if (state !== STATE.LOCKED || !rect) {
        sendResponse({ ok: false, error: t("errorNoLockedRegion") });
      } else {
        doCapture();
        sendResponse({ ok: true, state });
      }
      return false;
    }
    return false;
  }

  function destroy() {
    reset();
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  window.__regionSnapController = Object.freeze({
    version: CONTENT_VERSION,
    destroy,
  });
})();
