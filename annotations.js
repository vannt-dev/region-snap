/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
((scope) => {
  const TOOLS = Object.freeze(["arrow", "box", "highlight", "hide", "text", "step"]);
  // Placed with a click instead of drawn with a drag.
  const CLICK_TOOLS = Object.freeze(["text", "step"]);
  // The colours a mark can take; red is the default. A hidden area has no colour.
  const MARK_COLORS = Object.freeze({
    red: "#ef4444",
    yellow: "#facc15",
    green: "#22c55e",
    blue: "#3b82f6",
    black: "#111827",
  });
  const MARK_COLOR = MARK_COLORS.red;
  const HALO_COLOR = "#ffffff";
  // Outline and numbers on a light colour, where white would not read.
  const DARK_INK = "#111827";
  // A highlight lets this much of its colour through, so the text under it still reads.
  const HIGHLIGHT_ALPHA = 0.35;
  const LINE_WIDTH = 3;
  const ARROW_HEAD = 14;
  const BOX_RADIUS = 4;
  const MIN_MARK_SIZE = 6;
  // Side of one mosaic block in CSS pixels: about the height of body text, so the letters of a
  // hidden line average into blocks instead of staying legible.
  const HIDE_BLOCK = 14;
  // Text sizes in CSS pixels; the overlay and the image use the same font and line height.
  const TEXT_SIZES = Object.freeze({ small: 14, medium: 20, large: 28 });
  const TEXT_LINE_HEIGHT = 1.25;
  const TEXT_WEIGHT = 600;
  const TEXT_FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
  const TEXT_HALO = 3;
  const STEP_RADIUS = 13;
  const STEP_FONT_SIZE = 14;
  const STEP_BORDER = 2;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  // A stored or passed colour is untrusted; only the palette's colours are drawn.
  function markColor(value) {
    return Object.values(MARK_COLORS).includes(value) ? value : MARK_COLOR;
  }

  // White on dark colours, dark on light ones, by relative luminance.
  function markInk(color) {
    const [red, green, blue] = [1, 3, 5].map((index) => {
      const channel = parseInt(markColor(color).slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.4 ? DARK_INK : HALO_COLOR;
  }

  // Adds the colour to a new mark only when one was chosen, so marks made without one stay as
  // they were and are drawn in the default colour.
  const withColor = (mark, color) =>
    color === undefined ? mark : { ...mark, color: markColor(color) };

  function textFont(size, scale = 1) {
    const pixels = (TEXT_SIZES[size] || TEXT_SIZES.medium) * scale;
    return `${TEXT_WEIGHT} ${pixels}px ${TEXT_FONT_FAMILY}`;
  }

  function stepFont(scale = 1) {
    return `700 ${STEP_FONT_SIZE * scale}px ${TEXT_FONT_FAMILY}`;
  }

  // A text mark is anchored at its top-left corner, which is kept inside the region; the text
  // itself may run past the edge, where the capture cuts it like anything else. Blank text is
  // no mark, so committing an emptied note removes it.
  function createTextMark(point, text, size, bounds, color) {
    if (!point || !bounds || typeof text !== "string") return null;
    const value = text.replace(/\r\n?/g, "\n");
    if (!value.trim()) return null;
    return withColor(
      {
        tool: "text",
        x: clamp(point.x, bounds.left, bounds.left + bounds.width),
        y: clamp(point.y, bounds.top, bounds.top + bounds.height),
        text: value,
        size: Object.hasOwn(TEXT_SIZES, size) ? size : "medium",
      },
      color,
    );
  }

  // The next step is one more than the highest step still there, so removing the last step
  // with undo hands its number to the next one.
  function nextStepNumber(marks) {
    let highest = 0;
    for (const mark of marks || []) {
      if (mark?.tool === "step" && mark.number > highest) highest = mark.number;
    }
    return highest + 1;
  }

  // A step is a numbered circle centred on the click, moved in so the whole circle shows.
  function createStepMark(point, marks, bounds, color) {
    if (!point || !bounds) return null;
    return withColor(
      {
        tool: "step",
        x: clamp(point.x, bounds.left + STEP_RADIUS, bounds.left + bounds.width - STEP_RADIUS),
        y: clamp(point.y, bounds.top + STEP_RADIUS, bounds.top + bounds.height - STEP_RADIUS),
        number: nextStepNumber(marks),
      },
      color,
    );
  }

  // Marks live in viewport coordinates, like the region itself: moving or resizing the region
  // leaves them on the content they were drawn over. `bounds` is the region; a mark is kept
  // inside it, and one too small to be deliberate is dropped. A highlight is a rectangle like a
  // box; a hidden area takes no colour.
  function createMark(tool, start, end, bounds, color) {
    if (!TOOLS.includes(tool) || CLICK_TOOLS.includes(tool) || !start || !end || !bounds) {
      return null;
    }
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
      return withColor({ tool, x1: from.x, y1: from.y, x2: to.x, y2: to.y }, color);
    }

    const width = Math.abs(to.x - from.x);
    const height = Math.abs(to.y - from.y);
    if (width < MIN_MARK_SIZE || height < MIN_MARK_SIZE) return null;
    const area = { tool, left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width, height };
    return tool === "hide" ? area : withColor(area, color);
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
    if (mark.tool === "text" || mark.tool === "step") {
      return {
        ...mark,
        x: (mark.x - origin.left) * scale.x,
        y: (mark.y - origin.top) * scale.y,
      };
    }
    if (mark.tool === "arrow") {
      return withColor(
        {
          tool: mark.tool,
          x1: (mark.x1 - origin.left) * scale.x,
          y1: (mark.y1 - origin.top) * scale.y,
          x2: (mark.x2 - origin.left) * scale.x,
          y2: (mark.y2 - origin.top) * scale.y,
        },
        mark.color,
      );
    }
    return withColor(
      {
        tool: mark.tool,
        left: (mark.left - origin.left) * scale.x,
        top: (mark.top - origin.top) * scale.y,
        width: mark.width * scale.x,
        height: mark.height * scale.y,
      },
      mark.color,
    );
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

  // Text is drawn line by line with a light outline under it, so it reads on dark and light
  // content alike. The first line sits where the overlay's CSS line box puts it.
  function drawText(context, mark, scale) {
    const size = (TEXT_SIZES[mark.size] || TEXT_SIZES.medium) * scale;
    const lineHeight = size * TEXT_LINE_HEIGHT;
    const top = mark.y + (lineHeight - size) / 2;
    const lines = String(mark.text).split("\n");
    context.save();
    context.font = textFont(mark.size, scale);
    context.textAlign = "left";
    context.textBaseline = "top";
    context.lineJoin = "round";
    context.lineWidth = TEXT_HALO * scale;
    context.strokeStyle = markInk(mark.color);
    context.fillStyle = markColor(mark.color);
    lines.forEach((line, index) => context.strokeText(line, mark.x, top + index * lineHeight));
    lines.forEach((line, index) => context.fillText(line, mark.x, top + index * lineHeight));
    context.restore();
  }

  function drawStep(context, mark, scale) {
    context.save();
    context.beginPath();
    context.arc(mark.x, mark.y, STEP_RADIUS * scale, 0, Math.PI * 2);
    context.fillStyle = markColor(mark.color);
    context.fill();
    context.lineWidth = STEP_BORDER * scale;
    context.strokeStyle = markInk(mark.color);
    context.stroke();
    context.font = stepFont(scale);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = markInk(mark.color);
    context.fillText(String(mark.number), mark.x, mark.y);
    context.restore();
  }

  // Draws every mark onto the cropped image. `origin` is the region's corner in the viewport
  // and `scale` the image pixels per CSS pixel. Hidden areas go first, so an arrow or a box
  // drawn across one stays sharp on top of it; highlights come next, under the lines, and only
  // tint what is under them.
  function drawMarks(context, canvas, marks, { origin, scale, createCanvas }) {
    if (!marks?.length) return;
    const output = marks.map((mark) => toOutput(mark, origin, scale));
    const unit = Math.min(scale.x, scale.y);

    for (const mark of output) {
      if (mark.tool === "hide") {
        hide(context, canvas, mark, Math.max(2, HIDE_BLOCK * unit), createCanvas);
      }
    }

    for (const mark of output) {
      if (mark.tool !== "highlight") continue;
      context.save();
      context.globalAlpha = HIGHLIGHT_ALPHA;
      context.fillStyle = markColor(mark.color);
      context.fillRect(mark.left, mark.top, mark.width, mark.height);
      context.restore();
    }

    context.save();
    context.lineWidth = LINE_WIDTH * unit;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const mark of output) {
      if (mark.tool !== "arrow" && mark.tool !== "box") continue;
      context.strokeStyle = markColor(mark.color);
      context.fillStyle = markColor(mark.color);
      if (mark.tool === "arrow") drawArrow(context, mark, unit);
      if (mark.tool === "box") drawBox(context, mark, unit);
    }
    context.restore();
    // Notes and steps go last: they label what the other marks point at.
    for (const mark of output) {
      if (mark.tool === "text") drawText(context, mark, unit);
      if (mark.tool === "step") drawStep(context, mark, unit);
    }
  }

  const api = Object.freeze({
    ARROW_HEAD,
    BOX_RADIUS,
    CLICK_TOOLS,
    HALO_COLOR,
    HIDE_BLOCK,
    HIGHLIGHT_ALPHA,
    LINE_WIDTH,
    MARK_COLOR,
    MARK_COLORS,
    MIN_MARK_SIZE,
    STEP_FONT_SIZE,
    STEP_RADIUS,
    TEXT_FONT_FAMILY,
    TEXT_LINE_HEIGHT,
    TEXT_SIZES,
    TEXT_WEIGHT,
    TOOLS,
    arrowHead,
    createMark,
    createStepMark,
    createTextMark,
    drawMarks,
    hideArea,
    markColor,
    markInk,
    nextStepNumber,
    stepFont,
    textFont,
    toOutput,
  });

  scope.RegionSnapAnnotations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
