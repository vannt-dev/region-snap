const Geometry = require("../geometry.js");

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function intersectRect(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function getVirtualBounds(displays) {
  if (!Array.isArray(displays) || !displays.length) throw new Error("Không tìm thấy màn hình.");
  const left = Math.min(...displays.map(({ bounds }) => bounds.x));
  const top = Math.min(...displays.map(({ bounds }) => bounds.y));
  const right = Math.max(...displays.map(({ bounds }) => bounds.x + bounds.width));
  const bottom = Math.max(...displays.map(({ bounds }) => bounds.y + bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function displayLayout(displays, virtualBounds) {
  return displays.map((display) => ({
    id: String(display.id),
    bounds: {
      x: display.bounds.x - virtualBounds.x,
      y: display.bounds.y - virtualBounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    scaleFactor: display.scaleFactor,
  }));
}

function sameDisplayLayout(expected, actual) {
  if (expected.length !== actual.length) return false;
  return expected.every((display, index) => {
    const candidate = actual[index];
    return (
      display.id === candidate?.id &&
      display.bounds.x === candidate.bounds.x &&
      display.bounds.y === candidate.bounds.y &&
      display.bounds.width === candidate.bounds.width &&
      display.bounds.height === candidate.bounds.height
    );
  });
}

function validateSelection(payload, expectedViewport) {
  if (!payload || typeof payload !== "object") throw new Error("Dữ liệu vùng chụp không hợp lệ.");
  const { rect, viewport } = payload;
  if (
    !rect ||
    !viewport ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !finitePositive(rect.width) ||
    !finitePositive(rect.height) ||
    !finitePositive(viewport.width) ||
    !finitePositive(viewport.height) ||
    viewport.width !== expectedViewport.width ||
    viewport.height !== expectedViewport.height
  ) {
    throw new Error("Kích thước vùng chụp không hợp lệ.");
  }

  const safeRect = Geometry.fitRectToBounds(rect, viewport);
  if (safeRect.width < 1 || safeRect.height < 1) throw new Error("Vùng chụp quá nhỏ.");
  return { rect: safeRect, viewport };
}

function getNativeCropBounds(rect, viewport, imageSize) {
  if (!finitePositive(imageSize?.width) || !finitePositive(imageSize?.height)) {
    throw new Error("Kích thước ảnh màn hình không hợp lệ.");
  }
  const { source } = Geometry.getCropMetrics(rect, viewport, imageSize);
  const x = Math.max(0, Math.floor(source.x));
  const y = Math.max(0, Math.floor(source.y));
  const right = Math.min(imageSize.width, Math.ceil(source.x + source.width));
  const bottom = Math.min(imageSize.height, Math.ceil(source.y + source.height));
  const width = right - x;
  const height = bottom - y;
  if (width < 1 || height < 1) throw new Error("Vùng chụp nằm ngoài màn hình.");
  return { x, y, width, height };
}

module.exports = {
  displayLayout,
  getNativeCropBounds,
  getVirtualBounds,
  intersectRect,
  sameDisplayLayout,
  validateSelection,
};
