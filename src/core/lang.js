'use strict';

// Torrentio-like language detection & ordering
// - Detects audio language tokens from title/tag/description
// - Understands MULTi/DUAL
// - Prioritises user audio preferences (default EN)
// - Falls back gracefully if nothing matches

const TITLE_FIELDS = ['title', 'name', 'tag', 'description', 'info'];

// Language token regex map (audio-oriented)
const LANG_PATTERNS = {
  'EN':  [/\bEN(?:G|GLISH)?\b/i, /\bD?L?AUD(?:IO)?\s*EN\b/i],
  'ES':  [/\bES(?:P|PAÑOL|PA|MX)?\b/i, /CASTELLANO/i, /LAT(?:AM|INO)?\b/i],
  'PT-BR': [/\bPT[-_. ]?BR\b/i, /BRAS(?:IL|ILEIRO)\b/i],
  'PT-PT': [/\bPT[-_. ]?PT\b/i, /PORTUGU(?:ÊS|ES)(?!\s*BR)/i],
  'FR':  [/\bFR(?:ENCH)?\b/i, /VOSTFR\b/i, /\bVF\b/i],
  'IT':  [/\bIT(?:A|ALIANO)?\b/i],
  'DE':  [/\bDE(?:U|UTSCH)?\b/i, /\bGERMAN\b/i],
  'RU':  [/\bRU(?:S|SSIAN)?\b/i],
  'TR':  [/\bTR(?:K|TURK(?:CE|ISH))?\b/i],
  'PL':  [/\bPL(?:POL|POLISH)?\b/i],
  'LT':  [/\bLT(?:U|LIETUVIU|LIETUVIŠK.*)\b/i, /Lietuvišk/i],
  'AR':  [/\bAR(?:A|ABIC)?\b/i],
  'HI':  [/\bHI(?:NDI)?\b/i],
  'JA':  [/\bJA(?:P|JPN|JAPANESE)?\b/i],
  'KO':  [/\bKO(?:R|KOR|KOREAN)?\b/i],
  'ZH':  [/\bZH(?:H|CHN|CHINESE)?\b/i, /Cantonese/i, /Mandarin/i]
};

const NON_EN_PATTERNS = Object.entries(LANG_PATTERNS)
  .filter(([k]) => k !== 'EN')
  .flatMap(([, arr]) => arr);

function normalizePrefs(prefs) {
  let out = Array.isArray(prefs) ? prefs.slice() : [];
  out = out.map(x => String(x || '').trim().toUpperCase()).filter(Boolean);
  if (!out.length) out = ['EN'];
  return out;
}

function getText(stream) {
  let buf = '';
  for (const f of TITLE_FIELDS) {
    if (stream && stream[f]) buf += ' ' + String(stream[f]);
  }
  return buf || '';
}

function hasToken(text, pats) {
  for (let i = 0; i < pats.length; i++) if (pats[i].test(text)) return true;
  return false;
}

function detectAudioCodes(stream) {
  const text = getText(stream);
  const isMulti = /\bMULTI\b/i.test(text) || /\bDUAL\b/i.test(text);
  const up = text.toUpperCase();
  const present = new Set();
  for (const code of Object.keys(LANG_PATTERNS)) {
    if (hasToken(up, LANG_PATTERNS[code])) present.add(code);
  }
  // Also read structured hints if present
  const structured = []
    .concat(stream && stream.lang ? [stream.lang] : [])
    .concat(stream && stream.languages ? stream.languages : [])
    .concat(stream && stream.audio ? stream.audio : [])
    .concat(stream && stream.info && stream.info.audio ? stream.info.audio : []);
  for (const v of structured) {
    const code = String(v || '').trim().toUpperCase();
    if (!code) continue;
    // Map PT to PT-PT default for EU Portuguese
    if (code === 'PT') present.add('PT-PT');
    else present.add(code);
  }
  return { isMulti, codes: present };
}

// Language score similar in spirit to Torrentio: prefer earliest preference match,
// prefer explicit single-language over MULTi, gently penalize explicit non-preferred.
function languageScore(stream, prefs) {
  const { isMulti, codes } = detectAudioCodes(stream);
  // direct preference pass
  for (let i = 0; i < prefs.length; i++) {
    if (codes.has(prefs[i])) {
      return (1000 - i * 10) + (isMulti ? 0 : 3);
    }
  }
  // If EN preferred and we see explicit non-EN tokens (and no EN), penalize
  const text = getText(stream).toUpperCase();
  const enPreferred = prefs.includes('EN');
  const hasEN = codes.has('EN') || hasToken(text, LANG_PATTERNS['EN']);
  if (enPreferred && !hasEN && hasToken(text, NON_EN_PATTERNS)) {
    return -10;
  }
  return isMulti ? 0 : 1;
}

// Exported: language-first ordering; if at least one preferred-language match exists,
// restrict pool to those; otherwise return original list (no restriction).
function orderByTorrentioLanguage(streams, prefsInput) {
  const prefs = normalizePrefs(prefsInput);
  if (!Array.isArray(streams) || !streams.length) return streams || [];
  // find any matches
  const scored = streams.map((s, i) => ({ s, i, sc: languageScore(s, prefs) }));
  const havePref = scored.some(x => x.sc >= 990 || x.sc >= 900); // any positive match from prefs
  if (havePref) {
    const only = scored.filter(x => x.sc >= 0);
    // sort by score desc, then stable index
    only.sort((a, b) => (b.sc - a.sc) || (a.i - b.i));
    return only.map(x => x.s);
  }
  // no preferred matches → keep original
  return streams;
}

module.exports = {
  orderByTorrentioLanguage,
  detectAudioCodes, // exported for debugging
};
