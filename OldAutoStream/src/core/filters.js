'use strict';

function filterByMaxSize(streams, maxBytes) {
  if (!maxBytes || !Number(maxBytes)) return streams;
  return streams.filter(s => {
    const size = Number(s.size || s.bytes || (s.torrent && s.torrent.size) || 0);
    return !size || size <= maxBytes; // keep if unknown or within limit
  });
}

const LANG_TAGS = {
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

function langScoreForTitle(title, prioList) {
  if (!prioList?.length || !title) return 0;
  const t = String(title);
  for (let i = 0; i < prioList.length; i++) {
    const code = prioList[i];
    const regs = LANG_TAGS[code];
    if (regs && regs.some(rx => rx.test(t))) {
      return (prioList.length - i) * 5;
    }
  }
  return 0;
}

function sortByLanguagePreference(streams, prioList) {
  if (!prioList?.length) return streams;
  return streams
    .map(s => ({ s, _ls: langScoreForTitle(s.title || s.name || s.tag || '', prioList) }))
    .sort((a,b) => b._ls - a._ls)
    .map(x => x.s);
}

module.exports = { filterByMaxSize, sortByLanguagePreference };
