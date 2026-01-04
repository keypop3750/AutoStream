/**
 * filters.js (patched)
 * Language & size filtering similar to Torrentio.
 */
const { preferPrimaryLanguage, detectLanguages } = require('./lang-primary');

function parseSizeToBytes(str){
 if (!str) return 0;
 // Accept "[SAVE] 51.84 GB", "42.16 GB", "9.6GB", etc.
 const m = String(str).replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)\s*(TB|GB|MB|KB|B)/i);
 if (!m) return 0;
 const v = parseFloat(m[1]);
 const unit = m[2].toUpperCase();
 const mult = unit === 'TB' ? 1e12 : unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : unit === 'KB' ? 1e3 : 1;
 return Math.round(v * mult);
}

function extractSizeFromStream(stream){
 const candidates = [
 stream.size,
 // inside title, often after "[SAVE]"
 (stream.title||'').split('\n').slice(-1)[0],
 stream.title,
 stream.description
 ];
 for (const s of candidates){
 const b = parseSizeToBytes(s);
 if (b) return b;
 }
 // Sometimes available in name e.g. "14.2 GB"
 const b = parseSizeToBytes(stream.name);
 return b || 0;
}

/**
 * Apply size and language filters based on query parameters.
 * @param {Array} streams combined provider results
 * @param {Object} q e.g. req.query
 */
function applyAutoStreamFilters(streams, q={}){
 const out = streams.map(s => {
 const clone = {...s};
 clone._parsedSizeBytes = extractSizeFromStream(s);
 clone._langs = detectLanguages(s);
 return clone;
 });

 // Max size in bytes (if not provided, keep all).
 // Accept integers or strings: "6000000000" or "6GB"
 let maxBytes = 0;
 if (q.max_size){
 const v = String(q.max_size);
 if (/^\d+$/.test(v)) maxBytes = parseInt(v,10);
 else maxBytes = parseSizeToBytes(v);
 }
 let filtered = out;
 if (maxBytes > 0){
 filtered = filtered.filter(s => !s._parsedSizeBytes || s._parsedSizeBytes <= maxBytes);
 }

 // Language priority:
 // - lang_prio=EN,PL like Torrentio
 // - lang_strict=1 to drop non-matching
 const langPrio = q.lang_prio || q.lang || q.language;
 const strict = q.lang_strict === '1' || q.lang_strict === 1 || q.strict_lang === '1';
 filtered = preferPrimaryLanguage(filtered, langPrio, {strict});

 return filtered;
}

module.exports = {
 applyAutoStreamFilters,
 parseSizeToBytes,
 extractSizeFromStream
};
