
'use strict';

// SECURITY: Check for dangerous environment variables and refuse to use them
(function securityCheck() {
  const dangerousEnvVars = [
    'AD_KEY', 'ALLDEBRID_KEY', 'ALLDEBRID_API_KEY', 'AUTOSTREAM_AD_KEY',
    'RD_KEY', 'REALDEBRID_KEY', 'REALDEBRID_API_KEY', 
    'PM_KEY', 'PREMIUMIZE_KEY', 'PREMIUMIZE_API_KEY',
    'TB_KEY', 'TORBOX_KEY', 'TORBOX_API_KEY',
    'OC_KEY', 'OFFCLOUD_KEY', 'OFFCLOUD_API_KEY',
    'ED_KEY', 'EASYDEBRID_KEY', 'EASYDEBRID_API_KEY',
    'DL_KEY', 'DEBRIDLINK_KEY', 'DEBRIDLINK_API_KEY',
    'PIO_KEY', 'PUTIO_KEY', 'PUTIO_API_KEY'
  ];
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
// CRITICAL FIX: Import universal provider system
const debridProviders = require('../core/debridProviders');

// CRITICAL FIX: AllDebrid Compatibility Mode
// DISCOVERY: NO_SERVER is caused by Render.com IP detection, NOT request pattern
// AllDebrid blocks hosting provider IPs (Render, AWS, etc.) regardless of request format
// Solution: Need proxy routing for hosting environments
const ALLDEBRID_COMPATIBILITY_MODE = true; // Enable compatibility mode to prevent NO_SERVER
const DETECTED_HOSTING_ENVIRONMENT = process.env.RENDER || process.env.PORT === '10000'; // Detect hosting

// Simple headers that work with AllDebrid (matches OldAutoStream exactly)
const ALLDEBRID_SIMPLE_HEADERS = {
  'User-Agent': 'AutoStream/1.0'  // Exact same as OldAutoStream that worked
};

// DEBUG: Log compatibility mode status on module load
console.log(`🚨 [DEBRID-DEBUG] AllDebrid Compatibility Mode: ${ALLDEBRID_COMPATIBILITY_MODE ? 'ENABLED' : 'DISABLED'}`);
console.log(`🚨 [DEBRID-DEBUG] Using headers: ${JSON.stringify(ALLDEBRID_SIMPLE_HEADERS)}`);
console.log(`🚨 [DEBRID-DEBUG] Detected hosting environment: ${DETECTED_HOSTING_ENVIRONMENT ? 'YES' : 'NO'}`);
console.log(`🚨 [DEBRID-DEBUG] CRITICAL DISCOVERY: NO_SERVER is IP-based blocking, not request pattern`);
console.log(`🚨 [DEBRID-DEBUG] AllDebrid blocks hosting providers (Render, AWS, etc.) by IP range`);

// CRITICAL FIX: AllDebrid Compatibility API Call
// This function mimics the exact working pattern from OldAutoStream
// Uses URL parameter authentication and simple headers to avoid NO_SERVER detection
async function allDebridCompatibilityCall(endpoint, apiKey, options = {}, timeout = 15000) {
  // Build URL with API key in parameters (exactly like OldAutoStream)
  const baseUrl = 'https://api.alldebrid.com/v4';
  let url = `${baseUrl}/${endpoint.replace(/^\//, '')}`;
  
  // Add API key as URL parameter (not in headers)
  const separator = url.includes('?') ? '&' : '?';
  url += `${separator}apikey=${encodeURIComponent(apiKey)}`;
  
  // EXTENSIVE DEBUG LOGGING
  console.log(`🚨 [COMPAT-DEBUG] AllDebrid Compatibility Call:`);
  console.log(`🚨 [COMPAT-DEBUG] Endpoint: ${endpoint}`);
  console.log(`🚨 [COMPAT-DEBUG] Final URL: ${url.replace(/apikey=[^&]+/, 'apikey=***HIDDEN***')}`);
  console.log(`🚨 [COMPAT-DEBUG] Method: ${options.method || 'GET'}`);
  console.log(`🚨 [COMPAT-DEBUG] Headers: ${JSON.stringify({...ALLDEBRID_SIMPLE_HEADERS, ...(options.headers || {})})}`);
  console.log(`🚨 [COMPAT-DEBUG] Compatibility mode: ENABLED`);
  
  // Use ONLY the simple headers that worked in OldAutoStream
  const finalInit = {
    method: 'GET',
    ...options,
    headers: {
      ...ALLDEBRID_SIMPLE_HEADERS,
      ...(options.headers || {})
    }
  };
  
  console.log(`🚨 [COMPAT-DEBUG] Making direct fetch call...`);
  
  // Make direct fetch call without complex wrapper layers
  const response = await fetchWithTimeout(url, finalInit, timeout);
  
  console.log(`🚨 [COMPAT-DEBUG] Response status: ${response.status}`);
  console.log(`🚨 [COMPAT-DEBUG] Response ok: ${response.ok}`);
  
  return response;
}

// API Rate Limiter for debrid providers to prevent throttling
class DebridRateLimiter {
  constructor() {
    this.requests = new Map(); // API key -> request timestamps array
    this.maxRequestsPerMinute = 30; // Conservative limit for debrid APIs
    this.maxRequestsPerHour = 1000; // Conservative hourly limit
    this.maxCacheSize = 200; // Limit cache size to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }
  
  async checkRateLimit(apiKey) {
    if (!apiKey) return true; // No rate limiting if no API key
    
    const now = Date.now();
    const requests = this.requests.get(apiKey) || [];
    
    // Remove requests older than 1 hour
    const recentRequests = requests.filter(timestamp => now - timestamp < 3600000);
    
    // Check hourly limit
    if (recentRequests.length >= this.maxRequestsPerHour) {
      throw new Error('API rate limit exceeded (hourly). Please wait before making more requests.');
    }
    
    // Check per-minute limit
    const lastMinuteRequests = recentRequests.filter(timestamp => now - timestamp < 60000);
    if (lastMinuteRequests.length >= this.maxRequestsPerMinute) {
      throw new Error('API rate limit exceeded (per minute). Please wait before making more requests.');
    }
    
    // Add current request
    recentRequests.push(now);
    this.requests.set(apiKey, recentRequests);
    
    return true;
  }
  
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [apiKey, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(timestamp => now - timestamp < 3600000);
      if (recentRequests.length === 0) {
        keysToDelete.push(apiKey);
      } else {
        this.requests.set(apiKey, recentRequests);
      }
    }
    
    // Delete empty entries
    keysToDelete.forEach(key => this.requests.delete(key));
    
    // If still too large, remove oldest entries to prevent memory leaks
    if (this.requests.size > this.maxCacheSize) {
      const entries = Array.from(this.requests.entries());
      const toRemove = entries
        .sort((a, b) => {
          const lastRequestA = Math.max(...a[1]);
          const lastRequestB = Math.max(...b[1]);
          return lastRequestA - lastRequestB; // Oldest first
        })
        .slice(0, this.requests.size - this.maxCacheSize)
        .map(entry => entry[0]);
      
      toRemove.forEach(key => this.requests.delete(key));
      
      if (toRemove.length > 0) {
        console.log(`[MEMORY] Cleaned ${toRemove.length} entries from rate limiter cache, size now: ${this.requests.size}`);
      }
    }
  }
  
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }
}

// Global rate limiter instance
const debridRateLimiter = new DebridRateLimiter();

// Circuit breaker for API failures
class DebridCircuitBreaker {
  constructor() {
    this.failures = new Map(); // API key -> failure count and timestamps
    this.maxFailures = 5; // Max failures before circuit opens
    this.resetTime = 300000; // 5 minutes before attempting reset
    this.maxCacheSize = 200; // Limit cache size to prevent memory leaks
    
    // Periodic cleanup to prevent memory leaks
    setInterval(() => this.cleanup(), 10 * 60 * 1000); // Clean every 10 minutes
  }
  
  async checkCircuit(apiKey) {
    if (!apiKey) return true;
    
    const failures = this.failures.get(apiKey);
    if (!failures) return true;
    
    const now = Date.now();
    
    // Reset circuit if enough time has passed
    if (now - failures.lastFailure > this.resetTime) {
      this.failures.delete(apiKey);
      return true;
    }
    
    // Check if circuit is open
    if (failures.count >= this.maxFailures) {
      throw new Error('Debrid API circuit breaker is open. Service temporarily unavailable.');
    }
    
    return true;
  }
  
  recordSuccess(apiKey) {
    if (!apiKey) return;
    this.failures.delete(apiKey);
  }
  
  recordFailure(apiKey) {
    if (!apiKey) return;
    
    const now = Date.now();
    const failures = this.failures.get(apiKey) || { count: 0, lastFailure: 0 };
    
    failures.count++;
    failures.lastFailure = now;
    
    this.failures.set(apiKey, failures);
  }
  
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    // Remove entries that are past reset time (expired)
    for (const [apiKey, failures] of this.failures.entries()) {
      if (now - failures.lastFailure > this.resetTime) {
        keysToDelete.push(apiKey);
      }
    }
    
    keysToDelete.forEach(key => this.failures.delete(key));
    
    // If still too large, remove oldest entries to prevent memory leaks
    if (this.failures.size > this.maxCacheSize) {
      const entries = Array.from(this.failures.entries());
      const toRemove = entries
        .sort((a, b) => a[1].lastFailure - b[1].lastFailure) // Oldest first
        .slice(0, this.failures.size - this.maxCacheSize)
        .map(entry => entry[0]);
      
      toRemove.forEach(key => this.failures.delete(key));
      
      if (toRemove.length > 0) {
        console.log(`[MEMORY] Cleaned ${toRemove.length} entries from circuit breaker cache, size now: ${this.failures.size}`);
      }
    }
  }
}

