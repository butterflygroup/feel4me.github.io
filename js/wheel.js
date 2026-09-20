import { applyPaletteFromURL, clearPresetWedgeOverrides, initColorsPanel } from "./colors-panel.js";
import {
  hideEmotionGuidePanel,
  initEmotionGuideUI,
  renderEmotionGuide,
  setBundledGuides,
} from "./emotion-guide.js";
import { flattenFeelingsForReference, normalizeSegment } from "./feelings-reference.js";

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
const selectionPanel = document.getElementById("wheel-selection");
const selectionHeading = document.getElementById("selection-heading");
const selectionClearBtn = document.getElementById("wheel-selection-clear");

const SELECTION_PLACEHOLDER = "Tap a wedge to select";

/** Max rows in the feelings search suggestion list */
const FEELINGS_SUGGEST_CAP = 10;

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
/** @type {SVGPathElement | null} */
let selectionRing = null;
/** Breadcrumb of the selected wedge; while set, the idle spin stays paused. */
let selectedCrumb = "";
let alignHandle = 0;
/** @type {SVGPathElement | null} */
let rovingSegment = null;
/** Keyboard navigation maps, rebuilt on every render. */
let wheelNav = { rings: [], parentOf: new WeakMap(), firstChildOf: new WeakMap() };

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

const LABEL_FONT_MIN = 7;
const LABEL_FONT_MAX = 16;
/** Approximate glyph advance (em) for the semi-bold UI font; errs wide so labels stay inside their ring. */
const LABEL_CHAR_EM = 0.6;
/** Share of the ring width a label may span */
const LABEL_RING_FILL = 0.9;

/**
 * Labels read along the spoke: ring width limits their length, arc length limits their height.
 * @param {string} text
 * @param {number} arcLen wedge arc length at the label radius
 * @param {number} ringWidth radial depth of the wedge
 */
function labelFontSize(text, arcLen, ringWidth) {
  const byArc = arcLen * 0.6;
  const byLength = (ringWidth * LABEL_RING_FILL) / (Math.max(1, text.length) * LABEL_CHAR_EM);
  const fit = Math.floor(Math.min(byArc, byLength) * 2) / 2;
  return Math.max(LABEL_FONT_MIN, Math.min(LABEL_FONT_MAX, fit));
}

