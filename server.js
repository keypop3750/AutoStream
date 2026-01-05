
'use strict';

/**
 * AutoStream - click-time debrid
 * - No pre-resolve during /stream listing.
 * - Torrent candidates (when AD key present) are wrapped into /play?ih=... so
 * AllDebrid upload/unlock happens only when the user clicks.
 * - Configure UI served via your existing ./ui/configure.js (no change to your files).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Import unified debrid provider system
const { DEBRID_PROVIDERS, getEnabledProviders, getProvider, getProviderKeys, isValidProvider, getProviderDisplayName, detectConfiguredProvider, getConfiguredProviders, isValidApiKey, validateProvidersParallel } = require('./core/debridProviders');

// ============ DEFENSIVE CODE: CRASH PREVENTION ============

// 1. Unhandled Promise Rejection Handler (Prevents Node.js crashes)
process.on('unhandledRejection', (reason, promise) => {
 console.error('[ERROR] Unhandled Promise Rejection:', reason);
 console.error('[DEBUG] Promise:', promise);
 // Log but don't crash - keep the addon running
});

// 2. Uncaught Exception Handler (Last resort)
process.on('uncaughtException', (error) => {
 console.error('[ERROR] Uncaught Exception:', error);
 // In production, you might want to gracefully restart
 // For now, just log and continue
});

// 3. Safe Error Serialization
function safeStringify(obj, maxDepth = 3) {
 const seen = new WeakSet();
 return JSON.stringify(obj, function(key, val) {
 if (val !== null && typeof val === 'object') {
 if (seen.has(val)) return '[Circular]';
 seen.add(val);
 }
 return val;
 });
}

// 4. Safe Console Error Logging
const originalConsoleError = console.error;
console.error = function(...args) {
 const safeArgs = args.map(arg => {
 if (arg instanceof Error) {
 return { name: arg.name, message: arg.message, stack: arg.stack };
 }
 if (typeof arg === 'object' && arg !== null) {
 try {
 return safeStringify(arg);
 } catch {
 return '[Unserializable Object]';
 }
 }
 return arg;
 });
 originalConsoleError.apply(console, safeArgs);
};

// ============ RATE LIMITING & CONCURRENCY CONTROL ============

// 5. Simple Rate Limiter for API calls
class RateLimiter {
 constructor(maxRequests = 50, windowMs = 60000, maxKeys = 10000) {
 this.requests = new Map();
 this.maxRequests = maxRequests;
 this.windowMs = windowMs;
 this.maxKeys = maxKeys; // Max unique keys to prevent memory leak
 
 // Cleanup old entries every minute
 setInterval(() => this.cleanup(), 60000);
 }
 
 isAllowed(key) {
 const now = Date.now();
 const userRequests = this.requests.get(key) || [];
 
 // Remove old requests outside the window
 const validRequests = userRequests.filter(time => now - time < this.windowMs);
 
 if (validRequests.length >= this.maxRequests) {
 return false;
 }
 
 validRequests.push(now);
 this.requests.set(key, validRequests);
 return true;
 }
 
 cleanup() {
 const now = Date.now();
 for (const [key, requests] of this.requests.entries()) {
 const validRequests = requests.filter(time => now - time < this.windowMs);
 if (validRequests.length === 0) {
 this.requests.delete(key);
 } else {
 this.requests.set(key, validRequests);
 }
 }
 
 // LRU eviction if too many keys
 if (this.requests.size > this.maxKeys) {
 const keysToRemove = this.requests.size - this.maxKeys;
 const iterator = this.requests.keys();
 for (let i = 0; i < keysToRemove; i++) {
 this.requests.delete(iterator.next().value);
 }
 console.log(`[RateLimiter] Evicted ${keysToRemove} old keys to prevent memory leak`);
 }
 }
}

// 6. Concurrency Limiter for simultaneous requests
class ConcurrencyLimiter {
 constructor(maxConcurrent = 10) {
 this.maxConcurrent = maxConcurrent;
 this.running = 0;
 this.queue = [];
 }
 
 async execute(fn) {
 return new Promise((resolve, reject) => {
 const task = async () => {
 try {
 this.running++;
 const result = await fn();
 resolve(result);
 } catch (error) {
 reject(error);
 } finally {
 this.running--;
 this.processQueue();
 }
 };
 
 if (this.running < this.maxConcurrent) {
 task();
 } else {
 this.queue.push(task);
 }
 });
 }
 
 processQueue() {
 if (this.queue.length > 0 && this.running < this.maxConcurrent) {
 const task = this.queue.shift();
 task();
 }
 }
}

// 7. Memory Monitor
class MemoryMonitor {
 constructor(maxMemoryMB = 512) {
 this.maxMemoryMB = maxMemoryMB;
 this.checkInterval = setInterval(() => this.checkMemory(), 30000);
 }
 
 checkMemory() {
 const usage = process.memoryUsage();
 const usedMB = usage.heapUsed / 1024 / 1024;
 
 if (usedMB > this.maxMemoryMB) {
 console.warn(`[WARN] High memory usage: ${usedMB.toFixed(2)}MB`);
 // Force garbage collection if available
 if (global.gc) {
 global.gc();
 console.log('[CLEANUP] Forced garbage collection');
 }
 }
 }
 
 destroy() {
 if (this.checkInterval) {
 clearInterval(this.checkInterval);
 }
 }
}

// Initialize protective systems
const rateLimiter = new RateLimiter(100, 60000); // 100 requests per minute per IP
const concurrencyLimiter = new ConcurrencyLimiter(15); // Max 15 concurrent stream requests
const memoryMonitor = new MemoryMonitor(512); // Alert at 512MB

// ============ INPUT VALIDATION ============

// 8. Safe Input Validation
function validateIMDBId(id) {
 if (!id || typeof id !== 'string') return false;
 // Allow tt123456 or tt123456:1:2 format
 return /^tt\d{6,10}(:\d+:\d+)?$/.test(id);
}

function validateApiKey(key) {
 if (!key || typeof key !== 'string') return false;
 // Basic validation - alphanumeric, reasonable length
 return /^[a-zA-Z0-9_-]{8,128}$/.test(key);
}

function sanitizeStringParam(param, maxLength = 1000) {
 if (!param || typeof param !== 'string') return '';
 return param.substring(0, maxLength).replace(/[<>\"'&]/g, '');
}

function validateContentType(type) {
 return ['movie', 'series'].includes(type);
}

// ============ ORIGINAL CODE WITH DEFENSIVE ENHANCEMENTS ============

// Enhanced systems
const scoring = require('./core/scoring_v6');
const penaltyReliability = require('./services/penaltyReliability');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7010;

// Cloudflare Worker proxy URL - set in Render environment to bypass IP blocks
const CF_PROXY_URL = process.env.CF_PROXY_URL || '';

// Security: Force secure mode on Render
const FORCE_SECURE_MODE = process.env.FORCE_SECURE_MODE === 'true' || process.env.NODE_ENV === 'production';
const BLOCK_ENV_CREDENTIALS = process.env.BLOCK_ENV_CREDENTIALS !== 'false'; // Default to blocking
const EMERGENCY_DISABLE_DEBRID = process.env.EMERGENCY_DISABLE_DEBRID === 'true';

if (CF_PROXY_URL) {
 console.log('[PROXY] Using Cloudflare Worker proxy:', CF_PROXY_URL);
}

if (FORCE_SECURE_MODE) {
 console.log('[LOCKED] SECURE MODE: Environment credential fallbacks disabled');
}

if (EMERGENCY_DISABLE_DEBRID) {
 console.log('[ALERT] EMERGENCY MODE: All debrid features disabled');
}

// ----- remember manifest params -----
let MANIFEST_DEFAULTS = Object.create(null);
const REMEMBER_KEYS = new Set([
 'cookie','nuvio_cookie','dcookie',
 'include_nuvio','nuvio','dhosts','nuvio_base',
 'label_origin','lang_prio','max_size','additionalstream','secondBest','fallback','blacklist'
 // SECURITY: API keys removed from remember list to prevent global caching
]);

// Cache for debrid API key validation with size limit
const adKeyValidationCache = new Map(); // key -> { isValid: boolean, timestamp: number }
const AD_KEY_CACHE_MAX_SIZE = 1000; // Prevent unbounded memory growth

// Periodic cache cleanup to prevent memory leaks
setInterval(() => {
 const now = Date.now();
 const maxAge = 10 * 60 * 1000; // 10 minutes
 
 // Clean debrid API key validation cache - expired entries
 for (const [key, value] of adKeyValidationCache.entries()) {
 if (now - value.timestamp > maxAge) {
 adKeyValidationCache.delete(key);
 }
 }
 
 // LRU eviction if cache exceeds size limit
 if (adKeyValidationCache.size > AD_KEY_CACHE_MAX_SIZE) {
 const entries = Array.from(adKeyValidationCache.entries());
 const toRemove = entries
 .sort((a, b) => a[1].timestamp - b[1].timestamp) // Oldest first
 .slice(0, adKeyValidationCache.size - AD_KEY_CACHE_MAX_SIZE);
 toRemove.forEach(([key]) => adKeyValidationCache.delete(key));
 console.log(`[MEMORY] Cleaned ${toRemove.length} entries from adKeyValidationCache (LRU eviction)`);
 }
 
 // Force garbage collection if available and memory is high
 const memUsage = process.memoryUsage();
 const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
 const rssMB = Math.round(memUsage.rss / 1024 / 1024);
 
 if (heapUsedMB > 200) { // Alert if over 200MB
 console.log(`[WARN] High memory usage: ${heapUsedMB}MB heap, ${rssMB}MB RSS`);
 
 // Force garbage collection if available (requires --expose-gc flag)
 if (global.gc && heapUsedMB > 300) {
 console.log(`[CLEANUP] Forcing garbage collection...`);
 global.gc();
 
 const afterGC = process.memoryUsage();
 const newHeapMB = Math.round(afterGC.heapUsed / 1024 / 1024);
 console.log(`[CLEANUP] After GC: ${newHeapMB}MB heap (freed ${heapUsedMB - newHeapMB}MB)`);
 }
 }
}, 5 * 60 * 1000); // Run every 5 minutes

// ============ CACHE MANAGEMENT ============

// Function to clear episode and metadata caches (preserves penalty data)
function clearEpisodeCaches() {
 let totalCleared = 0;
 
 try {
 // Clear enhanced metadata cache
 const enhancedMeta = (() => {
 try { return require('./services/enhanced_meta'); }
 catch { return null; }
 })();
 
 if (enhancedMeta && enhancedMeta.clearMetadataCache) {
 totalCleared += enhancedMeta.clearMetadataCache();
 }
 
 // Clear series episode cache 
 const seriesCache = (() => {
 try { return require('./core/series-cache'); }
 catch { return null; }
 })();
 
 if (seriesCache && seriesCache.clearSeriesCache) {
 totalCleared += seriesCache.clearSeriesCache();
 }
 
 // Clear debrid API key validation cache (for fresh authentication)
 const adCacheSize = adKeyValidationCache.size;
 adKeyValidationCache.clear();
 
 if (adCacheSize > 0) {
 console.log(`[CLEANUP] Cleared debrid validation cache: ${adCacheSize} entries removed`);
 totalCleared += adCacheSize;
 }
 
 if (totalCleared > 0) {
 console.log(`[TARGET] Cache clearing complete: ${totalCleared} total entries cleared`);
 console.log(`[WARN] Note: Penalty/reliability data preserved for service stability`);
 }
 
 } catch (error) {
 console.error('Error during cache clearing:', error.message);
 }
}

// utils
function setCors(res) {
 try {
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, X-Requested-With, User-Agent');
 res.setHeader('Access-Control-Max-Age', '86400');
 // Mobile Stremio compatibility headers
 res.setHeader('Cache-Control', 'public, max-age=3600');
 } catch (e) { console.error('[setCors] Failed to set headers:', e.message); }
}
function writeJson(res, obj, code = 200) {
 try {
 if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
 } catch (e) { console.error('[writeJson] Failed to write headers:', e.message); }
 try { res.end(JSON.stringify(obj)); } catch (e) { console.error('[writeJson] Failed to serialize/send JSON:', e.message); }
}
function fileExists(p) { try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function sanitizeCookieVal(val) {
 const s = String(val||''); if (!s || s.length > 4096 || /[\r\n]/.test(s)) return ''; return s;
}
const UI_ROOT = path.join(__dirname, 'ui');
function serveFile(filePath, res) {
 try {
 if (!fileExists(filePath)) return false;
 if (!res.headersSent) res.writeHead(200, { 'Content-Type': ({
 '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
 '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
 '.ico':'image/x-icon','.map':'application/json; charset=utf-8','.woff2':'font/woff2'
 })[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
 fs.createReadStream(filePath).pipe(res);
 return true;
 } catch (e) {
 try { res.writeHead(500, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('File read error'); } catch (e2) { console.error('[serveFile] Failed to send error response:', e2.message); }
 return true;
 }
}

// deps (with fallbacks)
const sourcesMod = (() => {
 try { 
 const mod = require('./services/sources'); 
 return mod;
 }
 catch (e1) { 
 try { 
 const mod = require('./sources'); 
 return mod;
 }
 catch (e2) { 
 return { fetchTorrentioStreams: async()=>[], fetchTPBStreams: async()=>[], fetchNuvioStreams: async()=>[], fetchMediaFusionStreams: async()=>[], fetchCometStreams: async()=>[] }; 
 } 
 }
})();
const { fetchTorrentioStreams, fetchTPBStreams, fetchNuvioStreams, fetchMediaFusionStreams, fetchCometStreams } = sourcesMod;

const scoringMod = (() => {
 try { return require('./core/scoring_v6'); }
 catch (e1) { return { filterAndScoreStreams: (streams) => streams.slice(0,2) }; }
})();
const scoreStreamsV6 = scoringMod;

const clickDebrid = (() => {
 try { return require('./services/debrid'); }
 catch (e1) { 
 try { return require('./debrid'); }
 catch (e2) { return { buildPlayUrl: ()=>null, handlePlay: async (req,res)=>{ res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,err:'debrid missing'})); } }; } 
 }
})();
const { buildPlayUrl, handlePlay } = clickDebrid;

// Import enhanced formatting and series caching
const { fetchMeta } = (() => {
 try { 
 // Try enhanced metadata service first
 return require('./services/enhanced_meta'); 
 } catch (e1) {
 try { 
 // Fallback to basic meta service
 return require('./services/meta'); 
 } catch (e2) {
 return { 
 fetchMeta: async (type, id) => {
 // Extract meaningful name from IMDB ID or use ID as fallback
 let name = id;
 if (id.includes(':')) {
 const parts = id.split(':');
 name = parts[0]; // Use IMDB ID without season/episode
 }
 // Try to make IMDB IDs more readable
 if (name.startsWith('tt')) {
 name = `Movie ${name}`; // Better than just "Content"
 }
 return { name, season: null, episode: null };
 }
 }; 
 }
 }
})();

const { beautifyStreamName, shouldShowOriginTags, buildContentTitle } = (() => {
 try { return require('./core/format'); }
 catch { 
 console.log('[WARN] WARNING: core/format.js failed to load, using fallbacks');
 return { 
 beautifyStreamName: (s) => s.name || 'Stream', 
 shouldShowOriginTags: () => false, 
 buildContentTitle: (metaName, stream, opts) => {
 // Fallback content title builder with user-friendly resolution labels
 const quality = (() => {
 const t = ((stream?.title||'') + ' ' + (stream?.name||'')).toLowerCase();
 if (/\b(2160p|2160|4k|uhd)\b/.test(t)) return ' - 4K';
 if (/\b(1440p|1440|2k|qhd)\b/.test(t)) return ' - 2K';
 if (/\b(1080p|1080|fhd)\b/.test(t)) return ' - 1080p';
 if (/\b(720p|720|hd)\b/.test(t)) return ' - 720p';
 if (/\b(480p|480|sd)\b/.test(t)) return ' - 480p';
 return '';
 })();
 return (metaName || 'Content') + quality;
 }
 }; 
 }
})();

const seriesCache = (() => {
 try { return require('./core/series-cache'); }
 catch { return { preloadNextEpisode: ()=>{}, getCachedEpisode: ()=>null, shouldPreloadNext: ()=>false }; }
})();

// labels / ordering helpers
function isNuvio(s){ return !!(s && (s.autostreamOrigin === 'nuvio' || /\bNuvio\b/i.test(String(s?.name||'')))); }
function isTorrent(s){ const o = s && s.autostreamOrigin; const n = String(s?.name||''); return !!(o==='torrentio'||o==='tpb'||/\b(Torrentio|TPB\+?)\b/i.test(n)); }
function hasNuvioCookie(s){ return !!(s?.behaviorHints?.proxyHeaders?.Cookie) || !!s?._usedCookie; }
function isDebridStream(s){ return !!(s && (s._debrid || s._isDebrid || /\b(?:AllDebrid|Real-?Debrid|Premiumize|TorBox|Offcloud|Debrid)\b/i.test(String(s?.name||'')))); }
function badgeName(s){
 let name = String(s?.name || '');
 name = name.replace(/\s*\[(?:Nuvio|Torrentio|Debrid)(?:[^\]]*)\]\s*/gi, ' ').replace(/\s{2,}/g,' ').trim();
 const add = (txt) => (name.startsWith(txt) ? name : `${txt} ${name}`.trim());
 if (isDebridStream(s)) name = add('[Debrid]');
 else if (isNuvio(s)) name = add(hasNuvioCookie(s) ? '[Nuvio +]' : '[Nuvio]');
 else if (isTorrent(s)) name = add('[Torrentio]');
 return name;
}
function sortByOriginPriority(arr, { labelOrigin=false }={}) {
 const pri = (s)=>{
 if (isDebridStream(s)) return 0;
 if (isNuvio(s) && hasNuvioCookie(s)) return 1;
 if (isTorrent(s)) return 2;
 if (isNuvio(s)) return 3;
 return 4;
 };
 const out = [...(arr||[])].sort((a,b)=>{
 const pa = pri(a), pb = pri(b);
 if (pa !== pb) return pa - pb;
 const sa = a && (a._parsedSizeBytes || a.sizeBytes || a.size || 0);
 const sb = b && (b._parsedSizeBytes || b.sizeBytes || b.size || 0);
 if (sa && sb && sa !== sb) return sa - sb;
 return 0;
 });
 if (labelOrigin) out.forEach(s => s.name = badgeName(s));
 return out;
}
function attachNuvioCookie(list, cookie) {
 if (!cookie) return list;
 return (list || []).map((s) => {
 try {
 if (!(s && s.autostreamOrigin === 'nuvio' && s.url && /^https?:\/\//i.test(s.url))) return s;
 const bh = Object.assign({}, s.behaviorHints || {});
 const headers = Object.assign({}, bh.proxyHeaders || {});
 headers.Cookie = `ui=${cookie}`;
 s.behaviorHints = Object.assign({}, bh, { proxyHeaders: headers });
 s._usedCookie = true;
 } catch (e) { console.error('[attachNuvioCookie] Failed to attach cookie:', e.message); }
 return s;
 });
}
function __finalize(list, { nuvioCookie, labelOrigin }, req, actualDeviceType = null) {
 let out = Array.isArray(list) ? list.slice() : [];
 
 // Detect device type for platform-specific handling
 const deviceType = actualDeviceType || scoring.detectDeviceType(req);
 const requestId = req._requestId || 'unknown';
 
 // PHASE 1: TECHNICAL ENHANCEMENT (Preserve/Restore Metadata)
 out = enhanceStreamTechnical(out, deviceType, requestId);
 
 // PHASE 2: TORRENTIO-STYLE STREAM PROCESSING (Unchanged Logic)
 out = processStreamUrls(out, requestId, nuvioCookie);
 
 // PHASE 3: NUVIO COOKIE ATTACHMENT (Unchanged)
 out = attachNuvioCookie(out, nuvioCookie);
 
 // PHASE 4: BEAUTIFICATION (Display Names Only)
 if (labelOrigin) out = beautifyStreamNames(out);
 
 return out;
}

/**
 * PHASE 1: Technical Enhancement Layer
 * Restores critical metadata and adds device-specific properties
 * This is where TV compatibility is fixed!
 */
function enhanceStreamTechnical(streams, deviceType, requestId) {
 return streams.map((s, index) => {
 if (!s) return s;
 
 const enhanced = { ...s };
 const originalMetadata = s._originalMetadata;
 
 // Only enhance streams that have preserved metadata
 if (!originalMetadata) {
 console.log(`[${requestId}] [WARN] Stream ${index} missing original metadata - may lack TV compatibility`);
 return enhanced;
 }
 
 // RESTORE CRITICAL PROPERTIES FOR TV COMPATIBILITY
 
 // 1. File Index - CRITICAL for multi-file torrents on TV
 if (originalMetadata.fileIdx !== undefined && originalMetadata.fileIdx !== null) {
 enhanced.fileIdx = originalMetadata.fileIdx;
 }
 
 // 2. Rich Sources Array - CRITICAL for connection options on TV
 enhanced.sources = buildRichSourcesArray(originalMetadata, enhanced.infoHash);
 
 // 3. Comprehensive BehaviorHints - CRITICAL for TV client decisions
 enhanced.behaviorHints = buildComprehensiveBehaviorHints(originalMetadata, deviceType, enhanced);
 
 // 4. Device-Specific Enhancements
 if (deviceType === 'tv') {
 enhanceForTV(enhanced, originalMetadata, requestId);
 }
 
 return enhanced;
 });
}

/**
 * Build rich sources array like Torrentio (not just DHT)
 */
function buildRichSourcesArray(originalMetadata, infoHash) {
 const sources = [];
 
 // Add tracker sources first (most reliable)
 if (originalMetadata.trackers && originalMetadata.trackers.length > 0) {
 originalMetadata.trackers.forEach(tracker => {
 sources.push(`tracker:${tracker}`);
 });
 }
 
 // Add original sources if they exist
 if (originalMetadata.sources && originalMetadata.sources.length > 0) {
 originalMetadata.sources.forEach(source => {
 if (!sources.includes(source)) {
 sources.push(source);
 }
 });
 }
 
 // Always ensure DHT as fallback
 if (infoHash && !sources.some(s => s.includes('dht:'))) {
 sources.push(`dht:${infoHash}`);
 }
 
 return sources;
}

/**
 * Build comprehensive behaviorHints like Torrentio
 */
function buildComprehensiveBehaviorHints(originalMetadata, deviceType, stream) {
 const behaviorHints = { ...originalMetadata.behaviorHints };
 
 // Filename - CRITICAL for TV codec detection
 if (originalMetadata.filename) {
 behaviorHints.filename = originalMetadata.filename;
 }
 
 // Replace bingeGroup prefix to use autostream instead of source addon name
 if (originalMetadata.bingeGroup) {
 // Replace torrentio|, tpb|, nuvio| etc with autostream|
 behaviorHints.bingeGroup = originalMetadata.bingeGroup.replace(/^[^|]+\|/, 'autostream|');
 }
 
 // Video metadata for TV buffering decisions
 if (originalMetadata.videoSize) {
 behaviorHints.videoSize = originalMetadata.videoSize;
 }
 if (originalMetadata.videoHash) {
 behaviorHints.videoHash = originalMetadata.videoHash;
 }
 
 return behaviorHints;
}

/**
 * TV-specific enhancements - THE MISSING PIECE!
 */
function enhanceForTV(stream, originalMetadata, requestId) {
 // THE CRITICAL MISSING FLAG: notWebReady for TV magnet streams
 if (stream.infoHash && !stream.url) {
 stream.behaviorHints = stream.behaviorHints || {};
 stream.behaviorHints.notWebReady = true;
 console.log(`[${requestId}] [TV] Added notWebReady flag for TV device: ${stream.infoHash.substring(0, 8)}...`);
 }
 
 // Ensure filename is available for TV codec detection
 if (!stream.behaviorHints.filename && originalMetadata.filename) {
 stream.behaviorHints.filename = originalMetadata.filename;
 console.log(`[${requestId}] [TV] Restored filename for TV codec detection: ${originalMetadata.filename}`);
 }
 
 // Additional TV-specific logging
 console.log(`[${requestId}] [TV] Enhanced stream for TV: fileIdx=${stream.fileIdx}, sources=${stream.sources?.length || 0}, behaviorHints keys=[${Object.keys(stream.behaviorHints || {}).join(', ')}]`);
}

/**
 * PHASE 2: Stream URL Processing (UNCHANGED - Original Logic)
 * @param {Array} streams - Stream array to process
 * @param {string} requestId - Request ID for logging
 * @param {string} nuvioCookie - Nuvio cookie for authentication
 */
function processStreamUrls(streams, requestId, nuvioCookie) {
 streams.forEach((s, index) => {
 if (!s) return;
 
 // First try existing URLs
 s.url = s.url || s.externalUrl || s.link || (s.sources && s.sources[0] && s.sources[0].url) || '';
 
 // Torrentio-style stream handling: debrid streams get /play URLs, non-debrid get infoHash only
 if (s.infoHash && (!s.url || /^magnet:/i.test(s.url))) {
 // Check if this is a debrid stream (should have a play URL by now)
 const isDebridStream = s._debrid || s._isDebrid;
 
 if (isDebridStream) {
 // Debrid stream should have a play URL assigned - if not, this is an error
 if (!s.url || /^magnet:/i.test(s.url)) {
 console.warn(`[${requestId}] [WARN] Debrid stream missing play URL: ${s.infoHash?.substring(0, 8)}...`);
 }
 // Keep the debrid play URL, don't replace with magnet
 } else {
 // Non-debrid: Torrentio pattern - provide infoHash + sources, NO URL
 // Let Stremio handle the torrent internally (this works on Android TV)
 if (s.infoHash) {
 console.log(`[${requestId}] [MAGNET] Providing infoHash stream for client: ${s.infoHash.substring(0, 8)}...`);
 }
 
 // Remove any existing URL to force Stremio to use infoHash
 delete s.url;
 
 // NOTE: Sources are now enhanced in Phase 1, not just basic DHT
 }
 }
 
 if (s.autostreamOrigin === 'nuvio' && nuvioCookie) s._usedCookie = true;
 });
 
 return streams;
}

/**
 * PHASE 4: Beautification Layer (COSMETIC ONLY - No Technical Changes)
 * This preserves the clean user experience while keeping all technical metadata intact
 */
function beautifyStreamNames(streams) {
 return streams.map(s => {
 if (!s) return s;
 
 // ONLY change display properties - preserve all technical metadata
 const beautified = { ...s };
 beautified.name = badgeName(s); // Apply existing beautification logic
 
 return beautified;
 });
}

// AllDebrid API key validation function
async function validateAllDebridKey(apiKey) {
 if (!apiKey) return false;
 
 // Check cache first (valid for 5 minutes)
 const cached = adKeyValidationCache.get(apiKey);
 if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
 return cached.isValid;
 }
 
 try {
 // Test the API key with a simple user info request
 const { fetchWithTimeout } = require('./utils/http');
 const testUrl = `https://api.alldebrid.com/v4/user?apikey=${encodeURIComponent(apiKey)}`;
 const response = await fetchWithTimeout(testUrl, { method: 'GET' }, 5000);
 const data = await response.json();
 
 const isValid = data && data.status === 'success' && data.data && data.data.user;
 
 // Cache the result
 adKeyValidationCache.set(apiKey, { isValid, timestamp: Date.now() });
 
 return isValid;
 } catch (error) {
 // Cache failure as invalid for 1 minute (shorter cache for failures)
 adKeyValidationCache.set(apiKey, { isValid: false, timestamp: Date.now() - 4 * 60 * 1000 });
 return false;
 }
}

// Generic debrid key validation function
async function validateDebridKey(provider, apiKey) {
 if (!apiKey) return false;
 
 const cacheKey = `${provider}:${apiKey}`;
 const cached = adKeyValidationCache.get(cacheKey);
 if (cached && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
 return cached.isValid;
 }
 
 try {
 const { fetchWithTimeout } = require('./utils/http');
 let testUrl, expectedResponse;
 
 switch (provider.toLowerCase()) {
 case 'rd':
 case 'real-debrid':
 testUrl = `https://api.real-debrid.com/rest/1.0/user`;
 break;
 case 'pm':
 case 'premiumize':
 testUrl = `https://www.premiumize.me/api/account/info?apikey=${encodeURIComponent(apiKey)}`;
 break;
 case 'tb':
 case 'torbox':
 testUrl = `https://api.torbox.app/v1/api/user/me`;
 break;
 case 'oc':
 case 'offcloud':
 testUrl = `https://offcloud.com/api/account/info`;
 break;
 case 'ed':
 case 'easy-debrid':
 case 'easydebrid':
 testUrl = `https://api.easy-debrid.com/v1/user/details`;
 break;
 case 'dl':
 case 'debrid-link':
 case 'debridlink':
 testUrl = `https://debrid-link.fr/api/v2/account/infos`;
 break;
 default:
 return false;
 }
 
 const headers = { 'User-Agent': 'AutoStream/3.0' };
 
 // Add auth headers based on provider
 if (provider.toLowerCase() === 'rd') {
 headers['Authorization'] = `Bearer ${apiKey}`;
 } else if (provider.toLowerCase() === 'tb') {
 headers['Authorization'] = `Bearer ${apiKey}`;
 } else if (provider.toLowerCase() === 'oc') {
 headers['Authorization'] = `Bearer ${apiKey}`;
 } else if (provider.toLowerCase() === 'ed' || provider.toLowerCase() === 'easy-debrid' || provider.toLowerCase() === 'easydebrid') {
 headers['Authorization'] = `Bearer ${apiKey}`;
 } else if (provider.toLowerCase() === 'dl' || provider.toLowerCase() === 'debrid-link' || provider.toLowerCase() === 'debridlink') {
 headers['Authorization'] = `Bearer ${apiKey}`;
 }
 
 const response = await fetchWithTimeout(testUrl, { 
 method: 'GET',
 headers 
 }, 5000);
 
 const isValid = response.status === 200;
 
 // Cache the result
 adKeyValidationCache.set(cacheKey, { isValid, timestamp: Date.now() });
 
 return isValid;
 } catch (error) {
 // Cache failure as invalid for 1 minute
 adKeyValidationCache.set(cacheKey, { isValid: false, timestamp: Date.now() - 4 * 60 * 1000 });
 return false;
 }
}

// SECURITY: Check if a parameter contains sensitive data (API keys)
function isSensitiveParam(key) {
 return ['ad', 'apikey', 'alldebrid', 'ad_apikey', 'rd', 'real-debrid', 'realdebrid', 'pm', 'premiumize', 'tb', 'torbox', 'oc', 'offcloud'].includes(key);
}

// SECURITY: Sanitize URLs to hide API keys in query parameters
function sanitizeUrl(url) {
 if (!url) return url;
 try {
 const urlObj = new URL(url, 'http://localhost');
 for (const [key, value] of urlObj.searchParams.entries()) {
 if (isSensitiveParam(key) && value) {
 urlObj.searchParams.set(key, `${'*'.repeat(4)}${value.slice(-4)}`);
 }
 }
 return urlObj.pathname + urlObj.search;
 } catch (e) {
 // If URL parsing fails, just return the original
 return url;
 }
}

function getQ(q, k){ 
 // SECURITY: Never return API keys from global defaults
 if (isSensitiveParam(k)) {
 return (q && typeof q.get==='function' && q.get(k)) || '';
 }
 return (q && typeof q.get==='function' && q.get(k)) || MANIFEST_DEFAULTS[k] || ''; 
}
function resOf(s) {
 const t = ((s?.title||'') + ' ' + (s?.name||'') + ' ' + (s?.tag||'')).toLowerCase();
 // Use same patterns as extractResolution() for consistency
 if (/\b(2160p|2160|4k|uhd)\b/.test(t)) return 2160;
 if (/\b(1440p|1440|2k|qhd)\b/.test(t)) return 1440;
 if (/\b(1080p|1080|full\s*hd|fhd)\b/.test(t)) return 1080;
 if (/\b(720p|720|hd)\b/.test(t)) return 720;
 if (/\b(480p|480|sd)\b/.test(t)) return 480;
 return 0;
}
function getUserFriendlyResolution(resNumber) {
 if (resNumber >= 2160) return '4K';
 if (resNumber >= 1440) return '2K';
 if (resNumber >= 1080) return '1080p';
 if (resNumber >= 720) return '720p';
 if (resNumber >= 480) return '480p';
 return `${resNumber}p`;
}

// ===============================================
// PATH-BASED CONFIGURATION SUPPORT (Torrentio-style)
// ===============================================

function parsePathConfiguration(configurationPath) {
 if (!configurationPath) {
 return {};
 }
 
 // FIXED: URL-decode the configuration path first to handle encoded parameters
 const decodedPath = decodeURIComponent(configurationPath);
 
 // FIXED: Support both pipe and ampersand separators for backward compatibility
 // Torrentio uses pipe separators, which Stremio desktop app expects
 const separator = decodedPath.includes('|') ? '|' : '&';
 
 const configValues = decodedPath.split(separator)
 .reduce((map, next) => {
 const parameterParts = next.split('=');
 if (parameterParts.length === 2) {
 const key = parameterParts[0].toLowerCase();
 const value = parameterParts[1];
 map[key] = value;
 }
 return map;
 }, {});
 
 return configValues;
}

async function createManifestFromConfig(configParams, baseUrl) {
 const remembered = {};
 for (const [k, v] of Object.entries(configParams)) {
 if (REMEMBER_KEYS.has(k)) {
 remembered[k] = String(v);
 }
 }
 
 // Handle debrid provider mapping (same as existing logic)
 remembered.ad = remembered.ad || remembered.apikey || remembered.alldebrid || remembered.ad_apikey || MANIFEST_DEFAULTS.ad || '';
 
 // Apply same security measures as existing manifest endpoint
 const rememberedSafe = {};
 for (const [k, v] of Object.entries(remembered)) {
 if (!['ad', 'apikey', 'alldebrid', 'ad_apikey', 'rd', 'real-debrid', 'realdebrid', 'pm', 'premiumize', 'tb', 'torbox', 'oc', 'offcloud'].includes(k)) {
 rememberedSafe[k] = v;
 }
 }
 
 // FIXED: Map short form keys to full provider keys for getConfiguredProviders
 const expandedConfig = { ...configParams };
 if (configParams.ad) expandedConfig.alldebrid = configParams.ad;
 if (configParams.rd) expandedConfig.realdebrid = configParams.rd;
 if (configParams.pm) expandedConfig.premiumize = configParams.pm;
 if (configParams.tb) expandedConfig.torbox = configParams.tb;
 if (configParams.oc) expandedConfig.offcloud = configParams.oc;
 if (configParams.ed) expandedConfig.easydebrid = configParams.ed;
 if (configParams.dl) expandedConfig.debridlink = configParams.dl;
 if (configParams.pu) expandedConfig.putio = configParams.pu;
 
 // ADDED: API KEY VALIDATION FOR PATH-BASED CONFIGURATION
 // Support all debrid providers equally using parallel validation
 const configuredProviders = getConfiguredProviders(expandedConfig);
 
 // Validate all providers in parallel for faster manifest generation
 const validators = { validateAllDebridKey, validateDebridKey };
 const workingProviders = await validateProvidersParallel(configuredProviders, validators);

 // Build the tag based on the FIRST working debrid provider (only show tag if API key is valid)
 const primaryProvider = workingProviders.length > 0 ? workingProviders[0] : null;
 const tag = primaryProvider ? primaryProvider.provider.shortName : null;
 
 // Create query string for resource URL (same as existing logic)
 const queryParts = [];
 for (const [k, v] of Object.entries(configParams)) {
 if (!isSensitiveParam(k) && v) {
 queryParts.push(`${k}=${encodeURIComponent(v)}`);
 }
 }
 const queryString = queryParts.length > 0 ? queryParts.join('&') : '';
 
 const manifest = {
 id: 'com.stremio.autostream.addon',
 version: '3.5.2',
 name: tag ? `AutoStream Tester (${tag})` : 'AutoStream Tester',
 description: 'Curated best-pick streams with optional debrid; Nuvio direct-host supported.',
 logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
 background: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
 contactEmail: 'autostream@example.com',
 resources: [{
 name: 'stream',
 types: ['movie', 'series'],
 idPrefixes: ['tt', 'tmdb']
 }],
 types: ['movie', 'series'],
 catalogs: [],
 behaviorHints: {
 configurable: true,
 configurationRequired: false
 }
 };
 
 // Add resource URL with parameters if any exist
 if (queryString) {
 manifest.resources[0].url = `${baseUrl}/stream/{type}/{id}.json?${queryString}`;
 }
 
 return manifest;
}

// ---------- server ----------
function startServer(port = PORT) {
 const server = http.createServer();

 server.on('request', async (req, res) => {
 try {
 setCors(res);
 if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

 const url = new URL(req.url, `http://${req.headers.host}`);
 const pathname = url.pathname;
 const q = url.searchParams;

 if (pathname === '/health') return writeJson(res, { ok:true }, 200);
 
 // Detailed health endpoint with system status
 if (pathname === '/health/detailed') {
 const memUsage = process.memoryUsage();
 const uptime = process.uptime();
 
 // Collect cache sizes
 const cacheStats = {
 adKeyValidationCache: adKeyValidationCache.size,
 rateLimiter: rateLimiter.requests.size,
 concurrencyLimiter: { running: concurrencyLimiter.running, queued: concurrencyLimiter.queue.length }
 };
 
 // Get debrid provider status
 let debridStatus = 'unknown';
 try {
 const debridMod = require('./services/debrid');
 debridStatus = debridMod.getCacheStats ? debridMod.getCacheStats() : 'available';
 } catch { debridStatus = 'not-loaded'; }
 
 // Get reliability stats
 let reliabilityStats = {};
 try {
 reliabilityStats = scoring.getReliabilityStats ? scoring.getReliabilityStats() : {};
 } catch { reliabilityStats = { error: 'unavailable' }; }
 
 return writeJson(res, {
 ok: true,
 status: 'running',
 version: '2.1',
 timestamp: new Date().toISOString(),
 uptime: {
 seconds: Math.round(uptime),
 formatted: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${Math.round(uptime%60)}s`
 },
 memory: {
 heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
 heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
 rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
 external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
 },
 caches: cacheStats,
 debrid: debridStatus,
 reliability: reliabilityStats,
 config: {
 secureMode: FORCE_SECURE_MODE,
 emergencyDisableDebrid: EMERGENCY_DISABLE_DEBRID,
 port: PORT
 }
 }, 200);
 }
 
 // Debug endpoint to test upstream source connectivity
 if (pathname === '/debug/sources') {
 const testType = q.get('type') || 'movie';
 const testId = q.get('id') || 'tt0111161';
 // Allow testing with debrid credentials for Comet/MediaFusion
 const testDebridProvider = q.get('debrid_provider') || q.get('provider') || '';
 const testDebridApiKey = q.get('debrid_apikey') || q.get('apikey') || '';
 const testOptions = testDebridApiKey ? { debridProvider: testDebridProvider || 'realdebrid', debridApiKey: testDebridApiKey } : {};
 
 const results = { 
 cfProxy: CF_PROXY_URL ? 'enabled' : 'disabled',
 cfProxyUrl: CF_PROXY_URL || null,
 debridConfigured: !!testDebridApiKey,
 torrentio: null, 
 tpb: null, 
 nuvio: null,
 mediafusion: null,
 comet: null,
 errors: [] 
 };
 
 try {
 const start = Date.now();
 const torr = await fetchTorrentioStreams(testType, testId, {}, (m,...a) => results.errors.push(['torrentio', m, ...a]));
 results.torrentio = { count: torr.length, time: Date.now() - start, sample: torr[0]?.title?.substring(0,50) };
 } catch (e) { results.torrentio = { error: e.message }; }
 
 try {
 const start = Date.now();
 const tpb = await fetchTPBStreams(testType, testId, {}, (m,...a) => results.errors.push(['tpb', m, ...a]));
 results.tpb = { count: tpb.length, time: Date.now() - start, sample: tpb[0]?.title?.substring(0,50) };
 } catch (e) { results.tpb = { error: e.message }; }
 
 try {
 const start = Date.now();
 const nuvio = await fetchNuvioStreams(testType, testId, { query: { direct: '1' } }, (m,...a) => results.errors.push(['nuvio', m, ...a]));
 results.nuvio = { count: nuvio.length, time: Date.now() - start, sample: nuvio[0]?.title?.substring(0,50) };
 } catch (e) { results.nuvio = { error: e.message }; }
 
 try {
 const start = Date.now();
 const mf = await fetchMediaFusionStreams(testType, testId, testOptions, (m,...a) => results.errors.push(['mediafusion', m, ...a]));
 results.mediafusion = { count: mf.length, time: Date.now() - start, sample: mf[0]?.title?.substring(0,50) };
 } catch (e) { results.mediafusion = { error: e.message }; }
 
 try {
 const start = Date.now();
 const comet = await fetchCometStreams(testType, testId, testOptions, (m,...a) => results.errors.push(['comet', m, ...a]));
 results.comet = { count: comet.length, time: Date.now() - start, sample: comet[0]?.title?.substring(0,50) };
 } catch (e) { results.comet = { error: e.message }; }
 
 return writeJson(res, results, 200);
 }
 
 // Additional compatibility endpoints for mobile Stremio
 if (pathname === '/') {
 res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
 return res.end(`<!DOCTYPE html><html><head><title>AutoStream</title></head><body>
 <h1>AutoStream Addon</h1>
 <p>Running and ready.</p>
 <h2>Installation URLs:</h2>
 <ul>
 <li><strong>Regular:</strong> <code>http://localhost:7010/manifest.json</code></li>
 <li><strong>TV Test Mode:</strong> <code>http://localhost:7010/manifest.json?force_tv=1</code></li>
 </ul>
 <p><a href="/test-tv">Test TV Detection</a></p>
 </body></html>`);
 }
 
 if (pathname === '/test-tv') {
 const testDeviceType = scoring.detectDeviceType(req);
 const testActualDeviceType = q.get('force_tv') === '1' ? 'tv' : testDeviceType;
 const userAgent = req.headers['user-agent'] || '';
 
 res.writeHead(200, { 'Content-Type': 'application/json' });
 return res.end(JSON.stringify({
 detected_device: testDeviceType,
 actual_device: testActualDeviceType,
 user_agent: userAgent,
 force_tv_active: q.get('force_tv') === '1',
 recommendation: testActualDeviceType === 'tv' ? 
 'TV mode active - streams will be converted to /play URLs' : 
 'Web mode - add ?force_tv=1 to URL for TV testing'
 }, null, 2));
 }
 
 if (pathname === '/status') return writeJson(res, { status: 'ok', addon: 'AutoStream', version: '2' }, 200);

 // Penalty reliability API endpoints
 if (pathname === '/reliability/stats') {
 return writeJson(res, scoring.getReliabilityStats());
 }

 if (pathname === '/reliability/clear' && req.method === 'POST') {
 let body = '';
 req.on('data', chunk => body += chunk);
 req.on('end', () => {
 try {
 let data = {};
 if (body.trim()) {
 data = JSON.parse(body);
 }
 const { url } = data;
 const success = url ? penaltyReliability.clearPenalty(url) : penaltyReliability.clearAllPenalties();
 writeJson(res, { success });
 } catch (e) {
 writeJson(res, { success: false, error: e.message }, 400);
 }
 });
 return;
 }

 if (pathname === '/reliability/penalties') {
 const penalties = penaltyReliability.getState();
 return writeJson(res, { penalties });
 }

 // /play - click-time debrid resolver
 if (pathname === '/play') {
 const playRequestId = Math.random().toString(36).substr(2, 9);
 const userAgent = req.headers['user-agent'] || '';
 const deviceType = scoring.detectDeviceType(req);
 
 console.log(`\n[PLAY] [${playRequestId}] ===== PLAY REQUEST =====`);
 console.log(`[${playRequestId}] [DEVICE] Device: ${deviceType}`);
 console.log(`[${playRequestId}] [WEB] User Agent: ${userAgent}`);
 console.log(`[${playRequestId}] [LINK] URL: ${sanitizeUrl(req.originalUrl)}`);
 console.log(`[${playRequestId}] [STATS] Query:`, sanitizeQueryParams(q));
 
 return handlePlay(req, res, MANIFEST_DEFAULTS);
 }

 // Test dashboard for debugging issues
 if (pathname === '/test_issues_dashboard.html') {
 const testDashboardPath = path.join(__dirname, 'test_issues_dashboard.html');
 if (serveFile(testDashboardPath, res)) return;
 if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
 return res.end('Test dashboard not found');
 }

 // Configure UI - use your existing loader
 if (pathname === '/' || pathname === '/configure' || pathname === '/ui/configure') {
 const loaderPath = path.join(UI_ROOT, 'configure.js');
 if (fileExists(loaderPath)) {
 try {
 const loader = require(loaderPath);
 if (loader && typeof loader.configureHtml === 'function') {
 const html = loader.configureHtml();
 if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
 res.end(html);
 return;
 }
 } catch (e) { console.error('[configure] Failed to load configure.js:', e.message); }
 }
 const candidates = [
 path.join(UI_ROOT, 'configure.html'),
 path.join(UI_ROOT, 'configure', 'index.html'),
 path.join(UI_ROOT, 'index.html'),
 ];
 for (const f of candidates) { if (serveFile(f, res)) return; }
 if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
 return res.end('<!doctype html><meta charset="utf-8"><title>AutoStream</title><h1>AutoStream</h1><p>Addon is running.</p>');
 }

 // Path-based configuration route (Torrentio-style): /:configuration/manifest.json
 const pathBasedMatch = pathname.match(/^\/([^\/]+)\/manifest\.json$/);
 if (pathBasedMatch) {
 const configurationPath = pathBasedMatch[1];
 console.log('[INFO] PATH-BASED: Processing configuration:', configurationPath);
 
 try {
 const configParams = parsePathConfiguration(configurationPath);
 console.log('[DEBUG] PATH-BASED: Parsed params:', configParams);
 const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
 const manifest = await createManifestFromConfig(configParams, baseUrl);
 
 return writeJson(res, manifest, 200);
 } catch (error) {
 console.error('[ERROR] PATH-BASED: Configuration parsing failed:', error);
 // Fall back to basic manifest
 const basicManifest = await createManifestFromConfig({}, `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`);
 return writeJson(res, basicManifest, 200);
 }
 }

 if (pathname === '/manifest.json') {
 const paramsObj = Object.fromEntries(q.entries());
 
 // Enhanced logging for configuration debugging
 console.log('[CONFIG] MANIFEST REQUEST:', {
 pathname,
 queryString: req.url.split('?')[1] || 'no query string',
 paramsCount: Object.keys(paramsObj).length,
 paramKeys: Object.keys(paramsObj),
 userAgent: req.headers['user-agent'] || 'no user agent',
 referer: req.headers.referer || 'no referer'
 });
 
 if (Object.keys(paramsObj).length > 0) {
 console.log('[STATS] MANIFEST: Saving configuration with params:', Object.keys(paramsObj));
 // Redacted param values for security
 const redactedParams = {};
 for (const [k, v] of Object.entries(paramsObj)) {
 if (['alldebrid', 'realdebrid', 'premiumize', 'torbox', 'offcloud', 'easydebrid', 'debridlink', 'putio', 'ad', 'rd', 'pm', 'tb', 'oc', 'ed', 'dl', 'pu', 'nuvio_cookie'].includes(k)) {
 redactedParams[k] = '[REDACTED]';
 } else {
 redactedParams[k] = v;
 }
 }
 console.log('[STATS] MANIFEST: Parameter values (redacted):', redactedParams);
 } else {
 console.log('[STATS] MANIFEST: No parameters received - generating basic manifest');
 }
 
 const remembered = {};
 for (const [k, v] of Object.entries(paramsObj)) if (REMEMBER_KEYS.has(k)) remembered[k] = String(v);
 remembered.ad = remembered.ad || remembered.apikey || remembered.alldebrid || remembered.ad_apikey || MANIFEST_DEFAULTS.ad || '';
 
 // Clear old debrid defaults when new addon is being configured
 if (!remembered.ad && !remembered.rd && !remembered.pm && !remembered.tb && !remembered.oc) {
 // No debrid providers specified - clear cached debrid values
 delete MANIFEST_DEFAULTS.rd;
 delete MANIFEST_DEFAULTS.pm; 
 delete MANIFEST_DEFAULTS.tb;
 delete MANIFEST_DEFAULTS.oc;
 delete MANIFEST_DEFAULTS['real-debrid'];
 delete MANIFEST_DEFAULTS.realdebrid;
 delete MANIFEST_DEFAULTS.premiumize;
 delete MANIFEST_DEFAULTS.torbox;
 delete MANIFEST_DEFAULTS.offcloud;
 }
 
 // SECURITY: Never store API keys in global defaults
 const rememberedSafe = {};
 for (const [k, v] of Object.entries(remembered)) {
 // Only remember non-sensitive configuration
 if (!['ad', 'apikey', 'alldebrid', 'ad_apikey', 'rd', 'real-debrid', 'realdebrid', 'pm', 'premiumize', 'tb', 'torbox', 'oc', 'offcloud'].includes(k)) {
 rememberedSafe[k] = v;
 }
 }
 MANIFEST_DEFAULTS = Object.assign({}, MANIFEST_DEFAULTS, rememberedSafe);
 
 // UNIFIED DEBRID PROVIDER VALIDATION
 // Support all debrid providers equally using our new provider system
 
 // FIXED: Map short form keys to full provider keys for getConfiguredProviders
 const expandedParams = { ...paramsObj };
 if (paramsObj.ad) expandedParams.alldebrid = paramsObj.ad;
 if (paramsObj.rd) expandedParams.realdebrid = paramsObj.rd;
 if (paramsObj.pm) expandedParams.premiumize = paramsObj.pm;
 if (paramsObj.tb) expandedParams.torbox = paramsObj.tb;
 if (paramsObj.oc) expandedParams.offcloud = paramsObj.oc;
 if (paramsObj.ed) expandedParams.easydebrid = paramsObj.ed;
 if (paramsObj.dl) expandedParams.debridlink = paramsObj.dl;
 if (paramsObj.pu) expandedParams.putio = paramsObj.pu;
 
 const configuredProviders = getConfiguredProviders(expandedParams);
 
 // Validate all providers in parallel for faster manifest generation
 const validators = { validateAllDebridKey, validateDebridKey };
 const workingProviders = await validateProvidersParallel(configuredProviders, validators);

 // Build the tag based on the FIRST working debrid provider
 const primaryProvider = workingProviders.length > 0 ? workingProviders[0] : null;
 const tag = primaryProvider ? primaryProvider.provider.shortName : null;
 
 // Build query string for preserved parameters
 const queryParams = new URLSearchParams();
 for (const [k, v] of Object.entries(remembered)) {
 if (v && REMEMBER_KEYS.has(k)) queryParams.set(k, v);
 }
 const queryString = queryParams.toString();
 const baseUrl = `${req.protocol || 'http'}://${req.headers.host || 'localhost:7010'}`;
 
 // Build stream URL with configured parameters
 const streamUrl = queryString ? 
 `${baseUrl}/stream/{type}/{id}.json?${queryString}` : 
 `${baseUrl}/stream/{type}/{id}.json`;

 const manifest = {
 id: 'com.stremio.autostream.addon',
 version: '3.5.2',
 name: tag ? `AutoStream (${tag})` : 'AutoStream',
 description: 'Curated best-pick streams with optional debrid; Nuvio direct-host supported.',
 logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
 background: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
 contactEmail: 'autostream@example.com',
 resources: [{ 
 name: 'stream', 
 types: ['movie','series'], 
 idPrefixes: ['tt','tmdb'],
 ...(queryString && { url: streamUrl })
 }],
 types: ['movie','series'],
 catalogs: [],
 behaviorHints: { 
 configurable: true, 
 configurationRequired: false
 }
 };
 
 // SECURITY: Don't include API keys in manifest URLs - use path-based configuration
 // API keys in URLs expose them in browser history, logs, and can be intercepted
 // The configure UI uses path-based config which embeds keys safely in the manifest path
 if (queryString) {
 manifest.resources[0].url = `${baseUrl}/stream/{type}/{id}.json?${queryString}`;
 }
 
 return writeJson(res, manifest, 200);
 }

 // ==== PATH-BASED CONFIGURATION FOR STREAM ROUTES (Torrentio-style) ====
 // Handle both /stream/:type/:id.json AND /:config/stream/:type/:id.json
 let type, id;
 
 // Try path-based config first: /:configuration/stream/:type/:id.json
 const pathBasedStreamMatch = pathname.match(/^\/([^\/]+)\/stream\/(movie|series)\/(.+)\.json$/);
 if (pathBasedStreamMatch) {
 const configurationPath = pathBasedStreamMatch[1];
 type = pathBasedStreamMatch[2];
 id = decodeURIComponent(pathBasedStreamMatch[3]);
 
 console.log('[INFO] PATH-BASED STREAM: Configuration path:', configurationPath);
 
 // Parse config from path and merge with query params (path takes precedence)
 try {
 const pathParams = parsePathConfiguration(configurationPath);
 console.log('[DEBUG] PATH-BASED STREAM: Parsed params:', Object.keys(pathParams));
 
 // Merge path params into query params (path params take precedence)
 for (const [key, value] of Object.entries(pathParams)) {
 if (!q.has(key)) {
 q.set(key, value);
 }
 }
 } catch (error) {
 console.error('[ERROR] PATH-BASED STREAM: Config parsing failed:', error.message);
 }
 } else {
 // Standard route: /stream/:type/:id.json
 if (!/^\/stream\//.test(pathname)) {
 res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
 return res.end('Not found');
 }
 const m = pathname.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
 if (!m) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
 type = m[1];
 id = decodeURIComponent(m[2]);
 }

 // ============ TV DEBUGGING: DETAILED REQUEST LOGGING ============
 const requestId = Math.random().toString(36).substr(2, 9);
 const userAgent = req.headers['user-agent'] || '';
 const deviceType = scoring.detectDeviceType(req);
 
 // Helper function to sanitize query params for logging (hide API keys)
 function sanitizeQueryParams(params) {
 const sanitized = {};
 for (const [key, value] of params.entries()) {
 if (isSensitiveParam(key)) {
 sanitized[key] = value ? `${'*'.repeat(4)}${value.slice(-4)}` : 'undefined';
 } else {
 sanitized[key] = value;
 }
 }
 return sanitized;
 }
 
 console.log(`\n[PLAY] [${requestId}] ===== STREAM REQUEST START =====`);
 console.log(`[${requestId}] [TV] Type: ${type}, ID: ${id}`);
 console.log(`[${requestId}] [DEVICE] Device Type: ${deviceType}`);
 console.log(`[${requestId}] [WEB] User Agent: "${userAgent}"`);
 console.log(`[${requestId}] [LINK] Full URL: ${sanitizeUrl(req.originalUrl)}`);
 console.log(`[${requestId}] [STATS] Query Params:`, sanitizeQueryParams(q));
 
 // Simple universal device type (no TV-specific handling)
 const actualDeviceType = deviceType;

 // ============ DEFENSIVE CODE: REQUEST VALIDATION ============
 
 // 1. Rate limiting per IP
 const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
 if (!rateLimiter.isAllowed(clientIP)) {
 res.writeHead(429, { 'Content-Type': 'application/json' });
 return res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
 }
 
 // 2. Input validation
 if (!validateContentType(type)) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 return res.end(JSON.stringify({ error: 'Invalid content type' }));
 }
 
 if (!validateIMDBId(id)) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 return res.end(JSON.stringify({ error: 'Invalid IMDB ID format' }));
 }
 
 // 3. API key validation if provided
 const adParam = sanitizeStringParam(getQ(q,'ad') || getQ(q,'apikey') || getQ(q,'alldebrid') || getQ(q,'ad_apikey') || '');
 if (adParam && !validateApiKey(adParam)) {
 res.writeHead(400, { 'Content-Type': 'application/json' });
 return res.end(JSON.stringify({ error: 'Invalid API key format' }));
 }
 
 // 4. Wrap the entire request processing in concurrency limiter
 return concurrencyLimiter.execute(async () => {
 try {
 // Attach request ID to req object for tracking through the pipeline
 req._requestId = requestId;
 
 // ============ MAIN STREAM PROCESSING (WITH DEFENSIVE PROTECTIONS) ============

 const labelOrigin = q.get('label_origin') === '1';
 const onlySource = (q.get('only') || '').toLowerCase();
 const nuvioCookie = sanitizeCookieVal(getQ(q,'nuvio_cookie') || getQ(q,'dcookie') || getQ(q,'cookie') || MANIFEST_DEFAULTS.nuvio_cookie || MANIFEST_DEFAULTS.dcookie || MANIFEST_DEFAULTS.cookie || '');
 
 // Enhanced logging with levels and detailed TV debugging
 const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';
 const log = (msg, level = 'info') => {
 const prefix = `[${requestId}]`;
 
 if (level === 'error') {
 console.error(`${prefix} [ERROR] ${msg}`);
 } else if (level === 'warn') {
 console.warn(`${prefix} [WARN] ${msg}`);
 } else if (level === 'verbose') {
 if (VERBOSE_LOGGING) console.log(`${prefix} [DEBUG] ${msg}`);
 } else if (VERBOSE_LOGGING) {
 console.log(`${prefix} [INFO] ${msg}`);
 }
 };
 
 // Apply dynamic ID validation and correction for problematic IDs
 const { validateAndCorrectIMDBID } = (() => {
 try { return require('./utils/id-correction'); }
 catch { return { validateAndCorrectIMDBID: async (id) => ({ originalId: id, correctedId: id, needsCorrection: false }) }; }
 })();
 
 // Validate and potentially correct the IMDB ID before fetching streams
 console.log(`[${requestId}] [SEARCH] Validating IMDB ID: ${id}`);
 const idValidationResult = await validateAndCorrectIMDBID(id);
 const actualId = idValidationResult.correctedId;
 
 // Only log meaningful information - reduce noise
 if (idValidationResult.needsCorrection) {
 console.log(`[${requestId}] [REFRESH] ID corrected: ${id} → ${actualId} (${idValidationResult.reason})`);
 } else if (idValidationResult.reason && idValidationResult.reason.includes("Invalid")) {
 // Only warn for actual format issues, not API failures
 console.log(`[${requestId}] [WARN] ID validation warning: ${idValidationResult.reason}`);
 } else if (idValidationResult.metadata && idValidationResult.metadata.name) {
 // Only log successful external validation if we have actual metadata
 console.log(`[${requestId}] [OK] ID validated: "${idValidationResult.metadata.name}" (${idValidationResult.metadata.year})`);
 }
 // Note: Format validation success doesn't need logging - it's expected behavior
 
 console.log(`[${requestId}] [LOCATION] Stream request: ${type}/${actualId}`);
 
 // Parse enhanced configuration parameters
 const langPrioStr = getQ(q, 'lang_prio') || MANIFEST_DEFAULTS.lang_prio || '';
 const preferredLanguages = langPrioStr ? langPrioStr.split(',').map(l => l.trim()).filter(Boolean) : [];
 const maxSizeStr = getQ(q, 'max_size') || MANIFEST_DEFAULTS.max_size || '';
 const maxSizeBytes = maxSizeStr ? parseFloat(maxSizeStr) * (1024 ** 3) : 0; // Convert GB to bytes
 const additionalStreamEnabled = getQ(q, 'additionalstream') === '1' || getQ(q, 'fallback') === '1' || MANIFEST_DEFAULTS.additionalstream === '1' || MANIFEST_DEFAULTS.fallback === '1';
 const secondBestEnabled = getQ(q, 'secondBest') === '1' || getQ(q, 'secondbest') === '1' || MANIFEST_DEFAULTS.secondBest === '1';
 const conserveCookie = getQ(q, 'conserve_cookie') !== '0'; // Default to true unless explicitly disabled
 
 // Debug logging for 2ndBest
 console.log(`[${requestId}] [DEBUG] secondBest query: "${getQ(q, 'secondBest')}", default: "${MANIFEST_DEFAULTS.secondBest}", enabled: ${secondBestEnabled}`);
 
 const blacklistStr = getQ(q, 'blacklist') || MANIFEST_DEFAULTS.blacklist || '';
 // Sanitize and validate blacklist terms
 let blacklistTerms = blacklistStr 
 ? blacklistStr.split(',')
 .map(t => t.trim())
 .filter(Boolean)
 .map(t => t.substring(0, 100)) // Limit each term to 100 chars
 .filter(t => t.length >= 2) // Minimum 2 chars per term
 : [];
 // Server-side validation: limit blacklist to 100 terms to prevent abuse
 if (blacklistTerms.length > 100) {
 log(`[WARN] Blacklist truncated from ${blacklistTerms.length} to 100 terms`);
 blacklistTerms = blacklistTerms.slice(0, 100);
 }

 // Fetch metadata for proper titles (async, don't block stream fetching)
 // For series episodes, fetch metadata using base series ID (without :season:episode)
 const metaId = type === 'series' ? actualId.split(':')[0] : actualId;
 
 // Use metadata from ID validation if available, otherwise fetch fresh metadata
 let metaPromise;
 if (idValidationResult.metadata) {
 // We already have metadata from ID validation - use it directly
 log(`[OK] Using metadata from ID validation: "${idValidationResult.metadata.name}"`);
 metaPromise = Promise.resolve(idValidationResult.metadata);
 } else {
 // Fall back to normal metadata fetching
 log(`[REFRESH] Fetching fresh metadata for ${metaId}`);
 metaPromise = fetchMeta(type, metaId, (msg) => log('Meta: ' + msg, 'verbose'));
 }

 // which sources
 const dhosts = String(getQ(q,'dhosts') || MANIFEST_DEFAULTS.dhosts || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
 const nuvioEnabled = dhosts.includes('nuvio') || q.get('nuvio') === '1' || q.get('include_nuvio') === '1' || MANIFEST_DEFAULTS.nuvio === '1' || MANIFEST_DEFAULTS.include_nuvio === '1' || onlySource === 'nuvio' || 
 (!onlySource && dhosts.length === 0); // Enable by default when no specific sources requested

 // Extract debrid credentials early for Comet/MediaFusion (they need it for config)
 // This is a preliminary extraction - full validation happens later in the debrid section
 const providerKeysEarly = getProviderKeys();
 let earlyDebridProvider = null;
 let earlyDebridApiKey = null;
 for (const key of providerKeysEarly) {
  const value = getQ(q, key) || '';
  if (value) {
   earlyDebridProvider = key;
   earlyDebridApiKey = value;
   break;
  }
 }
 // Also check legacy AllDebrid params
 if (!earlyDebridApiKey) {
  const legacyAd = getQ(q,'ad') || getQ(q,'apikey') || getQ(q,'alldebrid') || getQ(q,'ad_apikey') || '';
  if (legacyAd) {
   earlyDebridProvider = 'alldebrid';
   earlyDebridApiKey = legacyAd;
  }
 }
 
 // Build source options with debrid config for Comet/MediaFusion
 const cometMfOptions = earlyDebridApiKey ? {
  debridProvider: earlyDebridProvider,
  debridApiKey: earlyDebridApiKey
 } : {};

 // fetch sources (no debrid here) - parallel execution with timeout for faster response
 // NOTE: Torrentio, TPB, and MediaFusion disabled - they return 403 from cloud IPs
 // Only Comet (with debrid) and Nuvio (with cookie) are active
 console.log(`[${requestId}] [LAUNCH] Fetching streams from sources...`);
 const sourcePromises = [
 Promise.resolve([]), // Torrentio disabled - 403 from cloud IPs
 Promise.resolve([]), // TPB disabled - 403 from cloud IPs  
 nuvioEnabled ? fetchNuvioStreams(type, actualId, { query: { direct: '1' }, cookie: nuvioCookie }, (msg) => log('Nuvio: ' + msg, 'verbose')) : Promise.resolve([]),
 Promise.resolve([]), // MediaFusion disabled - requires encrypted config
 (!onlySource || onlySource === 'comet') ? fetchCometStreams(type, actualId, cometMfOptions, (msg) => log('Comet: ' + msg, 'verbose')) : Promise.resolve([])
 ];
 
 // Use Promise.allSettled() with timeout for sources
 const [torrentioResult, tpbResult, nuvioResult, mediafusionResult, cometResult] = await Promise.allSettled(sourcePromises);
 
 // Extract results with graceful fallback - failed sources return empty arrays
 const fromTorr = torrentioResult.status === 'fulfilled' ? (torrentioResult.value || []) : [];
 const fromTPB = tpbResult.status === 'fulfilled' ? (tpbResult.value || []) : [];
 const fromNuvio = nuvioResult.status === 'fulfilled' ? (nuvioResult.value || []) : [];
 const fromMediaFusion = mediafusionResult.status === 'fulfilled' ? (mediafusionResult.value || []) : [];
 const fromComet = cometResult.status === 'fulfilled' ? (cometResult.value || []) : [];
 
 if (torrentioResult.status === 'rejected') console.log(`[${requestId}] [FAIL] Torrentio failed: ${torrentioResult.reason}`);
 if (tpbResult.status === 'rejected') console.log(`[${requestId}] [FAIL] TPB+ failed: ${tpbResult.reason}`);
 if (nuvioResult.status === 'rejected') console.log(`[${requestId}] [FAIL] Nuvio failed: ${nuvioResult.reason}`);
 if (mediafusionResult.status === 'rejected') console.log(`[${requestId}] [FAIL] MediaFusion failed: ${mediafusionResult.reason}`);
 if (cometResult.status === 'rejected') console.log(`[${requestId}] [FAIL] Comet failed: ${cometResult.reason}`);
 
 // Try to get meta quickly, but don't wait long
 let finalMeta;
 try {
 finalMeta = await Promise.race([
 metaPromise,
 new Promise((resolve) => setTimeout(() => resolve({
 name: 'TIMEOUT_FALLBACK', // Signal that we timed out
 season: null, 
 episode: null 
 }), 2500)) // Back to 2.5 seconds for better performance
 ]);
 
 console.log(`[${requestId}] [CONFIG] Metadata result: name="${finalMeta.name}", timeout=${finalMeta.name === 'TIMEOUT_FALLBACK'}`);
 
 // If we timed out or got bad metadata, try to extract from streams
 if (finalMeta && (finalMeta.name === 'TIMEOUT_FALLBACK' || finalMeta.name === 'Content' || finalMeta.name?.startsWith('Content ') || finalMeta.name?.startsWith('Title ') || !finalMeta.name || finalMeta.name === actualId || finalMeta.name.startsWith('tt'))) {
 
 // For series, try to get the base show name from any stream
 const allStreams = [...fromTorr, ...fromTPB, ...fromNuvio, ...fromMediaFusion, ...fromComet];
 if (allStreams.length > 0 && type === 'series') {
 // Look for common patterns in stream names to extract show title
 const streamTitles = allStreams.slice(0, 5).map(s => s.title || s.name || '').filter(Boolean);
 
 if (streamTitles.length > 0) {
 // Try to extract show name from first few stream titles
 for (const title of streamTitles.slice(0, 3)) {
 let extractedName = title;
 
 // First, try to extract the show name part before season/episode info
 let showNameMatch = title.match(/^([^\.]+?)[\.\s]+s\d+e\d+/i);
 if (showNameMatch) {
 extractedName = showNameMatch[1].replace(/\./g, ' ').trim();
 log(`[TARGET] Extracted from S##E## pattern: "${extractedName}"`);
 } else {
 // Fallback: remove everything after season/episode markers
 extractedName = extractedName.replace(/\b(S\d+E\d+|Season \d+|Episode \d+)\b.*$/i, '').trim();
 extractedName = extractedName.replace(/\b\d{4}\b.*$/, '').trim(); // Remove year and everything after
 extractedName = extractedName.replace(/\b(1080p|720p|4K|2160p|HDR|HEVC|x264|x265).*$/i, '').trim();
 extractedName = extractedName.replace(/\[[^\]]*\].*$/, '').trim(); // Remove [group] tags
 extractedName = extractedName.replace(/\([^)]*\).*$/, '').trim(); // Remove (year) etc
 extractedName = extractedName.replace(/\b(Complete|Collection|Pack)\b.*$/i, '').trim(); // Remove pack info
 // Clean up dots and dashes
 extractedName = extractedName.replace(/[\.\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
 log(`[SEARCH] Cleaned title: "${extractedName}"`);
 }
 
 // Validate the extracted name
 if (extractedName && extractedName.length > 2 && !extractedName.match(/^\d+$/) && !extractedName.startsWith('tt') && !extractedName.match(/^(web|hdtv|bluray|dvd)$/i)) {
 // Capitalize properly
 extractedName = extractedName.split(' ').map(word => 
 word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
 ).join(' ');
 
 finalMeta.name = extractedName;
 break;
 } else {
 }
 }
 }
 }
 
 // If extraction failed for series, try a different approach based on the ID
 if ((finalMeta.name === 'FALLBACK_NEEDED' || finalMeta.name === 'Content' || finalMeta.name.startsWith('tt')) && id.includes(':')) {
 const [baseId] = id.split(':');
 finalMeta.name = `Series ${baseId.replace('tt', '')}`;
 log(`🆔 Using ID-based fallback: "${finalMeta.name}"`);
 }
 }
 } catch (e) {
 finalMeta = { 
 name: type === 'series' ? `Series ${id.replace('tt', '').split(':')[0]}` : 'Content', 
 season: null, 
 episode: null 
 };
 }
 
 // Log which sources worked/failed for debugging
 if (torrentioResult.status === 'rejected') log('[WARN] Torrentio failed: ' + (torrentioResult.reason?.message || 'Unknown error'), 'verbose');
 if (tpbResult.status === 'rejected') log('[WARN] TPB+ failed: ' + (tpbResult.reason?.message || 'Unknown error'), 'verbose');
 if (nuvioResult.status === 'rejected') log('[WARN] Nuvio failed: ' + (nuvioResult.reason?.message || 'Unknown error'), 'verbose');
 
 // Better breakdown of Nuvio streams
 const cookieStreams = fromNuvio.filter(s => hasNuvioCookie(s) || (nuvioCookie && s.autostreamOrigin === 'nuvio'));
 const regularNuvio = fromNuvio.length - cookieStreams.length;
 const nuvioDisplay = fromNuvio.length > 0 ? 
 (cookieStreams.length > 0 ? `Nuvio(${regularNuvio}), Nuvio+(${cookieStreams.length})` : `Nuvio(${fromNuvio.length})`) :
 'Nuvio(0)';
 
 // Only show active sources (Nuvio and Comet are the only active ones now)
 console.log(`[${requestId}] [STATS] Active Sources: ${nuvioDisplay}, Comet(${fromComet.length})`);

 function tag(list, origin) {
 return (list || []).map(s => {
 s.autostreamOrigin = origin;
 s.name = s.name || (origin === 'nuvio' ? 'Nuvio' : origin === 'torrentio' ? 'Torrentio' : origin === 'mediafusion' ? 'MediaFusion' : origin === 'comet' ? 'Comet' : 'TPB+');
 return s;
 });
 }

 let combined = []
 .concat(tag(fromTorr, 'torrentio'))
 .concat(tag(fromTPB, 'tpb'))
 .concat(tag(fromNuvio, 'nuvio'))
 .concat(tag(fromMediaFusion, 'mediafusion'))
 .concat(tag(fromComet, 'comet'));

 let beforeFilterCount = combined.length; // Track for cache decision later

 // EPISODE FILTERING: For series, filter streams to only include correct episode BEFORE scoring
 if (type === 'series' && actualId.includes(':')) {
 const parts = actualId.split(':');
 if (parts.length === 3) {
 const season = parts[1];
 const episode = parts[2];
 const seasonNum = parseInt(season);
 const episodeNum = parseInt(episode);
 
 log(`[SEARCH] Pre-filtering for S${seasonNum}E${episodeNum} before scoring...`);
 
 const episodeFilteredStreams = combined.filter((stream, index) => {
 const streamText = `${stream.title || ''} ${stream.name || ''}`.toLowerCase();
 
 // Episode matching patterns - more permissive to catch PROPER, v2, multi-episode releases
 const patterns = [
 // S01E04, s01e04, S1E4, s1e4 (allow any non-digit or end after episode)
 new RegExp(`s0*${seasonNum}\\s*e0*${episodeNum}(?:[^\\d]|$)`, 'i'),
 // Season 1 Episode 4, season 01 episode 04
 new RegExp(`season\\s*0*${seasonNum}\\s*episode\\s*0*${episodeNum}(?:[^\\d]|$)`, 'i'),
 // 1x04, 1x4 (allow any non-digit after)
 new RegExp(`${seasonNum}x0*${episodeNum}(?:[^\\d]|$)`, 'i'),
 // S01 complete/pack (season packs that contain the episode)
 new RegExp(`s0*${seasonNum}\\s.*(complete|pack|collection)`, 'i'),
 // Flexible pattern: contains both season and episode numbers
 new RegExp(`s0*${seasonNum}.*e0*${episodeNum}(?:[^\\d]|$)`, 'i')
 ];
 
 const matches = patterns.map(pattern => pattern.test(streamText));
 const hasMatch = matches.some(Boolean);
 
 // DEBUG: Log first few mismatches to understand the issue
 if (!hasMatch && index < 3) {
 log(`� Debug mismatch ${index + 1}: "${streamText}" - Patterns: ${matches.map(m => m ? 'v' : 'x').join('')}`);
 log(`[SEARCH] Looking for: S${seasonNum}E${episodeNum} (${season}:${episode})`);
 }
 
 // Skip verbose logging for each match - only log mismatches and summary
 if (!hasMatch && index < 5) {
 log(`[BLOCKED] Pre-filtered: "${streamText.substring(0, 40)}..." (wrong episode)`, 'verbose');
 }
 
 return hasMatch;
 });
 
 const filteredCount = episodeFilteredStreams.length;
 log(`[STATS] Episode pre-filter: ${combined.length} → ${filteredCount} streams (removed ${combined.length - filteredCount} wrong episodes)`);
 
 combined = episodeFilteredStreams;
 
 // Quick validation of final episode selection
 if (combined.length > 0) {
 log(`[OK] Final episode streams found for S${seasonNum}E${episodeNum}: ${combined.length} streams`);
 } else {
 log(`[ALERT] No episode streams found for S${seasonNum}E${episodeNum} after filtering`);
 }
 }
 }

 if (combined.length === 0) {
 log('[WARN] No streams found from any source');
 
 // Instead of returning empty array (which causes infinite loading),
 // return a helpful message stream explaining the issue
 const messageStream = {
 name: "[BLOCKED] No Streams Available",
 title: `No streams found for this content. This may be because:\n• Content is too new or not yet indexed\n• Episode is not available on current sources\n• Try checking back later or use different sources`,
 url: "data:text/plain;charset=utf-8,No%20streams%20available%20for%20this%20content",
 behaviorHints: {
 // Message streams don't need notWebReady since they use data: URLs, not magnet links
 filename: "no_streams_available.txt"
 }
 };
 
 writeJson(res, { streams: [messageStream] });
 return;
 }

 // Skip pre-filtering for better performance - apply scoring directly
 log(`[INFO] Processing ${combined.length} streams from all sources`, 'verbose');
 
 // Fallback: If no streams after initial aggregation, try torrent sources
 if (combined.length === 0 && beforeFilterCount > 0) {
 log(`[WARN] No streams after aggregation - looking for torrent alternatives`);
 combined = []
 .concat(tag(fromTorr, 'torrentio'))
 .concat(tag(fromTPB, 'tpb'))
 .concat(tag(fromNuvio, 'nuvio'))
 .filter(stream => stream.infoHash || (stream.url && stream.url.startsWith('magnet:')));
 
 if (combined.length > 0) {
 log(`[INFO] Found ${combined.length} torrent/magnet alternatives`);
 } else {
 log(`[WARN] No torrent alternatives - falling back to original sources`);
 combined = []
 .concat(tag(fromTorr, 'torrentio'))
 .concat(tag(fromTPB, 'tpb'))
 .concat(tag(fromNuvio, 'nuvio'));
 }
 }

 // Apply blacklist filtering if configured
 if (blacklistTerms.length > 0) {
 const beforeCount = combined.length;
 combined = combined.filter(stream => {
 const streamText = [
 stream.name || '',
 stream.title || '',
 stream.description || '',
 stream.url || '',
 (stream.behaviorHints && stream.behaviorHints.filename) || ''
 ].join(' ').toLowerCase();
 
 // Return false if ANY blacklist term is found (exclude stream)
 for (const term of blacklistTerms) {
 if (streamText.includes(term.toLowerCase())) {
 return false;
 }
 }
 return true;
 });
 
 const filteredCount = beforeCount - combined.length;
 if (filteredCount > 0) {
 log(`[BLOCKED] Blacklist filtered out ${filteredCount} streams containing: ${blacklistTerms.join(', ')}`);
 }
 }

 // CRITICAL FIX: Don't auto-convert ALL torrents to debrid
 // UNIFIED DEBRID PROVIDER SYSTEM
 // Support all debrid providers equally - not AllDebrid-centric
 
 // Extract provider configuration from query parameters
 const providerConfig = {};
 const providerKeys = getProviderKeys();
 
 for (const key of providerKeys) {
 const value = getQ(q, key) || '';
 if (value) {
 providerConfig[key] = value;
 }
 }
 
 // Legacy AllDebrid parameter mapping for backward compatibility
 const legacyAdParam = getQ(q,'ad') || getQ(q,'apikey') || getQ(q,'alldebrid') || getQ(q,'ad_apikey') || '';
 if (legacyAdParam && !providerConfig.alldebrid) {
 providerConfig.alldebrid = legacyAdParam;
 }
 
 // SECURITY CHECK: Refuse to use environment variables for API keys 
 if (Object.keys(providerConfig).length === 0 && (process.env.AD_KEY || process.env.ALLDEBRID_KEY || process.env.ALLDEBRID_API_KEY || process.env.RD_KEY || process.env.PM_KEY)) {
 log('[ALERT] SECURITY: Environment variable API keys detected but ignored. Users must provide their own keys.');
 }
 
 // RENDER-LEVEL SECURITY: Additional protection against environment credential usage
 if (BLOCK_ENV_CREDENTIALS && (process.env.ALLDEBRID_KEY || process.env.AD_KEY || process.env.APIKEY || process.env.RD_KEY || process.env.PM_KEY)) {
 log('[LOCKED] RENDER SECURITY: Dangerous environment variables detected and blocked');
 }
 
 // FORCE SECURE MODE: In production, never allow environment fallbacks
 if (FORCE_SECURE_MODE && Object.keys(providerConfig).length === 0) {
 console.log(`[${requestId}] [LOCKED] SECURE MODE: Only user-provided API keys allowed, no environment fallbacks`);
 }
 
 // EMERGENCY DEBRID DISABLE: Server-wide debrid shutdown capability
 if (EMERGENCY_DISABLE_DEBRID) {
 log('[ALERT] EMERGENCY: All debrid features disabled server-wide');
 Object.keys(providerConfig).forEach(key => providerConfig[key] = ''); // Force no debrid for ALL users
 }
 
 // Validate configured debrid providers in parallel
 const providersToValidate = Object.entries(providerConfig)
 .filter(([_, token]) => token)
 .map(([key, token]) => ({ key, provider: getProvider(key), token }));
 
 const validators = { validateAllDebridKey, validateDebridKey };
 const workingProviders = await validateProvidersParallel(providersToValidate, validators);
 
 // Use the first working provider as primary
 const primaryProvider = workingProviders.length > 0 ? workingProviders[0] : null;
 const effectiveDebridProvider = primaryProvider ? primaryProvider.key : '';
 const effectiveDebridToken = primaryProvider ? primaryProvider.token : '';
 
 // SECURITY FIX: For ANY debrid provider, enable debrid URL conversion
 // This prevents raw magnet URLs from being served when debrid is configured
 const effectiveAdParam = primaryProvider ? primaryProvider.token : '';
 const hasDebridConfigured = !!primaryProvider;
 
 // Step 1: Score streams without converting to debrid yet
 combined = sortByOriginPriority(combined, { labelOrigin: false });
 
 // Step 1.5: Preserve original magnet URLs for seeder validation
 combined.forEach(s => {
 if (s && (s.url || s.externalUrl)) {
 const origUrl = s.url || s.externalUrl || '';
 if (/^magnet:/i.test(origUrl)) {
 s._originalMagnet = origUrl;
 }
 }
 });
 
 // Step 2: Enhanced scoring with permanent blacklist integration
 const scoringOptions = {
 preferredLanguages,
 maxSizeBytes,
 conservativeCookie: conserveCookie,
 blacklistTerms,
 debug: false // Standard debug setting
 };
 
 // Use new enhanced scoring system with penalty filtering
 let allScoredStreams = scoring.filterAndScoreStreams(combined, req, scoringOptions);
 
 if (allScoredStreams.length === 0) {
 console.log(`[${requestId}] [FAIL] ERROR: No streams survived scoring! This is likely the root cause.`);
 }
 
 // For additional stream logic, we need access to more streams to find different resolutions
 // But for final output, we'll only use what's needed
 
 let selectedStreams;
 if (effectiveAdParam) {
 // Debrid mode: take top stream for processing, but keep all scored streams for additional stream logic
 selectedStreams = [allScoredStreams[0]].filter(Boolean); // Just the top stream initially
 console.log(`[${requestId}] � Debrid mode: selected top stream for processing, ${allScoredStreams.length} total available for additional stream selection`);
 } else {
 // Non-debrid mode: take top stream for processing, but keep all scored streams for additional stream logic 
 selectedStreams = [allScoredStreams[0]].filter(Boolean); // Just the top stream initially
 console.log(`[${requestId}] [TV] Non-debrid mode: selected top stream for processing, ${allScoredStreams.length} total available for additional stream selection`);
 }
 
 // Define originBase for URL building (used in multiple places)
 const originBase = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
 
 // Step 3: Convert torrents to debrid URLs if ANY debrid provider is configured
 if (hasDebridConfigured && selectedStreams.length > 0) {
 for (const s of selectedStreams) {
 if (!s) continue;
 
 const isHttp = /^https?:/i.test(String(s.url||''));
 const isMagnetish = (!isHttp) && (!!s.infoHash || /^magnet:/i.test(String(s.url||'')));
 
 // Only convert torrents (not nuvio streams) to debrid
 if ((s.autostreamOrigin === 'torrentio' || s.autostreamOrigin === 'tpb') && (s.infoHash || isMagnetish)) {
 s._debrid = true; 
 s._isDebrid = true;
 
 // Extract filename for season pack file matching (like Torrentio)
 const streamFilename = s.behaviorHints?.filename || 
 s._originalMetadata?.filename || 
 '';
 
 s.url = buildPlayUrl({
 ih: s.infoHash || '',
 magnet: isMagnetish ? s.url : '',
 idx: (typeof s.fileIdx === 'number' ? s.fileIdx : 0),
 imdb: id,
 filename: streamFilename // Pass filename for season pack matching
 }, { 
 origin: originBase, 
 ad: effectiveAdParam,
 provider: effectiveDebridProvider,
 token: effectiveDebridToken
 });
 
 // SECURITY: Ensure no magnet URLs leak when debrid is configured
 if (!s.url || /^magnet:/i.test(s.url)) {
 log(`[WARN] SECURITY WARNING: Failed to convert torrent to debrid URL for ${s.infoHash?.substring(0,8)}...`);
 // Remove the stream entirely rather than serving raw magnet
 s._invalid = true;
 }
 }
 }
 
 // SECURITY: Filter out any streams that failed debrid conversion
 selectedStreams = selectedStreams.filter(s => !s._invalid);
 
 } else {
 // No debrid available - use Torrentio pattern (infoHash + sources, no URLs)
 console.log(`[${requestId}] [INFO] No debrid available - providing raw magnet URLs for external torrent clients`);
 
 // Don't assign URLs here - let __finalize handle the Torrentio pattern
 // For non-debrid streams, we want infoHash + sources but NO URL
 // This allows Stremio to handle torrents internally (works on Android TV)
 }

 // Step 4: Apply beautified names and finalize
 let streams = __finalize(selectedStreams, { nuvioCookie, labelOrigin }, req, actualDeviceType);
 
 // CRITICAL: Validate stream format for Stremio compatibility
 streams = streams.filter(s => {
 if (!s || (!s.url && !s.infoHash)) return false;
 
 // Ensure required Stremio properties exist
 if (!s.name) s.name = 'Stream';
 if (!s.title) s.title = 'Content';
 
 // Validate URL format (if URL exists)
 if (s.url) {
 try {
 const url = new URL(s.url);
 if (!['http:', 'https:', 'magnet:'].includes(url.protocol)) {
 return false;
 }
 } catch (e) {
 return false; // Invalid URL
 }
 }
 
 // Ensure stream has proper structure
 if (typeof s.name !== 'string' || typeof s.title !== 'string') {
 return false;
 }
 
 return true;
 });
 
 // Detect which debrid provider is being used (only if actually working)
 const debridProvider = effectiveDebridProvider || null;
 
 // Step 5: Process additional streams (both 2nd best and lower quality backup)
 if (allScoredStreams.length > 1) {
 const primary = streams[0]; // Already processed and finalized
 const pRes = resOf(primary);
 const primaryId = selectedStreams[0]?.infoHash || selectedStreams[0]?.url;
 
 let secondBest = null;
 let backupStream = null;
 
 // If secondBest is enabled, get the 2nd highest scored stream (same or similar quality)
 if (secondBestEnabled && allScoredStreams.length > 1) {
 const candidate = allScoredStreams[1]; // 2nd best by score
 const candidateId = candidate.infoHash || candidate.url;
 
 // Make sure it's different content
 if (candidateId !== primaryId) {
 secondBest = { ...candidate };
 console.log(`[${requestId}] [SECOND] Found 2nd best stream: ${candidate.title?.substring(0, 50) || candidate.name?.substring(0, 50) || 'Unknown'}...`);
 }
 }
 
 // If additional stream is enabled, find lower quality backup
 if (additionalStreamEnabled) {
 // Define target resolution for backup stream
 let targetRes;
 if (pRes >= 2160) targetRes = 1080; // 4K/2160p → 1080p
 else if (pRes >= 1080) targetRes = 720; // 1080p → 720p 
 else if (pRes >= 720) targetRes = 480; // 720p → 480p
 else targetRes = 0; // Don't go below 480p
 
 if (targetRes > 0) {
 console.log(`[${requestId}] [SEARCH] Looking for backup stream: primary is ${pRes}p, seeking ${targetRes}p`);
 
 // Look through scored streams to find target resolution (skip already selected streams)
 const secondBestId = secondBest?.infoHash || secondBest?.url;
 for (const candidate of allScoredStreams.slice(1)) { // Skip first (primary)
 const candidateRes = resOf(candidate);
 const candidateId = candidate.infoHash || candidate.url;
 
 log(`[INFO] Candidate: ${candidateRes}p (${candidate.title?.substring(0, 30) || candidate.name?.substring(0, 30)}...)`, 'verbose');
 
 // Make sure it's different content and target resolution (and not the 2nd best stream)
 if (candidateRes === targetRes && candidateId !== primaryId && candidateId !== secondBestId) {
 backupStream = { ...candidate };
 console.log(`[${requestId}] [OK] Found backup stream: ${candidate.title?.substring(0, 50) || candidate.name?.substring(0, 50) || 'Unknown'}...`);
 break;
 }
 }
 
 // If no exact target resolution found, try fallback to next lower resolution
 if (!backupStream && targetRes > 480) {
 const fallbackRes = targetRes === 1080 ? 720 : (targetRes === 720 ? 480 : 0);
 if (fallbackRes > 0) {
 log(`[SEARCH] No ${targetRes}p found, trying fallback to ${fallbackRes}p`);
 for (const candidate of allScoredStreams.slice(1)) {
 const candidateRes = resOf(candidate);
 const candidateId = candidate.infoHash || candidate.url;
 
 if (candidateRes === fallbackRes && candidateId !== primaryId && candidateId !== secondBestId) {
 backupStream = { ...candidate };
 log(`[OK] Found fallback backup stream: ${candidate.title?.substring(0, 50) || candidate.name?.substring(0, 50) || 'Unknown'}...`);
 break;
 }
 }
 }
 }
 }
 }
 
 // Process and finalize additional streams
 const additionalStreams = [];
 
 if (secondBest) {
 // Process 2nd best stream
 if (hasDebridConfigured && (secondBest.autostreamOrigin === 'torrentio' || secondBest.autostreamOrigin === 'tpb') && secondBest.infoHash) {
 secondBest._debrid = true;
 secondBest._isDebrid = true;
 
 const secondBestFilename = secondBest.behaviorHints?.filename || 
 secondBest._originalMetadata?.filename || 
 '';
 
 secondBest.url = buildPlayUrl({
 ih: secondBest.infoHash,
 magnet: secondBest.url && /^magnet:/i.test(secondBest.url) ? secondBest.url : '',
 idx: (typeof secondBest.fileIdx === 'number' ? secondBest.fileIdx : 0),
 imdb: id,
 filename: secondBestFilename
 }, { 
 origin: originBase, 
 ad: effectiveAdParam,
 provider: effectiveDebridProvider,
 token: effectiveDebridToken
 });
 
 if (!secondBest.url || /^magnet:/i.test(secondBest.url)) {
 log(`[WARN] SECURITY: Removing 2nd best stream - failed to convert to debrid URL (would leak magnet)`);
 secondBest._invalid = true;
 secondBest = null;
 }
 }
 
 if (secondBest) {
 const finalized2nd = __finalize([secondBest], { nuvioCookie, labelOrigin }, req, actualDeviceType)[0];
 if (finalized2nd && (finalized2nd.url || finalized2nd.infoHash)) {
 additionalStreams.push(finalized2nd);
 }
 }
 }
 
 if (backupStream) {
 // Process backup stream
 if (hasDebridConfigured && (backupStream.autostreamOrigin === 'torrentio' || backupStream.autostreamOrigin === 'tpb') && backupStream.infoHash) {
 backupStream._debrid = true;
 backupStream._isDebrid = true;
 
 const backupFilename = backupStream.behaviorHints?.filename || 
 backupStream._originalMetadata?.filename || 
 '';
 
 backupStream.url = buildPlayUrl({
 ih: backupStream.infoHash,
 magnet: backupStream.url && /^magnet:/i.test(backupStream.url) ? backupStream.url : '',
 idx: (typeof backupStream.fileIdx === 'number' ? backupStream.fileIdx : 0),
 imdb: id,
 filename: backupFilename
 }, { 
 origin: originBase, 
 ad: effectiveAdParam,
 provider: effectiveDebridProvider,
 token: effectiveDebridToken
 });
 
 if (!backupStream.url || /^magnet:/i.test(backupStream.url)) {
 log(`[WARN] SECURITY: Removing backup stream - failed to convert to debrid URL (would leak magnet)`);
 backupStream._invalid = true;
 backupStream = null;
 }
 }
 
 if (backupStream) {
 const finalizedBackup = __finalize([backupStream], { nuvioCookie, labelOrigin }, req, actualDeviceType)[0];
 if (finalizedBackup && (finalizedBackup.url || finalizedBackup.infoHash)) {
 additionalStreams.push(finalizedBackup);
 }
 }
 }
 
 // Add additional streams to final output
 if (additionalStreams.length > 0) {
 streams = [primary, ...additionalStreams];
 console.log(`[${requestId}] [TARGET] Processed ${streams.length} streams total (1 primary + ${additionalStreams.length} additional)`);
 }
 }
 
 // Ensure correct stream limit (already handled above, this override is removed)
 // Streams are already limited by streamLimit logic above

 // Step 6: Background preload next episode for series
 if (seriesCache.shouldPreloadNext(type, id)) {
 // Capture current context for preload
 const preloadReq = req;
 const preloadScoringOptions = { ...scoringOptions };
 
 // Don't await this - let it happen in background
 seriesCache.preloadNextEpisode(type, id, async (t, i) => {
 try {
 // Use Promise.allSettled for resilient background preloading
 const [nextTorrResult, nextTPBResult, nextNuvioResult, nextMFResult, nextCometResult] = await Promise.allSettled([
 (!onlySource || onlySource === 'torrentio') ? fetchTorrentioStreams(t, i, {}, ()=>{}) : Promise.resolve([]),
 (!onlySource || onlySource === 'tpb') ? fetchTPBStreams(t, i, {}, ()=>{}) : Promise.resolve([]),
 nuvioEnabled ? fetchNuvioStreams(t, i, { query: { direct: '1' }, cookie: nuvioCookie }, ()=>{}) : Promise.resolve([]),
 (!onlySource || onlySource === 'mediafusion') ? fetchMediaFusionStreams(t, i, {}, ()=>{}) : Promise.resolve([]),
 (!onlySource || onlySource === 'comet') ? fetchCometStreams(t, i, {}, ()=>{}) : Promise.resolve([])
 ]);
 
 const nextTorr = nextTorrResult.status === 'fulfilled' ? (nextTorrResult.value || []) : [];
 const nextTPB = nextTPBResult.status === 'fulfilled' ? (nextTPBResult.value || []) : [];
 const nextNuvio = nextNuvioResult.status === 'fulfilled' ? (nextNuvioResult.value || []) : [];
 const nextMF = nextMFResult.status === 'fulfilled' ? (nextMFResult.value || []) : [];
 const nextComet = nextCometResult.status === 'fulfilled' ? (nextCometResult.value || []) : [];
 
 let rawStreams = [].concat(
 tag(nextTorr, 'torrentio'),
 tag(nextTPB, 'tpb'), 
 tag(nextNuvio, 'nuvio'),
 tag(nextMF, 'mediafusion'),
 tag(nextComet, 'comet')
 );
 
 // Apply same processing as main request: scoring + filtering + selection
 rawStreams = sortByOriginPriority(rawStreams, { labelOrigin: false });
 const allScoredStreams = scoring.filterAndScoreStreams(rawStreams, preloadReq, preloadScoringOptions);
 const processedStreams = allScoredStreams.slice(0, 2); // Always process both for preload
 
 // Cache only the final processed streams (top 1-2), not all raw streams
 return processedStreams;
 } catch (error) {
 console.warn('Preload processing failed:', error.message);
 return [];
 }
 }).catch(err => console.warn('Preload failed:', err.message));
 }

 // Final validation and safe response
 if (!Array.isArray(streams)) {
 console.warn('Streams is not an array, converting');
 streams = [];
 }
 
 // Limit streams to prevent mobile crashes (max 10 streams)
 if (streams.length > 10) {
 streams = streams.slice(0, 10);
 console.log(`[${reqId}] [WARN] Limited to 10 streams to prevent mobile crashes (had ${streams.length + (streams.length - 10)})`);
 }

 // Apply visibility control based on flags
 // All streams are always processed, but flags control what the user sees
 let finalStreamCount = 1; // Always show primary
 if (secondBestEnabled) finalStreamCount++; // Add 2nd best if enabled
 if (additionalStreamEnabled) finalStreamCount++; // Add backup if enabled
 
 if (streams.length > finalStreamCount) {
 streams = streams.slice(0, finalStreamCount);
 console.log(`[${requestId}] [CONTROL] Stream visibility: showing ${finalStreamCount} streams (2ndBest=${secondBestEnabled}, Additional=${additionalStreamEnabled})`);
 } else if (streams.length > 1) {
 console.log(`[${requestId}] [CONTROL] Showing ${streams.length} streams (2ndBest=${secondBestEnabled}, Additional=${additionalStreamEnabled})`);
 }

 // STEP: Apply beautified names and titles (AFTER all scoring and processing)
 // This preserves original torrent names during scoring for codec detection
 const showOriginTags = shouldShowOriginTags(labelOrigin);
 streams.forEach(s => {
 if (s && (s.url || s.infoHash)) {
 // Set addon name (e.g., "AutoStream (AD)")
 s.name = beautifyStreamName(s, { 
 type, 
 id, 
 includeOriginTag: showOriginTags,
 debridProvider 
 });
 
 // Set content title with resolution (e.g., "Gen V S1E1 - 4K")
 s.title = buildContentTitle(finalMeta.name, s, { type, id: actualId });
 }
 });

 // Reduce cache time if we have penalties
 const hasPenalties = Object.keys(penaltyReliability.getState().penalties || {}).length > 0;
 let cacheTime = 3600; // Default: 1 hour
 
 if (hasPenalties) {
 cacheTime = 300; // 5 minutes with penalties
 }

 // CRITICAL: Clean up internal properties before sending to Stremio
 // Stremio may ignore or fail on streams with unknown properties
 // IMPORTANT: Match Comet/Torrentio exact format - no 'title' field, use 'description' for details
 console.log(`[${requestId}] [DEBUG] Cleaning ${streams.length} streams for Stremio...`);
 
 const cleanedStreams = streams.map((s, idx) => {
 if (!s) {
  console.log(`[${requestId}] [DEBUG] Stream ${idx}: NULL`);
  return null;
 }
 
 // Match Comet's exact format: name, description, url, behaviorHints
 // Stremio uses 'description' for the detailed info display, NOT 'title'
 const clean = {
  name: s.name,
  description: s.description || s.title || 'Stream', // Use description for details
  url: s.url,
  behaviorHints: s.behaviorHints || {}
 };
 
 // Only include optional properties if they have valid values
 if (s.infoHash) clean.infoHash = s.infoHash;
 if (s.fileIdx !== undefined && s.fileIdx !== null) clean.fileIdx = s.fileIdx;
 if (Array.isArray(s.sources) && s.sources.length > 0) clean.sources = s.sources;
 if (s.subtitles) clean.subtitles = s.subtitles;
 
 console.log(`[${requestId}] [DEBUG] Stream ${idx}: name="${clean.name}", url=${clean.url ? 'YES' : 'NO'}, desc=${clean.description ? clean.description.substring(0, 40) + '...' : 'NO'}`);
 
 return clean;
 }).filter(Boolean);

 // Send final response with streams
 console.log(`[${requestId}] ◆ Sending ${cleanedStreams.length} stream(s) to Stremio (cache: ${cacheTime}s)`);
 
 if (cleanedStreams.length === 0) {
 console.log(`[${requestId}] [FAIL] NO STREAMS - this will cause infinite loading in Stremio!`);
 }
 
 res.setHeader('Cache-Control', `max-age=${cacheTime}`);
 writeJson(res, { streams: cleanedStreams });
 
 log(`[OK] [${requestId}] ===== STREAM REQUEST COMPLETE =====\n`);
 
 } catch (e) {
 // Defensive error handling - prevent crashes
 console.error(`[${requestId}] [ERROR] Stream processing error:`, e);
 if (!res.headersSent) writeJson(res, { streams: [], error: 'Internal server error' }, 500);
 }
 }).catch(e => {
 // Concurrency limiter error handler
 console.error(`[${requestId}] [ERROR] Concurrency limiter error:`, e);
 if (!res.headersSent) writeJson(res, { streams: [], error: 'Service temporarily unavailable' }, 503);
 });
 } catch (e) {
 // Top-level request handler error protection
 console.error('Request handler error:', e);
 if (!res.headersSent) writeJson(res, { error: 'Server error' }, 500);
 }
 });

 server.listen(port, () => {
 console.log('AutoStream addon running at http://localhost:' + port);
 console.log('Configure at: http://localhost:' + port + '/configure');
 
 // Clear episode/metadata caches on startup to ensure fresh data after fixes
 clearEpisodeCaches();
 
 // Setup self-ping to keep Render instance alive
 setupSelfPing();
 });
 return server;
}

// Self-ping mechanism to keep Render instance alive (like HentaiStream)
function setupSelfPing() {
 // Only enable in production (Render)
 if (process.env.NODE_ENV !== 'production') {
 console.log('⏭ Self-ping disabled (not in production mode)');
 return;
 }

 const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes (before 15-min timeout)
 
 // Get the app's own URL from Render environment variable
 const selfUrl = process.env.RENDER_EXTERNAL_URL;
 
 if (!selfUrl) {
 console.warn('RENDER_EXTERNAL_URL not found - self-ping disabled');
 return;
 }

 const pingUrl = `${selfUrl}/health`;
 
 console.log(`[REFRESH] Self-ping enabled: ${pingUrl} every ${PING_INTERVAL / 60000} minutes`);

 setInterval(async () => {
 try {
 const https = require('https');
 const httpModule = require('http');
 const client = pingUrl.startsWith('https') ? https : httpModule;
 
 const startTime = Date.now();
 client.get(pingUrl, (res) => {
 const duration = Date.now() - startTime;
 console.log(`Self-ping successful (${res.statusCode}) - ${duration}ms`);
 }).on('error', (err) => {
 console.error('Self-ping failed:', err.message);
 });
 } catch (error) {
 console.error('Self-ping error:', error.message);
 }
 }, PING_INTERVAL);

 // Do an initial ping after 1 minute
 setTimeout(() => {
 console.log('Performing initial self-ping...');
 try {
 const https = require('https');
 const httpModule = require('http');
 const client = pingUrl.startsWith('https') ? https : httpModule;
 client.get(pingUrl, () => {});
 } catch (pingError) {
 console.error('Initial self-ping failed:', pingError.message);
 }
 }, 60000);
}

if (require.main === module) startServer(PORT);

module.exports = { startServer };
