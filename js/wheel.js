import { applyPaletteFromURL, clearPresetWedgeOverrides, initColorsPanel } from "./colors-panel.js";

const VIEW = 640;
const HUB_R = 52;
const OUTER_R = 296;

/** Center hub label — three lines */
const HUB_LINES = ["Feel", "4me", ".com"];
const HUB_FONT_SIZE = 18;
/** Line spacing (px); tuned so the block sits visually centered in the hub */
const HUB_LINE_GAP = Math.round(HUB_FONT_SIZE * 1.14);

const mount = document.getElementById("wheel-mount");
const themeSelect = document.getElementById("theme-select");
const selectionTextEl = document.getElementById("wheel-selection-text");

const SELECTION_PLACEHOLDER = "Tap a wedge to select";

let rotatingGroup = null;
let rotationDeg = 0;
let dragPointerId = null;
let lastPointerAngle = 0;
let prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let idleFrame = 0;
let inertiaHandle = 0;
let velocityDegPerMs = 0;
let lastMoveTs = 0;
let tapStartX = 0;
let tapStartY = 0;
/** @type {object | null} */
let wheelPayload = null;

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (ev) => {
  prefersReducedMotion = ev.matches;
  if (prefersReducedMotion) stopIdleWhileDragging();
  else if (dragPointerId === null && !inertiaHandle) scheduleIdle();
});

function polar(r, rad) {
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

function wedgePath(rInner, rOuter, a0, a1) {
  const arcLarge = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(rOuter, a0);
  const [ox1, oy1] = polar(rOuter, a1);
  const [ix1, iy1] = polar(rInner, a1);
  const [ix0, iy0] = polar(rInner, a0);
  return `M ${ox0} ${oy0} A ${rOuter} ${rOuter} 0 ${arcLarge} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${arcLarge} 0 ${ix0} ${iy0} Z`;
}

function normalizeSegment(node) {
  const childrenRaw = node.children ?? [];
  const children = childrenRaw.map((c) =>
    typeof c === "string" ? { label: c, children: [] } : normalizeSegment(c),
  );
  return { label: node.label, children };
}

function deepestLeafSteps(node) {
  if (!node.children?.length) return 0;
  return 1 + Math.max(...node.children.map(deepestLeafSteps));
}

function buildRadii(maxDepth) {
  const radii = [];
  radii[0] = HUB_R;
  for (let i = 1; i <= maxDepth + 1; i++) {
    const t = i / (maxDepth + 1);
    radii[i] = HUB_R + t * (OUTER_R - HUB_R);
  }
  return radii;
}

function themePalette() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const theme = root.dataset.theme ?? "ocean";
  if (theme === "mono") {
    return { mono: true, hue: 220 };
  }
  const hueShift = Number(cs.getPropertyValue("--hue-shift")) || 200;
  const sat = Number.parseFloat(cs.getPropertyValue("--sat-base")) || 55;
  const light = Number.parseFloat(cs.getPropertyValue("--light-base")) || 52;
  return { mono: false, hueShift: hueShift, sat, light };
}