/** Truncate only when a label cannot fit its ring even at the minimum font size. */
function fitLabelText(text, ringWidth) {
  const maxChars = Math.floor((ringWidth * LABEL_RING_FILL) / (LABEL_FONT_MIN * LABEL_CHAR_EM));
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Rotation in degrees so `<text>` reads along the spoke, outward from the center (all rings). */
function labelRotation(midRad) {
  return (midRad * 180) / Math.PI;
}

function appendLabel(svgNs, parent, text, midRad, textR, fs) {
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
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("transform", `rotate(${labelRotation(midRad)} ${x.toFixed(3)} ${y.toFixed(3)})`);
  el.textContent = text;
  parent.appendChild(el);
}

function renderWheel(data) {
  mount.innerHTML = "";
  const segments = data.segments.map(normalizeSegment);
  const maxDepth = Math.max(...segments.map(deepestLeafSteps));
  const radii = buildRadii(maxDepth);

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", `${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`);
  svg.setAttribute("width", "640");
  svg.setAttribute("height", "640");

  rotatingGroup = document.createElementNS(svgNs, "g");
  rotatingGroup.classList.add("wheel-rotating");

  wheelNav = { rings: [], parentOf: new WeakMap(), firstChildOf: new WeakMap() };
  rovingSegment = null;

  function drawBranch(node, start, end, depth, rootIndex, breadcrumb, parentPath) {
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
    path.dataset.midDeg = String((mid * 180) / Math.PI);
    if (!node.children?.length) {
      path.dataset.leaf = "1";
    }
    path.setAttribute("role", "button");
    path.setAttribute("aria-label", crumb);
    path.setAttribute("aria-pressed", "false");
    path.tabIndex = -1;
    (wheelNav.rings[depth] ??= []).push(path);
    if (parentPath) {
      wheelNav.parentOf.set(path, parentPath);
      if (!wheelNav.firstChildOf.has(parentPath)) wheelNav.firstChildOf.set(parentPath, path);
    }
    path.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectSegment(path);
    });
    path.addEventListener("focus", () => setRovingSegment(path));
    path.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectSegment(path);
        return;
      }
      if (ev.key === "Escape" && selectedCrumb) {
        ev.preventDefault();
        clearSelection();
        return;
      }
      const target = segmentForArrowKey(path, depth, ev.key);
      if (target) {
        ev.preventDefault();
        setRovingSegment(target);
        target.focus();
      }
    });
    rotatingGroup.appendChild(path);

    const textR = (rInner + rOuter) / 2;
    const ringWidth = rOuter - rInner;
    const labelText = fitLabelText(node.label, ringWidth);
    const fs = labelFontSize(labelText, (end - start) * textR, ringWidth);
    appendLabel(svgNs, rotatingGroup, labelText, mid, textR, fs);

    if (!node.children?.length) {
      return;
    }
    const span = end - start;
    node.children.forEach((child, i) => {
      const cs = start + (span * i) / node.children.length;
      const ce = start + (span * (i + 1)) / node.children.length;
      drawBranch(child, cs, ce, depth + 1, rootIndex, crumb, path);
    });
  }

  const tau = Math.PI * 2;
  const n = segments.length;
  segments.forEach((seg, rootIndex) => {
    const start = -Math.PI / 2 + (tau * rootIndex) / n;
    const end = -Math.PI / 2 + (tau * (rootIndex + 1)) / n;
    drawBranch(seg, start, end, 0, rootIndex, "", null);
  });

  if (wheelNav.rings[0]?.[0]) setRovingSegment(wheelNav.rings[0][0]);

  // Drawn last so the selection outline is never covered by neighbouring wedges.
  selectionRing = document.createElementNS(svgNs, "path");
  selectionRing.classList.add("wheel-selection-ring");
  selectionRing.setAttribute("aria-hidden", "true");
  selectionRing.setAttribute("visibility", "hidden");
  rotatingGroup.appendChild(selectionRing);

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
  hubText.setAttribute("aria-hidden", "true");
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
  const keep = selectedCrumb ? findSegmentByCrumb(selectedCrumb) : null;
  if (keep) selectSegment(keep, { align: false, scroll: false });
  else resetSelectionDisplay();

  const fsInput = document.getElementById("feelings-search");
  const fsList = document.getElementById("feelings-search-list");
  if (fsInput && fsList) {
    if (fsInput.value.trim().length >= 2) {
      updateFeelingsSearchSuggestions(fsInput, fsList);
    } else {
      closeFeelingsSearchList(fsInput, fsList);
    }
  }
}

function applyRotation() {
  if (!rotatingGroup) return;
  rotatingGroup.setAttribute("transform", `rotate(${rotationDeg})`);
}

/** @returns {SVGPathElement | null} */
function findSegmentByCrumb(crumb) {
  for (const p of mount.querySelectorAll(".wheel-segment")) {
    if (p.dataset.breadcrumb === crumb) return p;
  }
  return null;
}

/** Deselect, hide the panel, and let the wheel drift again. */
function clearSelection() {
  clearSegmentSelection();
  resetSelectionDisplay();
  scheduleIdle();
}

function resetSelectionDisplay() {
  selectedCrumb = "";
  hideEmotionGuidePanel();
  if (selectionTextEl) selectionTextEl.textContent = SELECTION_PLACEHOLDER;
  if (selectionHeading) selectionHeading.hidden = false;
  if (selectionPanel) selectionPanel.hidden = true;
}

function clearSegmentSelection() {
  mount.querySelectorAll(".wheel-segment.is-selected").forEach((p) => {
    p.classList.remove("is-selected");
    p.setAttribute("aria-pressed", "false");
  });
  selectionRing?.setAttribute("visibility", "hidden");
}

/** Roving tabindex: the wheel is one tab stop; arrow keys move between wedges. */
function setRovingSegment(path) {
  if (rovingSegment === path) return;
  if (rovingSegment) rovingSegment.tabIndex = -1;
  path.tabIndex = 0;
  rovingSegment = path;
}

/** @returns {SVGPathElement | null} */
function segmentForArrowKey(path, depth, key) {
  const ring = wheelNav.rings[depth] ?? [];
  const i = ring.indexOf(path);
  switch (key) {
    case "ArrowRight":
      return ring[(i + 1) % ring.length] ?? null;
    case "ArrowLeft":
      return ring[(i - 1 + ring.length) % ring.length] ?? null;
    case "ArrowDown":
      return wheelNav.firstChildOf.get(path) ?? null;
    case "ArrowUp":
      return wheelNav.parentOf.get(path) ?? null;
    case "Home":
      return ring[0] ?? null;
    case "End":
      return ring[ring.length - 1] ?? null;
    default:
      return null;
  }
}

