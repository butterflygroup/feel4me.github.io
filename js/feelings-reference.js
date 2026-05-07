/** Derived from data/emotions.json — keep in sync via flatten at runtime when JSON loads (same as wheel.js normalizeSegment). */

/**
 * @typedef {{ label: string; children?: unknown[] }} NormalizedSegment
 * @typedef {{ breadcrumb: string; label: string; searchHints: string[] }} FeelingsReferenceRow
 */

/** Same shape as wheel segment nodes after coercion from emotions.json. */
export function normalizeSegment(node) {
  const childrenRaw = node.children ?? [];
  const children = childrenRaw.map((c) =>
    typeof c === "string" ? { label: c, children: [] } : normalizeSegment(c),
  );
  return { label: node.label, children };
}

/** Ordered unique segment titles along the path (matches wheel breadcrumb tokens). */
function searchHintsFromBreadcrumb(breadcrumb) {
  const parts = breadcrumb.split(" › ");
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * One row per wedge / `.wheel-segment` (every tree node).
 * @param {NormalizedSegment[]} segmentsNormalized
 * @returns {FeelingsReferenceRow[]}
 */
export function flattenFeelingsForReference(segmentsNormalized) {
  /** @type {FeelingsReferenceRow[]} */
  const rows = [];

  /** @param {NormalizedSegment} node @param {string} breadcrumbPrefix */
  function walk(node, breadcrumbPrefix) {
    const crumb = breadcrumbPrefix.length ? `${breadcrumbPrefix} › ${node.label}` : node.label;
    rows.push({
      breadcrumb: crumb,
      label: node.label,
      searchHints: searchHintsFromBreadcrumb(crumb),
    });
    const kids = node.children ?? [];
    for (const child of kids) {
      walk(child, crumb);
    }
  }

  for (const seg of segmentsNormalized) {
    walk(seg, "");
  }

  return rows;
}
