/**
 * Leaf emotion guides from bundled JSON + optional URL hash draft (#g=base64url-json).
 * Payload: { v: 1, crumb: string, guide: { feel, body, call, overcome } }
 */

/** Soft limit per textarea when warning about URL length */
export const GUIDE_FIELD_CHAR_SOFT_LIMIT = 1200;

/** @typedef {{ feel?: string; body?: string; call?: string; overcome?: string }} EmotionGuideFields */

export const GUIDE_FIELD_META = /** @type {const} */ ([
  { key: "feel", label: "How you might feel" },
  { key: "body", label: "What's going on in your body" },
  { key: "call", label: "What this might be a call to be" },
  { key: "overcome", label: "Ways to overcome this" },
]);

/** @type {Record<string, EmotionGuideFields>} */
let bundledGuides = {};

/** @type {string} */
let lastGuideCrumb = "";
/** @type {boolean} */
let lastGuideIsLeaf = false;

/** @param {Record<string, EmotionGuideFields>} map */
export function setBundledGuides(map) {
  bundledGuides = map && typeof map === "object" ? map : {};
}

function emptyFields() {
  return /** @type {EmotionGuideFields} */ ({
    feel: "",
    body: "",
    call: "",
    overcome: "",
  });
}

/** @param {Partial<EmotionGuideFields> | null | undefined} raw */
function normalizeGuideFields(raw) {
  const out = emptyFields();
  if (!raw || typeof raw !== "object") return out;
  for (const { key } of GUIDE_FIELD_META) {
    const v = raw[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

/** @param {EmotionGuideFields} g */
function hasAnyGuideText(g) {
  return GUIDE_FIELD_META.some(({ key }) => (g[key] ?? "").trim().length > 0);
}

function base64UrlEncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @param {string} b64url */
function base64UrlDecodeUtf8(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** @returns {{ v: number; crumb: string; guide: EmotionGuideFields } | null} */
export function readDraftFromHash() {
  try {
    const h = location.hash;
    if (!h.startsWith("#g=")) return null;
    const raw = h.slice(3);
    if (!raw) return null;
    const json = base64UrlDecodeUtf8(raw);
    const data = JSON.parse(json);
    if (data?.v !== 1 || typeof data.crumb !== "string") return null;
    return {
      v: 1,
      crumb: data.crumb,
      guide: normalizeGuideFields(data.guide),
    };
  } catch {
    return null;
  }
}

/** @param {string} crumb @param {EmotionGuideFields} guide */
export function buildGuideDraftHash(crumb, guide) {
  const payload = { v: 1, crumb, guide: normalizeGuideFields(guide) };
  return `#g=${base64UrlEncodeUtf8(JSON.stringify(payload))}`;
}

/** @param {string} crumb */
function getEffectiveGuideForCrumb(crumb) {
  const draft = readDraftFromHash();
  if (draft && draft.crumb === crumb) {
    return { source: /** @type {"draft"} */ ("draft"), fields: draft.guide };
  }
  const bundled = bundledGuides[crumb];
  const norm = normalizeGuideFields(bundled);
  if (hasAnyGuideText(norm)) {
    return { source: /** @type {"bundled"} */ ("bundled"), fields: norm };
  }
  return { source: /** @type {"empty"} */ ("empty"), fields: emptyFields() };
}

/** @param {HTMLElement | null} el @param {string} text */
function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

export function hideEmotionGuidePanel() {
  const wrap = document.getElementById("emotion-guide");
  if (wrap) wrap.hidden = true;
  lastGuideCrumb = "";
  lastGuideIsLeaf = false;
}

/**
 * @param {string} crumb
 * @param {boolean} isLeaf
 */
export function renderEmotionGuide(crumb, isLeaf) {
  const wrap = document.getElementById("emotion-guide");
  const badge = document.getElementById("emotion-guide-draft-badge");
  const clearDraftBtn = document.getElementById("emotion-guide-clear-draft");

  lastGuideCrumb = crumb;
  lastGuideIsLeaf = isLeaf;

  if (!wrap || !crumb || !isLeaf) {
    if (wrap) wrap.hidden = true;
    return;
  }

  wrap.hidden = false;

  const { source, fields } = getEffectiveGuideForCrumb(crumb);

  if (badge) badge.hidden = source !== "draft";
  if (clearDraftBtn) clearDraftBtn.hidden = source !== "draft";

  for (const { key, label } of GUIDE_FIELD_META) {
    const titleEl = document.getElementById(`emotion-guide-title-${key}`);
    const bodyEl = document.getElementById(`emotion-guide-body-${key}`);
    if (titleEl) titleEl.textContent = label;
    const text = (fields[key] ?? "").trim();
    setText(bodyEl, text || "—");
  }

  const emptyNote = document.getElementById("emotion-guide-empty");
  if (emptyNote) {
    emptyNote.hidden = source !== "empty";
  }
}

function refreshGuideAfterHashChange() {
  if (lastGuideCrumb && lastGuideIsLeaf) {
    renderEmotionGuide(lastGuideCrumb, lastGuideIsLeaf);
  }
}

/** Read textareas from dialog into EmotionGuideFields */
function readFormFields() {
  const out = emptyFields();
  for (const { key } of GUIDE_FIELD_META) {
    const ta = document.getElementById(`emotion-guide-field-${key}`);
    out[key] = ta instanceof HTMLTextAreaElement ? ta.value : "";
  }
  return out;
}

/** @param {EmotionGuideFields} fields */
function fillFormFields(fields) {
  const norm = normalizeGuideFields(fields);
  for (const { key } of GUIDE_FIELD_META) {
    const ta = document.getElementById(`emotion-guide-field-${key}`);
    if (ta instanceof HTMLTextAreaElement) ta.value = norm[key] ?? "";
  }
}

/** @param {string} fullUrl */
async function copyToClipboard(fullUrl) {
  try {
    await navigator.clipboard.writeText(fullUrl);
    return true;
  } catch {
    try {
      window.prompt("Copy this link:", fullUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/** @param {string} crumb @param {EmotionGuideFields} guide */
function estimateHashLength(crumb, guide) {
  const payload = JSON.stringify({ v: 1, crumb, guide: normalizeGuideFields(guide) });
  return `#g=${base64UrlEncodeUtf8(payload)}`.length;
}

export function initEmotionGuideUI() {
  const proposeBtn = document.getElementById("emotion-guide-propose");
  const clearDraftBtn = document.getElementById("emotion-guide-clear-draft");
  const dialog = document.getElementById("emotion-guide-edit-dialog");
  const copyLinkBtn = document.getElementById("emotion-guide-copy-link");
  const copyJsonBtn = document.getElementById("emotion-guide-copy-json");
  const cancelBtn = document.getElementById("emotion-guide-dialog-cancel");

  window.addEventListener("hashchange", refreshGuideAfterHashChange);

  proposeBtn?.addEventListener("click", () => {
    if (!(dialog instanceof HTMLDialogElement) || !lastGuideCrumb || !lastGuideIsLeaf) return;
    const crumbEl = document.getElementById("emotion-guide-dialog-crumb");
    if (crumbEl) crumbEl.textContent = lastGuideCrumb;
    const { fields } = getEffectiveGuideForCrumb(lastGuideCrumb);
    fillFormFields(fields);
    dialog.showModal();
    updateDialogCharHints();
  });

  clearDraftBtn?.addEventListener("click", () => {
    const url = `${location.pathname}${location.search}`;
    history.replaceState(null, "", url);
    refreshGuideAfterHashChange();
  });

  cancelBtn?.addEventListener("click", () => {
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });

  for (const { key } of GUIDE_FIELD_META) {
    document.getElementById(`emotion-guide-field-${key}`)?.addEventListener("input", updateDialogCharHints);
  }

  function updateDialogCharHints() {
    const warnEl = document.getElementById("emotion-guide-url-length-warn");
    if (!warnEl || !lastGuideCrumb) return;
    const fields = readFormFields();
    let long = false;
    for (const { key } of GUIDE_FIELD_META) {
      const len = (fields[key] ?? "").length;
      const hint = document.getElementById(`emotion-guide-count-${key}`);
      if (hint) hint.textContent = `${len} / ${GUIDE_FIELD_CHAR_SOFT_LIMIT}`;
      if (len > GUIDE_FIELD_CHAR_SOFT_LIMIT) long = true;
    }
    const hashLen = estimateHashLength(lastGuideCrumb, fields);
    const tooLong = long || hashLen > 6000;
    warnEl.hidden = !tooLong;
    if (long) {
      warnEl.textContent = `Some fields exceed ${GUIDE_FIELD_CHAR_SOFT_LIMIT} characters; sharing via link may fail in some browsers. Use “Copy JSON snippet” instead.`;
    } else if (hashLen > 6000) {
      warnEl.textContent = `This draft is long (${hashLen} chars in URL); use “Copy JSON snippet” if the link does not work.`;
    }
  }

  copyLinkBtn?.addEventListener("click", async () => {
    if (!lastGuideCrumb) return;
    const guide = readFormFields();
    const hash = buildGuideDraftHash(lastGuideCrumb, guide);
    const fullUrl = `${location.origin}${location.pathname}${location.search}${hash}`;
    const hashLen = hash.length;
    if (hashLen > 8000) {
      window.alert("URL is too long to share reliably. Use “Copy JSON snippet” and send that text or a shorter draft.");
      return;
    }
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    refreshGuideAfterHashChange();
    await copyToClipboard(fullUrl);
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });

  copyJsonBtn?.addEventListener("click", async () => {
    if (!lastGuideCrumb) return;
    const guide = normalizeGuideFields(readFormFields());
    const snippet = JSON.stringify({ [lastGuideCrumb]: guide }, null, 2);
    await copyToClipboard(snippet);
  });
}