// Global circuit breaker instance
const debridCircuitBreaker = new DebridCircuitBreaker();

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
 * Click-time debrid resolver for any provider.
 * - buildPlayUrl(meta, { origin, provider, token }) -> creates play URL
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

// Defensive wrapper for debrid API calls
async function safeDebridApiCall(url, init, timeout, apiKey, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Add jitter to reduce thundering herd
      if (attempt > 0) {
        const jitter = Math.random() * 1000 * attempt; // Progressive backoff with jitter
        await new Promise(resolve => setTimeout(resolve, jitter));
      }
      
      // CRITICAL FIX: Add User-Agent headers for AllDebrid API calls to prevent NO_SERVER error
      const finalInit = { ...init };
      if (url.includes('api.alldebrid.com')) {
        finalInit.headers = { 
          ...ALLDEBRID_HEADERS,
          ...(finalInit.headers || {})
        };
      }
      
      const response = await fetchWithTimeout(url, finalInit, timeout);
      
      // Check for rate limiting
      if (response.status === 429) {
        debridCircuitBreaker.recordFailure(apiKey);
        const retryAfter = response.headers.get('retry-after') || '60';
        throw new Error(`Rate limited by debrid API. Retry after ${retryAfter} seconds.`);
      }
      
      // Check for other errors
      if (!response.ok && response.status >= 500) {
        throw new Error(`Debrid API server error: ${response.status} ${response.statusText}`);
      }
      
      debridCircuitBreaker.recordSuccess(apiKey);
      return response;
      
    } catch (error) {
      debridCircuitBreaker.recordFailure(apiKey);
      
      // Don't retry on certain errors
      if (error.message.includes('Rate limited') || 
          error.message.includes('circuit breaker') ||
          (error.response && error.response.status < 500)) {
        throw error;
      }
      
      // Retry on network errors and 5xx errors
      if (attempt === retries) {
        throw new Error(`Debrid API call failed after ${retries + 1} attempts: ${error.message}`);
      }
    }
  }
}

