
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
  catch { return { beautifyStreamName: (s)=>s.name||'Stream', shouldShowOriginTags: ()=>false, buildContentTitle: ()=>'Content' }; }
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
function __finalize(list, { nuvioCookie, labelOrigin }) {
  let out = Array.isArray(list) ? list.slice() : [];
  out.forEach(s => {
    if (!s) return;
    
    // First try existing URLs
    s.url = s.url || s.externalUrl || s.link || (s.sources && s.sources[0] && s.sources[0].url) || '';
    
    // For web Stremio compatibility: if we have infoHash, don't set magnet URL
    // Web Stremio prefers infoHash-only streams for torrent handling
    if (s.infoHash && (!s.url || /^magnet:/i.test(s.url))) {
      // Keep infoHash, remove magnet URL for web compatibility
      delete s.url;
    }
    
    const isHttp = /^https?:/i.test(String(s.url||''));
    const isMagnet = !isHttp && (s.infoHash || /^magnet:/i.test(String(s.url||'')));
    // Web Stremio can handle magnet URLs just fine - remove notWebReady flag if present
    if (s.behaviorHints && s.behaviorHints.notWebReady) {
      delete s.behaviorHints.notWebReady;
    }
    if (s.autostreamOrigin === 'nuvio' && nuvioCookie) s._usedCookie = true;
  });
  out = attachNuvioCookie(out, nuvioCookie);
  if (labelOrigin) out.forEach(s => s.name = badgeName(s));
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
  if (/\b(2160p|2160|4k|uhd)\b/.test(t)) return 2160;
  if (/\b(1080p|1080|fhd)\b/.test(t)) return 1080;
  if (/\b(720p|720|hd)\b/.test(t)) return 720;
  if (/\b(480p|480|sd)\b/.test(t)) return 480;
  return 0;
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
        return res.end('<!DOCTYPE html><html><head><title>AutoStream</title></head><body><h1>AutoStream Addon</h1><p>Running and ready.</p></body></html>');
      }
      
      if (pathname === '/status') return writeJson(res, { status: 'ok', addon: 'AutoStream', version: '3.2.3' }, 200);

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
      if (pathname === '/play') return handlePlay(req, res, MANIFEST_DEFAULTS);

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
          version: '3.2.3,
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
          // ============ MAIN STREAM PROCESSING (WITH DEFENSIVE PROTECTIONS) ============

      const labelOrigin = q.get('label_origin') === '1';
      const onlySource = (q.get('only') || '').toLowerCase();
      const nuvioCookie = sanitizeCookieVal(getQ(q,'nuvio_cookie') || getQ(q,'dcookie') || getQ(q,'cookie') || MANIFEST_DEFAULTS.nuvio_cookie || MANIFEST_DEFAULTS.dcookie || MANIFEST_DEFAULTS.cookie || '');
      
      // Generate unique request ID for log isolation
      const reqId = Math.random().toString(36).substr(2, 9);
      
      // Enhanced logging with levels
      const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';
      const log = (msg, level = 'info') => {
        if (level === 'verbose' && !VERBOSE_LOGGING) return;
        console.log(`[${reqId}] ${msg}`);
      };
      
      // Apply ID correction for known problematic IDs
      const { enhancedIDProcessing } = (() => {
        try { return require('./utils/id-correction'); }
        catch { return { enhancedIDProcessing: async (id) => ({ id, corrected: false }) }; }
      })();
      
      // Correct the ID if needed (this is where tt13623136 becomes tt13159924)
      const idResult = await enhancedIDProcessing(id, fetchMeta, (msg) => log(`ID: ${msg}`));
      const actualId = idResult.id;
      
      if (idResult.corrected) {
        log(`📍 Stream request: ${type}/${id} → ${actualId} (corrected)`);
      } else {
        log(`📍 Stream request: ${type}/${actualId}`);
      }
      
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
      const metaPromise = fetchMeta(type, actualId, (msg) => log('Meta: ' + msg, 'verbose'));

      // which sources
      const dhosts = String(getQ(q,'dhosts') || MANIFEST_DEFAULTS.dhosts || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      const nuvioEnabled = dhosts.includes('nuvio') || q.get('nuvio') === '1' || q.get('include_nuvio') === '1' || MANIFEST_DEFAULTS.nuvio === '1' || MANIFEST_DEFAULTS.include_nuvio === '1' || onlySource === 'nuvio' || 
                          (!onlySource && dhosts.length === 0); // Enable by default when no specific sources requested

      // fetch sources (no debrid here) - parallel execution with timeout for faster response
      log('🚀 Fetching streams from sources...');
      const sourcePromises = [
        (!onlySource || onlySource === 'torrentio') ? fetchTorrentioStreams(type, actualId, {}, (msg) => log('Torrentio: ' + msg, 'verbose')) : Promise.resolve([]),
        (!onlySource || onlySource === 'tpb')       ? fetchTPBStreams(type, actualId, {}, (msg) => log('TPB+: ' + msg, 'verbose'))       : Promise.resolve([]),
        nuvioEnabled ? fetchNuvioStreams(type, actualId, { query: { direct: '1' }, cookie: nuvioCookie }, (msg) => log('Nuvio: ' + msg, 'verbose')) : Promise.resolve([])
      ];
      
      // Use Promise.allSettled() with timeout for sources
      const [torrentioResult, tpbResult, nuvioResult] = await Promise.allSettled(sourcePromises);
      
      // Extract results with graceful fallback - failed sources return empty arrays
      const fromTorr = torrentioResult.status === 'fulfilled' ? (torrentioResult.value || []) : [];
      const fromTPB = tpbResult.status === 'fulfilled' ? (tpbResult.value || []) : [];
      const fromNuvio = nuvioResult.status === 'fulfilled' ? (nuvioResult.value || []) : [];
      
      // Try to get meta quickly, but don't wait long
      let finalMeta;
      try {
        finalMeta = await Promise.race([
          metaPromise,
          new Promise((resolve) => setTimeout(() => resolve({
            name: id.startsWith('tt') ? `Title ${id}` : id, 
            season: null, 
            episode: null 
          }), 1000)) // Fallback after 1 second
        ]);
      } catch (e) {
        finalMeta = { 
          name: id.startsWith('tt') ? `Title ${id}` : id, 
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

      if (combined.length === 0) {
        log('⚠️  No streams found from any source');
        
        // Instead of returning empty array (which causes infinite loading),
        // return a helpful message stream explaining the issue
        const messageStream = {
          name: "🚫 No Streams Available",
          title: `No streams found for this content. This may be because:\n• Content is too new or not yet indexed\n• Episode is not available on current sources\n• Try checking back later or use different sources`,
          url: "data:text/plain;charset=utf-8,No%20streams%20available%20for%20this%20content",
          behaviorHints: {
            notWebReady: true,
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
        debug: false // Set to true for detailed scoring logs
      };
      
      // Use new enhanced scoring system with penalty filtering
      let allScoredStreams = scoring.filterAndScoreStreams(combined, req, scoringOptions);
      
      // ALWAYS select both primary and secondary streams for processing
      // The additionalStreamEnabled flag will only control final visibility, not processing
      const processingLimit = 2; // Always process top 2 streams to ensure both primary and secondary are available
      
      let selectedStreams;
      if (effectiveAdParam) {
        // Debrid mode: take top 2 streams for processing (visibility controlled later)
        selectedStreams = allScoredStreams.slice(0, processingLimit);
        log(`🔧 Debrid mode: selected top ${selectedStreams.length} streams for processing`);
      } else {
        // Non-debrid mode: take top 2 streams for processing (visibility controlled later)
        selectedStreams = allScoredStreams.slice(0, processingLimit);
        log(`📺 Non-debrid mode: selected top ${selectedStreams.length} streams for processing`);
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
            
            // Note: Removed notWebReady flag to fix playback issues in Stremio v5
            // s.behaviorHints = Object.assign({}, s.behaviorHints, { notWebReady: true });
          }
        }
      } else {
        // No debrid available - keep ALL streams (magnets + direct)
        log('ℹ️ No debrid available - providing raw magnet URLs for external torrent clients');
      }

      // Step 4: Apply beautified names and finalize
      let streams = __finalize(selectedStreams, { nuvioCookie, labelOrigin });
      
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
        
        // Remove notWebReady flag - web Stremio can handle magnet URLs fine
        if (s.behaviorHints && s.behaviorHints.notWebReady) {
          delete s.behaviorHints.notWebReady;
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
      
      // Apply beautified names and titles
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
          
          // Set content title (e.g., "KPop Demon Hunters (2025) - 4K")
          s.title = buildContentTitle(finalMeta.name, s, { type, id: actualId });
        }
      });

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
          
          // Look through scored streams to find target resolution
          for (const candidate of allScoredStreams.slice(1)) { // Skip first (primary)
            const candidateRes = resOf(candidate);
            const candidateId = candidate.infoHash || candidate.url;
            
            // Make sure it's different content and target resolution
            if (candidateRes === targetRes && candidateId !== primaryId) {
              additional = { ...candidate }; // Copy to avoid mutations
              break;
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
            const finalizedAdditional = __finalize([additional], { nuvioCookie, labelOrigin })[0];
            
            if (finalizedAdditional && (finalizedAdditional.url || finalizedAdditional.infoHash)) {
              // Apply same beautification as primary
              finalizedAdditional.name = beautifyStreamName(finalizedAdditional, { 
                type, 
                id, 
                includeOriginTag: showOriginTags,
                debridProvider 
              });
              
              finalizedAdditional.title = buildContentTitle(finalMeta.name, finalizedAdditional, { type, id: actualId });
              
              // ALWAYS prepare both streams - visibility control comes at the end
              streams = [primary, finalizedAdditional];
              log(`🎯 Processed both primary and secondary streams: ${streams.length} total`);
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

      // Final cleanup: Remove notWebReady flags - web Stremio can handle magnet URLs
      streams.forEach(s => {
        if (s && s.behaviorHints && s.behaviorHints.notWebReady) {
          delete s.behaviorHints.notWebReady;
        }
      });

      // Apply visibility control based on additionalStreamEnabled flag
      // Both streams are always processed, but this controls what the user sees
      if (!additionalStreamEnabled && streams.length > 1) {
        streams = streams.slice(0, 1); // Only show primary stream
        log(`🎛️ Additional stream disabled: showing only primary stream (${streams[0]?.title || 'Unknown'})`);
      } else if (streams.length > 1) {
        log(`🎛️ Additional stream enabled: showing ${streams.length} streams`);
      }

      // Reduce cache time if we filtered problematic URLs or have penalties
      // EXPERIMENTAL: Test if caching causes URL expiry for specific content
      // Disable caching for Gen V to test if our caching triggers immediate expiry
      const isGenV = id.includes('tt13623136');
      const hasPenalties = Object.keys(penaltyReliability.getState().penalties || {}).length > 0;
      let cacheTime = 3600; // Default: 1 hour
      
      if (isGenV) {
        cacheTime = 0; // No cache for Gen V - always fetch fresh
        log(`🧪 EXPERIMENTAL: Disabled caching for Gen V to test if caching triggers URL expiry`);
      } else if (hasPenalties) {
        cacheTime = 300; // 5 minutes with penalties
        log(`⚡ Reduced cache time to 5 minutes due to penalties`);
      }

      return writeJson(res, { streams, cacheMaxAge: cacheTime, staleRevalidate: 21600, staleError: 86400 }, 200);
        
        } catch (e) {
          // Defensive error handling - prevent crashes
          console.error('Stream processing error:', e);
          if (!res.headersSent) writeJson(res, { streams: [], error: 'Internal server error' }, 500);
        }
      }).catch(e => {
        // Concurrency limiter error handler
        console.error('Concurrency limiter error:', e);
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
  });
  return server;
}

if (require.main === module) startServer(PORT);

module.exports = { startServer };
