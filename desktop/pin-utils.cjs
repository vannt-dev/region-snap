/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
// Size, zoom, opacity and drag maths for pinned captures. Pure functions so they can be tested
// without Electron; main.cjs clamps every value from a pin window through them.

const PIN_LIMITS = Object.freeze({
  minScale: 0.1,
  maxScale: 8,
  minSize: 16,
  maxSize: 16384,
  minOpacity: 0.2,
  maxOpacity: 1,
  zoomStep: 1.1,
  opacityStep: 0.1,
});
// One mouse-wheel notch on Windows; touchpads send smaller deltas and zoom proportionally.
const WHEEL_NOTCH = 100;
const MAX_NOTCHES_PER_EVENT = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

function wheelNotches(deltaY) {
  return clamp(finite(deltaY, 0) / WHEEL_NOTCH, -MAX_NOTCHES_PER_EVENT, MAX_NOTCHES_PER_EVENT);
}

// The zoom range for a pin of this logical size: never smaller than minSize on its short side,
// never larger than maxSize on its long side, and 100% always allowed.
function scaleLimits(baseSize) {
  const shortSide = Math.max(1, Math.min(baseSize.width, baseSize.height));
  const longSide = Math.max(1, baseSize.width, baseSize.height);
  return {
    min: Math.min(1, Math.max(PIN_LIMITS.minScale, PIN_LIMITS.minSize / shortSide)),
    max: Math.max(1, Math.min(PIN_LIMITS.maxScale, PIN_LIMITS.maxSize / longSide)),
  };
}

function clampScale(scale, baseSize) {
  const { min, max } = scaleLimits(baseSize);
  return Math.round(clamp(finite(scale, 1), min, max) * 1000) / 1000;
}

// Wheel up (negative deltaY) zooms in, wheel down zooms out.
function nextScale(scale, deltaY, baseSize) {
  return clampScale(finite(scale, 1) * PIN_LIMITS.zoomStep ** -wheelNotches(deltaY), baseSize);
}

function clampOpacity(opacity) {
  const value = clamp(finite(opacity, 1), PIN_LIMITS.minOpacity, PIN_LIMITS.maxOpacity);
  return Math.round(value * 100) / 100;
}

// Wheel up (negative deltaY) makes the pin more opaque, wheel down more transparent.
function nextOpacity(opacity, deltaY) {
  return clampOpacity(finite(opacity, 1) - wheelNotches(deltaY) * PIN_LIMITS.opacityStep);
}

// Resizes `bounds` to `baseSize * scale`, keeping the point at `anchor` (fractions of the
// window, 0..1; the centre when missing) under the cursor.
function scaledBounds(bounds, baseSize, scale, anchor = {}) {
  const fx = clamp(finite(anchor.x, 0.5), 0, 1);
  const fy = clamp(finite(anchor.y, 0.5), 0, 1);
  const width = Math.max(1, Math.round(baseSize.width * scale));
  const height = Math.max(1, Math.round(baseSize.height * scale));
  return {
    x: Math.round(bounds.x + bounds.width * fx - width * fx),
    y: Math.round(bounds.y + bounds.height * fy - height * fy),
    width,
    height,
  };
}

// Where a capture of `rect` (overlay coordinates) is pinned: exactly over the captured region.
function initialPinBounds(rect, virtualBounds) {
  return {
    x: Math.round(virtualBounds.x + rect.left),
    y: Math.round(virtualBounds.y + rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

// Moves `bounds` so that at least part of it is inside `area` (a display), for a pin of an older
// capture whose display layout has changed since.
function keepOnScreen(bounds, area) {
  const visible = Math.min(48, bounds.width, bounds.height);
  return {
    ...bounds,
    x: clamp(bounds.x, area.x - bounds.width + visible, area.x + area.width - visible),
    y: clamp(bounds.y, area.y, area.y + area.height - visible),
  };
}

// The window position while dragging: the start position moved by how far the pointer moved.
// The size stays the stored one so the window cannot creep on scaled displays.
function dragBounds(start, pointerStart, pointer) {
  const dx = finite(pointer?.x, pointerStart.x) - pointerStart.x;
  const dy = finite(pointer?.y, pointerStart.y) - pointerStart.y;
  return {
    x: Math.round(start.x + dx),
    y: Math.round(start.y + dy),
    width: start.width,
    height: start.height,
  };
}

const MODIFIER_ALIASES = Object.freeze({
  cmdorctrl: "ctrl",
  commandorcontrol: "ctrl",
  control: "ctrl",
  ctrl: "ctrl",
  option: "alt",
  altgr: "altgr",
  meta: "super",
  cmd: "super",
  command: "super",
  super: "super",
});

function normalizeAccelerator(accelerator) {
  if (typeof accelerator !== "string" || !accelerator.trim()) return "";
  const parts = accelerator
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.pop() || "";
  const modifiers = [...new Set(parts.map((part) => MODIFIER_ALIASES[part] || part))].sort();
  return [...modifiers, key].join("+");
}

function sameAccelerator(first, second) {
  const normalized = normalizeAccelerator(first);
  return Boolean(normalized) && normalized === normalizeAccelerator(second);
}

module.exports = {
  PIN_LIMITS,
  clampOpacity,
  clampScale,
  dragBounds,
  initialPinBounds,
  keepOnScreen,
  nextOpacity,
  nextScale,
  normalizeAccelerator,
  sameAccelerator,
  scaleLimits,
  scaledBounds,
};