/**
 * @param {string} rawQuery
 * @returns {SVGPathElement[]}
 */
function getSegmentCandidates(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const paths = mount.querySelectorAll(".wheel-segment");
  /** @type {SVGPathElement[]} */
  const candidates = [];
  paths.forEach((p) => {
    const label = (p.dataset.label ?? "").toLowerCase();
    const crumb = (p.dataset.breadcrumb ?? "").toLowerCase();
    if (label.includes(q) || crumb.includes(q)) candidates.push(p);
  });
  return candidates;
}

/**
 * Rank by how the feeling's own label matches: exact, then prefix, then substring;
 * wedges that only match through an ancestor's name come last. Dedupe by breadcrumb.
 * @param {SVGPathElement[]} paths
 * @param {string} q normalized lowercase trimmed query
 */
function rankAndDedupeCandidates(paths, q) {
  function tier(p) {
    const label = (p.dataset.label ?? "").toLowerCase();
    if (label === q) return 0;
    if (label.startsWith(q)) return 1;
    if (label.includes(q)) return 2;
    return 3;
  }
  const ordered = [...paths].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const byLabel = (a.dataset.label ?? "").localeCompare(b.dataset.label ?? "", undefined, { sensitivity: "base" });
    if (byLabel !== 0) return byLabel;
    return (a.dataset.breadcrumb ?? "").localeCompare(b.dataset.breadcrumb ?? "", undefined, { sensitivity: "base" });
  });
  const seen = new Set();
  /** @type {SVGPathElement[]} */
  const out = [];
  for (const p of ordered) {
    const c = p.dataset.breadcrumb ?? "";
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(p);
  }
  return out;
}

/** @returns {SVGPathElement[]} */
function rankedFeelingsMatches(rawQuery, limit = FEELINGS_SUGGEST_CAP) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const ranked = rankAndDedupeCandidates(getSegmentCandidates(rawQuery), q);
  return ranked.slice(0, limit);
}

/** @returns {SVGPathElement | null} */
function findBestSegmentMatch(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;
  const ranked = rankAndDedupeCandidates(getSegmentCandidates(rawQuery), q);
  return ranked[0] ?? null;
}

/** @type {number} */
let feelingsSearchActiveIndex = -1;
/** @type {SVGPathElement[]} */
let feelingsSearchPaths = [];

function closeFeelingsSearchList(input, listEl) {
  feelingsSearchActiveIndex = -1;
  feelingsSearchPaths = [];
  listEl.hidden = true;
  listEl.innerHTML = "";
  input.removeAttribute("aria-activedescendant");
  input.setAttribute("aria-expanded", "false");
}

