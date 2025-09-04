
'use strict';

// SECURITY: Check for dangerous environment variables and refuse to use them
(function securityCheck() {
  const dangerousEnvVars = ['AD_KEY', 'ALLDEBRID_KEY', 'ALLDEBRID_API_KEY', 'AUTOSTREAM_AD_KEY'];
  const foundVars = dangerousEnvVars.filter(varName => process.env[varName]);
  
  if (foundVars.length > 0) {
    console.error('🚨 SECURITY WARNING: Dangerous environment variables detected:', foundVars);
    console.error('🚨 These variables could leak credentials to all users. They have been disabled.');
    console.error('🚨 Users must provide their own API keys via the addon configuration.');
    
    // Actively remove these variables to prevent accidental usage
    foundVars.forEach(varName => {
      delete process.env[varName];
      console.error(`🚨 Removed dangerous environment variable: ${varName}`);
    });
  }
})();

// Security functions to prevent API key leakage in logs
function sanitizeUrlForLogging(url) {
  if (!url) return url;
  return url.replace(/([?&]apikey=)[^&]+/gi, '$1***HIDDEN***');
}

function sanitizeResponseForLogging(responseData) {
  if (!responseData || typeof responseData !== 'object') return responseData;
  
  const sanitized = JSON.parse(JSON.stringify(responseData));
  
  // Remove any fields that might contain sensitive data
  const sensitiveFields = ['apikey', 'token', 'key', 'auth', 'password', 'secret'];
  
  function recursiveSanitize(obj) {
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '***HIDDEN***';
        } else if (typeof value === 'object') {
          recursiveSanitize(value);
        }
      }
    }
  }
  
  recursiveSanitize(sanitized);
  return sanitized;
}

/**
 * Click-time AllDebrid resolver.
 * - buildPlayUrl(meta, { origin, ad }) ->    // 1) upload magnet
    log('Step 1: Uploading magnet to AllDebrid...');
    try {
      const uploadUrl = 'https://api.alldebrid.com/v4/magnet/upload?apikey=' + encodeURIComponent(adKey) + '&magnets[]=' + encodeURIComponent(magnet);
      const up = await fetchWithTimeout(uploadUrl, { method: 'GET' }, 10000);
      const uploadResult = await jsonSafe(up);
      log('Upload result: ' + (uploadResult?.status || 'unknown'));
    } catch (e) {
      log('Upload error (non-fatal): ' + e.message);
    }play URL
 * - handlePlay(req, res, MANIFEST_DEFAULTS) -> resolves magnet on click, redirects to unlocked file.
 */

let fetchWithTimeout;
try { ({ fetchWithTimeout } = require('../utils/http')); }
catch {
  fetchWithTimeout = async (url, init, ms) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms || 12000);
    try { return await fetch(url, { ...(init||{}), signal: ac.signal }); }
    finally { clearTimeout(t); }
  };
}

function discoverADKey(params, defaults, headers) {
  const usp = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const get = (k)=> (usp.get(k) || '').trim();
  const headerKey = headers && (headers['x-ad-key'] || headers['authorization'] && headers['authorization'].replace(/^bearer\s+/i,'').trim()) || '';
  // SECURITY FIX: Removed environment variable fallbacks to prevent accidental credential sharing
  // OLD CODE: return get('ad') || get('apikey') || get('alldebrid') || get('ad_apikey') || defaults.ad || headerKey || process.env.ALLDEBRID_KEY || process.env.AD_KEY || '';
  return get('ad') || get('apikey') || get('alldebrid') || get('ad_apikey') || defaults.ad || headerKey || '';
}

function buildPlayUrl(meta, { origin, ad }) {
  const u = new URL('/play', origin.replace(/\/+$/,''));
  if (meta && meta.ih) u.searchParams.set('ih', meta.ih);
  if (meta && meta.magnet) u.searchParams.set('magnet', meta.magnet);
  if (typeof meta?.idx === 'number') u.searchParams.set('idx', String(meta.idx));
  if (meta && meta.imdb) u.searchParams.set('imdb', meta.imdb);
  if (ad) u.searchParams.set('ad', ad);
  return u.toString();
}

async function jsonSafe(res){ try{ return await res.json(); } catch{ return null; } }
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

// Simple cache to avoid re-resolving the same magnet multiple times
const resolveCache = new Map();

