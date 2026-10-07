((scope) => {
  const TOOLS = Object.freeze(["arrow", "box", "hide"]);
  const MARK_COLOR = "#ef4444";
  const LINE_WIDTH = 3;
  const ARROW_HEAD = 14;
  const BOX_RADIUS = 4;
  const MIN_MARK_SIZE = 6;
  // Side of one mosaic block in CSS pixels: about the height of body text, so the letters of a
  // hidden line average into blocks instead of staying legible.
  const HIDE_BLOCK = 14;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  // Marks live in viewport coordinates, like the region itself: moving or resizing the region
  // leaves them on the content they were drawn over. `bounds` is the region; a mark is kept
  // inside it, and one too small to be deliberate is dropped.
  function createMark(tool, start, end, bounds) {
    if (!TOOLS.includes(tool) || !start || !end || !bounds) return null;
    const right = bounds.left + bounds.width;
    const bottom = bounds.top + bounds.height;
    const from = {
      x: clamp(start.x, bounds.left, right),
      y: clamp(start.y, bounds.top, bottom),
    };
    const to = {
      x: clamp(end.x, bounds.left, right),
      y: clamp(end.y, bounds.top, bottom),
    };

    if (tool === "arrow") {
      if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_MARK_SIZE) return null;
      return { tool, x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    }

    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < MIN_MARK_SIZE || height < MIN_MARK_SIZE) return null;
    return { tool, left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width, height };
  }

  // The head of an arrow ending at (x2, y2): its tip, its two barbs, and the point where the
  // shaft should stop so the line does not show through the tip.
  function arrowHead(mark, size = ARROW_HEAD) {
    const length = Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1);
    if (length === 0) return null;
    const headSize = Math.min(size, length);
    const ux = (mark.x2 - mark.x1) / length;
    const uy = (mark.y2 - mark.y1) / length;
    const baseX = mark.x2 - ux * headSize;
    const baseY = mark.y2 - uy * headSize;
    const half = headSize * 0.5;
    return {
      tip: { x: mark.x2, y: mark.y2 },
      left: { x: baseX - uy * half, y: baseY + ux * half },
      right: { x: baseX + uy * half, y: baseY - ux * half },
      shaftEnd: { x: baseX, y: baseY },
    };
  }

  // Converts a mark from viewport coordinates to the pixels of the cropped image.
  function toOutput(mark, origin, scale) {
    if (mark.tool === "arrow") {
      return {
        tool: mark.tool,
        x1: (mark.x1 - origin.left) * scale.x,
        y1: (mark.y1 - origin.top) * scale.y,
        x2: (mark.x2 - origin.left) * scale.x,
        y2: (mark.y2 - origin.top) * scale.y,
      };
    }
    return {
      tool: mark.tool,
      left: (mark.left - origin.left) * scale.x,
      top: (mark.top - origin.top) * scale.y,
      width: mark.width * scale.x,
      height: mark.height * scale.y,
    };
  }

  // The part of a hidden area that lies on the canvas, in whole pixels, or null when none does.
  function hideArea(mark, canvasSize) {
    const left = clamp(Math.floor(mark.left), 0, canvasSize.width);
    const top = clamp(Math.floor(mark.top), 0, canvasSize.height);
    const right = clamp(Math.ceil(mark.left + mark.width), 0, canvasSize.width);
    const bottom = clamp(Math.ceil(mark.top + mark.height), 0, canvasSize.height);
    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  // Replaces an area of the canvas with a mosaic of its own colours. The area is first drawn
  // small, which averages each block, then drawn back without smoothing; the detail that was
  // there is not in the image any more, unlike a blur drawn on top of it.
  function hide(context, canvas, mark, block, createCanvas) {
    const area = hideArea(mark, canvas);
    if (!area) return;
    const columns = Math.max(1, Math.round(area.width / block));
    const rows = Math.max(1, Math.round(area.height / block));
    const small = createCanvas(columns, rows);
    const smallContext = small.getContext("2d");
    if (!smallContext) {
      // Without a second canvas there is no mosaic; a flat block still hides the area.
      context.fillStyle = "#64748b";
      context.fillRect(area.left, area.top, area.width, area.height);
      return;
    }
    smallContext.imageSmoothingEnabled = true;
    smallContext.imageSmoothingQuality = "high";
    smallContext.drawImage(
      canvas,
      area.left,
      area.top,
      area.width,
      area.height,
      0,
      0,
      columns,
      rows,
    );
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, columns, rows, area.left, area.top, area.width, area.height);
    context.restore();
    small.width = 1;
    small.height = 1;
  }

  function drawArrow(context, mark, scale) {
    const head = arrowHead(mark, ARROW_HEAD * scale);
    if (!head) return;
    context.beginPath();
    context.moveTo(mark.x1, mark.y1);
    context.lineTo(head.shaftEnd.x, head.shaftEnd.y);
    context.stroke();
    context.beginPath();
    context.moveTo(head.tip.x, head.tip.y);
    context.lineTo(head.left.x, head.left.y);
    context.lineTo(head.right.x, head.right.y);
    context.closePath();
    context.fill();
  }

  function drawBox(context, mark, scale) {
    const radius = Math.min(BOX_RADIUS * scale, mark.width / 2, mark.height / 2);
    const right = mark.left + mark.width;
    const bottom = mark.top + mark.height;
    context.beginPath();
    context.moveTo(mark.left + radius, mark.top);
    context.lineTo(right - radius, mark.top);
    context.quadraticCurveTo(right, mark.top, right, mark.top + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(mark.left + radius, bottom);
    context.quadraticCurveTo(mark.left, bottom, mark.left, bottom - radius);
    context.lineTo(mark.left, mark.top + radius);
    context.quadraticCurveTo(mark.left, mark.top, mark.left + radius, mark.top);
    context.closePath();
    context.stroke();
  }

  // Draws every mark onto the cropped image. `origin` is the region's corner in the viewport
  // and `scale` the image pixels per CSS pixel. Hidden areas go first, so an arrow or a box
  // drawn across one stays sharp on top of it.
  function drawMarks(context, canvas, marks, { origin, scale, createCanvas }) {
    if (!marks?.length) return;
    const output = marks.map((mark) => toOutput(mark, origin, scale));
    const unit = Math.min(scale.x, scale.y);

    for (const mark of output) {
      if (mark.tool === "hide") {
        hide(context, canvas, mark, Math.max(2, HIDE_BLOCK * unit), createCanvas);
      }
    }

    context.save();
    context.strokeStyle = MARK_COLOR;
    context.fillStyle = MARK_COLOR;
    context.lineWidth = LINE_WIDTH * unit;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const mark of output) {
      if (mark.tool === "arrow") drawArrow(context, mark, unit);
      if (mark.tool === "box") drawBox(context, mark, unit);
    }
    context.restore();
  }

  const api = Object.freeze({
    ARROW_HEAD,
    BOX_RADIUS,
    HIDE_BLOCK,
    LINE_WIDTH,
    MARK_COLOR,
    MIN_MARK_SIZE,
    TOOLS,
    arrowHead,
    createMark,
    drawMarks,
    hideArea,
    toOutput,
  });

  scope.RegionSnapAnnotations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
