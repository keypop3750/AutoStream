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
 HI: ['HI', 'HIN', 'HINDI', 'HINDIDUB'],
 TR: ['TR', 'TUR', 'TURKISH'],
 NL: ['NL', 'DUT', 'DUTCH', 'FLEMISH'],
 SV: ['SV', 'SWE', 'SWEDISH'],
 DA: ['DA', 'DAN', 'DANISH'],
 NO: ['NO', 'NOR', 'NORWEGIAN'],
 FI: ['FI', 'FIN', 'FINNISH'],
 EL: ['EL', 'GRE', 'GREEK'],
 HU: ['HU', 'HUN', 'HUNGARIAN'],
 CS: ['CS', 'CZE', 'CZECH'],
 RO: ['RO', 'RUM', 'ROMANIAN'],
 TH: ['TH', 'THA', 'THAI'],
 ID: ['ID', 'IND', 'INDONESIAN'],
 VI: ['VI', 'VIE', 'VIETNAMESE'],
 UK: ['UK', 'UKR', 'UKRAINIAN'],
 BG: ['BG', 'BUL', 'BULGARIAN'],
 HR: ['HR', 'HRV', 'CROATIAN'],
 SK: ['SK', 'SLO', 'SLOVAK'],
 TA: ['TA', 'TAM', 'TAMIL'],
 TE: ['TE', 'TEL', 'TELUGU'],
 BN: ['BN', 'BEN', 'BENGALI'],
 MR: ['MR', 'MAR', 'MARATHI'],
 ML: ['ML', 'MAL', 'MALAYALAM'],
 KN: ['KN', 'KAN', 'KANNADA'],
 PA: ['PA', 'PAN', 'PUNJABI'],
 GU: ['GU', 'GUJ', 'GUJARATI'],
 LT: ['LT', 'LIT', 'LITHUANIAN'],
 HE: ['HE', 'HEB', 'HEBREW'],
 FA: ['FA', 'PER', 'PERSIAN', 'FARSI'],
 MS: ['MS', 'MAY', 'MALAY'],
 AR: ['AR', 'ARA', 'ARABIC'],
 JA: ['JA', 'JAP', 'JAPANESE'],
 KO: ['KO', 'KOR', 'KOREAN'],
 ZH: ['ZH', 'CHI', 'CHINESE', 'MANDARIN', 'CANTONESE'],
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
 '🇬🇧': 'EN', '🇺🇸': 'EN', '🇦🇺': 'EN', '🇨🇦': 'EN',
 '🇵🇱': 'PL',
 '🇮🇹': 'IT',
 '🇪🇸': 'ES', '🇲🇽': 'ES', '🇦🇷': 'ES',
 '🇫🇷': 'FR',
 '🇩🇪': 'DE', '🇦🇹': 'DE', '🇨🇭': 'DE',
 '🇵🇹': 'PT', '🇧🇷': 'PT',
 '🇷🇺': 'RU',
 '🇮🇳': 'HI',
 '🇹🇷': 'TR',
 '🇳🇱': 'NL', '🇧🇪': 'NL',
 '🇸🇪': 'SV',
 '🇩🇰': 'DA',
 '🇳🇴': 'NO',
 '🇫🇮': 'FI',
 '🇬🇷': 'EL',
 '🇭🇺': 'HU',
 '🇨🇿': 'CS',
 '🇷🇴': 'RO',
 '🇹🇭': 'TH',
 '🇮🇩': 'ID',
 '🇻🇳': 'VI',
 '🇺🇦': 'UK',
 '🇧🇬': 'BG',
 '🇭🇷': 'HR',
 '🇸🇰': 'SK',
 '🇱🇹': 'LT',
 '🇮🇱': 'HE',
 '🇮🇷': 'FA',
 '🇲🇾': 'MS',
 '🇸🇦': 'AR', '🇦🇪': 'AR', '🇪🇬': 'AR',
 '🇯🇵': 'JA',
 '🇰🇷': 'KO',
 '🇨🇳': 'ZH', '🇹🇼': 'ZH', '🇭🇰': 'ZH',
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
