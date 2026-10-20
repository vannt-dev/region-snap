/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
(() => {
  const CONTENT_VERSION = chrome.runtime.getManifest().version;
  const previousController = window.__regionSnapController;
  if (previousController?.version === CONTENT_VERSION) return;
  previousController?.destroy?.();
  document.getElementById("region-snap-root")?.remove();

  const Geometry = globalThis.RegionSnapGeometry;
  const Shared = globalThis.RegionSnapShared;
  const Annotations = globalThis.RegionSnapAnnotations;
  if (!Geometry || !Shared || !Annotations) {
    console.error("Region Snap: required modules are unavailable.");
    return;
  }

  const { IMAGE_FORMATS, MESSAGE, SETTINGS_KEY, STATE, buildFileName, normalizeSettings } = Shared;
  const MIN_SIZE = 8;
  const LOSSY_QUALITY = 0.92;
  // Chrome allows two captureVisibleTab calls a second; full-page slices keep clear of that.
  const CAPTURE_INTERVAL_MS = 600;
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;

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
  let hasShownMarkHint = false;
  const shownToolHints = new Set();
  // Arrows, boxes, hidden areas, notes and steps over the locked region, in viewport coordinates.
  let marks = [];
  let activeTool = null;
  let markStart = null;
  let draftMark = null;
  // The note under the pointer when the text tool went down on one: a drag moves it, a click
  // edits it.
  let textDrag = null;
  // The note being typed: its textarea, where it sits, its size, and which mark it replaces.
  let editor = null;
  let textSize = "medium";
  // Set while a capture delay is counting down; calling it stops the countdown.
  let stopCountdown = null;
  let fullPageRun = null;

  let root;
  let dim;
  let border;
  let toolbar;
  let gripButton;
  let sizeLabel;
  let toast;
  let markLayer;
  let markSurface;
  let markSvg;
  let undoButton;
  let textSizeButton;
  const handles = {};

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TOOL_GLYPHS = { arrow: "↗", box: "▢", hide: "▒", text: "T", step: "①" };
  const TOOL_LABELS = {
    arrow: "overlayToolArrow",
    box: "overlayToolBox",
    hide: "overlayToolHide",
    text: "overlayToolText",
    step: "overlayToolStep",
  };
  const TOOL_HINTS = { text: "overlayTextHint", step: "overlayStepHint" };
  const TEXT_SIZE_ORDER = ["small", "medium", "large"];
  const TEXT_SIZE_LABELS = {
    small: "overlayTextSmall",
    medium: "overlayTextMedium",
    large: "overlayTextLarge",
  };
  // A press that travels less than this is a click on a note, not a drag of it.
  const CLICK_SLOP = 3;
  const TOOLBAR_WIDTH = 540;
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
      ${Annotations.TOOLS.map(
        (tool) =>
          `<button class="region-snap-tool" type="button" data-tool="${tool}" aria-pressed="false" title="${t(TOOL_LABELS[tool])}" aria-label="${t(TOOL_LABELS[tool])}">${TOOL_GLYPHS[tool]}</button>`,
      ).join("")}
      <button class="region-snap-text-size" type="button" data-size="${textSize}">A</button>
      <button class="region-snap-undo" type="button" disabled title="${t("overlayUndo")}" aria-label="${t("overlayUndo")}">↶</button>
      <button class="region-snap-capture" type="button">${t("overlayCapture")}</button>
      <button class="region-snap-copy" type="button">${t("overlayCopy")}</button>
      <button class="region-snap-cancel" type="button" title="${t("overlayCancel")}" aria-label="${t("overlayCancel")}">×</button>
    `;
    gripButton = toolbar.querySelector(".region-snap-grip");
    sizeLabel = toolbar.querySelector(".region-snap-size");
    undoButton = toolbar.querySelector(".region-snap-undo");
    textSizeButton = toolbar.querySelector(".region-snap-text-size");
    labelTextSize();

    // The layer is the region's own box and clips what is drawn; the surface inside it is
    // shifted back so its coordinates are the viewport's, the same ones the marks use.
    markLayer = document.createElement("div");
    markLayer.className = "region-snap-marks";
    markSurface = document.createElement("div");
    markSurface.className = "region-snap-mark-surface";
    markSvg = document.createElementNS(SVG_NS, "svg");
    markSvg.setAttribute("class", "region-snap-mark-svg");
    markSvg.setAttribute("aria-hidden", "true");
    markSurface.appendChild(markSvg);
    markLayer.appendChild(markSurface);

    toast = document.createElement("div");
    toast.className = "region-snap-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    root.dataset.tool = "none";
    root.append(dim, markLayer, border, toolbar, toast);
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
      if (event.isTrusted) doCapture({ action: "download" });
    });
    toolbar.querySelector(".region-snap-copy").addEventListener("click", (event) => {
      if (event.isTrusted) doCapture({ action: "copy" });
    });
    toolbar.querySelector(".region-snap-cancel").addEventListener("click", (event) => {
      if (event.isTrusted) reset();
    });
    for (const button of toolbar.querySelectorAll(".region-snap-tool")) {
      button.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        const { tool } = event.currentTarget.dataset;
        setTool(tool === activeTool ? null : tool);
      });
    }
    undoButton.addEventListener("click", (event) => {
      if (event.isTrusted) undoMark();
    });
    // Pressing the size button must not take the focus from a note being typed.
    textSizeButton.addEventListener("mousedown", (event) => event.preventDefault());
    textSizeButton.addEventListener("click", (event) => {
      if (event.isTrusted) cycleTextSize();
    });
    markLayer.addEventListener("mousedown", onMarkDown);
    gripButton.addEventListener("mousedown", onMoveGripDown);
    Object.values(handles).forEach((handle) => handle.addEventListener("mousedown", onHandleDown));
  }

  function removeOverlay() {
    root?.remove();
    root = dim = border = toolbar = gripButton = sizeLabel = toast = null;
    markLayer = markSurface = markSvg = undoButton = textSizeButton = null;
    editor = null;
    textDrag = null;
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

  function svgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  // Redraws the marks from scratch. There are only ever a handful, and it runs when one is
  // added, removed or dragged out, never on a pointer move over the page.
  function renderMarks() {
    if (!markSvg || !markSurface) return;
    const visible = draftMark ? [...marks, draftMark] : marks;
    markSvg.replaceChildren();
    for (const element of markSurface.querySelectorAll(".region-snap-hide, .region-snap-text")) {
      element.remove();
    }
    const steps = [];

    for (const mark of visible) {
      // A note being edited shows as its textarea instead.
      if (editor && mark === editor.original) continue;
      if (mark.tool === "text") {
        const note = document.createElement("div");
        note.className = "region-snap-text";
        note.dataset.index = String(marks.indexOf(mark));
        note.textContent = mark.text;
        note.style.setProperty("left", `${mark.x}px`, "important");
        note.style.setProperty("top", `${mark.y}px`, "important");
        note.style.setProperty("font", Annotations.textFont(mark.size), "important");
        note.style.setProperty("line-height", String(Annotations.TEXT_LINE_HEIGHT), "important");
        markSurface.appendChild(note);
      } else if (mark.tool === "step") {
        steps.push(mark);
      } else if (mark.tool === "hide") {
        const cover = document.createElement("div");
        cover.className = "region-snap-hide";
        cover.style.setProperty("left", `${mark.left}px`, "important");
        cover.style.setProperty("top", `${mark.top}px`, "important");
        cover.style.setProperty("width", `${mark.width}px`, "important");
        cover.style.setProperty("height", `${mark.height}px`, "important");
        markSurface.insertBefore(cover, markSvg);
      } else if (mark.tool === "box") {
        markSvg.appendChild(
          svgElement("rect", {
            x: mark.left,
            y: mark.top,
            width: mark.width,
            height: mark.height,
            rx: Annotations.BOX_RADIUS,
          }),
        );
      } else {
        const head = Annotations.arrowHead(mark);
        if (!head) continue;
        markSvg.append(
          svgElement("line", {
            x1: mark.x1,
            y1: mark.y1,
            x2: head.shaftEnd.x,
            y2: head.shaftEnd.y,
          }),
          svgElement("polygon", {
            points: [head.tip, head.left, head.right]
              .map((point) => `${point.x},${point.y}`)
              .join(" "),
          }),
        );
      }
    }
    // Steps sit on top of the lines and boxes, as they do in the image.
    for (const mark of steps) {
      markSvg.append(
        svgElement("circle", { cx: mark.x, cy: mark.y, r: Annotations.STEP_RADIUS }),
        Object.assign(svgElement("text", { x: mark.x, y: mark.y }), {
          textContent: String(mark.number),
        }),
      );
    }
    if (editor) markSurface.appendChild(editor.element);
    if (undoButton) undoButton.disabled = marks.length === 0;
  }

  function labelTextSize() {
    if (!textSizeButton) return;
    const size = editor?.size || textSize;
    const label = t("overlayTextSize", [t(TEXT_SIZE_LABELS[size])]);
    textSizeButton.dataset.size = size;
    textSizeButton.title = label;
    textSizeButton.setAttribute("aria-label", label);
  }

  // Small, medium, large, and round again. It sets the size of the note being typed and of
  // the notes that follow.
  function cycleTextSize() {
    const current = editor?.size || textSize;
    textSize = TEXT_SIZE_ORDER[(TEXT_SIZE_ORDER.indexOf(current) + 1) % TEXT_SIZE_ORDER.length];
    if (editor) {
      editor.size = textSize;
      styleEditor();
      editor.element.focus({ preventScroll: true });
    }
    labelTextSize();
  }

  function styleEditor() {
    if (!editor) return;
    const { element, point, size } = editor;
    element.style.setProperty("left", `${point.x}px`, "important");
    element.style.setProperty("top", `${point.y}px`, "important");
    element.style.setProperty("font", Annotations.textFont(size), "important");
    element.style.setProperty("line-height", String(Annotations.TEXT_LINE_HEIGHT), "important");
    fitEditor();
  }

  // Grows the textarea with what is typed. `field-sizing: content` does it in current Chrome;
  // rows and columns cover older versions without reading layout.
  function fitEditor() {
    if (!editor) return;
    const lines = editor.element.value.split("\n");
    editor.element.rows = Math.max(1, lines.length);
    editor.element.cols = Math.max(4, ...lines.map((line) => line.length + 1));
  }

  // Opens a textarea for a new note at `point`, or over an existing note to change it.
  function openEditor(point, original = null) {
    commitEditor();
    if (!markSurface) return;
    const element = document.createElement("textarea");
    element.className = "region-snap-text-editor";
    element.wrap = "off";
    element.spellcheck = false;
    element.setAttribute("aria-label", t("overlayToolText"));
    element.value = original?.text || "";
    editor = { element, point: { ...point }, size: original?.size || textSize, original };
    // Keys typed into the note are not the page's business.
    for (const type of ["keyup", "keypress"]) {
      element.addEventListener(type, (event) => event.stopPropagation());
    }
    element.addEventListener("input", fitEditor);
    element.addEventListener("blur", () => commitEditor());
    styleEditor();
    labelTextSize();
    renderMarks();
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }

  // Keeps what was typed. A note emptied out is removed; a new one left empty is dropped.
  function commitEditor() {
    if (!editor) return;
    const { element, point, size, original } = editor;
    editor = null;
    const mark = rect ? Annotations.createTextMark(point, element.value, size, rect) : null;
    const index = original ? marks.indexOf(original) : -1;
    if (index >= 0) {
      marks = mark
        ? marks.map((item, position) => (position === index ? mark : item))
        : marks.filter((_item, position) => position !== index);
    } else if (mark) {
      marks = [...marks, mark];
    }
    element.remove();
    labelTextSize();
    renderMarks();
  }

  // Throws away what was typed; a note that was being changed keeps its old text.
  function cancelEditor() {
    if (!editor) return;
    const { element } = editor;
    editor = null;
    element.remove();
    labelTextSize();
    renderMarks();
  }

  // With a tool chosen the region takes the pointer so a drag draws; with none it lets the
  // page through again, which is what a locked region normally does.
  function setTool(tool) {
    activeTool = Annotations.TOOLS.includes(tool) ? tool : null;
    if (activeTool !== "text") commitEditor();
    if (!root) return;
    root.dataset.tool = activeTool || "none";
    for (const button of toolbar.querySelectorAll(".region-snap-tool")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === activeTool));
    }
    if (TOOL_HINTS[activeTool]) {
      if (!shownToolHints.has(activeTool)) showToast(t(TOOL_HINTS[activeTool]));
      shownToolHints.add(activeTool);
    } else if (activeTool && !hasShownMarkHint) {
      showToast(t("overlayMarkHint"));
      hasShownMarkHint = true;
    }
  }

  function undoMark() {
    commitEditor();
    if (!marks.length) return;
    marks = marks.slice(0, -1);
    renderMarks();
  }

  function onMarkDown(event) {
    if (
      !event.isTrusted ||
      !activeTool ||
      !rect ||
      state !== STATE.LOCKED ||
      event.button !== 0 ||
      capturing
    )
      return;
    // A press inside the note being typed belongs to the textarea: it moves the caret.
    if (editor && event.target === editor.element) return;
    stopPageEvent(event);
    markStart = { x: event.clientX, y: event.clientY };
    draftMark = null;
    textDrag = null;
    if (activeTool === "text") {
      const index = Number(event.target.closest?.(".region-snap-text")?.dataset.index ?? -1);
      const note = marks[index]?.tool === "text" ? marks[index] : null;
      commitEditor();
      if (note) textDrag = { mark: note, from: { x: note.x, y: note.y }, moved: false };
    }
    root.dataset.interacting = "true";
    document.addEventListener("mousemove", onMarkMove, true);
    document.addEventListener("mouseup", onMarkUp, true);
  }

  // Moves the note held by the text tool, keeping its corner inside the region.
  function dragNote(event) {
    const dx = event.clientX - markStart.x;
    const dy = event.clientY - markStart.y;
    if (!textDrag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    textDrag.moved = true;
    const { mark } = textDrag;
    const moved = Annotations.createTextMark(
      { x: textDrag.from.x + dx, y: textDrag.from.y + dy },
      mark.text,
      mark.size,
      rect,
    );
    if (!moved) return;
    marks = marks.map((item) => (item === mark ? moved : item));
    textDrag.mark = moved;
    renderMarks();
  }

  function onMarkMove(event) {
    if (!event.isTrusted || !markStart || !rect) return;
    stopPageEvent(event);
    if (Annotations.CLICK_TOOLS.includes(activeTool)) {
      if (textDrag) dragNote(event);
      return;
    }
    draftMark = Annotations.createMark(
      activeTool,
      markStart,
      { x: event.clientX, y: event.clientY },
      rect,
    );
    renderMarks();
  }

  function onMarkUp(event) {
    if (event && !event.isTrusted) return;
    if (event) stopPageEvent(event);
    if (event && markStart && rect && Annotations.CLICK_TOOLS.includes(activeTool)) {
      finishClickTool();
      return;
    }
    const mark =
      event && markStart && rect
        ? Annotations.createMark(
            activeTool,
            markStart,
            { x: event.clientX, y: event.clientY },
            rect,
          )
        : null;
    if (mark) marks = [...marks, mark];
    markStart = null;
    draftMark = null;
    if (root) root.dataset.interacting = "false";
    document.removeEventListener("mousemove", onMarkMove, true);
    document.removeEventListener("mouseup", onMarkUp, true);
    renderMarks();
  }

  function endMarkPress() {
    markStart = null;
    draftMark = null;
    textDrag = null;
    if (root) root.dataset.interacting = "false";
    document.removeEventListener("mousemove", onMarkMove, true);
    document.removeEventListener("mouseup", onMarkUp, true);
  }

  // A click with the step tool drops the next number where the press started; with the text
  // tool it opens a note there, or on the note clicked. A note that was dragged is already moved.
  function finishClickTool() {
    const point = markStart;
    const drag = textDrag;
    endMarkPress();
    if (activeTool === "step") {
      const step = Annotations.createStepMark(point, marks, rect);
      if (step) marks = [...marks, step];
      renderMarks();
    } else if (drag?.moved) {
      renderMarks();
    } else if (drag) {
      openEditor({ x: drag.mark.x, y: drag.mark.y }, drag.mark);
    } else {
      openEditor(point);
    }
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

  // While a note is typed, Escape throws it away and Enter keeps it (Shift+Enter starts a new
  // line). No key reaches the page, and Ctrl+Z is the textarea's own undo.
  function onEditorKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditor();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      commitEditor();
    }
    event.stopImmediatePropagation();
  }

  function onKeyDown(event) {
    if (!event.isTrusted) return;
    if (editor && event.target === editor.element) {
      onEditorKeyDown(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Escape first stops a countdown, then puts the drawing tool down; the region is
      // cancelled by the next one.
      if (stopCountdown) stopCountdown();
      else if (activeTool) setTool(null);
      else reset();
      return;
    }
    // Only while a tool is held: otherwise Ctrl+Z belongs to whatever the page is editing.
    if (
      activeTool &&
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      undoMark();
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
    document.removeEventListener("mousemove", onMarkMove, true);
    document.removeEventListener("mouseup", onMarkUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onPickingScroll, true);
    window.removeEventListener("resize", onViewportResize);
  }

  function reset() {
    sessionId += 1;
    stopCountdown?.();
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
    marks = [];
    activeTool = null;
    markStart = null;
    draftMark = null;
    textDrag = null;
    editor = null;
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

  function canvasToBlob(canvas, mime) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error(t("overlayPngError")));
        },
        mime,
        LOSSY_QUALITY,
      );
    });
  }

  // Read on every capture so a change made on the options page applies without reselecting.
  // Pages where the storage API is unavailable capture with the defaults.
  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      return normalizeSettings(stored?.[SETTINGS_KEY]);
    } catch {
      return normalizeSettings(null);
    }
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

  function downloadBlob(blob, settings) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildFileName(settings, new Date());
    anchor.style.display = "none";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The async clipboard API only exists in secure contexts and rejects when the page is not
  // focused or blocks it by policy; the caller falls back to a download in those cases.
  async function copyBlob(blob) {
    if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    } catch (error) {
      console.warn("Region Snap clipboard write failed:", error);
      return false;
    }
  }

  function createScratchCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function cropToBlob(dataUrl, selectedRect, settings, selectedMarks) {
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
    const { mime } = IMAGE_FORMATS[settings.format];
    // JPEG has no transparency: without a backdrop the cut corners would come out black.
    if (mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (settings.roundedCorners) {
      clipRoundedRect(context, canvas.width, canvas.height, CORNER_RADIUS * cornerScale);
    }

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
    // The screenshot is taken with the overlay hidden, so the marks are not in it yet: they
    // are drawn here, at the image's own resolution.
    const visibleRect = fitRectToViewport(selectedRect);
    Annotations.drawMarks(context, canvas, selectedMarks, {
      origin: { left: visibleRect.left, top: visibleRect.top },
      scale: {
        x: canvas.width / Math.max(1, visibleRect.width),
        y: canvas.height / Math.max(1, visibleRect.height),
      },
      createCanvas: createScratchCanvas,
    });
    try {
      return await canvasToBlob(canvas, mime);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      image.src = "";
    }
  }

  const DELIVERY_MESSAGES = {
    copied: "overlayCopied",
    fallback: "overlayCopyFallback",
    saved: "overlaySaved",
  };

  // Copies or downloads the finished image and says which of the two happened.
  async function deliver(blob, settings, copy) {
    if (copy && (await copyBlob(blob))) return "copied";
    downloadBlob(blob, settings);
    return copy ? "fallback" : "saved";
  }

  // Counts the delay down in the toast, a second a tick. Resolves true when it ran out and
  // false when Escape or a new selection stopped it.
  function countDown(seconds, captureSession) {
    return new Promise((resolve) => {
      let remaining = seconds;
      let timer = null;
      const finish = (completed) => {
        clearTimeout(timer);
        stopCountdown = null;
        resolve(completed);
      };
      const tick = () => {
        if (captureSession !== sessionId) {
          finish(false);
        } else if (remaining <= 0) {
          finish(true);
        } else {
          showToast(t("overlayCountdown", [String(remaining)]));
          remaining -= 1;
          timer = window.setTimeout(tick, 1000);
        }
      };
      stopCountdown = () => finish(false);
      tick();
    });
  }

  // `action` is "download" or "copy"; left out, the user's default action applies.
  async function doCapture({ action } = {}) {
    if (state !== STATE.LOCKED || !rect) {
      showToast(t("overlaySelectFirst"), "error");
      return false;
    }
    if (capturing) return false;

    capturing = true;
    const captureSession = sessionId;
    // A note still being typed goes into the image as it stands.
    commitEditor();

    try {
      const stored = await loadSettings();
      if (captureSession !== sessionId) return false;
      if (stored.captureDelay > 0 && !(await countDown(stored.captureDelay, captureSession))) {
        if (root && captureSession === sessionId) showToast(t("overlayCountdownStopped"));
        return false;
      }
      // Read after the countdown: the region and its marks may be adjusted while it runs.
      const selectedRect = { ...rect };
      const selectedMarks = marks.map((mark) => ({ ...mark }));
      root.dataset.capturing = "true";
      await nextFrame();
      await nextFrame();
      if (captureSession !== sessionId) return false;
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.CAPTURE_TAB });
      if (!response || response.error) {
        throw new Error(response?.error || t("overlayCaptureMissing"));
      }
      if (captureSession !== sessionId) return false;
      const copy = (action || stored.defaultAction) === "copy";
      // The clipboard only takes PNG, so a copy ignores the chosen file format.
      const settings = copy ? { ...stored, format: "png" } : stored;
      const blob = await cropToBlob(response.dataUrl, selectedRect, settings, selectedMarks);
      if (captureSession !== sessionId) return false;
      const outcome = await deliver(blob, settings, copy);
      if (root && captureSession === sessionId) {
        root.dataset.capturing = "false";
        showToast(t(DELIVERY_MESSAGES[outcome]), "success");
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

  // A fixed element would repeat in every slice of a full-page capture, so those in the top
  // half of the viewport are kept for the first slice only and those in the bottom half for the
  // last. A sticky element goes back to where it sits in the flow. All of it is undone after.
  function prepareFullPageLayout() {
    const sticky = [];
    const top = [];
    const bottom = [];
    const middle = window.innerHeight / 2;
    for (const element of document.querySelectorAll("body *")) {
      if (isOwnElement(element)) continue;
      const { position } = getComputedStyle(element);
      if (position === "sticky") {
        sticky.push(element);
      } else if (position === "fixed") {
        const bounds = element.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) {
          (bounds.top + bounds.height / 2 < middle ? top : bottom).push(element);
        }
      }
    }

    const undo = [];
    const override = (element, property, value) => {
      undo.push([
        element,
        property,
        element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property),
      ]);
      element.style.setProperty(property, value, "important");
    };
    for (const element of sticky) {
      override(element, "position", "relative");
      for (const side of ["top", "right", "bottom", "left"]) override(element, side, "auto");
    }

    const hidden = new Map();
    const setVisible = (elements, visible) => {
      for (const element of elements) {
        if (visible && hidden.has(element)) {
          element.style.setProperty("visibility", ...hidden.get(element));
          hidden.delete(element);
        } else if (!visible && !hidden.has(element)) {
          hidden.set(element, [
            element.style.getPropertyValue("visibility"),
            element.style.getPropertyPriority("visibility"),
          ]);
          element.style.setProperty("visibility", "hidden", "important");
        }
      }
    };

    return {
      showFor(isFirst, isLast) {
        setVisible(top, isFirst);
        setVisible(bottom, isLast);
      },
      restore() {
        setVisible([...top, ...bottom], true);
        for (const [element, property, value, priority] of undo.splice(0).reverse()) {
          element.style.setProperty(property, value, priority);
        }
      },
    };
  }

  // The overlay of a full-page capture only carries the toast; nothing is selected behind it.
  function closeIdleOverlay() {
    if (state !== STATE.IDLE) return;
    clearTimeout(toastTimer);
    removeOverlay();
  }

  function onFullPageKeyDown(event) {
    if (!event.isTrusted || event.key !== "Escape" || !fullPageRun) return;
    event.preventDefault();
    fullPageRun.cancelled = true;
  }

  // Photographs the page a viewport at a time and stitches the slices into one image. It
  // covers what the document itself scrolls; a page that scrolls inside an inner panel only
  // gives what is on screen.
  async function captureFullPage() {
    if (capturing) return false;
    if (state === STATE.IDLE) sessionId += 1;
    else reset();

    capturing = true;
    const captureSession = sessionId;
    const run = { cancelled: false };
    fullPageRun = run;
    const stopped = () => run.cancelled || captureSession !== sessionId;
    const scroller = document.scrollingElement || document.documentElement;
    const scrollStart = { left: window.scrollX, top: window.scrollY };
    const scrollBack = () => window.scrollTo({ ...scrollStart, behavior: "instant" });
    let layout = null;
    let canvas = null;

    injectOverlay();
    root.dataset.capturing = "true";
    document.addEventListener("keydown", onFullPageKeyDown, true);

    try {
      const stored = await loadSettings();
      if (stopped()) return false;
      const copy = stored.defaultAction === "copy";
      // The clipboard only takes PNG, so a copy ignores the chosen file format.
      const settings = copy ? { ...stored, format: "png" } : stored;
      const { mime } = IMAGE_FORMATS[settings.format];
      const viewport = {
        width: scroller.clientWidth || window.innerWidth,
        height: scroller.clientHeight || window.innerHeight,
      };
      const pageHeight = scroller.scrollHeight;
      layout = prepareFullPageLayout();

      let plan = null;
      let scale = null;
      let context = null;
      let lastCaptureAt = 0;
      for (let index = 0; !plan || index < plan.positions.length; index += 1) {
        window.scrollTo({
          left: scrollStart.left,
          top: plan ? plan.positions[index] : 0,
          behavior: "instant",
        });
        layout.showFor(
          index === 0,
          plan ? index === plan.positions.length - 1 : pageHeight <= viewport.height,
        );
        await nextFrame();
        await nextFrame();
        const pause = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
        if (pause > 0) await new Promise((resolve) => window.setTimeout(resolve, pause));
        if (stopped()) return false;

        const top = window.scrollY;
        const response = await chrome.runtime.sendMessage({ type: MESSAGE.CAPTURE_TAB });
        lastCaptureAt = Date.now();
        if (!response || response.error) {
          throw new Error(response?.error || t("overlayCaptureMissing"));
        }
        if (stopped()) return false;
        if (!response.dataUrl?.startsWith("data:image/")) throw new Error(t("overlayInvalidImage"));
        const image = await loadImage(response.dataUrl);

        if (!plan) {
          scale = {
            x: image.naturalWidth / window.innerWidth,
            y: image.naturalHeight / window.innerHeight,
          };
          plan = Geometry.planFullPage(
            { height: pageHeight, viewportWidth: viewport.width, viewportHeight: viewport.height },
            scale,
          );
          canvas = createScratchCanvas(plan.width, plan.height);
          context = canvas.getContext("2d");
          if (!context) throw new Error(t("overlayCanvasError"));
          if (mime === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
        // The scrollbar is left out: only the part of the screenshot the page lays out in.
        const sliceWidth = viewport.width * scale.x;
        const sliceHeight = viewport.height * scale.y;
        context.drawImage(
          image,
          0,
          0,
          sliceWidth,
          sliceHeight,
          0,
          Math.round(top * scale.y),
          sliceWidth,
          sliceHeight,
        );
        image.src = "";
      }

      layout.restore();
      scrollBack();
      const blob = await canvasToBlob(canvas, mime);
      if (stopped()) return false;
      const outcome = await deliver(blob, settings, copy);
      if (root && captureSession === sessionId) {
        root.dataset.capturing = "false";
        let message = DELIVERY_MESSAGES[outcome];
        if (plan.truncated) {
          message =
            outcome === "copied" ? "overlayFullPageCopiedTruncated" : "overlayFullPageTruncated";
        }
        showToast(t(message), "success");
      }
      return true;
    } catch (error) {
      if (root && captureSession === sessionId) {
        root.dataset.capturing = "false";
        showToast(error?.message || t("overlayCaptureError"), "error");
      }
      console.error("Region Snap full-page capture failed:", error);
      return false;
    } finally {
      layout?.restore();
      scrollBack();
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      document.removeEventListener("keydown", onFullPageKeyDown, true);
      if (fullPageRun === run) fullPageRun = null;
      if (captureSession === sessionId) {
        capturing = false;
        if (run.cancelled) {
          closeIdleOverlay();
        } else {
          // Leave the toast up for as long as it shows, then take the empty overlay away.
          window.setTimeout(() => {
            if (captureSession === sessionId) closeIdleOverlay();
          }, 3000);
        }
      }
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
    if (message?.type === MESSAGE.CAPTURE_FULL_PAGE) {
      captureFullPage();
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