async function handlePlay(req, res, defaults = {}) {
  // Generate unique request ID for proper isolation
  const reqId = Math.random().toString(36).substr(2, 9);
  const log = (msg) => console.log(`[${reqId}] ${msg}`);
  
  // Only log for the first request, not subsequent range requests
  const isRangeRequest = req.headers.range;
  const isFirstRequest = !isRangeRequest || req.headers.range === 'bytes=0-';
  
  if (isFirstRequest) {
    log('🎬 Debrid play request');
  }
  
  try {
    const url = new URL(req.url, 'http://localhost:7010');
    const usp = url.searchParams;
    
    if (isFirstRequest) {
      log('Query params: ' + JSON.stringify(Object.fromEntries(usp), null, 2));
    }
    
    const adKey = discoverADKey(usp, defaults, req.headers);
    if (!adKey) {
      if (isFirstRequest) log('ERROR: No AllDebrid API key found');
      res.writeHead(401, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:false, err:'AllDebrid API key required' }));
    }
    if (isFirstRequest) log('AD Key found: YES');
    
    const ih = usp.get('ih') || '';
    const magnet = usp.get('magnet') || `magnet:?xt=urn:btih:${ih}`;
    const idx = parseInt(usp.get('idx') || '0', 10);
    const imdb = usp.get('imdb') || '';
    
    // Create cache key
    const cacheKey = `${ih}_${idx}`;
    
    // Check cache first
    if (resolveCache.has(cacheKey)) {
      const cached = resolveCache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < 300000) { // 5 minutes cache
        if (isFirstRequest) log(`🚀 Using cached URL (${Math.round(age/1000)}s old)`);
        res.writeHead(302, { 'Location': cached.url });
        return res.end();
      } else {
        resolveCache.delete(cacheKey); // Expired
      }
    }
    
    if (isFirstRequest) {
      log('Extracted data:');
      log('  InfoHash: ' + ih);
      log('  Magnet: ' + magnet.substring(0, 60) + '...');
      log('  File Index: ' + idx);
      if (imdb) log('  IMDB: ' + imdb);
    }

    // 1) upload
    if (isFirstRequest) log('Step 1: Uploading magnet to AllDebrid...');
    let uploadSuccess = false;
    try {
      const uploadUrl = 'https://api.alldebrid.com/v4/magnet/upload?apikey=' + encodeURIComponent(adKey) + '&magnets[]=' + encodeURIComponent(magnet);
      const up = await fetchWithTimeout(uploadUrl, { method: 'GET' }, 10000);
      
      if (isFirstRequest) {
        log('Upload response status: ' + up.status);
        log('Upload response ok: ' + up.ok);
      }
      
      const uploadResult = await jsonSafe(up);
      
      if (isFirstRequest) {
        if (uploadResult && uploadResult.status === 'success') {
          log('Upload result: success');
          uploadSuccess = true;
        } else {
          log('Upload result: ' + (uploadResult?.status || 'failed'));
          if (uploadResult?.error) {
            log('Upload error details: ' + JSON.stringify(uploadResult.error));
            
            // Check for permanent upload errors
            const errorCode = uploadResult.error.code;
            const permanentUploadErrors = [
              'MAGNET_MUST_BE_PREMIUM',
              'AUTH_BLOCKED',
              'AUTH_BAD_APIKEY', 
              'AUTH_USER_BANNED'
            ];
            
            if (permanentUploadErrors.includes(errorCode)) {
              log('❌ Permanent upload error: ' + errorCode + ' - stopping immediately');
              res.writeHead(400, {'Content-Type':'application/json'});
              return res.end(JSON.stringify({ 
                ok: false, 
                error: errorCode,
                message: uploadResult.error.message || 'AllDebrid service error',
                permanent: true 
              }));
            }
          }
          if (uploadResult?.message) {
            log('Upload message: ' + uploadResult.message);
          }
          if (!uploadResult) {
            log('Upload result was null/undefined - possible network issue');
          }
          // Log the full response for debugging on Render (SANITIZED FOR SECURITY)
          log('Full upload response: ' + JSON.stringify(sanitizeResponseForLogging(uploadResult)));
        }
      }
    } catch (e) {
      if (isFirstRequest) {
        log('Upload error (exception): ' + e.message);
        log('Upload error stack: ' + e.stack);
      }
    }

    // 2) poll a few times for files
    if (isFirstRequest) log('Step 2: Polling for files...');
    let files = [];
    let magnetId = null; // Store the actual magnet ID from status response
    
    for (let i=0;i<4;i++){ // Reduce from 6 to 4 iterations (~2s total)
      if (isFirstRequest && i === 0) log(`Polling for files...`);
      try {
        const statusUrl = 'https://api.alldebrid.com/v4/magnet/status?apikey=' + encodeURIComponent(adKey) + '&id=' + encodeURIComponent(ih || magnet);
        const st = await fetchWithTimeout(statusUrl, { method: 'GET' }, 10000);
        const sj = await jsonSafe(st);
        
        log('Status response: status=' + st.status + ', ok=' + st.ok + ', body=' + JSON.stringify(sanitizeResponseForLogging(sj)));
        
        // Check for permanent errors that should stop polling immediately
        if (sj && sj.status === 'error' && sj.error && sj.error.code) {
          const errorCode = sj.error.code;
          const permanentErrors = [
            'MAGNET_MUST_BE_PREMIUM',
            'AUTH_BLOCKED',
            'AUTH_BAD_APIKEY', 
            'AUTH_USER_BANNED',
            'MAGNET_TOO_MANY',
            'MAGNET_INVALID_ID'
          ];
          
          if (permanentErrors.includes(errorCode)) {
            log('❌ Permanent AllDebrid error: ' + errorCode + ' - ' + (sj.error.message || 'Unknown error'));
            log('Stopping polling - this error cannot be resolved by waiting');
            
            // Return appropriate error response
            res.writeHead(400, {'Content-Type':'application/json'});
            return res.end(JSON.stringify({ 
              ok: false, 
              error: errorCode,
              message: sj.error.message || 'AllDebrid service error',
              permanent: true 
            }));
          }
        }
        
        if (sj && sj.status === 'success' && sj.data && Array.isArray(sj.data.magnets)) {
          // Find the magnet that matches our hash
          const targetHash = (ih || '').toLowerCase();
          const matchingMagnet = sj.data.magnets.find(m => 
            m && m.hash && m.hash.toLowerCase() === targetHash
          );
          
          if (matchingMagnet) {
            log('Found matching magnet: ' + matchingMagnet.id + ' ' + matchingMagnet.hash + ' status=' + matchingMagnet.status);
            magnetId = matchingMagnet.id;
            
            if (matchingMagnet.status === 'Ready' && matchingMagnet.links && matchingMagnet.links.length > 0) {
              // Extract files from the magnet links - each link represents a separate file
              files = matchingMagnet.links.map(link => ({
                name: link.filename || 'Unknown',
                size: link.size || 0,
                link: link.link
              }));
              
              log('Found files via status (Ready magnet): ' + files.length);
              break;
            }
          } else {
            log('No matching magnet found for hash: ' + targetHash + ', available magnets: ' + sj.data.magnets.map(m => m.hash).join(','));
          }
        } else {
          log('Invalid status response structure: ' + JSON.stringify(sj));
        }
      } catch (e) {
        log('Status API error: ' + e.message + ', stack: ' + e.stack);
      }
      
      // If we have a magnet ID, try the Files API with the correct ID
      if (magnetId) {
        try {
          const filesUrl = 'https://api.alldebrid.com/v4/magnet/files?apikey=' + encodeURIComponent(adKey) + '&id=' + encodeURIComponent(magnetId);
          const f = await fetchWithTimeout(filesUrl, { method: 'GET' }, 10000);
          const fj = await jsonSafe(f);
          
          log('Files API response (with ID): status=' + f.status + ', ok=' + f.ok + ', body=' + JSON.stringify(sanitizeResponseForLogging(fj)));
          
          if (fj && fj.status === 'success' && fj.data && Array.isArray(fj.data.files) && fj.data.files.length) { 
            log('Found files via files API: ' + fj.data.files.length);
            files = fj.data.files; 
            break; 
          }
        } catch (e) {
          log('Files API error: ' + e.message + ', stack: ' + e.stack);
        }
      } else {
        // Fallback: try Files API with hash/magnet (will likely fail but worth trying)
        try {
          const filesUrl = 'https://api.alldebrid.com/v4/magnet/files?apikey=' + encodeURIComponent(adKey) + '&id=' + encodeURIComponent(ih || magnet);
          const f = await fetchWithTimeout(filesUrl, { method: 'GET' }, 10000);
          const fj = await jsonSafe(f);
          
          log('Files API response (fallback): status=' + f.status + ', ok=' + f.ok + ', body=' + JSON.stringify(sanitizeResponseForLogging(fj)));
          
          if (fj && fj.status === 'success' && fj.data && Array.isArray(fj.data.files) && fj.data.files.length) { 
            log('Found files via files API (fallback): ' + fj.data.files.length);
            files = fj.data.files; 
            break; 
          }
        } catch (e) {
          log('Files API error (fallback): ' + e.message + ', stack: ' + e.stack);
        }
      }
      
      log('No files found, sleeping 500ms...');
      await sleep(500);
    }

    if (!files.length) {
      // Caching started but no file yet
      log('ERROR: No files found after polling');
      res.writeHead(404, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:false, caching:true, msg:'Debrid is caching the magnet; try again shortly' }));
    }

    log('Step 3: Selecting best file...');
    
    // pick file (idx preferred, else largest mkv/mp4/avi, else largest)
    let chosen = null;
    const videoRe = /\.(mkv|mp4|m4v|avi|mov|ts|flv|webm)$/i;
    
    // First, filter out obviously non-video files
    const videoFiles = files.filter(f => {
      if (!f || !f.link) return false;
      const name = f.name || f.path || '';
      const size = f.size || 0;
      
      // Skip very small files (likely text files, subs, etc.)
      if (size < 50 * 1024 * 1024) return false; // Less than 50MB
      
      // Skip known non-video files
      if (/\.(txt|nfo|sub|srt|idx|sup|url|jpg|png|jpeg|gif)$/i.test(name)) return false;
      if (/readme|sample|trailer|extras|bonus/i.test(name)) return false;
      
      return videoRe.test(name);
    });
    
    log(`Found ${videoFiles.length} video files from ${files.length} total`);
    
    if (Number.isFinite(idx) && idx >= 0 && idx < videoFiles.length) {
      chosen = videoFiles[idx];
      log('Chosen file by index: ' + chosen.name);
    }
    
    if (!chosen && videoFiles.length > 0) {
      chosen = videoFiles.sort((a,b)=> (b.size||0)-(a.size||0))[0];
      log('Chosen largest video file: ' + chosen.name);
    }
    
    // Fallback to any file with link if no video files found
    if (!chosen) {
      const anyFiles = files.filter(f => f && f.link && (f.size || 0) > 10 * 1024 * 1024); // At least 10MB
      chosen = anyFiles.sort((a,b)=> (b.size||0)-(a.size||0))[0] || null;
      log('Chosen by size fallback: ' + (chosen?.name || 'none'));
    }
    if (!chosen || !chosen.link) {
      log('ERROR: No playable file found');
      res.writeHead(404, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:false, caching:true, msg:'No playable file yet' }));
    }

    log('Step 4: Unlocking direct link...');

    // 3) unlock direct link
    let finalUrl = chosen.link;
    try {
      const unlockUrl = 'https://api.alldebrid.com/v4/link/unlock?apikey=' + encodeURIComponent(adKey) + '&link=' + encodeURIComponent(chosen.link);
      const unl = await fetchWithTimeout(unlockUrl, { method: 'GET' }, 10000);
      const uj = await jsonSafe(unl);
      
      log('Unlock response: status=' + unl.status + ', ok=' + unl.ok + ', body=' + JSON.stringify(sanitizeResponseForLogging(uj)));
      
      finalUrl = (uj && uj.status === 'success' && uj.data && (uj.data.link || uj.data.download || uj.data.downloadLink)) || finalUrl;
      log('✅ Unlocked successfully, final URL length: ' + finalUrl.length);
    } catch (e) {
      log('Unlock error (non-fatal): ' + e.message + ', stack: ' + e.stack);
    }

    // Cache the result for future requests
    resolveCache.set(cacheKey, {
      url: finalUrl,
      timestamp: Date.now()
    });

    log('Step 5: Redirecting to final URL...');
    // redirect to file
    res.writeHead(302, { 'Location': finalUrl });
    return res.end();
  } catch (e) {
    log('FATAL ERROR in handlePlay: ' + e.message);
    log('Stack trace: ' + e.stack);
    try { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:false, err:String(e) })); } catch {}
  }
}

module.exports = { buildPlayUrl, handlePlay };
