/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
((scope) => {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  function rectFromPoints(start, end) {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x),
      height: Math.abs(start.y - end.y),
    };
  }

  function fitRectToBounds(rect, bounds) {
    const rawRight = rect.left + rect.width;
    const rawBottom = rect.top + rect.height;
    const left = clamp(Math.min(rect.left, rawRight), 0, bounds.width);
    const top = clamp(Math.min(rect.top, rawBottom), 0, bounds.height);
    const right = clamp(Math.max(rect.left, rawRight), 0, bounds.width);
    const bottom = clamp(Math.max(rect.top, rawBottom), 0, bounds.height);
    return { left, top, width: right - left, height: bottom - top };
  }

  function moveRectTo(rect, left, top, bounds) {
    const width = Math.min(rect.width, bounds.width);
    const height = Math.min(rect.height, bounds.height);
    return {
      left: clamp(left, 0, bounds.width - width),
      top: clamp(top, 0, bounds.height - height),
      width,
      height,
    };
  }

  function resizeRect(rect, handle, point, bounds, minimumSize) {
    let left = rect.left;
    let top = rect.top;
    let right = rect.left + rect.width;
    let bottom = rect.top + rect.height;

    if (handle.includes("n")) top = clamp(point.y, 0, bottom - minimumSize);
    if (handle.includes("s")) bottom = clamp(point.y, top + minimumSize, bounds.height);
    if (handle.includes("w")) left = clamp(point.x, 0, right - minimumSize);
    if (handle.includes("e")) right = clamp(point.x, left + minimumSize, bounds.width);

    return { left, top, width: right - left, height: bottom - top };
  }

  function getCropMetrics(rect, viewport, image) {
    const safeRect = fitRectToBounds(rect, viewport);
    const scaleX = image.width / viewport.width;
    const scaleY = image.height / viewport.height;
    return {
      source: {
        x: safeRect.left * scaleX,
        y: safeRect.top * scaleY,
        width: safeRect.width * scaleX,
        height: safeRect.height * scaleY,
      },
      output: {
        width: Math.max(1, Math.round(safeRect.width * scaleX)),
        height: Math.max(1, Math.round(safeRect.height * scaleY)),
      },
    };
  }

  // Chrome refuses a canvas taller or wider than 32767 px, or larger than 16384 × 16384 in area.
  const CANVAS_LIMITS = Object.freeze({ dimension: 32767, area: 268435456 });

  // Plans a full-page capture: the scroll offsets to photograph, one viewport apart, and the
  // size of the stitched image. `page` is in CSS pixels; `scale` is image pixels per CSS pixel.
  // A page that would not fit in one canvas is cut at the limit and reported as truncated.
  function planFullPage(page, scale, limits = CANVAS_LIMITS) {
    const viewportHeight = Math.max(1, page.viewportHeight);
    const pageHeight = Math.max(page.height, viewportHeight);
    const width = Math.max(1, Math.round(page.viewportWidth * scale.x));
    const fullHeight = Math.max(1, Math.round(pageHeight * scale.y));
    const maxHeight = Math.max(1, Math.min(limits.dimension, Math.floor(limits.area / width)));
    const height = Math.min(fullHeight, maxHeight);
    const coveredHeight = height / scale.y;
    const maxScroll = pageHeight - viewportHeight;
    const positions = [];
    for (let top = 0; top < coveredHeight; top += viewportHeight) {
      positions.push(Math.min(top, maxScroll));
    }
    return { width, height, positions, truncated: fullHeight > maxHeight };
  }

  // An element scrolls its content when it is set to and has more content than room; a pixel
  // of difference is rounding, not scrolling.
  function canScrollY(overflowY, scrollHeight, clientHeight) {
    return ["auto", "scroll", "overlay"].includes(overflowY) && scrollHeight > clientHeight + 1;
  }

  // Plans a scroll-and-stitch capture of one scroller: a panel inside the page, or the page
  // itself for an element taller than the window. All lengths are CSS pixels in the scroller's
  // content. At scroll position `s` the window shows content from `s + offset` for
  // `windowHeight`; `start`–`end` is what should be captured and `width` how wide it is.
  // Content the window can never show is left out (`partial`), and an image that would not
  // fit in one canvas is cut at the limit (`truncated`).
  function planScrollCapture(area, scale, limits = CANVAS_LIMITS) {
    const windowHeight = Math.max(1, area.windowHeight);
    const offset = Math.max(0, area.offset);
    const maxScroll = Math.max(0, area.maxScroll);
    const top = Math.max(area.start, offset);
    const reachable = Math.max(top, Math.min(area.end, maxScroll + offset + windowHeight));
    const width = Math.max(1, Math.round(area.width * scale.x));
    const fullHeight = Math.max(1, Math.round((reachable - top) * scale.y));
    const maxHeight = Math.max(1, Math.min(limits.dimension, Math.floor(limits.area / width)));
    const height = Math.min(fullHeight, maxHeight);
    const bottom = top + height / scale.y;

    const positions = [];
    let position = clamp(top - offset, 0, maxScroll);
    for (;;) {
      positions.push(position);
      if (position + offset + windowHeight >= bottom) break;
      const next = Math.min(position + windowHeight, maxScroll);
      if (next <= position) break;
      position = next;
    }
    return {
      width,
      height,
      positions,
      top,
      bottom,
      truncated: fullHeight > maxHeight,
      partial: top - area.start > 0.5 || area.end - reachable > 0.5,
    };
  }

  // What one screenshot adds to the stitched image: the rows of the window (from `sourceTop`
  // in the viewport, CSS pixels) that land `destTop` below the top of the image. Rows above
  // `covered` (content already drawn) are skipped; null when nothing new is on screen.
  function scrollSlice(plan, position, view, covered = plan.top) {
    const shownTop = position + view.offset;
    const from = Math.max(shownTop, covered, plan.top);
    const to = Math.min(shownTop + view.windowHeight, plan.bottom);
    if (to - from < 0.5) return null;
    return {
      sourceTop: view.windowTop + (from - shownTop),
      destTop: from - plan.top,
      height: to - from,
    };
  }

  const api = Object.freeze({
    CANVAS_LIMITS,
    canScrollY,
    clamp,
    fitRectToBounds,
    getCropMetrics,
    moveRectTo,
    planFullPage,
    planScrollCapture,
    rectFromPoints,
    resizeRect,
    scrollSlice,
  });

  scope.RegionSnapGeometry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
