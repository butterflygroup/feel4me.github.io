/**
 * Colors dialog: CSS variables, URL round-trip, clipboard share URL.
 */

const rootEl = () => document.documentElement;

/** Inline properties we own (clear on reset / preset wedge restore). */
const INLINE_VARS = [
  "--page-bg",
  "--hero-bg",
  "--page-fg",
  "--muted",
  "--wheel-stage-bg",
  "--wheel-shadow",
  "--segment-stroke",
  "--center-fill",
  "--segment-text",
  "--center-text",
  "--accent-selected",
  "--control-bg",
  "--control-border",
  "--control-fg",
  "--hue-shift",
  "--sat-base",
  "--light-base",
];

const THEME_WEDGE_DEFAULTS = {
  ocean: { hu: 200, sd: 62, li: 52 },
  sunset: { hu: 18, sd: 68, li: 56 },
  forest: { hu: 132, sd: 48, li: 48 },
  mono: { hu: 0, sd: 8, li: 62 },
};

function parseRgbLike(s) {
  const t = String(s).trim();
  const hex = t.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = t.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] !== undefined ? Number(rgb[4]) : 1,
    };
  }
  return null;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function rgbToHex({ r, g, b }) {
  const h = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbaFromHex(hex, alphaPct) {
  const rgb = parseRgbLike(hex);
  if (!rgb) return hex;
  const a = clamp(Number(alphaPct), 0, 100) / 100;
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

function readComputedVar(name) {
  return getComputedStyle(rootEl()).getPropertyValue(name).trim();
}

function hexFromComputed(name, fallback = "#000000") {
  const raw = readComputedVar(name);
  const p = parseRgbLike(raw);
  return p ? rgbToHex(p) : fallback;
}

function alphaPctFromComputed(name, fallback = 100) {
  const raw = readComputedVar(name);
  const p = parseRgbLike(raw);
  if (!p) return fallback;
  return clamp(Math.round(p.a * 100), 0, 100);
}

/** Apply URL search params to `<html>` inline styles (call before first wheel paint). */
export function applyPaletteFromURL() {
  const p = new URLSearchParams(location.search);
  if ([...p.keys()].length === 0) return;

  const r = rootEl().style;

  const setHex = (key, cssVar) => {
    const v = p.get(key);
    if (!v || !/^[\da-f]{6}$/i.test(v)) return;
    r.setProperty(cssVar, `#${v}`);
  };

  const setRgba = (hexKey, alphaKey, cssVar, defaultAlpha) => {
    const hex = p.get(hexKey);
    const ap = p.has(alphaKey) ? Number(p.get(alphaKey)) : defaultAlpha;
    if (!hex || !/^[\da-f]{6}$/i.test(hex)) return;
    r.setProperty(cssVar, rgbaFromHex(`#${hex}`, Number.isFinite(ap) ? ap : defaultAlpha));
  };

  setHex("pb", "--page-bg");
  setHex("hb", "--hero-bg");
  setHex("pf", "--page-fg");
  setHex("mu", "--muted");
  setRgba("ws", "wa", "--wheel-stage-bg", 18);
  setRgba("wd", "wo", "--wheel-shadow", 35);
  setRgba("ss", "ssa", "--segment-stroke", 55);
  setHex("cf", "--center-fill");
  setHex("st", "--segment-text");
  setHex("ct", "--center-text");
  setRgba("af", "aa", "--accent-selected", 95);
  setRgba("cg", "cba", "--control-bg", 6);
  setRgba("cn", "cna", "--control-border", 14);
  const lw = p.get("lw");
  if (lw === "b") {
    r.setProperty("--segment-text", "#000000");
    r.setProperty("--center-text", "#000000");
  } else if (lw === "w") {
    r.setProperty("--segment-text", "#ffffff");
    r.setProperty("--center-text", "#ffffff");
  }

  const th = p.get("th");
  if (th && /^(ocean|sunset|forest|mono)$/.test(th)) {
    rootEl().dataset.theme = th;
  }

  if (p.has("pf") && /^[\da-f]{6}$/i.test(p.get("pf"))) {
    r.setProperty("--control-fg", `#${p.get("pf")}`);
  }

  const hu = p.get("hu");
  const sd = p.get("sd");
  const li = p.get("li");
  if (hu !== null && hu !== "" && Number.isFinite(Number(hu))) {
    r.setProperty("--hue-shift", String(clamp(Number(hu), 0, 359)));
  }
  if (sd !== null && sd !== "" && Number.isFinite(Number(sd))) {
    r.setProperty("--sat-base", `${clamp(Number(sd), 0, 100)}%`);
  }
  if (li !== null && li !== "" && Number.isFinite(Number(li))) {
    r.setProperty("--light-base", `${clamp(Number(li), 0, 100)}%`);
  }
}

function gatherParamsFromForm(ui) {
  const params = new URLSearchParams();

  const hexNoHash = (id) => {
    const el = ui[id];
    if (!el?.value) return "";
    return el.value.replace(/^#/, "").toLowerCase();
  };

  params.set("pb", hexNoHash("pb"));
  params.set("hb", hexNoHash("hb"));
  params.set("pf", hexNoHash("pf"));
  params.set("mu", hexNoHash("mu"));
  params.set("ws", hexNoHash("ws"));
  params.set("wa", String(ui.wa.value));
  params.set("wd", hexNoHash("wd"));
  params.set("wo", String(ui.wo.value));
  params.set("ss", hexNoHash("ss"));
  params.set("ssa", String(ui.ssa.value));
  params.set("cf", hexNoHash("cf"));
  params.set("st", hexNoHash("st"));
  params.set("ct", hexNoHash("ct"));
  params.set("af", hexNoHash("af"));
  params.set("aa", String(ui.aa.value));
  params.set("cg", hexNoHash("cg"));
  params.set("cba", String(ui.cba.value));
  params.set("cn", hexNoHash("cn"));
  params.set("cna", String(ui.cna.value));

  const lwChecked = ui.form.querySelector('input[name="lw"]:checked');
  if (lwChecked?.value === "b" || lwChecked?.value === "w") {
    params.set("lw", lwChecked.value);
  }

  params.set("th", ui.themeSelect.value);
  params.set("hu", String(ui.hu.value));
  params.set("sd", String(ui.sd.value));
  params.set("li", String(ui.li.value));

  return params;
}

function applyFormToDocument(ui) {
  const r = rootEl().style;
  const hx = (id) => ui[id].value;

  r.setProperty("--page-bg", hx("pb"));
  r.setProperty("--hero-bg", hx("hb"));
  r.setProperty("--page-fg", hx("pf"));
  r.setProperty("--muted", hx("mu"));
  r.setProperty("--wheel-stage-bg", rgbaFromHex(hx("ws"), ui.wa.value));
  r.setProperty("--wheel-shadow", rgbaFromHex(hx("wd"), ui.wo.value));
  r.setProperty("--segment-stroke", rgbaFromHex(hx("ss"), ui.ssa.value));
  r.setProperty("--center-fill", hx("cf"));
  r.setProperty("--segment-text", hx("st"));
  r.setProperty("--center-text", hx("ct"));
  r.setProperty("--accent-selected", rgbaFromHex(hx("af"), ui.aa.value));
  r.setProperty("--control-bg", rgbaFromHex(hx("cg"), ui.cba.value));
  r.setProperty("--control-border", rgbaFromHex(hx("cn"), ui.cna.value));
  r.setProperty("--control-fg", hx("pf"));

  const lw = ui.form.querySelector('input[name="lw"]:checked')?.value;
  if (lw === "b") {
    r.setProperty("--segment-text", "#000000");
    r.setProperty("--center-text", "#000000");
    ui.st.value = "#000000";
    ui.ct.value = "#000000";
  } else if (lw === "w") {
    r.setProperty("--segment-text", "#ffffff");
    r.setProperty("--center-text", "#ffffff");
    ui.st.value = "#ffffff";
    ui.ct.value = "#ffffff";
  }

  rootEl().dataset.theme = ui.themeSelect.value;
  r.setProperty("--hue-shift", String(ui.hu.value));
  r.setProperty("--sat-base", `${ui.sd.value}%`);
  r.setProperty("--light-base", `${ui.li.value}%`);
}

function syncFormFromComputed(ui) {
  ui.pb.value = hexFromComputed("--page-bg", "#0f1419");
  ui.hb.value = hexFromComputed("--hero-bg", "#121922");
  ui.pf.value = hexFromComputed("--page-fg", "#ffffff");
  ui.mu.value = hexFromComputed("--muted", "#9aa7b2");

  ui.ws.value = hexFromComputed("--wheel-stage-bg", "#000000");
  ui.wa.value = String(alphaPctFromComputed("--wheel-stage-bg", 18));
  ui.wd.value = hexFromComputed("--wheel-shadow", "#000000");
  ui.wo.value = String(alphaPctFromComputed("--wheel-shadow", 35));

  ui.ss.value = hexFromComputed("--segment-stroke", "#0f1419");
  ui.ssa.value = String(alphaPctFromComputed("--segment-stroke", 55));

  ui.cf.value = hexFromComputed("--center-fill", "#2d3a48");
  ui.st.value = hexFromComputed("--segment-text", "#ffffff");
  ui.ct.value = hexFromComputed("--center-text", "#ffffff");

  ui.af.value = hexFromComputed("--accent-selected", "#ffffff");
  ui.aa.value = String(alphaPctFromComputed("--accent-selected", 95));

  ui.cg.value = hexFromComputed("--control-bg", "#ffffff");
  ui.cba.value = String(alphaPctFromComputed("--control-bg", 6));
  ui.cn.value = hexFromComputed("--control-border", "#ffffff");
  ui.cna.value = String(alphaPctFromComputed("--control-border", 14));

  const st = ui.st.value.toLowerCase();
  if (st === "#000000" && ui.ct.value.toLowerCase() === "#000000") ui.form.querySelector("#lw-b").checked = true;
  else if (st === "#ffffff" && ui.ct.value.toLowerCase() === "#ffffff") ui.form.querySelector("#lw-w").checked = true;
  else ui.form.querySelector("#lw-custom").checked = true;

  let theme = rootEl().dataset.theme ?? "ocean";
  if (!["ocean", "sunset", "forest", "mono"].includes(theme)) theme = "ocean";
  rootEl().dataset.theme = theme;
  ui.themeSelect.value = theme;

  const thKey = ui.themeSelect.value in THEME_WEDGE_DEFAULTS ? ui.themeSelect.value : "ocean";
  const def = THEME_WEDGE_DEFAULTS[thKey];
  const huParsed = parseFloat(readComputedVar("--hue-shift"));
  const hu = Number.isFinite(huParsed) ? huParsed : def.hu;
  const satStr = readComputedVar("--sat-base");
  const litStr = readComputedVar("--light-base");
  ui.hu.value = String(clamp(Math.round(hu), 0, 359));
  ui.sd.value = String(clamp(Math.round(parseFloat(satStr) || def.sd), 0, 100));
  ui.li.value = String(clamp(Math.round(parseFloat(litStr) || def.li), 0, 100));

  updateMonoSlidersDisabled(ui);
}

function clearInlinePalette() {
  const r = rootEl().style;
  INLINE_VARS.forEach((prop) => r.removeProperty(prop));
}

/** Clear wedge palette overrides so preset CSS (`data-theme`) applies again. */
export function clearPresetWedgeOverrides() {
  const r = rootEl().style;
  r.removeProperty("--hue-shift");
  r.removeProperty("--sat-base");
  r.removeProperty("--light-base");
}

function updateMonoSlidersDisabled(ui) {
  const mono = ui.themeSelect.value === "mono";
  ui.hu.disabled = mono;
  ui.sd.disabled = mono;
  ui.li.disabled = mono;
}

/**
 * @param {{ themeSelect: HTMLSelectElement | null; recolor: () => void }} api
 */
export function initColorsPanel(api) {
  const dialog = document.getElementById("colors-dialog");
  const openBtn = document.getElementById("colors-open");
  const closeBtn = document.getElementById("colors-close");
  const copyBtn = document.getElementById("colors-copy-url");
  const resetBtn = document.getElementById("colors-reset");
  const form = document.getElementById("colors-form");

  if (!dialog || !openBtn || !form || !api.themeSelect) return;

  const pick = (id) => /** @type {HTMLInputElement} */ (document.getElementById(`color-${id}`));

  const ui = {
    form,
    themeSelect: api.themeSelect,
    pb: pick("pb"),
    hb: pick("hb"),
    pf: pick("pf"),
    mu: pick("mu"),
    ws: pick("ws"),
    wa: /** @type {HTMLInputElement} */ (document.getElementById("range-wa")),
    wd: pick("wd"),
    wo: /** @type {HTMLInputElement} */ (document.getElementById("range-wo")),
    ss: pick("ss"),
    ssa: /** @type {HTMLInputElement} */ (document.getElementById("range-ssa")),
    cf: pick("cf"),
    st: pick("st"),
    ct: pick("ct"),
    af: pick("af"),
    aa: /** @type {HTMLInputElement} */ (document.getElementById("range-aa")),
    cg: pick("cg"),
    cn: pick("cn"),
    cba: /** @type {HTMLInputElement} */ (document.getElementById("range-cba")),
    cna: /** @type {HTMLInputElement} */ (document.getElementById("range-cna")),
    hu: /** @type {HTMLInputElement} */ (document.getElementById("range-hu")),
    sd: /** @type {HTMLInputElement} */ (document.getElementById("range-sd")),
    li: /** @type {HTMLInputElement} */ (document.getElementById("range-li")),
  };

  const pushLive = () => {
    applyFormToDocument(ui);
    api.recolor();
  };

  openBtn.addEventListener("click", () => {
    syncFormFromComputed(ui);
    dialog.showModal();
  });

  closeBtn?.addEventListener("click", () => dialog.close());

  form.addEventListener("input", pushLive);
  form.addEventListener("change", pushLive);

  copyBtn?.addEventListener("click", async () => {
    const params = gatherParamsFromForm(ui);
    const url = new URL(location.href);
    url.search = params.toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy share URL";
      }, 2000);
    } catch {
      window.prompt("Copy this URL:", url.toString());
    }
  });

  resetBtn?.addEventListener("click", () => {
    clearInlinePalette();
    syncFormFromComputed(ui);
    pushLive();
  });

  dialog.addEventListener("close", () => openBtn.focus());
}
