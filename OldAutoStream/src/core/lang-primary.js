'use strict';

/**
 * preferPrimaryLanguage(streams, prefList)
 * Reorders streams to strongly prefer the user's primary language(s):
 * For the first preference, prefer: pure-LANG > LANG-first bilingual > any-LANG.
 * If no match, try the second preference with the same tiers, etc.
 * Falls back to the original order when nothing matches.
 *
 * This DOES NOT filter out streams, only reorders them.
 * Safe to combine with your existing size filter, language sort, and pickStreams.
 */

// Language patterns (kept consistent with filters.js)
const LANG_PATTERNS = {
  'EN':  [/\bEN(?:G|GLISH)?\b/i],
  'ES':  [/\bES(?:P|PA(?:Ñ|N)OL|MX)?\b/i, /CASTELLANO/i, /LAT(?:AM|INO)?/i],
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

// Emoji flag hints (best-effort)
const FLAG_TO_LANG = {
  '🇬🇧': 'EN', '🇺🇸': 'EN',
  '🇮🇹': 'IT',
  '🇷🇺': 'RU',
  '🇫🇷': 'FR',
  '🇪🇸': 'ES',
  '🇵🇹': 'PT-PT',
  '🇧🇷': 'PT-BR',
  '🇵🇱': 'PL',
  '🇹🇷': 'TR',
  '🇯🇵': 'JA',
  '🇰🇷': 'KO',
  '🇨🇳': 'ZH',
  '🇦🇪': 'AR',
  '🇮🇳': 'HI',
  '🇱🇹': 'LT'
};

function normalizePref(code) {
  let k = String(code || '').trim().toUpperCase();
  if (!k) return '';
  if (k === 'PT' || k === 'POR' || k === 'PORTUGUESE') k = 'PT-PT';
  if (!LANG_PATTERNS[k]) {
    if (k.length >= 2) {
      const two = k.slice(0, 2);
      if (two === 'PT') k = 'PT-PT';
      else if (LANG_PATTERNS[two]) k = two;
      else return two; // allow generic two-letter
    }
  }
  return k;
}

function textHasLang(textUpper, code) {
  const pats = LANG_PATTERNS[code];
  if (pats && pats.length) {
    for (let i = 0; i < pats.length; i++) if (pats[i].test(textUpper)) return true;
    return false;
  }
  // generic two-letter fallback
  const two = code.slice(0, 2).replace(/[^A-Z]/gi, '');
  if (!two) return false;
  const re = new RegExp(`(^|[^A-Z])${two}(?![A-Z])`, 'i');
  return re.test(textUpper);
}

function extractLangTokens(text) {
  const raw = String(text || '');
  const upper = raw.toUpperCase();
  const tokens = new Set();

  // regex-based
  for (const code of Object.keys(LANG_PATTERNS)) {
    if (textHasLang(upper, code)) tokens.add(code);
  }
  // flags
  for (const ch of raw) {
    const mapped = FLAG_TO_LANG[ch];
    if (mapped) tokens.add(mapped);
  }
  return { raw, upper, tokens };
}

function isFirstOverSecond(upper, codeA, codeB) {
  // Collapse to tokens separated by dashes for simple order checking
  const flat = upper.replace(/[^A-Z]+/gi, '-').toUpperCase();
  const a = codeA.startsWith('PT-') ? 'PT' : codeA.slice(0, 2);
  const b = codeB.startsWith('PT-') ? 'PT' : codeB.slice(0, 2);
  const aBeforeB = new RegExp(`-${a}-(?:[A-Z-]*?)${b}(-|$)`).test(flat);
  const bBeforeA = new RegExp(`-${b}-(?:[A-Z-]*?)${a}(-|$)`).test(flat);
  return aBeforeB && !bBeforeA;
}

function preferPrimaryLanguage(streams, prefList) {
  if (!Array.isArray(streams) || !streams.length) return streams || [];

  // normalize preferences; default to EN
  let prefs = (Array.isArray(prefList) ? prefList : [])
    .map(normalizePref)
    .filter(Boolean);
  if (!prefs.length) prefs = ['EN'];

  // Pre-extract tokens for each stream once
  const analyzed = streams.map((s, i) => {
    const T = `${s.title || ''} ${s.name || ''} ${s.description || ''}`;
    const info = extractLangTokens(T);
    return { s, i, info };
  });

  function scoreForPref(info, pref, prefIndex) {
    const { upper, tokens } = info;
    const hasP = tokens.has(pref) || textHasLang(upper, pref);
    if (!hasP) return 0;

    // pure pref (no other known langs)
    const others = [...tokens].filter(t => t !== pref);
    const base = 1000 - prefIndex * 100;

    if (others.length === 0) return base + 300;

    // pref-first bilingual? check ordering against each other token
    for (let k = 0; k < others.length; k++) {
      const other = others[k];
      if (isFirstOverSecond(upper, pref, other)) return base + 200;
    }
    // has pref somewhere
    return base + 100;
  }

  function totalScore(rec) {
    let best = 0;
    for (let i = 0; i < prefs.length; i++) {
      const sc = scoreForPref(rec.info, prefs[i], i);
      if (sc > best) best = sc;
      if (best >= (1000 - i * 100) + 300) break; // cannot beat pure for earlier pref
    }
    return best;
  }

  const scored = analyzed.map(r => ({ s: r.s, i: r.i, sc: totalScore(r) }));
  // Stable: score desc, then original order
  scored.sort((a, b) => (b.sc - a.sc) || (a.i - b.i));
  return scored.map(x => x.s);
}

module.exports = { preferPrimaryLanguage };
