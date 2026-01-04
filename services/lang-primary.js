/**
 * lang-primary.js (patched)
 * Utilities to detect languages in titles and to sort/filter streams
 * by preferred languages similarly to Torrentio's "Language" setting.
 */

const ISO_MAP = {
 EN: ['EN', 'ENG', 'ENGLISH', 'OV'],
 PL: ['PL', 'POL', 'POLISH', 'PLDUB', 'LEKTOR PL', 'LEKTOR'],
 IT: ['IT', 'ITA', 'ITALIAN', 'ITALIANO'],
 ES: ['ES', 'SPA', 'SPANISH', 'CASTELLANO', 'LATINO', 'ES-ES', 'ES-LA'],
 PT: ['PT', 'POR', 'PORTUGUESE', 'PT-PT', 'PT-BR', 'BRA', 'BR'],
 FR: ['FR', 'FRE', 'FRENCH', 'VF', 'VFF', 'TRUEFRENCH'],
 DE: ['DE', 'GER', 'GERMAN', 'DEU'],
 RU: ['RU', 'RUS', 'RUSSIAN'],
 HI: ['HI', 'HIN', 'HINDI'],
 TR: ['TR', 'TUR', 'TURKISH'],
};

function norm(s){ return (s||'').toUpperCase(); }

/**
 * Attempt to extract language tags from a stream object.
 * We inspect several fields commonly present in providers.
 */
function detectLanguages(stream){
 const bag = new Set();
 const fields = [
 stream.title,
 stream.name,
 stream.description,
 stream.behaviorHints?.filename
 ];
 const hay = norm(fields.filter(Boolean).join(' • '));
 for(const [iso, alts] of Object.entries(ISO_MAP)){
 for(const alt of alts){
 if (hay.includes(alt)) { bag.add(iso); break; }
 }
 }
 // Also parse flag emojis 🇬🇧 🇮🇹 etc.
 const FLAG_TO_ISO = {
 '🇬🇧': 'EN', '🇺🇸': 'EN',
 '🇵🇱': 'PL',
 '🇮🇹': 'IT',
 '🇪🇸': 'ES',
 '🇫🇷': 'FR',
 '🇩🇪': 'DE',
 '🇵🇹': 'PT', '🇧🇷': 'PT',
 '🇷🇺': 'RU',
 '🇮🇳': 'HI',
 '🇹🇷': 'TR',
 };
 for (const [flag, iso] of Object.entries(FLAG_TO_ISO)){
 if (hay.includes(flag)) bag.add(iso);
 }
 return [...bag];
}

/**
 * Given streams and a preferred language list like "EN,PL",
 * sort so that preferred languages come first, but do not
 * drop other streams unless "strict" is true.
 */
function preferPrimaryLanguage(streams, langPrio, {strict=false}={}){
 let order = [];
 if (Array.isArray(langPrio)) order = langPrio.map(s=>norm(s)).filter(Boolean);
 else if (typeof langPrio === 'string') order = langPrio.split(/[\s,]+/).map(s=>norm(s)).filter(Boolean);

 if (!order.length) return streams;

 const rank = new Map(order.map((code, i)=>[code, i]));
 function bestRank(stream){
 const langs = detectLanguages(stream);
 if (!langs.length) return 9999;
 let r = 9999;
 for (const L of langs){
 if (rank.has(L)) r = Math.min(r, rank.get(L));
 }
 return r;
 }
 const arr = [...streams];
 arr.sort((a,b)=>{
 const ra = bestRank(a), rb = bestRank(b);
 if (ra !== rb) return ra - rb;
 // tie-break by size ascending (smaller first) to feel snappier
 const sa = a._parsedSizeBytes || 0;
 const sb = b._parsedSizeBytes || 0;
 if (sa && sb && sa !== sb) return sa - sb;
 return 0;
 });

 if (!strict) return arr;

 // strict means filter to only items that matched any preferred language.
 return arr.filter(s => {
 const langs = detectLanguages(s);
 return langs.some(L => order.includes(L));
 });
}

module.exports = {
 preferPrimaryLanguage,
 detectLanguages
};
