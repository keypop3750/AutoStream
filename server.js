
'use strict';

/**
 * AutoStream — click-time debrid
 * - No pre-resolve during /stream listing.
 * - Torrent candidates (when AD key present) are wrapped into /play?ih=... so
 *   AllDebrid upload/unlock happens only when the user clicks.
 * - Configure UI served via your existing ./ui/configure.js (no change to your files).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============ DEFENSIVE CODE: CRASH PREVENTION ============

// 1. Unhandled Promise Rejection Handler (Prevents Node.js crashes)
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Log but don't crash - keep the addon running
});

// 2. Uncaught Exception Handler (Last resort)
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
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
  constructor(maxRequests = 50, windowMs = 60000) {
    this.requests = new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    
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
      console.warn(`⚠️ High memory usage: ${usedMB.toFixed(2)}MB`);
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        console.log('🧹 Forced garbage collection');
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

// Security: Force secure mode on Render
const FORCE_SECURE_MODE = process.env.FORCE_SECURE_MODE === 'true' || process.env.NODE_ENV === 'production';
const BLOCK_ENV_CREDENTIALS = process.env.BLOCK_ENV_CREDENTIALS !== 'false'; // Default to blocking
const EMERGENCY_DISABLE_DEBRID = process.env.EMERGENCY_DISABLE_DEBRID === 'true';

if (FORCE_SECURE_MODE) {
  console.log('🔒 SECURE MODE: Environment credential fallbacks disabled');
}

if (EMERGENCY_DISABLE_DEBRID) {
  console.log('🚨 EMERGENCY MODE: All debrid features disabled');
}

// ----- remember manifest params -----
let MANIFEST_DEFAULTS = Object.create(null);
const REMEMBER_KEYS = new Set([
  'cookie','nuvio_cookie','dcookie',
  'include_nuvio','nuvio','dhosts','nuvio_base',
  'label_origin','lang_prio','max_size','additionalstream','fallback','blacklist'
  // SECURITY: API keys removed from remember list to prevent global caching
]);

// Cache for AllDebrid API key validation
const adKeyValidationCache = new Map(); // key -> { isValid: boolean, timestamp: number }

// Periodic cache cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  // Clean AllDebrid API key validation cache
  for (const [key, value] of adKeyValidationCache.entries()) {
    if (now - value.timestamp > maxAge) {
      adKeyValidationCache.delete(key);
    }
  }
  
  // Force garbage collection if available and memory is high
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  
  if (heapUsedMB > 200) { // Alert if over 200MB
    console.log(`⚠️  High memory usage: ${heapUsedMB}MB heap, ${rssMB}MB RSS`);
    
    // Force garbage collection if available (requires --expose-gc flag)
    if (global.gc && heapUsedMB > 300) {
      console.log(`🧹 Forcing garbage collection...`);
      global.gc();
      
      const afterGC = process.memoryUsage();
      const newHeapMB = Math.round(afterGC.heapUsed / 1024 / 1024);
      console.log(`🧹 After GC: ${newHeapMB}MB heap (freed ${heapUsedMB - newHeapMB}MB)`);
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
    
    // Clear AllDebrid API key validation cache (for fresh authentication)
    const adCacheSize = adKeyValidationCache.size;
    adKeyValidationCache.clear();
    
    if (adCacheSize > 0) {
      console.log(`🧹 Cleared AllDebrid validation cache: ${adCacheSize} entries removed`);
      totalCleared += adCacheSize;
    }
    
    if (totalCleared > 0) {
      console.log(`🎯 Cache clearing complete: ${totalCleared} total entries cleared`);
      console.log(`⚠️  Note: Penalty/reliability data preserved for service stability`);
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
  } catch {}
}
function writeJson(res, obj, code = 200) {
  try {
    if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch {}
  try { res.end(JSON.stringify(obj)); } catch {}
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
    try { res.writeHead(500, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('File read error'); } catch {}
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
      return { fetchTorrentioStreams: async()=>[], fetchTPBStreams: async()=>[], fetchNuvioStreams: async()=>[] }; 
    } 
  }
})();
const { fetchTorrentioStreams, fetchTPBStreams, fetchNuvioStreams } = sourcesMod;

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
    console.log('⚠️  WARNING: core/format.js failed to load, using fallbacks');
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
function isDebridStream(s){ return !!(s && (s._debrid || s._isDebrid || /AllDebrid|Real-?Debrid/i.test(String(s?.name||'')))); }
function badgeName(s){
  let name = String(s?.name || '');
  name = name.replace(/\s*\[(?:Nuvio|Torrentio|Debrid)(?:[^\]]*)\]\s*/gi, ' ').replace(/\s{2,}/g,' ').trim();
  const add = (txt) => (name.startsWith(txt) ? name : `${txt} ${name}`.trim());
  if (isDebridStream(s)) name = add('[Debrid]');
  else if (isNuvio(s)) name = add(hasNuvioCookie(s) ? '[Nuvio ⚡]' : '[Nuvio]');
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
    } catch {}
    return s;
  });
}
function __finalize(list, { nuvioCookie, labelOrigin }, req, actualDeviceType = null) {
  let out = Array.isArray(list) ? list.slice() : [];
  
  // Detect device type for platform-specific handling
  const deviceType = actualDeviceType || scoring.detectDeviceType(req);
  const requestId = req._requestId || 'unknown';
  
  console.log(`\n🔧 [${requestId}] ===== STREAM FINALIZATION START =====`);
  console.log(`[${requestId}] 🖥️  Device Type: ${deviceType}`);
  console.log(`[${requestId}] 📊 Input streams: ${out.length}`);
  
  out.forEach((s, index) => {
    if (!s) return;
    
    console.log(`\n[${requestId}] 🔍 Processing stream [${index + 1}/${out.length}]:`);
    console.log(`[${requestId}]   Name: "${s.name || 'Unnamed'}"`);
    console.log(`[${requestId}]   URL (before): "${(s.url || '').substring(0, 100)}${(s.url || '').length > 100 ? '...' : ''}"`);
    console.log(`[${requestId}]   InfoHash: ${s.infoHash || 'none'}`);
    console.log(`[${requestId}]   Is Debrid: ${!!(s._debrid || s._isDebrid)}`);
    
    // First try existing URLs
    s.url = s.url || s.externalUrl || s.link || (s.sources && s.sources[0] && s.sources[0].url) || '';
    
    // Torrentio-style stream handling: debrid streams get /play URLs, non-debrid get infoHash only
    if (s.infoHash && (!s.url || /^magnet:/i.test(s.url))) {
      // Check if this is a debrid stream (should have a play URL by now)
      const isDebridStream = s._debrid || s._isDebrid;
      console.log(`[${requestId}]   InfoHash stream - isDebrid: ${isDebridStream}`);
      
      if (isDebridStream) {
        // Debrid stream should have a play URL assigned - if not, this is an error
        if (!s.url || /^magnet:/i.test(s.url)) {
          console.warn(`[${requestId}] ⚠️ Debrid stream missing play URL: ${s.infoHash?.substring(0, 8)}...`);
        }
        // Keep the debrid play URL, don't replace with magnet
      } else {
        // Non-debrid: Torrentio pattern - provide infoHash + sources, NO URL
        // Let Stremio handle the torrent internally (this works on Android TV)
        console.log(`[${requestId}]   Non-debrid: using Torrentio pattern (infoHash + sources, no URL)`);
        
        // Remove any existing URL to force Stremio to use infoHash
        delete s.url;
        
        // Ensure we have sources for the torrent
        if (!s.sources || s.sources.length === 0) {
          s.sources = [`dht:${s.infoHash}`];
        }
      }
    }
    
    const isHttp = /^https?:/i.test(String(s.url||''));
    const isMagnet = !isHttp && (s.infoHash || /^magnet:/i.test(String(s.url||'')));
    const isInfoHashOnly = s.infoHash && !s.url;
    
    let streamType = 'OTHER';
    if (isHttp) streamType = 'HTTP';
    else if (isInfoHashOnly) streamType = 'INFOHASH_ONLY';
    else if (isMagnet) streamType = 'MAGNET';
    
    console.log(`[${requestId}]   Stream type: ${streamType}`);
    if (s.url) {
      console.log(`[${requestId}]   URL (final): "${(s.url || '').substring(0, 100)}${(s.url || '').length > 100 ? '...' : ''}"`);
    } else {
      console.log(`[${requestId}]   No URL (infoHash-only stream for Stremio internal handling)`);
    }
    console.log(`[${requestId}]   Sources: ${s.sources ? s.sources.length : 0} available`);
    
    if (s.autostreamOrigin === 'nuvio' && nuvioCookie) s._usedCookie = true;
  });
  
  out = attachNuvioCookie(out, nuvioCookie);
  if (labelOrigin) out.forEach(s => s.name = badgeName(s));
  
  console.log(`[${requestId}] ✅ Finalization complete: ${out.length} streams ready`);
  return out;
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

function getQ(q, k){ 
  // SECURITY: Never return API keys from global defaults
  if (['ad', 'apikey', 'alldebrid', 'ad_apikey', 'rd', 'real-debrid', 'realdebrid', 'pm', 'premiumize', 'tb', 'torbox', 'oc', 'offcloud'].includes(k)) {
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
      
      if (pathname === '/status') return writeJson(res, { status: 'ok', addon: 'AutoStream', version: '3.4.6' }, 200);

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

      // /play — click-time debrid resolver
      if (pathname === '/play') {
        const playRequestId = Math.random().toString(36).substr(2, 9);
        const userAgent = req.headers['user-agent'] || '';
  const deviceType = scoring.detectDeviceType(req);
        
        console.log(`\n🎬 [${playRequestId}] ===== PLAY REQUEST =====`);
        console.log(`[${playRequestId}] 🖥️  Device: ${deviceType}`);
        console.log(`[${playRequestId}] 🌐 User Agent: ${userAgent}`);
        console.log(`[${playRequestId}] 🔗 URL: ${req.originalUrl}`);
        console.log(`[${playRequestId}] 📊 Query: ${JSON.stringify(Object.fromEntries(q))}`);
        
        return handlePlay(req, res, MANIFEST_DEFAULTS);
      }

      // Test dashboard for debugging issues
      if (pathname === '/test_issues_dashboard.html') {
        const testDashboardPath = path.join(__dirname, 'test_issues_dashboard.html');
        if (serveFile(testDashboardPath, res)) return;
        if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Test dashboard not found');
      }

      // Configure UI — use your existing loader
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
          } catch {}
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

      if (pathname === '/manifest.json') {
        const paramsObj = Object.fromEntries(q.entries());
        
        // Enhanced logging for configuration debugging
        if (Object.keys(paramsObj).length > 0) {
          console.log('� MANIFEST: Saving configuration with params:', Object.keys(paramsObj));
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
        
        // SECURITY: Only use user-provided API keys, never from global defaults
        const adKey = paramsObj.ad || paramsObj.apikey || paramsObj.alldebrid || paramsObj.ad_apikey;
        let adKeyWorking = false;
        if (adKey) {
          try {
            adKeyWorking = await validateAllDebridKey(adKey);
          } catch (e) {
            console.log('AllDebrid key validation failed:', e.message);
            adKeyWorking = false;
          }
        }
        
        // SECURITY: Only use user-provided API keys, never from global defaults
        const rdKey = paramsObj.rd || paramsObj['real-debrid'] || paramsObj.realdebrid;
        const pmKey = paramsObj.pm || paramsObj.premiumize;
        const tbKey = paramsObj.tb || paramsObj.torbox;
        const ocKey = paramsObj.oc || paramsObj.offcloud;
        
        let rdKeyWorking = false, pmKeyWorking = false, tbKeyWorking = false, ocKeyWorking = false;
        
        if (rdKey) {
          try {
            rdKeyWorking = await validateDebridKey('rd', rdKey);
          } catch (e) {
            console.log('RealDebrid key validation failed:', e.message);
          }
        }
        
        if (pmKey) {
          try {
            pmKeyWorking = await validateDebridKey('pm', pmKey);
          } catch (e) {
            console.log('Premiumize key validation failed:', e.message);
          }
        }
        
        if (tbKey) {
          try {
            tbKeyWorking = await validateDebridKey('tb', tbKey);
          } catch (e) {
            console.log('TorBox key validation failed:', e.message);
          }
        }
        
        if (ocKey) {
          try {
            ocKeyWorking = await validateDebridKey('oc', ocKey);
          } catch (e) {
            console.log('OffCloud key validation failed:', e.message);
          }
        }

        // Build the tag based on WORKING debrid services only
        const tag = (()=>{
          // Only show provider if API key is working and validated
          if (adKeyWorking) return 'AD';
          if (rdKeyWorking) return 'RD';
          if (pmKeyWorking) return 'PM';
          if (tbKeyWorking) return 'TB';
          if (ocKeyWorking) return 'OC';
          
          return null; // No working debrid provider
        })();
        
        // Build query string for preserved parameters
        const queryParams = new URLSearchParams();
        for (const [k, v] of Object.entries(remembered)) {
          if (v && REMEMBER_KEYS.has(k)) queryParams.set(k, v);
        }
        const queryString = queryParams.toString();
        const baseUrl = `${req.protocol || 'http'}://${req.headers.host || 'localhost:7010'}`;
        
        const manifest = {
          id: 'com.stremio.autostream.addon',
          version: '3.4.6',
          name: tag ? `AutoStream (${tag})` : 'AutoStream',
          description: 'Curated best-pick streams with optional debrid; Nuvio direct-host supported.',
          logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
          background: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
          contactEmail: 'autostream@example.com',
          resources: [{ 
            name: 'stream', 
            types: ['movie','series'], 
            idPrefixes: ['tt','tmdb']
          }],
          types: ['movie','series'],
          catalogs: [],
          behaviorHints: { 
            configurable: true, 
            configurationRequired: false
          }
        };
        
        // MOBILE FIX: Never add query parameters to manifest endpoint
        // This prevents mobile installation issues. Configuration is stored server-side.
        // The manifest endpoint always stays clean: /stream/{type}/{id}.json
        
        return writeJson(res, manifest, 200);
      }

      if (!/^\/stream\//.test(pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const m = pathname.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
      if (!m) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found'); }
      const type = m[1];
      const id = decodeURIComponent(m[2]);

      // ============ TV DEBUGGING: DETAILED REQUEST LOGGING ============
      const requestId = Math.random().toString(36).substr(2, 9);
      const userAgent = req.headers['user-agent'] || '';
      const deviceType = scoring.detectDeviceType(req);
      
      console.log(`\n🎬 [${requestId}] ===== STREAM REQUEST START =====`);
      console.log(`[${requestId}] 📺 Type: ${type}, ID: ${id}`);
      console.log(`[${requestId}] 🖥️  Device Type: ${deviceType}`);
      console.log(`[${requestId}] 🌐 User Agent: "${userAgent}"`);
      console.log(`[${requestId}] 🔗 Full URL: ${req.originalUrl}`);
      console.log(`[${requestId}] 📊 Query Params:`, Object.fromEntries(q));
      console.log(`[${requestId}] 🌍 Client IP: ${req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'}`);
      
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
        const timestamp = new Date().toISOString().substr(11, 8);
        const prefix = `[${requestId}] ${timestamp}`;
        
        if (level === 'error') {
          console.error(`${prefix} ❌ ${msg}`);
        } else if (level === 'warn') {
          console.warn(`${prefix} ⚠️ ${msg}`);
        } else if (level === 'verbose') {
          if (VERBOSE_LOGGING || deviceType === 'tv') console.log(`${prefix} 🔍 ${msg}`);
        } else {
          console.log(`${prefix} 📝 ${msg}`);
        }
      };
      
      log(`🚀 Starting stream processing for ${type}/${id}`);
      log(`🖥️  Device: ${actualDeviceType}`);
      log(`🎛️  Config - labelOrigin: ${labelOrigin}, onlySource: ${onlySource}, nuvioCookie: ${!!nuvioCookie}`);
      
      // Apply dynamic ID validation and correction for problematic IDs
      const { validateAndCorrectIMDBID } = (() => {
        try { return require('./utils/id-correction'); }
        catch { return { validateAndCorrectIMDBID: async (id) => ({ originalId: id, correctedId: id, needsCorrection: false }) }; }
      })();
      
      // Validate and potentially correct the IMDB ID before fetching streams
      log(`🔍 Validating IMDB ID: ${id}`);
      const idValidationResult = await validateAndCorrectIMDBID(id);
      const actualId = idValidationResult.correctedId;
      
      if (idValidationResult.needsCorrection) {
        log(`� ID corrected: ${id} → ${actualId} (${idValidationResult.reason})`);
      } else if (!idValidationResult.metadata) {
        log(`⚠️ ID validation warning: ${idValidationResult.reason}`);
      } else {
        log(`✅ ID validated: "${idValidationResult.metadata.name}" (${idValidationResult.metadata.year})`);
      }
      
      log(`📍 Stream request: ${type}/${actualId}`);
      
      // Parse enhanced configuration parameters
      const langPrioStr = getQ(q, 'lang_prio') || MANIFEST_DEFAULTS.lang_prio || '';
      const preferredLanguages = langPrioStr ? langPrioStr.split(',').map(l => l.trim()).filter(Boolean) : [];
      const maxSizeStr = getQ(q, 'max_size') || MANIFEST_DEFAULTS.max_size || '';
      const maxSizeBytes = maxSizeStr ? parseFloat(maxSizeStr) * (1024 ** 3) : 0; // Convert GB to bytes
      const additionalStreamEnabled = getQ(q, 'additionalstream') === '1' || getQ(q, 'fallback') === '1' || MANIFEST_DEFAULTS.additionalstream === '1' || MANIFEST_DEFAULTS.fallback === '1';
      const conserveCookie = getQ(q, 'conserve_cookie') !== '0'; // Default to true unless explicitly disabled
      
      // DEBUG: Log stream configuration
      log(`🔧 Stream config - additionalstream: ${getQ(q, 'additionalstream')}, fallback: ${getQ(q, 'fallback')}, enabled: ${additionalStreamEnabled}`, 'verbose');
      const blacklistStr = getQ(q, 'blacklist') || MANIFEST_DEFAULTS.blacklist || '';
      const blacklistTerms = blacklistStr ? blacklistStr.split(',').map(t => t.trim()).filter(Boolean) : [];

      // Fetch metadata for proper titles (async, don't block stream fetching)
      // For series episodes, fetch metadata using base series ID (without :season:episode)
      const metaId = type === 'series' ? actualId.split(':')[0] : actualId;
      
      // Use metadata from ID validation if available, otherwise fetch fresh metadata
      let metaPromise;
      if (idValidationResult.metadata) {
        // We already have metadata from ID validation - use it directly
        log(`✅ Using metadata from ID validation: "${idValidationResult.metadata.name}"`);
        metaPromise = Promise.resolve(idValidationResult.metadata);
      } else {
        // Fall back to normal metadata fetching
        log(`🔄 Fetching fresh metadata for ${metaId}`);
        metaPromise = fetchMeta(type, metaId, (msg) => log('Meta: ' + msg, 'verbose'));
      }

      // which sources
      const dhosts = String(getQ(q,'dhosts') || MANIFEST_DEFAULTS.dhosts || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      const nuvioEnabled = dhosts.includes('nuvio') || q.get('nuvio') === '1' || q.get('include_nuvio') === '1' || MANIFEST_DEFAULTS.nuvio === '1' || MANIFEST_DEFAULTS.include_nuvio === '1' || onlySource === 'nuvio' || 
                          (!onlySource && dhosts.length === 0); // Enable by default when no specific sources requested

      log(`🎯 Source selection - dhosts: [${dhosts.join(', ')}], nuvioEnabled: ${nuvioEnabled}, onlySource: ${onlySource}`);

      // fetch sources (no debrid here) - parallel execution with timeout for faster response
      log('🚀 Fetching streams from sources...');
      const sourcePromises = [
        (!onlySource || onlySource === 'torrentio') ? fetchTorrentioStreams(type, actualId, {}, (msg) => log('Torrentio: ' + msg, 'verbose')) : Promise.resolve([]),
        (!onlySource || onlySource === 'tpb')       ? fetchTPBStreams(type, actualId, {}, (msg) => log('TPB+: ' + msg, 'verbose'))       : Promise.resolve([]),
        nuvioEnabled ? fetchNuvioStreams(type, actualId, { query: { direct: '1' }, cookie: nuvioCookie }, (msg) => log('Nuvio: ' + msg, 'verbose')) : Promise.resolve([])
      ];
      
      log(`📊 Executing ${sourcePromises.length} source fetch promises...`);
      
      // Use Promise.allSettled() with timeout for sources
      const [torrentioResult, tpbResult, nuvioResult] = await Promise.allSettled(sourcePromises);
      
      // Extract results with graceful fallback - failed sources return empty arrays
      const fromTorr = torrentioResult.status === 'fulfilled' ? (torrentioResult.value || []) : [];
      const fromTPB = tpbResult.status === 'fulfilled' ? (tpbResult.value || []) : [];
      const fromNuvio = nuvioResult.status === 'fulfilled' ? (nuvioResult.value || []) : [];
      
      log(`📦 Source results - Torrentio: ${fromTorr.length}, TPB+: ${fromTPB.length}, Nuvio: ${fromNuvio.length}`);
      if (torrentioResult.status === 'rejected') log(`❌ Torrentio failed: ${torrentioResult.reason}`, 'error');
      if (tpbResult.status === 'rejected') log(`❌ TPB+ failed: ${tpbResult.reason}`, 'error');
      if (nuvioResult.status === 'rejected') log(`❌ Nuvio failed: ${nuvioResult.reason}`, 'error');
      
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
        
        log(`🔧 Metadata result: name="${finalMeta.name}", timeout=${finalMeta.name === 'TIMEOUT_FALLBACK'}`);
        
        // If we timed out or got bad metadata, try to extract from streams
        if (finalMeta && (finalMeta.name === 'TIMEOUT_FALLBACK' || finalMeta.name === 'Content' || finalMeta.name?.startsWith('Content ') || finalMeta.name?.startsWith('Title ') || !finalMeta.name || finalMeta.name === actualId || finalMeta.name.startsWith('tt'))) {
          log(`🔧 Attempting to extract title from streams (current: "${finalMeta.name}")`);
          
          // For series, try to get the base show name from any stream
          const allStreams = [...fromTorrentio, ...fromTPB, ...fromNuvio];
          if (allStreams.length > 0 && type === 'series') {
            // Look for common patterns in stream names to extract show title
            const streamTitles = allStreams.slice(0, 5).map(s => s.title || s.name || '').filter(Boolean);
            log(`🔍 Sample stream titles for extraction: ${streamTitles.slice(0, 3).join(' | ')}`);
            
            if (streamTitles.length > 0) {
              // Try to extract show name from first few stream titles
              for (const title of streamTitles.slice(0, 3)) {
                let extractedName = title;
                log(`🔍 Processing stream title: "${title}"`);
                
                // First, try to extract the show name part before season/episode info
                let showNameMatch = title.match(/^([^\.]+?)[\.\s]+s\d+e\d+/i);
                if (showNameMatch) {
                  extractedName = showNameMatch[1].replace(/\./g, ' ').trim();
                  log(`🎯 Extracted from S##E## pattern: "${extractedName}"`);
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
                  log(`🔍 Cleaned title: "${extractedName}"`);
                }
                
                // Validate the extracted name
                if (extractedName && extractedName.length > 2 && !extractedName.match(/^\d+$/) && !extractedName.startsWith('tt') && !extractedName.match(/^(web|hdtv|bluray|dvd)$/i)) {
                  // Capitalize properly
                  extractedName = extractedName.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                  ).join(' ');
                  
                  finalMeta.name = extractedName;
                  log(`🎯 Successfully extracted title: "${extractedName}"`);
                  break;
                } else {
                  log(`❌ Rejected extracted name: "${extractedName}" (too short, numeric, or invalid)`);
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
      if (torrentioResult.status === 'rejected') log('⚠️  Torrentio failed: ' + (torrentioResult.reason?.message || 'Unknown error'), 'verbose');
      if (tpbResult.status === 'rejected') log('⚠️  TPB+ failed: ' + (tpbResult.reason?.message || 'Unknown error'), 'verbose');
      if (nuvioResult.status === 'rejected') log('⚠️  Nuvio failed: ' + (nuvioResult.reason?.message || 'Unknown error'), 'verbose');
      
      // Better breakdown of Nuvio streams
      const cookieStreams = fromNuvio.filter(s => hasNuvioCookie(s) || (nuvioCookie && s.autostreamOrigin === 'nuvio'));
      const regularNuvio = fromNuvio.length - cookieStreams.length;
      const nuvioDisplay = fromNuvio.length > 0 ? 
        (cookieStreams.length > 0 ? `Nuvio(${regularNuvio}), Nuvio+(${cookieStreams.length})` : `Nuvio(${fromNuvio.length})`) :
        'Nuvio(0)';
      
      log(`📊 Sources: Torrentio(${fromTorr.length}), TPB+(${fromTPB.length}), ${nuvioDisplay}`);

      function tag(list, origin) {
        return (list || []).map(s => {
          s.autostreamOrigin = origin;
          s.name = s.name || (origin === 'nuvio' ? 'Nuvio' : origin === 'torrentio' ? 'Torrentio' : 'TPB+');
          return s;
        });
      }

      let combined = []
        .concat(tag(fromTorr, 'torrentio'))
        .concat(tag(fromTPB, 'tpb'))
        .concat(tag(fromNuvio, 'nuvio'));

      let beforeFilterCount = combined.length; // Track for cache decision later

      // EPISODE FILTERING: For series, filter streams to only include correct episode BEFORE scoring
      if (type === 'series' && actualId.includes(':')) {
        const parts = actualId.split(':');
        if (parts.length === 3) {
          const season = parts[1];
          const episode = parts[2];
          const seasonNum = parseInt(season);
          const episodeNum = parseInt(episode);
          
          log(`🔍 Pre-filtering for S${seasonNum}E${episodeNum} before scoring...`);
          
          const episodeFilteredStreams = combined.filter((stream, index) => {
            const streamText = `${stream.title || ''} ${stream.name || ''}`.toLowerCase();
            
            // Episode matching patterns (same as before but applied earlier)
            const patterns = [
              // S01E04, s01e04, S1E4, s1e4
              new RegExp(`s0*${seasonNum}\\s*e0*${episodeNum}(?:\\s|\\.|$)`, 'i'),
              // Season 1 Episode 4, season 01 episode 04  
              new RegExp(`season\\s*0*${seasonNum}\\s*episode\\s*0*${episodeNum}(?:\\s|\\.|$)`, 'i'),
              // 1x04, 1x4
              new RegExp(`${seasonNum}x0*${episodeNum}(?:\\s|\\.|$)`, 'i'),
              // S01 complete/pack (season packs that contain the episode)
              new RegExp(`s0*${seasonNum}\\s.*(complete|pack|collection)`, 'i'),
              // Flexible pattern: contains both season and episode numbers
              new RegExp(`s0*${seasonNum}.*e0*${episodeNum}`, 'i')
            ];
            
            const matches = patterns.map(pattern => pattern.test(streamText));
            const hasMatch = matches.some(Boolean);
            
            // DEBUG: Log first few mismatches to understand the issue
            if (!hasMatch && index < 3) {
              log(`� Debug mismatch ${index + 1}: "${streamText}" - Patterns: ${matches.map(m => m ? '✓' : '✗').join('')}`);
              log(`🔍 Looking for: S${seasonNum}E${episodeNum} (${season}:${episode})`);
            }
            
            // Skip verbose logging for each match - only log mismatches and summary
            if (!hasMatch && index < 5) {
              log(`🚫 Pre-filtered: "${streamText.substring(0, 40)}..." (wrong episode)`, 'verbose');
            }
            
            return hasMatch;
          });
          
          const filteredCount = episodeFilteredStreams.length;
          log(`📊 Episode pre-filter: ${combined.length} → ${filteredCount} streams (removed ${combined.length - filteredCount} wrong episodes)`);
          
          combined = episodeFilteredStreams;
          
          // Quick validation of final episode selection
          if (combined.length > 0) {
            log(`✅ Final episode streams found for S${seasonNum}E${episodeNum}: ${combined.length} streams`);
          } else {
            log(`🚨 No episode streams found for S${seasonNum}E${episodeNum} after filtering`);
          }
        }
      }

      if (combined.length === 0) {
        log('⚠️  No streams found from any source');
        
        // Instead of returning empty array (which causes infinite loading),
        // return a helpful message stream explaining the issue
        const messageStream = {
          name: "🚫 No Streams Available",
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
      log(`📊 Processing ${combined.length} streams from all sources`, 'verbose');
      
      // TEMPORARILY DISABLED: Filter out problematic URLs that cause infinite loading
      // combined = combined.filter(stream => {
      //   // Filter out Google Drive URLs that expire immediately (max-age=0)
      //   if (stream.url && stream.url.includes('googleusercontent.com')) {
      //     log(`🚫 Filtered Google Drive URL (expires immediately): ${stream.title}`);
      //     return false;
      //   }
      //   
      //   // Filter out obviously invalid URLs
      //   if (stream.url && (stream.url.includes('error') || stream.url.includes('expired'))) {
      //     log(`🚫 Filtered invalid URL: ${stream.title}`);
      //     return false;
      //   }
      //   
      //   return true;
      // });
      
      log(`🔍 Skipped filtering, ${combined.length} streams remain`, 'verbose');
      
      // If all streams were filtered, prefer torrent/magnet sources instead
      if (combined.length === 0 && beforeFilterCount > 0) {
        log(`⚠️ All ${beforeFilterCount} streams were Google Drive URLs - looking for torrent alternatives`);
        // Allow magnet/torrent streams to pass through as they don't expire
        combined = []
          .concat(tag(fromTorr, 'torrentio'))
          .concat(tag(fromTPB, 'tpb'))
          .concat(tag(fromNuvio, 'nuvio'))
          .filter(stream => stream.infoHash || (stream.url && stream.url.startsWith('magnet:')));
        
        if (combined.length > 0) {
          log(`✅ Found ${combined.length} torrent/magnet alternatives`);
        } else {
          log(`⚠️ No torrent alternatives available - falling back to original sources with warning`);
          // Fall back to original sources but mark them as potentially problematic
          combined = []
            .concat(tag(fromTorr, 'torrentio'))
            .concat(tag(fromTPB, 'tpb'))
            .concat(tag(fromNuvio, 'nuvio'));
          combined.forEach(stream => {
            // TEMPORARILY DISABLED: Google Drive warning
            // if (stream.url && stream.url.includes('googleusercontent.com')) {
            //   stream.title = `⚠️ ${stream.title} (may expire)`;
            // }
          });
        }
      }
      
      if (beforeFilterCount !== combined.length) {
        log(`🔍 Filtered ${beforeFilterCount - combined.length} problematic URLs, ${combined.length} remain`);
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
          log(`🚫 Blacklist filtered out ${filteredCount} streams containing: ${blacklistTerms.join(', ')}`);
        }
      }

      // CRITICAL FIX: Don't auto-convert ALL torrents to debrid
      // Instead, let sources compete first, then convert winners to debrid URLs
      // SECURITY: Only use API keys explicitly provided by users, never from environment
      // SECURITY: Only use user-provided API keys, never from global defaults  
      const adParam = (getQ(q,'ad') || getQ(q,'apikey') || getQ(q,'alldebrid') || getQ(q,'ad_apikey') || '');
      
      // SECURITY CHECK: Refuse to use environment variables for API keys
      if (!adParam && (process.env.AD_KEY || process.env.ALLDEBRID_KEY || process.env.ALLDEBRID_API_KEY)) {
        log('🚨 SECURITY: Environment variable API keys detected but ignored. Users must provide their own keys.');
      }
      
      // RENDER-LEVEL SECURITY: Additional protection against environment credential usage
      if (BLOCK_ENV_CREDENTIALS && (process.env.ALLDEBRID_KEY || process.env.AD_KEY || process.env.APIKEY)) {
        log('🔒 RENDER SECURITY: Dangerous environment variables detected and blocked');
      }
      
      // FORCE SECURE MODE: In production, never allow environment fallbacks
      if (FORCE_SECURE_MODE && !adParam) {
        log('🔒 SECURE MODE: Only user-provided API keys allowed, no environment fallbacks');
      }
      
      // EMERGENCY DEBRID DISABLE: Server-wide debrid shutdown capability
      if (EMERGENCY_DISABLE_DEBRID) {
        log('🚨 EMERGENCY: All debrid features disabled server-wide');
        adParam = ''; // Force no debrid for ALL users
      }
      
      // Validate AllDebrid key if provided - fall back to non-debrid if invalid
      let adKeyWorking = false;
      if (adParam) {
        try {
          adKeyWorking = await validateAllDebridKey(adParam);
          if (!adKeyWorking) {
            log('⚠️ AllDebrid key provided but not working (blocked/invalid) - falling back to non-debrid mode');
          }
        } catch (e) {
          log('⚠️ AllDebrid key validation failed - falling back to non-debrid mode: ' + e.message);
          adKeyWorking = false;
        }
      }
      
      const effectiveAdParam = adKeyWorking ? adParam : ''; // Only use AD if key is validated
      
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
      
      log(`🎯 Starting scoring with options:`, JSON.stringify(scoringOptions, null, 2));
      log(`📊 Input streams for scoring: ${combined.length}`);
      
      // Use new enhanced scoring system with penalty filtering
      let allScoredStreams = scoring.filterAndScoreStreams(combined, req, scoringOptions);
      
      log(`📈 Scoring complete: ${allScoredStreams.length} streams scored and ranked`);
      if (allScoredStreams.length > 0) {
        log(`🥇 Top stream: "${allScoredStreams[0].name}" (score: ${allScoredStreams[0].score})`);
        if (allScoredStreams.length > 1) {
          log(`🥈 Second stream: "${allScoredStreams[1].name}" (score: ${allScoredStreams[1].score})`);
        }
      } else {
        log(`❌ ERROR: No streams survived scoring! This is likely the root cause.`, 'error');
      }
      
      // For additional stream logic, we need access to more streams to find different resolutions
      // But for final output, we'll only use what's needed
      
      let selectedStreams;
      if (effectiveAdParam) {
        // Debrid mode: take top stream for processing, but keep all scored streams for additional stream logic
        selectedStreams = [allScoredStreams[0]].filter(Boolean); // Just the top stream initially
        log(`🔧 Debrid mode: selected top stream for processing, ${allScoredStreams.length} total available for additional stream selection`);
      } else {
        // Non-debrid mode: take top stream for processing, but keep all scored streams for additional stream logic  
        selectedStreams = [allScoredStreams[0]].filter(Boolean); // Just the top stream initially
        log(`📺 Non-debrid mode: selected top stream for processing, ${allScoredStreams.length} total available for additional stream selection`);
      }
      
      // Define originBase for URL building (used in multiple places)
      const originBase = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      
      // Step 3: Convert torrents to debrid URLs if debrid is available
      if (effectiveAdParam && selectedStreams.length > 0) {
        log(`🔧 Converting ${selectedStreams.length} torrents to AllDebrid URLs...`);
        for (const s of selectedStreams) {
          if (!s) continue;
          
          const isHttp = /^https?:/i.test(String(s.url||''));
          const isMagnetish = (!isHttp) && (!!s.infoHash || /^magnet:/i.test(String(s.url||'')));
          
          // Only convert torrents (not nuvio streams) to debrid
          if ((s.autostreamOrigin === 'torrentio' || s.autostreamOrigin === 'tpb') && (s.infoHash || isMagnetish)) {
            s._debrid = true; 
            s._isDebrid = true;
            s.url = buildPlayUrl({
              ih: s.infoHash || '',
              magnet: isMagnetish ? s.url : '',
              idx: (typeof s.fileIdx === 'number' ? s.fileIdx : 0),
              imdb: id
            }, { origin: originBase, ad: effectiveAdParam });
            
            // notWebReady flag is now handled device-aware in __finalize function
          }
        }
      } else {
        // No debrid available - use Torrentio pattern (infoHash + sources, no URLs)
        log('ℹ️ No debrid available - using Torrentio pattern for universal compatibility');
        
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
      const debridProvider = (() => {
        // Return the actual working provider name
        if (adKeyWorking) return 'ad';
        // Add other providers when their stream processing is implemented
        // if (rdKeyWorking) return 'rd';
        // if (pmKeyWorking) return 'pm';
        // if (tbKeyWorking) return 'tb';
        // if (ocKeyWorking) return 'oc';
        
        return null;
      })();
      
      // Step 5: Always process additional stream logic to ensure both primary and secondary are available
      // The additionalStreamEnabled flag will only control final visibility
      if (allScoredStreams.length > 1) {
        const primary = streams[0]; // Already processed and finalized
        const pRes = resOf(primary);
        
        // Define target resolution for additional stream
        let targetRes;
        if (pRes >= 2160) targetRes = 1080;       // 4K/2160p → 1080p
        else if (pRes >= 1080) targetRes = 720;   // 1080p → 720p  
        else if (pRes >= 720) targetRes = 480;    // 720p → 480p
        else targetRes = 0; // Don't go below 480p
        
        if (targetRes > 0) {
          // Find the best additional stream from the already scored streams
          let additional = null;
          
          // Get primary stream identifier for comparison (use infoHash for torrents)
          const primaryId = selectedStreams[0]?.infoHash || selectedStreams[0]?.url;
          
          log(`🔍 Looking for additional stream: primary is ${pRes}p, seeking ${targetRes}p`);
          
          // Look through scored streams to find target resolution (or fallback)
          for (const candidate of allScoredStreams.slice(1)) { // Skip first (primary)
            const candidateRes = resOf(candidate);
            const candidateId = candidate.infoHash || candidate.url;
            
            log(`📋 Candidate: ${candidateRes}p (${candidate.title?.substring(0, 30) || candidate.name?.substring(0, 30)}...)`, 'verbose');
            
            // Make sure it's different content and target resolution
            if (candidateRes === targetRes && candidateId !== primaryId) {
              additional = { ...candidate }; // Copy to avoid mutations
              log(`✅ Found secondary stream: ${candidate.title?.substring(0, 50) || candidate.name?.substring(0, 50) || 'Unknown'}...`);
              break;
            }
          }
          
          // If no exact target resolution found, try fallback to next lower resolution
          if (!additional && targetRes > 480) {
            const fallbackRes = targetRes === 1080 ? 720 : (targetRes === 720 ? 480 : 0);
            if (fallbackRes > 0) {
              log(`🔍 No ${targetRes}p found, trying fallback to ${fallbackRes}p`);
              for (const candidate of allScoredStreams.slice(1)) {
                const candidateRes = resOf(candidate);
                const candidateId = candidate.infoHash || candidate.url;
                
                if (candidateRes === fallbackRes && candidateId !== primaryId) {
                  additional = { ...candidate };
                  log(`✅ Found fallback secondary stream: ${candidate.title?.substring(0, 50) || candidate.name?.substring(0, 50) || 'Unknown'}...`);
                  break;
                }
              }
            }
          }
          
          if (additional) {
            // Process additional stream same way as primary was processed
            if (effectiveAdParam && (additional.autostreamOrigin === 'torrentio' || additional.autostreamOrigin === 'tpb') && additional.infoHash) {
              additional.url = buildPlayUrl({
                ih: additional.infoHash,
                magnet: additional.url && /^magnet:/i.test(additional.url) ? additional.url : '',
                idx: (typeof additional.fileIdx === 'number' ? additional.fileIdx : 0),
                imdb: id
              }, { origin: originBase, ad: effectiveAdParam });
            }
            
            // Finalize additional stream
            const finalizedAdditional = __finalize([additional], { nuvioCookie, labelOrigin }, req, actualDeviceType)[0];
            
            if (finalizedAdditional && (finalizedAdditional.url || finalizedAdditional.infoHash)) {
              // buildContentTitle will be applied later in the naming step
              const additionalRes = resOf(finalizedAdditional);
              const primaryRes = resOf(primary);
              const additionalLabel = getUserFriendlyResolution(additionalRes);
              const primaryLabel = getUserFriendlyResolution(primaryRes);
              
              // ALWAYS prepare both streams - visibility control comes at the end
              streams = [primary, finalizedAdditional];
              log(`🎯 Processed both primary(${primaryLabel}) and secondary(${additionalLabel}) streams: ${streams.length} total`);
            }
          } else {
            log(`📝 No suitable ${targetRes}p secondary stream found for additional processing`);
          }
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
            const [nextTorrResult, nextTPBResult, nextNuvioResult] = await Promise.allSettled([
              (!onlySource || onlySource === 'torrentio') ? fetchTorrentioStreams(t, i, {}, ()=>{}) : Promise.resolve([]),
              (!onlySource || onlySource === 'tpb')       ? fetchTPBStreams(t, i, {}, ()=>{})       : Promise.resolve([]),
              nuvioEnabled ? fetchNuvioStreams(t, i, { query: { direct: '1' }, cookie: nuvioCookie }, ()=>{}) : Promise.resolve([])
            ]);
            
            const nextTorr = nextTorrResult.status === 'fulfilled' ? (nextTorrResult.value || []) : [];
            const nextTPB = nextTPBResult.status === 'fulfilled' ? (nextTPBResult.value || []) : [];
            const nextNuvio = nextNuvioResult.status === 'fulfilled' ? (nextNuvioResult.value || []) : [];
            
            let rawStreams = [].concat(
              tag(nextTorr, 'torrentio'),
              tag(nextTPB, 'tpb'), 
              tag(nextNuvio, 'nuvio')
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
        console.log(`[${reqId}] ⚠️ Limited to 10 streams to prevent mobile crashes (had ${streams.length + (streams.length - 10)})`);
      }

      // Apply visibility control based on additionalStreamEnabled flag
      // Both streams are always processed, but this controls what the user sees
      if (!additionalStreamEnabled && streams.length > 1) {
        streams = streams.slice(0, 1); // Only show primary stream
        log(`🎛️ Additional stream disabled: showing only primary stream (${streams[0]?.title || 'Unknown'})`);
      } else if (streams.length > 1) {
        log(`🎛️ Additional stream enabled: showing ${streams.length} streams`);
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
        log(`⚡ Reduced cache time to 5 minutes due to penalties`);
      }

      // Send final response with streams
      log(`📤 Preparing final response for Stremio:`);
      log(`   📊 Stream count: ${streams.length}`);
      log(`   ⏰ Cache time: ${cacheTime}s`);
      log(`   🖥️  Device: ${actualDeviceType}`);
      
      if (streams.length > 0) {
        streams.forEach((stream, index) => {
          log(`   [${index + 1}] "${stream.name}" - ${stream.url ? 'HAS URL' : 'NO URL'} - notWebReady: ${!!(stream.behaviorHints && stream.behaviorHints.notWebReady)}`);
          if (actualDeviceType === 'tv') {
            log(`     📺 TV URL: ${stream.url ? stream.url.substring(0, 80) + '...' : 'NONE'}`);
          }
        });
      } else {
        log(`   ❌ NO STREAMS - this will cause infinite loading in Stremio!`, 'error');
      }
      
      res.setHeader('Cache-Control', `max-age=${cacheTime}`);
      writeJson(res, { streams });
      
      log(`✅ [${requestId}] ===== STREAM REQUEST COMPLETE =====\n`);
      
        } catch (e) {
          // Defensive error handling - prevent crashes
          console.error(`[${requestId}] ❌ Stream processing error:`, e);
          if (!res.headersSent) writeJson(res, { streams: [], error: 'Internal server error' }, 500);
        }
      }).catch(e => {
        // Concurrency limiter error handler
        console.error(`[${requestId}] ❌ Concurrency limiter error:`, e);
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
  });
  return server;
}

if (require.main === module) startServer(PORT);

module.exports = { startServer };
