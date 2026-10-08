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

  const api = Object.freeze({
    CANVAS_LIMITS,
    clamp,
    fitRectToBounds,
    getCropMetrics,
    moveRectTo,
    planFullPage,
    rectFromPoints,
    resizeRect,
  });

  scope.RegionSnapGeometry = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
