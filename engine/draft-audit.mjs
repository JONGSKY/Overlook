// draft-audit.mjs — an audit.json built from what the reviewer typed, for when Bob has not audited yet.
//
// The Overlook Auditor mode in Bob produces the real audit (fence drawn from the brief, claims
// classified, plain-language notes). This draft only splits the agent's report into sentences,
// recognises the claim types git can check by their wording, and suggests a fence from folder
// names the request mentions. Git still decides every verdict in build-city.

const CLAIM_PATTERNS = [
  ['no_api_change', /\b(no|without( any)?|zero)\s+(public\s+)?api\b|\bapi\b[^.]*\b(unchanged|untouched|not (changed|touched))|\bno (breaking|contract) changes?\b/i],
  ['tests_pass', /\b(all\s+)?tests?\b[^.]*\b(pass(es|ed|ing)?|green|succeed(s|ed)?)\b|\bci is green\b/i],
  ['no_new_files', /\bno new files?\b|\bdid(n't| not) (add|create) (any )?(new )?files?\b/i],
  ['scope', /\b(only|just)\s+(changed|touched|modified|updated|edited)\b|\b(nothing|no other (files|code))\s+(else\s+)?(was\s+)?(changed|touched)\b|\bscoped to\b/i],
];

/** Split a report into sentences, dropping a leading "Done." */
export function splitSentences(report) {
  return String(report ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(done|finished|complete[d]?)[.!]?$/i.test(s));
}

/** Claims in SPEC 3.2 shape. Unrecognised sentences are `feature` claims left `unverified`. */
export function extractClaims(report) {
  return splitSentences(report).map((text) => {
    const hit = CLAIM_PATTERNS.find(([, re]) => re.test(text));
    return hit ? { text, type: hit[0] } : { text, type: 'feature', verdict: 'unverified', note: 'Needs a reviewer or the Overlook Auditor mode in Bob.' };
  });
}

/** Singular form, good enough for folder names: articles -> article, classes -> class, stories -> story. */
export function stem(word) {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Folders (as "path/") whose name the request text mentions, e.g. "article" -> src/articles/. */
export function suggestFence(evidence, requestText) {
  const words = new Set(String(requestText ?? '').split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 4).map(stem));
  if (!words.size) return [];
  const folders = new Set();
  for (const f of evidence.files) {
    const parts = f.path.split('/').slice(0, -1);
    for (let i = 0; i < parts.length; i++) {
      if (words.has(stem(parts[i]))) folders.add(parts.slice(0, i + 1).join('/') + '/');
    }
  }
  // Nothing by folder name: fall back to the files the request names ("browser_take_screenshot" →
  // src/tools/screenshot.ts), the files themselves. Only distinctive names count (5+ letters, not generic ones).
  if (!folders.size) {
    const GENERIC = new Set(['index', 'utils', 'types', 'config', 'readme', 'tests', 'files', 'change', 'update', 'makefile', 'package']);
    for (const f of evidence.files) {
      const base = f.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/\.(spec|test)$/, '');
      const bits = base.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).map((b) => b.toLowerCase()).filter((b) => b.length >= 5 && !GENERIC.has(b));
      if (bits.length && bits.every((b) => words.has(stem(b)))) folders.add(f.path);
    }
  }
  // Keep the outermost matches only.
  return [...folders].filter((p, _, all) => !all.some((q) => q !== p && p.startsWith(q))).sort();
}

/**
 * @param evidence evidence.json from collect
 * @param input    { title, request, report, fence: string[] }
 */
export function draftAudit(evidence, { id, title, request, report, fence } = {}) {
  const paths = (fence ?? []).map((p) => p.trim()).filter(Boolean);
  const fencePaths = paths.length ? paths : suggestFence(evidence, `${title ?? ''} ${request ?? ''}`);
  return {
    kind: 'overlook.audit/v1',
    sample: false,
    draft: true,
    request: { id: id || '', title: title || 'Untitled request', scope: request || '', source: 'typed in Overlook' },
    fence: {
      paths: fencePaths,
      rationale: paths.length ? 'Fence set by the reviewer.' : fencePaths.length ? 'Suggested from folder names the request mentions. Adjust it if it is wrong.' : 'No fence yet: every change counts as outside the request.',
    },
    districts: [],
    bobReport: report || '',
    claims: extractClaims(report),
    plain: {},
    screens: [],
  };
}