function setFeelingsSearchActiveOption(input, listEl, index) {
  const opts = listEl.querySelectorAll('[role="option"]');
  feelingsSearchActiveIndex = index;
  opts.forEach((el, i) => {
    el.setAttribute("aria-selected", i === index ? "true" : "false");
    el.classList.toggle("feelings-search__option--active", i === index);
  });
  if (index >= 0 && opts[index]) {
    input.setAttribute("aria-activedescendant", opts[index].id);
    opts[index].scrollIntoView({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function renderFeelingsSearchOptions(input, listEl, paths) {
  listEl.innerHTML = "";
  feelingsSearchPaths = paths;
  feelingsSearchActiveIndex = paths.length > 0 ? 0 : -1;

  paths.forEach((path, i) => {
    const opt = document.createElement("div");
    opt.id = `feelings-search-opt-${i}`;
    opt.className = "feelings-search__option";
    opt.setAttribute("role", "option");
    opt.setAttribute("aria-selected", i === 0 ? "true" : "false");
    opt.textContent = path.dataset.breadcrumb ?? path.dataset.label ?? "";
    opt.addEventListener("mouseenter", () => setFeelingsSearchActiveOption(input, listEl, i));
    opt.addEventListener("click", () => {
      selectSegment(path);
      closeFeelingsSearchList(input, listEl);
    });
    listEl.appendChild(opt);
  });

  if (paths.length > 0) {
    listEl.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setFeelingsSearchActiveOption(input, listEl, 0);
  } else {
    listEl.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
}

function showNoMatch(query) {
  clearSelection();
  if (selectionHeading) selectionHeading.hidden = true;
  if (selectionClearBtn) selectionClearBtn.hidden = true;
  if (selectionTextEl) selectionTextEl.textContent = `No match for "${query}"`;
  if (selectionPanel) selectionPanel.hidden = false;
}

function updateFeelingsSearchSuggestions(input, listEl) {
  const raw = input.value;
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    closeFeelingsSearchList(input, listEl);
    clearSelection();
    return;
  }

  if (trimmed.length < 2) {
    closeFeelingsSearchList(input, listEl);
    return;
  }

  const ranked = rankedFeelingsMatches(raw, FEELINGS_SUGGEST_CAP);
  if (ranked.length === 0) {
    closeFeelingsSearchList(input, listEl);
    showNoMatch(trimmed);
    return;
  }

  if (selectionTextEl?.textContent.startsWith("No match")) {
    if (selectionPanel) selectionPanel.hidden = true;
    if (selectionHeading) selectionHeading.hidden = false;
  }

  renderFeelingsSearchOptions(input, listEl, ranked);
}

function commitFeelingsSearchSelection(input, listEl) {
  const trimmed = input.value.trim();
  if (trimmed.length === 0) {
    clearSelection();
    closeFeelingsSearchList(input, listEl);
    return;
  }

  const listOpen = !listEl.hidden && feelingsSearchPaths.length > 0;
  if (listOpen) {
    const idx =
      feelingsSearchActiveIndex >= 0 && feelingsSearchActiveIndex < feelingsSearchPaths.length
        ? feelingsSearchActiveIndex
        : 0;
    const path = feelingsSearchPaths[idx];
    if (path) {
      selectSegment(path);
      closeFeelingsSearchList(input, listEl);
    }
    return;
  }

  const path = findBestSegmentMatch(input.value);
  if (!path) {
    showNoMatch(trimmed);
    return;
  }
  selectSegment(path);
}

function handleFeelingsSearch(ev) {
  ev.preventDefault();
  const input = document.getElementById("feelings-search");
  const listEl = document.getElementById("feelings-search-list");
  if (!input || !listEl) return;
  commitFeelingsSearchSelection(input, listEl);
}

function initFeelingsSearchUI() {
  const form = document.getElementById("feelings-search-form");
  const input = document.getElementById("feelings-search");
  const combo = document.querySelector(".feelings-search__combo");
  const listEl = document.getElementById("feelings-search-list");
  if (!form || !input || !combo || !listEl) return;

  let blurCloseTimer = 0;

  form.addEventListener("submit", handleFeelingsSearch);

  input.addEventListener("input", () => updateFeelingsSearchSuggestions(input, listEl));

  listEl.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
  });

  combo.addEventListener("focusout", () => {
    blurCloseTimer = window.setTimeout(() => {
      closeFeelingsSearchList(input, listEl);
    }, 150);
  });

  combo.addEventListener("focusin", () => {
    window.clearTimeout(blurCloseTimer);
  });

  document.addEventListener("pointerdown", (ev) => {
    if (!combo.contains(ev.target)) closeFeelingsSearchList(input, listEl);
  });

  input.addEventListener("keydown", (ev) => {
    const open = !listEl.hidden && feelingsSearchPaths.length > 0;
    if (ev.key === "Escape") {
      if (open) {
        ev.preventDefault();
        closeFeelingsSearchList(input, listEl);
      }
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitFeelingsSearchSelection(input, listEl);
      return;
    }
    if (!open) return;

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      const next = Math.min(feelingsSearchActiveIndex + 1, feelingsSearchPaths.length - 1);
      setFeelingsSearchActiveOption(input, listEl, next);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      const next = Math.max(feelingsSearchActiveIndex - 1, 0);
      setFeelingsSearchActiveOption(input, listEl, next);
    }
  });
}

/**
 * @param {SVGPathElement} path
 * @param {{ align?: boolean; scroll?: boolean }} [opts]
 */
function selectSegment(path, { align = true, scroll = true } = {}) {
  clearSegmentSelection();
  path.classList.add("is-selected");
  path.setAttribute("aria-pressed", "true");
  setRovingSegment(path);
  if (selectionRing) {
    selectionRing.setAttribute("d", path.getAttribute("d") ?? "");
    selectionRing.setAttribute("visibility", "visible");
  }
  const crumb = path.dataset.breadcrumb ?? path.dataset.label ?? "";
  const isLeaf = path.dataset.leaf === "1";
  if (selectionHeading) selectionHeading.hidden = false;
  if (selectionTextEl) {
    selectionTextEl.textContent = crumb || SELECTION_PLACEHOLDER;
  }
  if (selectionClearBtn) selectionClearBtn.hidden = false;
  if (selectionPanel) selectionPanel.hidden = !crumb;
  renderEmotionGuide(crumb, isLeaf);
  selectedCrumb = crumb;
  stopIdleWhileDragging();
  if (align) alignSegmentToTop(path);
  if (scroll && selectionPanel && !selectionPanel.hidden) {
    selectionPanel.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
  }
}

function stopAlign() {
  if (alignHandle) cancelAnimationFrame(alignHandle);
  alignHandle = 0;
}

/** Turn the wheel the short way round so the wedge's centre sits at 12 o'clock. */
function alignSegmentToTop(path) {
  stopAlign();
  stopInertia();
  const midDeg = Number(path.dataset.midDeg) || 0;
  const from = rotationDeg;
  const delta = ((((-90 - midDeg - from) % 360) + 540) % 360) - 180;
  if (prefersReducedMotion || Math.abs(delta) < 0.5) {
    rotationDeg = from + delta;
    applyRotation();
    return;
  }
  const duration = 350 + Math.abs(delta) * 2.5;
  const t0 = performance.now();
  mount.classList.add("is-idle");
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - (1 - t) ** 3;
    rotationDeg = from + delta * eased;
    applyRotation();
    if (t < 1) {
      alignHandle = requestAnimationFrame(step);
    } else {
      alignHandle = 0;
      mount.classList.remove("is-idle");
    }
  };
  alignHandle = requestAnimationFrame(step);
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
  if (prefersReducedMotion || dragPointerId !== null || inertiaHandle || selectedCrumb) return;
  cancelAnimationFrame(idleFrame);
  const tick = () => {
    if (dragPointerId !== null || inertiaHandle || selectedCrumb) return;
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
  stopAlign();
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

  const cancelled = ev.type === "pointercancel";
  if (cancelled) velocityDegPerMs = 0;

  const dx = ev.clientX - tapStartX;
  const dy = ev.clientY - tapStartY;
  if (!cancelled && dx * dx + dy * dy <= 100) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const seg = hit?.closest?.(".wheel-segment");
    if (seg) selectSegment(seg);
    else if (hit?.closest?.(".wheel-hub") && selectedCrumb) clearSelection();
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

/** Static reference list below the wheel: "Show on the wheel" links and #feeling deep links. */
function initFeelingsReferenceLinks() {
  document.addEventListener("click", (ev) => {
    const link = ev.target instanceof Element ? ev.target.closest("a[data-crumb]") : null;
    if (!link) return;
    const path = findSegmentByCrumb(link.dataset.crumb ?? "");
    if (!path) return;
    ev.preventDefault();
    selectSegment(path, { scroll: false });
    document
      .querySelector(".wheel-stage")
      ?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  });

  const openTargetedFeeling = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && !id.includes("=") ? document.getElementById(id) : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
  };
  window.addEventListener("hashchange", openTargetedFeeling);
  openTargetedFeeling();
}

async function init() {
  applyPaletteFromURL();

  const emotionsUrl = new URL("../data/emotions.json", import.meta.url);
  const guidesUrl = new URL("../data/emotion-guides.json", import.meta.url);
  const [emotionsRes, guidesRes] = await Promise.all([fetch(emotionsUrl), fetch(guidesUrl)]);
  if (!emotionsRes.ok) throw new Error(`Failed to load emotions (${emotionsRes.status})`);
  const data = await emotionsRes.json();
  wheelPayload = data;

  if (guidesRes.ok) {
    try {
      setBundledGuides(await guidesRes.json());
    } catch {
      setBundledGuides({});
    }
  } else {
    setBundledGuides({});
  }

  let th = document.documentElement.dataset.theme ?? themeSelect?.value ?? "ocean";
  if (!["ocean", "sunset", "forest", "mono"].includes(th)) th = "ocean";
  document.documentElement.dataset.theme = th;
  if (themeSelect) themeSelect.value = th;

  initColorsPanel({
    themeSelect,
    recolor: () => wheelPayload && renderWheel(wheelPayload),
  });

  renderWheel(wheelPayload);

  const feelingsRefRows = flattenFeelingsForReference(data.segments.map(normalizeSegment));
  const segmentCount = mount.querySelectorAll(".wheel-segment").length;
  if (segmentCount !== feelingsRefRows.length) {
    console.warn(
      `[feelings wheel] Reference rows (${feelingsRefRows.length}) do not match segment count (${segmentCount}).`,
    );
  }

  initFeelingsSearchUI();
  initEmotionGuideUI();

  initFeelingsReferenceLinks();

  selectionClearBtn?.addEventListener("click", () => {
    const fsInput = document.getElementById("feelings-search");
    if (fsInput) fsInput.value = "";
    clearSelection();
  });

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