function segmentFill(rootIndex, depth, maxDepth) {
  const p = themePalette();
  if (p.mono) {
    const band = maxDepth > 0 ? depth / maxDepth : 0;
    const l = 78 - band * 22 - (rootIndex % 4) * 3;
    return `hsl(${p.hue} 10% ${Math.max(34, l)}%)`;
  }
  const hue = (p.hueShift + rootIndex * 38 + depth * 12) % 360;
  const light = Math.max(36, p.light - depth * 7 - (rootIndex % 3) * 2);
  const sat = Math.min(78, p.sat + depth * 2);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function labelFontSize(depth, maxDepth) {
  const outerBias = maxDepth > 0 ? 1 - depth / maxDepth : 1;
  // Ring 1: wide labels on relatively narrow wedges — smaller type than the old default (~22px).
  if (depth === 0) {
    return Math.max(9, Math.round(6 + outerBias * 8));
  }
  // Ring 2 (middle) has many narrow wedges — keep type smaller so labels fit along the spoke.
  if (depth === 1) {
    return Math.max(8, Math.round(7 + outerBias * 7));
  }
  return Math.round(10 + outerBias * 12);
}

/** Rotation in degrees so `<text>` reads along the spoke, outward from the center (all rings). */
function labelRotation(midRad) {
  return (midRad * 180) / Math.PI;
}

function appendLabel(svgNs, parent, text, midRad, textR, depth, maxDepth) {
  const fs = labelFontSize(depth, maxDepth);
  const [x, y] = polar(textR, midRad);
  const el = document.createElementNS(svgNs, "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("text-anchor", "middle");
  el.setAttribute("dominant-baseline", "middle");
  el.setAttribute("fill", "var(--segment-text)");
  el.setAttribute("font-size", String(fs));
  el.setAttribute("font-weight", "600");
  el.setAttribute("pointer-events", "none");
  el.setAttribute("transform", `rotate(${labelRotation(midRad)} ${x.toFixed(3)} ${y.toFixed(3)})`);
  el.textContent = text;
  parent.appendChild(el);
}

function renderWheel(data) {
  mount.innerHTML = "";
  const segments = data.segments.map(normalizeSegment);
  const maxDepth = Math.max(...segments.map(deepestLeafSteps));
  const radii = buildRadii(maxDepth);

  function abbrev(s) {
    return s.length <= 12 ? s : `${s.slice(0, 11)}…`;
  }

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`);
  svg.setAttribute("width", "640");
  svg.setAttribute("height", "640");
  svg.setAttribute("role", "presentation");

  rotatingGroup = document.createElementNS(svgNs, "g");
  rotatingGroup.classList.add("wheel-rotating");

  function drawBranch(node, start, end, depth, rootIndex, breadcrumb) {
    const rInner = radii[depth];
    const rOuter = node.children?.length ? radii[depth + 1] : radii[maxDepth + 1];
    const mid = (start + end) / 2;
    const crumb = breadcrumb.length ? `${breadcrumb} › ${node.label}` : node.label;

    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", wedgePath(rInner, rOuter, start, end));
    path.setAttribute("fill", segmentFill(rootIndex, depth, maxDepth));
    path.setAttribute("stroke", "var(--segment-stroke)");
    path.setAttribute("stroke-width", "1");
    path.classList.add("wheel-segment");
    path.dataset.breadcrumb = crumb;
    path.dataset.label = node.label;
    path.tabIndex = 0;
    path.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectSegment(path);
    });
    path.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectSegment(path);
      }
    });
    rotatingGroup.appendChild(path);

    const textR = (rInner + rOuter) / 2;
    const arcSpan = end - start;
    const labelText =
      arcSpan * textR > 42 || node.label.length <= 10 ? node.label : abbrev(node.label);
    appendLabel(svgNs, rotatingGroup, labelText, mid, textR, depth, maxDepth);

    if (!node.children?.length) return;
    const span = end - start;
    node.children.forEach((child, i) => {
      const cs = start + (span * i) / node.children.length;
      const ce = start + (span * (i + 1)) / node.children.length;
      drawBranch(child, cs, ce, depth + 1, rootIndex, crumb);
    });
  }

  const tau = Math.PI * 2;
  const n = segments.length;
  segments.forEach((seg, rootIndex) => {
    const start = -Math.PI / 2 + (tau * rootIndex) / n;
    const end = -Math.PI / 2 + (tau * (rootIndex + 1)) / n;
    drawBranch(seg, start, end, 0, rootIndex, "");
  });

  const hub = document.createElementNS(svgNs, "circle");
  hub.setAttribute("cx", "0");
  hub.setAttribute("cy", "0");
  hub.setAttribute("r", String(HUB_R - 4));
  hub.setAttribute("fill", "var(--center-fill)");
  hub.setAttribute("stroke", "var(--segment-stroke)");
  hub.classList.add("wheel-hub");

  const hubText = document.createElementNS(svgNs, "text");
  hubText.setAttribute("x", "0");
  hubText.setAttribute("y", "0");
  hubText.setAttribute("text-anchor", "middle");
  hubText.setAttribute("fill", "var(--center-text)");
  hubText.setAttribute("font-size", String(HUB_FONT_SIZE));
  hubText.setAttribute("font-weight", "700");
  hubText.setAttribute("pointer-events", "none");
  hubText.classList.add("wheel-hub-label");

  const hubMid = (HUB_LINES.length - 1) / 2;
  HUB_LINES.forEach((line, i) => {
    const tsp = document.createElementNS(svgNs, "tspan");
    tsp.setAttribute("x", "0");
    tsp.setAttribute("y", String((i - hubMid) * HUB_LINE_GAP));
    tsp.setAttribute("dominant-baseline", "middle");
    tsp.textContent = line;
    hubText.appendChild(tsp);
  });

  svg.appendChild(rotatingGroup);
  svg.appendChild(hub);
  svg.appendChild(hubText);
  mount.appendChild(svg);
  applyRotation();
  resetSelectionDisplay();
}

function applyRotation() {
  if (!rotatingGroup) return;
  rotatingGroup.setAttribute("transform", `rotate(${rotationDeg})`);
}

function resetSelectionDisplay() {
  if (selectionTextEl) selectionTextEl.textContent = SELECTION_PLACEHOLDER;
}

function selectSegment(path) {
  mount.querySelectorAll(".wheel-segment.is-selected").forEach((p) => p.classList.remove("is-selected"));
  path.classList.add("is-selected");
  const crumb = path.dataset.breadcrumb ?? path.dataset.label ?? "";
  if (selectionTextEl) {
    selectionTextEl.textContent = crumb ? `Selected: ${crumb}` : SELECTION_PLACEHOLDER;
  }
}

function pointerAngle(ev) {
  const rect = mount.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.atan2(ev.clientY - cy, ev.clientX - cx);
}

function stopIdleWhileDragging() {
  cancelAnimationFrame(idleFrame);
  idleFrame = 0;
}

function scheduleIdle() {
  if (prefersReducedMotion || dragPointerId !== null || inertiaHandle) return;
  cancelAnimationFrame(idleFrame);
  const tick = () => {
    if (dragPointerId !== null || inertiaHandle) return;
    rotationDeg = (rotationDeg + 0.035) % 360;
    applyRotation();
    idleFrame = requestAnimationFrame(tick);
  };
  idleFrame = requestAnimationFrame(tick);
}

function stopInertia() {
  if (inertiaHandle) cancelAnimationFrame(inertiaHandle);
  inertiaHandle = 0;
  velocityDegPerMs = 0;
  mount.classList.remove("is-idle");
}

function beginInertia() {
  if (prefersReducedMotion || Math.abs(velocityDegPerMs) < 0.004) {
    velocityDegPerMs = 0;
    scheduleIdle();
    return;
  }
  stopIdleWhileDragging();
  mount.classList.add("is-idle");
  let last = performance.now();

  const step = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    rotationDeg += velocityDegPerMs * dt;
    velocityDegPerMs *= Math.exp(-dt / 180);
    applyRotation();
    if (Math.abs(velocityDegPerMs) > 0.004) {
      inertiaHandle = requestAnimationFrame(step);
    } else {
      inertiaHandle = 0;
      velocityDegPerMs = 0;
      mount.classList.remove("is-idle");
      scheduleIdle();
    }
  };

  inertiaHandle = requestAnimationFrame(step);
}

mount.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.pointerType === "mouse") return;
  tapStartX = ev.clientX;
  tapStartY = ev.clientY;
  stopIdleWhileDragging();
  stopInertia();
  dragPointerId = ev.pointerId;
  mount.classList.add("is-idle");
  try {
    mount.setPointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
  lastPointerAngle = pointerAngle(ev);
  lastMoveTs = performance.now();
  velocityDegPerMs = 0;
});

mount.addEventListener("pointermove", (ev) => {
  if (dragPointerId !== ev.pointerId) return;
  const angle = pointerAngle(ev);
  let delta = angle - lastPointerAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  lastPointerAngle = angle;
  const deltaDeg = (delta * 180) / Math.PI;
  rotationDeg += deltaDeg;
  applyRotation();

  const now = performance.now();
  const dt = Math.max(1, now - lastMoveTs);
  lastMoveTs = now;
  const instant = deltaDeg / dt;
  velocityDegPerMs = velocityDegPerMs * 0.85 + instant * 0.15;
});

function endDrag(ev) {
  if (dragPointerId !== ev.pointerId) return;

  const dx = ev.clientX - tapStartX;
  const dy = ev.clientY - tapStartY;
  if (dx * dx + dy * dy <= 100) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const seg = hit?.closest?.(".wheel-segment");
    if (seg) selectSegment(seg);
  }

  dragPointerId = null;
  mount.classList.remove("is-idle");
  try {
    mount.releasePointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
  beginInertia();
}

mount.addEventListener("pointerup", endDrag);
mount.addEventListener("pointercancel", endDrag);

async function init() {
  applyPaletteFromURL();

  const url = new URL("../data/emotions.json", import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load emotions (${res.status})`);
  const data = await res.json();
  wheelPayload = data;

  let th = document.documentElement.dataset.theme ?? themeSelect?.value ?? "ocean";
  if (!["ocean", "sunset", "forest", "mono"].includes(th)) th = "ocean";
  document.documentElement.dataset.theme = th;
  if (themeSelect) themeSelect.value = th;

  initColorsPanel({
    themeSelect,
    recolor: () => wheelPayload && renderWheel(wheelPayload),
  });

  renderWheel(wheelPayload);

  themeSelect?.addEventListener("change", () => {
    clearPresetWedgeOverrides();
    document.documentElement.dataset.theme = themeSelect.value;
    renderWheel(wheelPayload);
    rotationDeg = rotationDeg % 360;
    applyRotation();
    if (!prefersReducedMotion && dragPointerId === null && !inertiaHandle) {
      cancelAnimationFrame(idleFrame);
      idleFrame = 0;
      scheduleIdle();
    }
  });

  if (!prefersReducedMotion) scheduleIdle();
}

init().catch((err) => {
  console.error(err);
  mount.textContent = "Could not load the feelings wheel.";
});