// FIXED: Provider-aware AllDebrid API calls using universal system
async function providerAwareAllDebridApiCall(endpoint, options = {}, timeout = 15000, apiKey) {
  try {
    // Get AllDebrid provider configuration
    const provider = debridProviders.getProvider('alldebrid');
    if (!provider) {
      throw new Error('AllDebrid provider not found in configuration');
    }
    
    // Construct URL using provider base URL (no API key in URL)
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${provider.apiBaseUrl}/${endpoint.replace(/^\//, '')}`;
    
    console.log(`[PROVIDER-AWARE] AllDebrid API call: ${url}`);
    
    // Basic rate limiting check
    await debridRateLimiter.checkRateLimit(apiKey);
    
    // Use provider-specific headers with proper Authorization
    const finalInit = { 
      method: 'GET',
      ...options,
      headers: {
        ...provider.headers,  // Use provider headers from config
        'Authorization': `${provider.authHeader} ${apiKey}`,  // FIXED: Add Authorization header
        ...(options.headers || {})
      }
    };
    
    // Single attempt with provider configuration  
    const response = await fetchWithTimeout(url, finalInit, timeout);
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || '60';
      throw new Error(`Rate limited by AllDebrid API. Retry after ${retryAfter} seconds.`);
    }
    
    // Record success for non-error responses
    if (response.status >= 200 && response.status < 500) {
      debridCircuitBreaker.recordSuccess(apiKey);
    }
    
    return response;
    
  } catch (error) {
    // Only record network/server failures, not API error responses
    if (error.message.includes('fetch') || error.message.includes('timeout') || error.message.includes('network')) {
      debridCircuitBreaker.recordFailure(apiKey);
    }
    console.error(`[PROVIDER-AWARE] AllDebrid API error: ${error.message}`);
    throw error;
  }
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
const MAX_RESOLVE_CACHE_SIZE = 500; // Limit cache size to prevent memory leaks

// Request deduplication to prevent multiple identical requests
const pendingRequests = new Map();
const MAX_PENDING_REQUESTS = 100; // Limit pending requests to prevent memory leaks

// Periodic cache cleanup for resolve cache and pending requests
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Clean expired entries (older than 15 minutes)
  for (const [key, value] of resolveCache.entries()) {
    if (now - value.timestamp > 900000) { // 15 minutes
      resolveCache.delete(key);
      cleanedCount++;
    }
  }
  
  // Clean expired pending requests (older than 2 minutes)
  for (const [key, value] of pendingRequests.entries()) {
    if (now - value.timestamp > 120000) { // 2 minutes
      pendingRequests.delete(key);
      cleanedCount++;
    }
  }
  
  // If still too large, remove oldest entries (LRU-style)
  if (resolveCache.size > MAX_RESOLVE_CACHE_SIZE) {
    const entries = Array.from(resolveCache.entries());
    const toRemove = entries
      .sort((a, b) => a[1].timestamp - b[1].timestamp) // Sort by timestamp (oldest first)
      .slice(0, resolveCache.size - MAX_RESOLVE_CACHE_SIZE)
      .map(entry => entry[0]);
    
    toRemove.forEach(key => resolveCache.delete(key));
    cleanedCount += toRemove.length;
  }
  
  if (pendingRequests.size > MAX_PENDING_REQUESTS) {
    const entries = Array.from(pendingRequests.entries());
    const toRemove = entries
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, pendingRequests.size - MAX_PENDING_REQUESTS)
      .map(entry => entry[0]);
    
    toRemove.forEach(key => pendingRequests.delete(key));
    cleanedCount += toRemove.length;
  }
  
  if (cleanedCount > 0) {
    console.log(`[MEMORY] Cleaned ${cleanedCount} entries from resolve/pending caches, sizes now: resolve=${resolveCache.size}, pending=${pendingRequests.size}`);
  }
}, 15 * 60 * 1000); // Clean every 15 minutes

