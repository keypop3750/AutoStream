'use strict';

/**
 * Keep stream if size is unknown or <= maxBytes.
 * Streams can carry size as: size, bytes, torrent.size (bytes).
 */
function filterByMaxSize(streams, maxBytes) {
  if (!maxBytes || !Number(maxBytes)) return streams;
  const limit = Number(maxBytes);
  return (Array.isArray(streams) ? streams : []).filter(s => {
    const size =
      Number(s && (s.size || s.bytes || (s.torrent && s.torrent.size) || 0)) || 0;
    return !size || size <= limit;
  });
}

/**
 * Language prioritization
 * - Keeps user's full regex coverage for many languages (EN/ES/PT-BR/PT-PT/FR/IT/DE/RU/TR/PL/LT/AR/HI/JA/KO/ZH)
 * - Looks into structured fields (lang, languages, audio, subtitles) when present
 * - Understands MULTi packs
 * - Stable sort: preserves original order on ties
 */

// User-specified patterns
const LANG_PATTERNS = {
  'EN':  [/\bEN(?:G|GLISH)?\b/i],
  'ES':  [/\bES(?:P|PAÑOL|PA|MX)?\b/i, /CASTELLANO/i, /LAT(?:AM|INO)?/i],
  'PT-BR': [/\bPT[-_. ]?BR\b/i, /BRAS(?:IL|ILEIRO)/i],
  'PT-PT': [/\bPT[-_. ]?PT\b/i, /PORTUGU(?:ÊS|ES)(?!\s*BR)/i],
  'FR':  [/\bFR(?:ENCH)?\b/i, /VOSTFR/i],
  'IT':  [/\bIT(?:A|ALIANO)?\b/i],
  'DE':  [/\bDE(?:U|UTSCH)?\b/i, /GERMAN/i],
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

// Build a fast lookup table of all non-EN patterns for penalty heuristics
const NON_EN_PATTERNS = Object.entries(LANG_PATTERNS)
  .filter(([code]) => code !== 'EN')
  .flatMap(([, arr]) => arr);

/** normalize a user preference item into a known code key */
function normalizePref(code) {
  let k = String(code || '').trim().toUpperCase();
  if (!k) return '';
  // Collapse shorthand families to keys we have
  if (k === 'PT' || k === 'POR' || k === 'PORTUGUESE') k = 'PT-PT'; // default EU PT
  if (!LANG_PATTERNS[k]) {
    // Try two-letter family fallbacks
    if (k.length >= 2) {
      const two = k.slice(0, 2);
      // Map some known two-letter to keys we have
      if (two === 'PT') k = 'PT-PT';
      else if (LANG_PATTERNS[two]) k = two;
      else return two; // allow generic two-letter family
    }
  }
  return k;
}

function textMatchesAny(text, patterns) {
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) return true;
  }
  return false;
}

function textHasLang(text, code) {
  const pats = LANG_PATTERNS[code];
  if (pats && pats.length) return textMatchesAny(text, pats);
  // generic two-letter fallback: whole-word-ish match
  const two = code.slice(0, 2).replace(/[^A-Z]/gi, '');
  if (!two) return false;
  const re = new RegExp(`(^|[^A-Z])${two}(?![A-Z])`, 'i');
  return re.test(text);
}

function collectSearchText(stream) {
  const chunks = [];
  const push = v => { if (v) chunks.push(String(v)); };

  if (stream) {
    push(stream.title || stream.name || stream.tag);
    push(stream.description || stream.info);
    // structured fields some scrapers expose
    push(stream.lang);
    push(stream.language);
    if (Array.isArray(stream.languages)) push(stream.languages.join(' '));
    push(stream.audio);
    push(stream.audioLang);
    if (Array.isArray(stream.subtitles)) push(stream.subtitles.join(' '));
    if (Array.isArray(stream.subtitleLangs)) push(stream.subtitleLangs.join(' '));
  }
  return chunks.join(' ');
}

function languageScore(stream, prefs) {
  const title = collectSearchText(stream);
  const isMulti = /\bMULTI\b/i.test(title);
  const textU = title.toUpperCase();

  // 1) Direct preference pass
  for (let i = 0; i < prefs.length; i++) {
    const code = prefs[i];
    if (code && textHasLang(textU, code)) {
      // Sooner in preferences = higher score; small bonus if not MULTi
      return (100 - i * 10) + (isMulti ? 0 : 3);
    }
  }

  // 2) If EN is preferred and we see explicit non-EN tokens (and no EN tokens), gently penalize
  const enPreferred = prefs.includes('EN');
  const hasEN = textHasLang(textU, 'EN');
  if (enPreferred && !hasEN && textMatchesAny(textU, NON_EN_PATTERNS)) {
    return -10;
  }

  // 3) Neutral: unknown language; tiny nudge for NON-MULTi
  return isMulti ? 0 : 1;
}

function isPreferredLanguage(stream, prefList) {
  const prefs = (Array.isArray(prefList) ? prefList : [])
    .map(normalizePref)
    .filter(Boolean);
  const finalPrefs = prefs.length ? prefs : ['EN'];
  const txt = collectSearchText(stream).toUpperCase();
  for (let i = 0; i < finalPrefs.length; i++) {
    if (textHasLang(txt, finalPrefs[i])) return true;
  }
  // Also accept EN when preferred but not explicitly matched above
  if (finalPrefs.includes('EN') && textHasLang(txt, 'EN')) return true;
  return false;
}

function sortByLanguagePreference(streams, prefList) {
  // normalize preference list
  let prefs = (Array.isArray(prefList) ? prefList : [])
    .map(normalizePref)
    .filter(Boolean);

  // default to EN for safety
  if (!prefs.length) prefs = ['EN'];

  if (!Array.isArray(streams) || !streams.length) return streams || [];

  // Stable sort by score; keep original order on ties
  return streams
    .map((s, i) => ({ s, i, score: languageScore(s, prefs) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map(x => x.s);
}

module.exports = { filterByMaxSize, sortByLanguagePreference, isPreferredLanguage };
