
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
  'ad','apikey','alldebrid','ad_apikey',
  'cookie','nuvio_cookie','dcookie',
  'include_nuvio','nuvio','dhosts','nuvio_base',
  'label_origin','lang_prio','max_size','debrid','rd','pm','tb','oc','fallback'
]);

// Cache for AllDebrid API key validation
const adKeyValidationCache = new Map(); // key -> { isValid: boolean, timestamp: number }

// utils
function setCors(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, X-Requested-With');
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
  catch (e1) { try { return require('./debrid'); }
  catch (e2) { return { buildPlayUrl: ()=>null, handlePlay: async (req,res)=>{ res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,err:'debrid missing'})); } }; } }
})();
const { buildPlayUrl, handlePlay } = clickDebrid;

// Import enhanced formatting and series caching
const { fetchMeta } = (() => {
  try { return require('./services/meta'); }
  catch { 
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
    
    // If no URL but has infoHash, create magnet URL for non-debrid users
    if (!s.url && s.infoHash) {
      s.url = `magnet:?xt=urn:btih:${s.infoHash}`;
      if (s.title) {
        s.url += `&dn=${encodeURIComponent(s.title)}`;
      }
    }
    
    const isHttp = /^https?:/i.test(String(s.url||''));
    const isMagnet = !isHttp && (s.infoHash || /^magnet:/i.test(String(s.url||'')));
    if (isMagnet) s.behaviorHints = Object.assign({}, s.behaviorHints, { notWebReady: true });
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

function getQ(q, k){ return (q && typeof q.get==='function' && q.get(k)) || MANIFEST_DEFAULTS[k] || ''; }
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

      // Penalty reliability API endpoints
      if (pathname === '/reliability/stats') {
        return writeJson(res, scoring.getReliabilityStats());
      }

      if (pathname === '/reliability/clear' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { url } = JSON.parse(body);
            const success = url ? penaltyReliability.clearPenalty(url) : penaltyReliability.clearAllPenalties();
            writeJson(res, { success });
          } catch (e) {
            writeJson(res, { success: false, error: e.message }, 400);
          }
        });
        return;
      }

      if (pathname === '/reliability/penalties') {
        const penalties = penaltyReliability.getAllPenalties();
        return writeJson(res, { penalties });
      }

      // /play — click-time debrid resolver
      if (pathname === '/play') return handlePlay(req, res, MANIFEST_DEFAULTS);

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
        MANIFEST_DEFAULTS = Object.assign({}, MANIFEST_DEFAULTS, remembered);
        
        // Validate AllDebrid key if provided to ensure it actually works
        const adKey = remembered.ad || MANIFEST_DEFAULTS.ad || paramsObj.ad || paramsObj.apikey || paramsObj.alldebrid || paramsObj.ad_apikey;
        let adKeyWorking = false;
        if (adKey) {
          try {
            adKeyWorking = await validateAllDebridKey(adKey);
          } catch (e) {
            console.log('AllDebrid key validation failed:', e.message);
            adKeyWorking = false;
          }
        }
        
        // Build the tag based on WORKING debrid services (not just configured ones)
        const tag = (()=>{
          if (adKeyWorking) return 'AD';
          if (remembered.rd || MANIFEST_DEFAULTS.rd || paramsObj.rd || paramsObj['real-debrid'] || paramsObj.realdebrid) return 'RD';
          if (remembered.pm || MANIFEST_DEFAULTS.pm || paramsObj.pm || paramsObj.premiumize) return 'PM';
          if (remembered.tb || MANIFEST_DEFAULTS.tb || paramsObj.tb || paramsObj.torbox) return 'TB';
          if (remembered.oc || MANIFEST_DEFAULTS.oc || paramsObj.oc || paramsObj.offcloud) return 'OC';
          return null;
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
          version: '3.0.0',
          name: tag ? `AutoStream (${tag})` : 'AutoStream',
          description: 'Curated best-pick streams with optional debrid; Nuvio direct-host supported.',
          logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
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
        
        // Add query string to resources if we have parameters
        if (queryString) {
          manifest.resources[0].endpoint = `${baseUrl}/stream/{type}/{id}.json?${queryString}`;
        }
        
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

      const labelOrigin = q.get('label_origin') === '1';
      const onlySource = (q.get('only') || '').toLowerCase();
      const nuvioCookie = sanitizeCookieVal(getQ(q,'nuvio_cookie') || getQ(q,'dcookie') || getQ(q,'cookie') || MANIFEST_DEFAULTS.nuvio_cookie || MANIFEST_DEFAULTS.dcookie || MANIFEST_DEFAULTS.cookie || '');
      
      // Generate unique request ID for log isolation
      const reqId = Math.random().toString(36).substr(2, 9);
      const log = (msg) => console.log(`[${reqId}] ${msg}`);
      
      log(`📍 Stream request: ${type}/${id}`);
      
      // Parse enhanced configuration parameters
      const langPrioStr = getQ(q, 'lang_prio') || MANIFEST_DEFAULTS.lang_prio || '';
      const preferredLanguages = langPrioStr ? langPrioStr.split(',').map(l => l.trim()).filter(Boolean) : [];
      const maxSizeStr = getQ(q, 'max_size') || MANIFEST_DEFAULTS.max_size || '';
      const maxSizeBytes = maxSizeStr ? parseFloat(maxSizeStr) * (1024 ** 3) : 0; // Convert GB to bytes
      const fallbackEnabled = getQ(q, 'fallback') === '1' || MANIFEST_DEFAULTS.fallback === '1';
      const conserveCookie = getQ(q, 'conserve_cookie') !== '0'; // Default to true unless explicitly disabled

      // Fetch metadata for proper titles (async, don't block stream fetching)
      const metaPromise = fetchMeta(type, id, (msg) => log('Meta: ' + msg));

      // which sources
      const dhosts = String(getQ(q,'dhosts') || MANIFEST_DEFAULTS.dhosts || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      const nuvioEnabled = dhosts.includes('nuvio') || q.get('nuvio') === '1' || q.get('include_nuvio') === '1' || MANIFEST_DEFAULTS.nuvio === '1' || MANIFEST_DEFAULTS.include_nuvio === '1' || onlySource === 'nuvio' || 
                          (!onlySource && dhosts.length === 0); // Enable by default when no specific sources requested

      // fetch sources (no debrid here) - parallel execution with timeout for faster response
      log('🚀 Fetching streams from sources...');
      const sourcePromises = [
        (!onlySource || onlySource === 'torrentio') ? fetchTorrentioStreams(type, id, {}, (msg) => log('Torrentio: ' + msg)) : Promise.resolve([]),
        (!onlySource || onlySource === 'tpb')       ? fetchTPBStreams(type, id, {}, (msg) => log('TPB+: ' + msg))       : Promise.resolve([]),
        nuvioEnabled ? fetchNuvioStreams(type, id, { query: { direct: '1' }, cookie: nuvioCookie }, (msg) => log('Nuvio: ' + msg)) : Promise.resolve([])
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
      if (torrentioResult.status === 'rejected') log('⚠️  Torrentio failed: ' + (torrentioResult.reason?.message || 'Unknown error'));
      if (tpbResult.status === 'rejected') log('⚠️  TPB+ failed: ' + (tpbResult.reason?.message || 'Unknown error'));
      if (nuvioResult.status === 'rejected') log('⚠️  Nuvio failed: ' + (nuvioResult.reason?.message || 'Unknown error'));
      
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

      if (combined.length === 0) {
        log('⚠️  No streams found from any source');
        writeJson(res, { streams: [] });
        return;
      }

      // Skip pre-filtering for better performance - apply scoring directly
      log(`📊 Processing ${combined.length} streams from all sources`);

      // CRITICAL FIX: Don't auto-convert ALL torrents to debrid
      // Instead, let sources compete first, then convert winners to debrid URLs
      // SECURITY: Only use API keys explicitly provided by users, never from environment
      const adParam = (getQ(q,'ad') || getQ(q,'apikey') || getQ(q,'alldebrid') || getQ(q,'ad_apikey') || MANIFEST_DEFAULTS.ad || '');
      
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
        debug: false // Set to true for detailed scoring logs
      };
      
      // Use new enhanced scoring system with penalty filtering
      let allScoredStreams = scoring.filterAndScoreStreams(combined, req, scoringOptions);
      
      // Apply stream limits based on fallback setting
      const streamLimit = fallbackEnabled ? 4 : 2; // Show 2 streams by default, 4 with fallback
      let selectedStreams = allScoredStreams.slice(0, streamLimit);
      
      // Define originBase for URL building (used in multiple places)
      const originBase = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
      
      // Step 3: NOW convert torrent winners to debrid URLs (only the selected ones)
      if (effectiveAdParam && selectedStreams.length > 0) {
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
      }

      // Step 4: Apply beautified names and finalize
      let streams = __finalize(selectedStreams, { nuvioCookie, labelOrigin });
      
      // Detect which debrid provider is being used (only if actually working)
      const debridProvider = (() => {
        if (effectiveAdParam) return 'ad'; // Only show AD if key is validated and working
        if (getQ(q,'rd') || getQ(q,'real-debrid') || getQ(q,'realdebrid') || MANIFEST_DEFAULTS.rd || MANIFEST_DEFAULTS['real-debrid'] || MANIFEST_DEFAULTS.realdebrid) return 'rd';
        if (getQ(q,'pm') || getQ(q,'premiumize') || MANIFEST_DEFAULTS.pm || MANIFEST_DEFAULTS.premiumize) return 'pm';
        if (getQ(q,'tb') || getQ(q,'torbox') || MANIFEST_DEFAULTS.tb || MANIFEST_DEFAULTS.torbox) return 'tb';
        if (getQ(q,'oc') || getQ(q,'offcloud') || MANIFEST_DEFAULTS.oc || MANIFEST_DEFAULTS.offcloud) return 'oc';
        return null; // No working debrid provider
      })();
      
      // Apply beautified names and titles
      const showOriginTags = shouldShowOriginTags(labelOrigin);
      streams.forEach(s => {
        if (s && s.url) {
          // Set addon name (e.g., "AutoStream (AD)")
          s.name = beautifyStreamName(s, { 
            type, 
            id, 
            includeOriginTag: showOriginTags,
            debridProvider 
          });
          
          // Set content title (e.g., "KPop Demon Hunters (2025) - 4K")
          s.title = buildContentTitle(finalMeta.name, s, { type, id });
        }
      });

      // Step 5: Simple additional stream logic
      if (fallbackEnabled && allScoredStreams.length > 1) {
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
            
            if (finalizedAdditional && finalizedAdditional.url) {
              // Apply same beautification as primary
              finalizedAdditional.name = beautifyStreamName(finalizedAdditional, { 
                type, 
                id, 
                includeOriginTag: showOriginTags,
                debridProvider 
              });
              
              finalizedAdditional.title = buildContentTitle(finalMeta.name, finalizedAdditional, { type, id });
              
              streams = [primary, finalizedAdditional];
            }
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
            const streamLimit = fallbackEnabled ? 4 : 2; // Show 2 streams by default, 4 with fallback
            const processedStreams = allScoredStreams.slice(0, streamLimit);
            
            // Cache only the final processed streams (top 1-4), not all raw streams
            return processedStreams;
          } catch (error) {
            console.warn('Preload processing failed:', error.message);
            return [];
          }
        }).catch(err => console.warn('Preload failed:', err.message));
      }

      return writeJson(res, { streams, cacheMaxAge: 3600, staleRevalidate: 21600, staleError: 86400 }, 200);
    } catch (e) {
      console.error('Server error:', e && e.stack || e);
      if (!res.headersSent) writeJson(res, { streams: [] }, 200);
      else { try { res.end(); } catch {} }
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