async function handlePlay(req, res, defaults = {}) {
  // Generate unique request ID for proper isolation
  const reqId = Math.random().toString(36).substr(2, 9);
  const log = (msg, level = 'info') => {
    const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';
    if (level === 'verbose' && !VERBOSE_LOGGING) return;
    console.log(`[${reqId}] ${msg}`);
  };
  
  // Reference VERBOSE_LOGGING for use in conditional logging
  const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';
  
  // Only log for the first request, not subsequent range requests
  const isRangeRequest = req.headers.range;
  const isFirstRequest = !isRangeRequest || req.headers.range === 'bytes=0-';
  
  if (isFirstRequest) {
    log('🎬 Debrid play request');
  }
  
  // Defensive wrapper with timeout and error handling
  const handlePlayTimeout = setTimeout(() => {
    if (!res.headersSent) {
      log('⚠️ HandlePlay timeout - responding with 408');
      res.writeHead(408, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ ok: false, error: 'Request timeout', code: 'TIMEOUT' }));
    }
  }, 30000); // 30 second timeout

  try {
    const url = new URL(req.url, 'http://localhost:7010');
    const usp = url.searchParams;
    
    if (isFirstRequest) {
      log('Query params: ' + JSON.stringify(Object.fromEntries(usp), null, 2), 'verbose');
    }
    
    const adKey = discoverADKey(usp, defaults, req.headers);
    if (!adKey) {
      if (isFirstRequest) log('No debrid API key found - checking for non-debrid fallback');
      
      // NON-DEBRID TV FALLBACK: Return helpful error for TV devices
      const ih = usp.get('ih') || '';
      if (ih) {
        const magnetUrl = `magnet:?xt=urn:btih:${ih}`;
        const userAgent = req.headers['user-agent'] || '';
        
        if (isFirstRequest) {
          log(`🧲 Non-debrid fallback: redirecting to magnet link`);
          log(`   🔗 Magnet URL: ${magnetUrl}`);
        }
        
        clearTimeout(handlePlayTimeout);
        
        // Universal fallback: redirect to magnet for all devices
        res.writeHead(302, { 
          'Location': magnetUrl,
          'Cache-Control': 'no-cache'
        });
        return res.end();
      }
      
      // If no infoHash, return error
      if (isFirstRequest) log('ERROR: No debrid API key and no infoHash for fallback');
      clearTimeout(handlePlayTimeout);
      res.writeHead(401, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:false, err:'Debrid API key required or invalid infoHash' }));
    }
    
    // Check rate limits and circuit breaker
    try {
      await debridRateLimiter.checkRateLimit(adKey);
      await debridCircuitBreaker.checkCircuit(adKey);
    } catch (rateLimitError) {
      if (isFirstRequest) log('⚠️ Rate limit or circuit breaker triggered: ' + rateLimitError.message);
      clearTimeout(handlePlayTimeout);
      res.writeHead(429, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({ 
        ok: false, 
        error: rateLimitError.message,
        code: 'RATE_LIMITED'
      }));
    }
    
    if (isFirstRequest) log('AD Key found: YES');
    
    const ih = usp.get('ih') || '';
    const magnet = usp.get('magnet') || `magnet:?xt=urn:btih:${ih}`;
    const idx = parseInt(usp.get('idx') || '0', 10);
    const imdb = usp.get('imdb') || '';
    
    // Create cache key
    const cacheKey = `${ih}_${idx}`;
    
    // Check cache first (extended cache for better deduplication)
    if (resolveCache.has(cacheKey)) {
      const cached = resolveCache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < 900000) { // Extended to 15 minutes cache to reduce API calls
        if (isFirstRequest) log(`🚀 Using cached URL (${Math.round(age/1000)}s old)`);
        
        // Enhanced headers for better player compatibility
        const headers = {
          'Location': cached.url,
          'Cache-Control': 'public, max-age=900', // 15 minutes
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range',
          'Accept-Ranges': 'bytes'
        };
        
        res.writeHead(302, headers);
        clearTimeout(handlePlayTimeout);
        return res.end();
      } else {
        resolveCache.delete(cacheKey); // Expired
      }
    }
    
    // Request deduplication: if same request is already in progress, wait for it
    if (pendingRequests.has(cacheKey)) {
      const pending = pendingRequests.get(cacheKey);
      if (isFirstRequest) log(`⏳ Waiting for identical request already in progress...`);
      
      try {
        const result = await pending.promise;
        if (isFirstRequest) log(`✅ Got result from deduplication: ${result.url ? 'success' : 'failed'}`);
        
        if (result.url) {
          // Enhanced headers for better player compatibility
          const headers = {
            'Location': result.url,
            'Cache-Control': 'public, max-age=900',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range, Content-Range, Accept-Ranges',
            'Accept-Ranges': 'bytes',
            'Content-Type': 'video/mp4'
          };
          
          res.writeHead(302, headers);
          clearTimeout(handlePlayTimeout);
          return res.end();
        } else {
          throw new Error(result.error || 'Request failed');
        }
      } catch (error) {
        if (isFirstRequest) log(`❌ Deduplication failed: ${error.message}`);
        clearTimeout(handlePlayTimeout);
        res.writeHead(500, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    }
    
    // Create promise for this request to allow deduplication
    let resolveDedup, rejectDedup;
    const dedupPromise = new Promise((resolve, reject) => {
      resolveDedup = resolve;
      rejectDedup = reject;
    });
    
    pendingRequests.set(cacheKey, {
      promise: dedupPromise,
      timestamp: Date.now()
    });

    if (isFirstRequest) {
      log('Extracted data:', 'verbose');
      log('  InfoHash: ' + ih, 'verbose');
      log('  Magnet: ' + magnet.substring(0, 60) + '...', 'verbose');
      log('  File Index: ' + idx, 'verbose');
      if (imdb) log('  IMDB: ' + imdb, 'verbose');
    }

    // 1) upload
    if (isFirstRequest) log('Step 1: Uploading magnet to AllDebrid...');
    let uploadSuccess = false;
    try {
      // CRITICAL FIX: Use AllDebrid compatibility mode to prevent NO_SERVER errors
      // This mimics the exact working pattern from OldAutoStream
      let up;
      
      console.log(`🚨 [UPLOAD-DEBUG] Starting AllDebrid upload...`);
      console.log(`🚨 [UPLOAD-DEBUG] Compatibility mode enabled: ${ALLDEBRID_COMPATIBILITY_MODE}`);
      
      if (ALLDEBRID_COMPATIBILITY_MODE) {
        console.log(`🚨 [UPLOAD-DEBUG] Using COMPATIBILITY mode (OldAutoStream style)`);
        // Use OldAutoStream-style API call with URL parameters and simple headers
        // CRITICAL: OldAutoStream uses 'magnets[]' parameter format
        const endpoint = `magnet/upload?magnets[]=${encodeURIComponent(magnet)}`;
        console.log(`🚨 [UPLOAD-DEBUG] Endpoint: ${endpoint.substring(0, 80)}...`);
        console.log(`🚨 [UPLOAD-DEBUG] Magnet length: ${magnet.length}`);
        console.log(`🚨 [UPLOAD-DEBUG] Full magnet: ${magnet.substring(0, 100)}...`);
        up = await allDebridCompatibilityCall(endpoint, adKey, { method: 'GET' }, 15000);
      } else {
        console.log(`🚨 [UPLOAD-DEBUG] Using PROVIDER-AWARE mode (new system)`);
        // Fallback to provider-aware system if compatibility mode disabled
        up = await providerAwareAllDebridApiCall(`magnet/upload?magnet=${encodeURIComponent(magnet)}`, { method: 'GET' }, 15000, adKey);
      }
      
      if (isFirstRequest) {
        log('Upload response status: ' + up.status, 'verbose');
        log('Upload response ok: ' + up.ok, 'verbose');
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
              'AUTH_USER_BANNED',
              'NO_SERVER'  // AllDebrid blocks server/VPN IPs - user needs to check their network
            ];
            
            if (permanentUploadErrors.includes(errorCode)) {
              log('❌ Permanent upload error: ' + errorCode + ' - stopping immediately');
              
              // CRITICAL: Provide helpful error message for NO_SERVER
              let userMessage = uploadResult.error.message || 'AllDebrid service error';
              if (errorCode === 'NO_SERVER' && DETECTED_HOSTING_ENVIRONMENT) {
                userMessage = 'AllDebrid blocks hosting service IPs (Render, AWS, etc.). This addon needs to run on a residential connection or use a proxy service to work with AllDebrid. The issue is environmental, not a code bug.';
              }
              
              res.writeHead(400, {'Content-Type':'application/json'});
              return res.end(JSON.stringify({ 
                ok: false, 
                error: errorCode,
                message: userMessage,
                permanent: true,
                hosting_detected: DETECTED_HOSTING_ENVIRONMENT,
                solution: errorCode === 'NO_SERVER' ? 'Deploy on residential IP or use proxy service' : null
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
    let inQueueCount = 0; // Track how many times we see "In queue"
    
    for (let i=0;i<15;i++){ // Increased to 15 iterations to handle downloading torrents (up to ~30 seconds)
      if (isFirstRequest && i === 0) log(`Polling for files...`);
      try {
        // CRITICAL FIX: Use AllDebrid compatibility mode for status calls
        let st;
        if (ALLDEBRID_COMPATIBILITY_MODE) {
          const endpoint = `magnet/status?id=${encodeURIComponent(magnetId)}`;
          st = await allDebridCompatibilityCall(endpoint, adKey, { method: 'GET' }, 15000);
        } else {
          st = await providerAwareAllDebridApiCall(`magnet/status?id=${magnetId}`, { method: 'GET' }, 15000, adKey);
        }
        const sj = await jsonSafe(st);
        
        log('Status response: status=' + st.status + ', ok=' + st.ok, 'verbose');
        if (VERBOSE_LOGGING) {
          log('Status body: ' + JSON.stringify(sanitizeResponseForLogging(sj)), 'verbose');
        }
        
        // Check for permanent errors that should stop polling immediately
        if (sj && sj.status === 'error' && sj.error && sj.error.code) {
          const errorCode = sj.error.code;
          const permanentErrors = [
            'MAGNET_MUST_BE_PREMIUM',
            'AUTH_BLOCKED',
            'AUTH_BAD_APIKEY', 
            'AUTH_USER_BANNED',
            'MAGNET_TOO_MANY'
            // Removed 'MAGNET_INVALID_ID' - this can happen during processing
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
        
        if (sj && sj.status === 'success' && sj.data) {
          // Handle both single magnet object and array of magnets
          let magnets = [];
          if (Array.isArray(sj.data.magnets)) {
            magnets = sj.data.magnets;
          } else if (sj.data.magnets && typeof sj.data.magnets === 'object') {
            // Single magnet object - convert to array
            magnets = [sj.data.magnets];
          }
          
          // Find the magnet that matches our hash
          const targetHash = (ih || '').toLowerCase();
          const matchingMagnet = magnets.find(m => 
            m && m.hash && m.hash.toLowerCase() === targetHash
          );
          
          if (matchingMagnet) {
            log('Found matching magnet: ' + matchingMagnet.id + ' ' + matchingMagnet.hash + ' status=' + matchingMagnet.status, 'verbose');
            magnetId = matchingMagnet.id;
            
            // Track status for proper handling
            if (matchingMagnet.status === 'In queue') {
              inQueueCount++;
              log('⏳ Torrent still in queue (' + inQueueCount + '/3 - may need manual processing)');
              
              // After 3 "In queue" responses, give more informative feedback
              if (inQueueCount >= 3) {
                log('⚠️ Torrent has been in queue for extended time - may require manual processing');
                res.writeHead(202, {'Content-Type':'application/json'});
                return res.end(JSON.stringify({ 
                  ok: false, 
                  caching: true,
                  requiresManualProcessing: true,
                  msg: 'This torrent requires manual processing in AllDebrid. Please visit alldebrid.com to select files, then try again.',
                  magnetId: magnetId
                }));
              }
            } else if (matchingMagnet.status === 'Downloading') {
              const downloaded = matchingMagnet.downloaded || 0;
              const total = matchingMagnet.size || 0;
              const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
              
              log('⏳ Torrent downloading (' + downloaded + '/' + total + ' bytes, ' + progress + '%)');
              
              // For downloading torrents, be much more patient
              // Only consider "stuck" after many attempts (30+ seconds) AND no progress
              if (i >= 10) { // Increased from 4 to 10 attempts (15-20 seconds)
                log('ℹ️ Torrent still downloading after extended polling (' + progress + '% complete)');
                
                // If torrent is making good progress (>50%), let it continue
                if (progress >= 50) {
                  log('✅ Torrent is making good progress (' + progress + '%), continuing to wait...');
                  // Don't return error, let it continue polling
                } else if (progress === 0) {
                  // Only mark as stuck if there's literally zero progress
                  log('⚠️ Torrent shows no download progress - may be stuck');
                  res.writeHead(202, {'Content-Type':'application/json'});
                  return res.end(JSON.stringify({ 
                    ok: false, 
                    caching: true,
                    stuckDownloading: true,
                    msg: 'This torrent appears to have no seeders or may be corrupted. Try a different quality.',
                    magnetId: magnetId,
                    progress: progress
                  }));
                } else {
                  // Some progress but slow - inform user but continue
                  log('⏳ Torrent downloading slowly (' + progress + '%), continuing to monitor...');
                }
              }
            }
            
            if (matchingMagnet.status === 'Ready' && matchingMagnet.links && matchingMagnet.links.length > 0) {
              // Extract files from the magnet links - each link represents a separate file
              files = matchingMagnet.links.map(link => ({
                name: link.filename || 'Unknown',
                size: link.size || 0,
                link: link.link
              }));
              
              log('Found files via status (Ready magnet): ' + files.length, 'verbose');
              break;
            }
            
            // Check for error states that should stop processing
            if (matchingMagnet.status === 'Error' || matchingMagnet.status === 'Dead') {
              log('❌ Torrent failed with status: ' + matchingMagnet.status);
              res.writeHead(400, {'Content-Type':'application/json'});
              return res.end(JSON.stringify({ 
                ok: false, 
                error: 'TORRENT_FAILED',
                message: 'Torrent processing failed: ' + matchingMagnet.status,
                permanent: true 
              }));
            }
          } else {
            log('No matching magnet found for hash: ' + targetHash + ', available magnets: ' + magnets.map(m => m.hash).join(','));
          }
        } else {
          log('No magnet data in status response: ' + JSON.stringify(sanitizeResponseForLogging(sj)));
        }
      } catch (e) {
        log('Status API error: ' + e.message + ', stack: ' + e.stack);
      }
      
      // Only try Files API if we have a Ready magnet - avoid "MAGNET_INVALID_ID" errors
      if (magnetId && inQueueCount === 0) {
        // Additional check: only call Files API for Ready torrents to prevent errors
        try {
          // CRITICAL FIX: Use AllDebrid compatibility mode for status calls
          let st;
          if (ALLDEBRID_COMPATIBILITY_MODE) {
            const endpoint = `magnet/status?id=${encodeURIComponent(ih || magnet)}`;
            st = await allDebridCompatibilityCall(endpoint, adKey, { method: 'GET' }, 5000);
          } else {
            st = await providerAwareAllDebridApiCall(`magnet/status?id=${encodeURIComponent(ih || magnet)}`, { method: 'GET' }, 5000, adKey);
          }
          const sj = await jsonSafe(st);
          
          if (sj && sj.status === 'success' && sj.data) {
            // Handle both single magnet object and array of magnets
            let magnets = [];
            if (Array.isArray(sj.data.magnets)) {
              magnets = sj.data.magnets;
            } else if (sj.data.magnets && typeof sj.data.magnets === 'object') {
              // Single magnet object - convert to array
              magnets = [sj.data.magnets];
            }
            
            const targetHash = (ih || '').toLowerCase();
            const matchingMagnet = magnets.find(m => 
              m && m.hash && m.hash.toLowerCase() === targetHash
            );
            
            // Only call Files API if torrent is actually Ready
            if (matchingMagnet && matchingMagnet.status === 'Ready') {
              // CRITICAL FIX: Use AllDebrid compatibility mode for files calls
              let f;
              if (ALLDEBRID_COMPATIBILITY_MODE) {
                const endpoint = `magnet/files?id=${encodeURIComponent(magnetId)}`;
                f = await allDebridCompatibilityCall(endpoint, adKey, { method: 'GET' }, 15000);
              } else {
                f = await providerAwareAllDebridApiCall(`magnet/files?id=${magnetId}`, { method: 'GET' }, 15000, adKey);
              }
              const fj = await jsonSafe(f);
              
              log('Files API response (with ID): status=' + f.status + ', ok=' + f.ok + ', body=' + JSON.stringify(sanitizeResponseForLogging(fj)));
              
              if (fj && fj.status === 'success' && fj.data && Array.isArray(fj.data.files) && fj.data.files.length) { 
                log('Found files via files API: ' + fj.data.files.length);
                files = fj.data.files; 
                break; 
              }
            } else {
              log('Skipping Files API call - torrent status is: ' + (matchingMagnet ? matchingMagnet.status : 'unknown'));
            }
          }
        } catch (e) {
          log('Files API error: ' + e.message + ', stack: ' + e.stack);
        }
      }
      
      // Adaptive sleep - different timing based on torrent status
      let sleepTime = 500; // Default
      if (inQueueCount > 0) {
        sleepTime = 1000; // Longer wait for queue processing
      } else if (i >= 5) {
        sleepTime = 2000; // Even longer wait for extended polling (downloads)
      }
      
      log('No files found, sleeping ' + sleepTime + 'ms...');
      await sleep(sleepTime);
    }

    if (!files.length) {
      // Caching started but no file yet
      log('ERROR: No files found after polling');
      res.writeHead(404, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:false, caching:true, msg:'Debrid is caching the magnet; try again shortly' }));
    }

    log('Step 3: Selecting best file...');
    
    // Extract episode info from IMDB ID if available (e.g., tt1870479:3:1 -> S3E1)
    let targetSeason = null;
    let targetEpisode = null;
    if (imdb && imdb.includes(':')) {
      const parts = imdb.split(':');
      if (parts.length >= 3) {
        targetSeason = parseInt(parts[1], 10);
        targetEpisode = parseInt(parts[2], 10);
        if (isFirstRequest) {
          log(`Episode target: S${targetSeason}E${targetEpisode} from IMDB ${imdb}`);
        }
      }
    }
    
    // pick file (idx preferred, else episode match, else largest mkv/mp4/avi, else largest)
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
    
    // Try episode-specific file selection first
    if (!chosen && targetSeason && targetEpisode && videoFiles.length > 1) {
      // For season packs, try to find the exact episode file
      const episodePatterns = [
        new RegExp(`s0*${targetSeason}\\s*e0*${targetEpisode}(?:\\s|\\.|$)`, 'i'),
        new RegExp(`season\\s*0*${targetSeason}.*episode\\s*0*${targetEpisode}`, 'i'),
        new RegExp(`${targetSeason}x0*${targetEpisode}(?:\\s|\\.|$)`, 'i'),
        new RegExp(`s0*${targetSeason}.*e0*${targetEpisode}`, 'i')
      ];
      
      for (const file of videoFiles) {
        const fileName = file.name || file.path || '';
        if (episodePatterns.some(pattern => pattern.test(fileName))) {
          chosen = file;
          if (isFirstRequest) {
            log(`✅ Found episode match: ${fileName}`);
          }
          break;
        }
      }
      
      // If no exact match and this looks like a season pack, try episode index
      if (!chosen && videoFiles.length >= targetEpisode) {
        // For season packs, episodes are often in order
        const episodeIndex = targetEpisode - 1; // Convert to 0-based index
        if (episodeIndex >= 0 && episodeIndex < videoFiles.length) {
          // Sort files by name to ensure consistent ordering
          const sortedFiles = videoFiles.slice().sort((a, b) => {
            const nameA = (a.name || a.path || '').toLowerCase();
            const nameB = (b.name || b.path || '').toLowerCase();
            return nameA.localeCompare(nameB);
          });
          
          chosen = sortedFiles[episodeIndex];
          if (isFirstRequest) {
            log(`📍 Using episode index ${episodeIndex} for S${targetSeason}E${targetEpisode}: ${chosen.name}`);
          }
        }
      }
    }
    
    // Fallback to provided index
    if (!chosen && Number.isFinite(idx) && idx >= 0 && idx < videoFiles.length) {
      chosen = videoFiles[idx];
      if (isFirstRequest) {
        log('Chosen file by provided index: ' + chosen.name);
      }
    }
    
    // Final fallback to largest file
    if (!chosen && videoFiles.length > 0) {
      chosen = videoFiles.sort((a,b)=> (b.size||0)-(a.size||0))[0];
      if (isFirstRequest) {
        log('Chosen largest video file: ' + chosen.name);
      }
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
      // CRITICAL FIX: Use AllDebrid compatibility mode for unlock calls
      let unl;
      if (ALLDEBRID_COMPATIBILITY_MODE) {
        const endpoint = `link/unlock?link=${encodeURIComponent(chosen.link)}`;
        unl = await allDebridCompatibilityCall(endpoint, adKey, { method: 'GET' }, 15000);
      } else {
        unl = await providerAwareAllDebridApiCall(`link/unlock?link=${encodeURIComponent(chosen.link)}`, { method: 'GET' }, 15000, adKey);
      }
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
    
    // Cache the successful result for longer to reduce API calls
    resolveCache.set(cacheKey, {
      url: finalUrl,
      timestamp: Date.now()
    });
    
    // Resolve deduplication promise for other waiting requests
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      pendingRequests.delete(cacheKey);
      resolveDedup({ url: finalUrl });
    }
    
    // Record success for circuit breaker
    debridCircuitBreaker.recordSuccess(adKey);
    clearTimeout(handlePlayTimeout);
    
    // Enhanced headers for better player compatibility and range request support
    const headers = {
      'Location': finalUrl,
      'Cache-Control': 'public, max-age=900', // 15 minutes
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4' // Hint about content type
    };
    
    // redirect to file
    res.writeHead(302, headers);
    return res.end();
  } catch (e) {
    log('FATAL ERROR in handlePlay: ' + e.message);
    log('Stack trace: ' + e.stack);
    
    // Reject deduplication promise for other waiting requests
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      pendingRequests.delete(cacheKey);
      rejectDedup(e);
    }
    
    // Record failure for circuit breaker if it's an API-related error
    const adKey = discoverADKey(new URL(req.url, 'http://localhost:7010').searchParams, defaults, req.headers);
    if (adKey && (e.message.includes('debrid') || e.message.includes('API') || e.message.includes('fetch'))) {
      debridCircuitBreaker.recordFailure(adKey);
    }
    
    clearTimeout(handlePlayTimeout);
    
    // Safe error response
    if (!res.headersSent) {
      try { 
        res.writeHead(500, {'Content-Type':'application/json'}); 
        res.end(JSON.stringify({ 
          ok: false, 
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        })); 
      } catch (responseError) {
        log('Failed to send error response: ' + responseError.message);
      }
    }
  } finally {
    clearTimeout(handlePlayTimeout);
  }
}

// Cleanup on module unload
process.on('exit', () => {
  debridRateLimiter.destroy();
});

module.exports = { buildPlayUrl, handlePlay };
