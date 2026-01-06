'use strict';
const { TTLCache } = require('../utils/cache');
const { fetchWithTimeout } = require('../utils/http');
const { 
 BASE_TORRENTIO, 
 BASE_TPB, 
 BASE_NUVIO, 
 BASE_MEDIAFUSION, 
 BASE_COMET, 
 COMET_DEFAULT_CONFIG,
 MEDIAFUSION_DEFAULT_CONFIG,
 CF_PROXY_URL 
} = require('../constants');

const torrentioCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 });
const tpbCache = new TTLCache({ max: 300, ttlMs: 60 * 60 * 1000 });
const nuvioCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 }); // Increased from 12 min to 60 min
const mediafusionCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 });
const cometCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 });
const mediafusionConfigCache = new TTLCache({ max: 50, ttlMs: 24 * 60 * 60 * 1000 }); // 24 hour cache for encrypted configs

/**
 * Build standard Stremio stream URL (for Torrentio, TPB, Nuvio)
 */
function buildUrl(base, type, id, query) {
 const qs = new URLSearchParams(query || {}).toString();
 return `${base.replace(/\/+$/, '')}/stream/${type}/${encodeURIComponent(id)}.json${qs ? ('?' + qs) : ''}`;
}

/**
 * Build Torrentio configuration string for a debrid provider
 * Torrentio uses pipe-separated config: provider=apikey|setting=value
 * @param {string} debridProvider - Provider key (realdebrid, alldebrid, premiumize, torbox, etc.)
 * @param {string} apiKey - The debrid API key
 * @returns {string} Configuration string for Torrentio URL path
 */
function buildTorrentioConfig(debridProvider, apiKey) {
 if (!debridProvider || !apiKey) return '';
 
 // Map AutoStream provider keys to Torrentio's provider names
 const providerMapping = {
  'realdebrid': 'realdebrid',
  'rd': 'realdebrid',
  'alldebrid': 'alldebrid',
  'ad': 'alldebrid',
  'premiumize': 'premiumize',
  'pm': 'premiumize',
  'torbox': 'torbox',
  'tb': 'torbox',
  'debridlink': 'debridlink',
  'dl': 'debridlink',
  'offcloud': 'offcloud',
  'easydebrid': 'easydebrid',
  'putio': 'putio'
 };

 const provider = providerMapping[debridProvider?.toLowerCase()];
 if (!provider) return '';
 
 // Torrentio config format: provider=apikey
 return `${provider}=${apiKey}`;
}

/**
 * Build Torrentio stream URL with optional debrid config
 * Torrentio uses: /{config}/stream/{type}/{id}.json or /stream/{type}/{id}.json
 */
function buildTorrentioUrl(base, type, id, config) {
 const configPath = config ? `/${config}` : '';
 return `${base.replace(/\/+$/, '')}${configPath}/stream/${type}/${encodeURIComponent(id)}.json`;
}

/**
 * Build MediaFusion stream URL with config path
 * MediaFusion uses: /{secret_str}/stream/{type}/{id}.json
 * For public access without debrid: /D-/stream/{type}/{id}.json
 */
function buildMediaFusionUrl(base, type, id, config) {
 const configPath = config || MEDIAFUSION_DEFAULT_CONFIG;
 return `${base.replace(/\/+$/, '')}/${configPath}/stream/${type}/${encodeURIComponent(id)}.json`;
}

/**
 * Build Comet stream URL with config path
 * Comet uses: /{b64config}/stream/{type}/{id}.json
 * Config is base64-encoded JSON
 */
function buildCometUrl(base, type, id, config) {
 const configPath = config || COMET_DEFAULT_CONFIG;
 return `${base.replace(/\/+$/, '')}/${configPath}/stream/${type}/${encodeURIComponent(id)}.json`;
}

/**
 * Build Comet configuration string for a debrid provider
 * Comet uses base64-encoded JSON config
 * @param {string} debridProvider - Provider key (realdebrid, alldebrid, premiumize, torbox, etc.)
 * @param {string} apiKey - The debrid API key
 * @returns {string} Base64-encoded configuration string
 */
function buildCometConfig(debridProvider, apiKey) {
 // Map AutoStream provider keys to Comet's debridService names
 const providerMapping = {
  'realdebrid': 'realdebrid',
  'rd': 'realdebrid',
  'alldebrid': 'alldebrid',
  'ad': 'alldebrid',
  'premiumize': 'premiumize',
  'pm': 'premiumize',
  'torbox': 'torbox',
  'tb': 'torbox',
  'debridlink': 'debridlink',
  'dl': 'debridlink',
  'offcloud': 'offcloud',
  'easydebrid': 'easydebrid'
 };

 const debridService = providerMapping[debridProvider?.toLowerCase()] || 'torrent';
 
 const config = {
  debridService: debridService,
  debridApiKey: apiKey || '',
  maxResultsPerResolution: 0,
  maxSize: 0,
  resultFormat: ['all']
 };
 
 return Buffer.from(JSON.stringify(config)).toString('base64');
}

/**
 * Build MediaFusion configuration via their /encrypt-user-data API
 * MediaFusion requires encrypted user data which must be generated server-side
 * @param {string} debridProvider - Provider key (realdebrid, alldebrid, premiumize, torbox, etc.)
 * @param {string} apiKey - The debrid API key
 * @returns {Promise<string>} Encrypted configuration string (e.g., "D-abc123...")
 */
async function buildMediaFusionConfigViaAPI(debridProvider, apiKey) {
 if (!debridProvider || !apiKey) {
  return MEDIAFUSION_DEFAULT_CONFIG;
 }
 
 // Check cache first (keyed by provider + first/last 4 chars of key for privacy)
 const cacheKey = `${debridProvider}:${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
 const cached = mediafusionConfigCache.get(cacheKey);
 if (cached) {
  return cached;
 }
 
 // Map AutoStream provider keys to MediaFusion's streaming_provider.service names
 const providerMapping = {
  'realdebrid': 'realdebrid',
  'rd': 'realdebrid',
  'alldebrid': 'alldebrid',
  'ad': 'alldebrid',
  'premiumize': 'premiumize',
  'pm': 'premiumize',
  'torbox': 'torbox',
  'tb': 'torbox',
  'debridlink': 'debridlink',
  'dl': 'debridlink',
  'offcloud': 'offcloud',
  'easydebrid': 'easydebrid',
  'putio': 'pikpak' // MediaFusion uses 'pikpak' for put.io-like services
 };
 
 const service = providerMapping[debridProvider?.toLowerCase()];
 if (!service) {
  console.log('[MediaFusion] Unknown debrid provider:', debridProvider);
  return MEDIAFUSION_DEFAULT_CONFIG;
 }
 
 const userData = {
  streaming_provider: {
   service: service,
   token: apiKey
  },
  selected_resolutions: ['4k', '2160p', '1080p', '720p', '480p'],
  max_streams_per_resolution: 10,
  enable_catalogs: false, // We only want streams, not catalogs
  show_full_torrent_name: true
 };
 
 try {
  const response = await fetchWithTimeout(`${BASE_MEDIAFUSION}/encrypt-user-data`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(userData),
   timeout: 10000
  });
  
  if (!response.ok) {
   console.log('[MediaFusion] Config API returned status:', response.status);
   return null;
  }
  
  const data = await response.json();
  if (data && data.encrypted_str) {
   console.log('[MediaFusion] Successfully got encrypted config');
   mediafusionConfigCache.set(cacheKey, data.encrypted_str);
   return data.encrypted_str;
  }
  
  // MediaFusion validates debrid credentials - if invalid, it returns error
  if (data && data.status === 'error') {
   console.log('[MediaFusion] Config API validation error:', data.message);
   return null;
  }
  
  console.log('[MediaFusion] Config API returned unexpected data:', Object.keys(data));
  return null;
 } catch (error) {
  console.log('[MediaFusion] Config API error:', error.message);
  return null;
 }
}

/**
 * Build MediaFusion configuration string for a debrid provider (sync wrapper)
 * MediaFusion uses encrypted user data generated via their API
 * @param {string} debridProvider - Provider key
 * @param {string} apiKey - The debrid API key
 * @returns {string} Configuration path (D- for direct mode if no debrid)
 */
function buildMediaFusionConfig(debridProvider, apiKey) {
 // This is a sync function for backwards compatibility
 // The actual config fetching is done async in fetchMediaFusionStreams
 if (!debridProvider || !apiKey) {
  return MEDIAFUSION_DEFAULT_CONFIG;
 }
 // Return a placeholder - the actual config will be fetched async
 return null; // Signal that async config fetch is needed
}

/**
 * Wrap URL with Cloudflare proxy if CF_PROXY_URL is set
 */
function proxyUrl(url) {
 if (!CF_PROXY_URL) return url;
 return `${CF_PROXY_URL}?url=${encodeURIComponent(url)}`;
}

/**
 * METADATA PRESERVATION LAYER
 * Captures and preserves critical technical metadata from original streams
 * This metadata must survive the entire pipeline to reach TV clients
 */
function preserveStreamMetadata(stream, source = 'unknown') {
 if (!stream || typeof stream !== 'object') return stream;
 
 // Extract filename from various possible locations
 function extractFilename(stream) {
 // Try behaviorHints.filename first (most reliable)
 if (stream.behaviorHints && stream.behaviorHints.filename) {
 return stream.behaviorHints.filename;
 }
 
 // Try to extract from title (common in Torrentio streams)
 if (stream.title) {
 // Look for filename patterns in title (after last "/" or standalone filename-like strings)
 const title = stream.title.replace(/\n.*$/s, ''); // Remove everything after first newline
 const filenameMatch = title.match(/([^\/\n]+\.(mkv|mp4|avi|mov|m4v|wmv|flv|webm|ts|m2ts))/i);
 if (filenameMatch) {
 return filenameMatch[1];
 }
 
 // Last resort: use title as filename if it looks like one
 if (/\.(mkv|mp4|avi|mov|m4v|wmv|flv|webm|ts|m2ts)/i.test(title)) {
 return title.split('/').pop().split('\n')[0];
 }
 }
 
 return null;
 }
 
 // Extract trackers from sources array
 function extractTrackers(sources) {
 if (!Array.isArray(sources)) return [];
 return sources
 .filter(source => typeof source === 'string' && source.startsWith('tracker:'))
 .map(source => source.replace(/^tracker:/, ''));
 }
 
 // Create comprehensive metadata preservation object
 const originalMetadata = {
 // File identification - CRITICAL for TV
 fileIdx: stream.fileIdx !== undefined ? stream.fileIdx : 
 stream.fileIndex !== undefined ? stream.fileIndex : 0,
 infoHash: stream.infoHash || null,
 
 // Filename extraction - CRITICAL for codec detection on TV
 filename: extractFilename(stream),
 
 // Preserve original behaviorHints completely
 behaviorHints: stream.behaviorHints ? { ...stream.behaviorHints } : {},
 
 // Sources and trackers - CRITICAL for connection options
 sources: Array.isArray(stream.sources) ? [...stream.sources] : [],
 trackers: extractTrackers(stream.sources),
 
 // Quality information for TV codec decisions
 originalTitle: stream.title || '',
 originalName: stream.name || '',
 originalDescription: stream.description || '', // Preserve for cache status detection
 
 // Source tracking
 source: source,
 
 // Season pack information (for proper file selection)
 isSeasonPack: !!stream.autostreamSeasonPack,
 
 // Preserve any existing video metadata
 videoSize: stream.behaviorHints && stream.behaviorHints.videoSize,
 videoHash: stream.behaviorHints && stream.behaviorHints.videoHash,
 
 // Preserve bingeGroup if present (Torrentio compatibility)
 bingeGroup: stream.behaviorHints && stream.behaviorHints.bingeGroup
 };
 
 // Attach metadata to stream (will survive pipeline)
 const preservedStream = { ...stream };
 preservedStream._originalMetadata = originalMetadata;
 
 return preservedStream;
}
async function fetchJson(url, timeoutMs, log = ()=>{}, useProxy = true) {
 try {
 // Use CF proxy for Torrentio/TPB to bypass IP blocks on Render
 const fetchUrl = useProxy ? proxyUrl(url) : url;
 const r = await fetchWithTimeout(fetchUrl, { redirect: 'follow' }, timeoutMs || 12000);
 if (!r || !r.ok) { 
 log('status', r && r.status, url); 
 return { ok: false, data: null, error: `HTTP ${r ? r.status : 'unknown'}` }; 
 }
 const data = await r.json();
 return { ok: true, data, error: null };
 } catch (e) { 
 log('error', e && e.message || e); 
 return { ok: false, data: null, error: e && e.message || String(e) }; 
 }
}
async function fetchTorrentioStreams(type, id, options = {}, log = ()=>{}) {
 // Build debrid config if credentials provided
 const debridConfig = options.debridProvider && options.debridApiKey 
  ? buildTorrentioConfig(options.debridProvider, options.debridApiKey)
  : '';
 
 const url = debridConfig 
  ? buildTorrentioUrl(BASE_TORRENTIO, type, id, debridConfig)
  : buildUrl(BASE_TORRENTIO, type, id, options.query);
 
 const cached = torrentioCache.get(url); 
 if (cached) return cached;
 
 let streams = [];
 
 // Step 1: Try normal episode format
 const result = await fetchJson(url, 12000, (m,...a)=>log('torrentio',m,...a));
 const j = result.ok ? result.data : null;
 let arr = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
 streams = Array.isArray(arr) ? arr : [];
 
 // Apply metadata preservation to normal streams
 streams = streams.map(stream => {
 const preserved = preserveStreamMetadata(stream, 'torrentio');
 preserved.autostreamOrigin = 'torrentio'; // Set origin for downstream processing
 // Mark as debrid if debrid config was used
 if (debridConfig) {
  preserved._isDebrid = true;
  preserved._debrid = true;
 }
 return preserved;
 });
 
 // Step 2: If no streams and this is a series episode, try season pack format
 if (streams.length === 0 && type === 'series' && id.includes(':')) {
 const seasonId = id.split(':')[0]; // Extract just the IMDB ID
 const seasonUrl = debridConfig
  ? buildTorrentioUrl(BASE_TORRENTIO, type, seasonId, debridConfig)
  : buildUrl(BASE_TORRENTIO, type, seasonId, options.query);
 
 log('torrentio', `Episode format returned 0 streams, trying season pack: ${seasonId}`);
 
 const seasonResult = await fetchJson(seasonUrl, 12000, (m,...a)=>log('torrentio-season',m,...a));
 const seasonJ = seasonResult.ok ? seasonResult.data : null;
 let seasonArr = Array.isArray(seasonJ) ? seasonJ : (seasonJ && Array.isArray(seasonJ.streams) ? seasonJ.streams : []);
 const seasonStreams = Array.isArray(seasonArr) ? seasonArr : [];
 
 if (seasonStreams.length > 0) {
 // Mark these as season pack streams and preserve metadata
 const processedSeasonStreams = seasonStreams.map(stream => {
 const preserved = preserveStreamMetadata(stream, 'torrentio');
 preserved.autostreamOrigin = 'torrentio';
 preserved.autostreamSeasonPack = true;
 preserved.name = (preserved.name || 'Stream') + ' (Season Pack)';
 // Update metadata to reflect season pack status
 preserved._originalMetadata.isSeasonPack = true;
 // Mark as debrid if debrid config was used
 if (debridConfig) {
  preserved._isDebrid = true;
  preserved._debrid = true;
 }
 return preserved;
 });
 
 streams = processedSeasonStreams;
 log('torrentio', `Found ${streams.length} season pack streams`);
 }
 }
 
 torrentioCache.set(url, streams);
 return streams;
}
async function fetchTPBStreams(type, id, query, log = ()=>{}) {
 const url = buildUrl(BASE_TPB, type, id, query);
 const cached = tpbCache.get(url); if (cached) return cached;
 const result = await fetchJson(url, 12000, (m,...a)=>log('tpb',m,...a));
 const j = result.ok ? result.data : null;
 let arr = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
 arr = Array.isArray(arr) ? arr : [];
 
 // Apply metadata preservation to TPB streams
 const preservedStreams = arr.map(stream => {
 const preserved = preserveStreamMetadata(stream, 'tpb');
 preserved.autostreamOrigin = 'tpb'; // Set origin for downstream processing
 return preserved;
 });
 
 tpbCache.set(url, preservedStreams);
 return preservedStreams;
}
function pickCookie(opts) {
 const q = (opts && opts.query) || {};
 return (opts && opts.cookie) || q.dcookie || q.nuvio_cookie || '';
}
async function fetchNuvioStreams(type, id, options = {}, log = ()=>{}) {
 const base = (options.base || BASE_NUVIO || 'https://nuviostreams.hayd.uk').replace(/\/+$/, '');
 const cookie = pickCookie(options);
 const query = Object.assign({ direct: '1' }, options.query || {}, cookie ? { cookie } : {});
 const url = buildUrl(base, type, id, query);
 const cacheKey = url + '#ck=' + (cookie ? '1' : '0');
 const cached = nuvioCache.get(cacheKey); if (cached) return cached;
 const result = await fetchJson(url, 12000, (m,...a)=>log('nuvio',m,...a));
 const j = result.ok ? result.data : null;
 let streams = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
 if (!Array.isArray(streams)) streams = [];
 streams = streams.map(s => {
 if (!s || typeof s !== 'object') return s;
 
 // First, preserve metadata before any modifications
 const preserved = preserveStreamMetadata(s, 'nuvio');
 preserved.autostreamOrigin = 'nuvio';
 
 // Apply cookie handling to preserved stream
 if (cookie && preserved.url && /^https?:\/\//i.test(preserved.url)) {
 const bh = Object.assign({}, preserved.behaviorHints || {});
 const headers = Object.assign({}, bh.proxyHeaders || {});
 headers.Cookie = `ui=${cookie}`;
 preserved.behaviorHints = Object.assign({}, bh, { proxyHeaders: headers });
 
 // Also update the preserved metadata to reflect cookie usage
 preserved._originalMetadata.behaviorHints = preserved.behaviorHints;
 }
 
 return preserved;
 });
 nuvioCache.set(cacheKey, streams);
 return streams;
}

/**
 * Fetch streams from MediaFusion (ElfHosted instance)
 * MediaFusion is an alternative to Torrentio that may not block cloud IPs
 * Uses /{config}/stream/{type}/{id}.json format
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - IMDB ID (tt0111161) or series with season/episode (tt0903747:1:1)
 * @param {Object} options - { debridProvider, debridApiKey, mediafusionConfig }
 * @param {Function} log - Logging function
 */
async function fetchMediaFusionStreams(type, id, options = {}, log = ()=>{}) {
 // Build config - MediaFusion requires encrypted user data via their API
 let config = options.mediafusionConfig;
 
 log('mediafusion', `Starting fetch with options: provider=${options.debridProvider}, hasKey=${!!options.debridApiKey}`);
 
 // If no pre-built config and we have debrid credentials, fetch via API
 if (!config && options.debridProvider && options.debridApiKey) {
  config = await buildMediaFusionConfigViaAPI(options.debridProvider, options.debridApiKey);
  log('mediafusion', `Got config from API: ${config ? config.substring(0, 30) + '...' : 'null'}`);
 }
 
 // If still no valid config, MediaFusion won't work (P2P disabled on ElfHosted)
 if (!config || config === MEDIAFUSION_DEFAULT_CONFIG) {
  log('mediafusion', 'No valid config available - skipping (P2P disabled on ElfHosted)');
  return [];
 }
 
 const url = buildMediaFusionUrl(BASE_MEDIAFUSION, type, id, config);
 const cached = mediafusionCache.get(url);
 if (cached) return cached;
 
 log('mediafusion', 'Fetching from:', url);
 
 // MediaFusion doesn't need proxy - ElfHosted generally allows cloud IPs
 const result = await fetchJson(url, 15000, (m,...a)=>log('mediafusion',m,...a), false);
 const j = result.ok ? result.data : null;
 let arr = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
 arr = Array.isArray(arr) ? arr : [];
 
 // Filter out error/info streams (invalid config messages, etc.)
 arr = arr.filter(stream => {
  if (!stream || !stream.name) return false;
  // Filter out error streams that contain warning messages
  const name = stream.name.toLowerCase();
  const desc = (stream.description || '').toLowerCase();
  if (name.includes('invalid') || desc.includes('invalid')) return false;
  if (name.includes('error') || desc.includes('delete the invalid')) return false;
  if (name.includes('disabled') || desc.includes('non-debrid')) return false;
  return true;
 });
 
 const preservedStreams = arr.map(stream => {
 const preserved = preserveStreamMetadata(stream, 'mediafusion');
 preserved.autostreamOrigin = 'mediafusion';
 return preserved;
 });
 
 log('mediafusion', `Found ${preservedStreams.length} streams`);
 mediafusionCache.set(url, preservedStreams);
 return preservedStreams;
}

/**
 * Fetch streams from Comet (ElfHosted instance)
 * Comet is an alternative to Torrentio that may not block cloud IPs
 * Uses /{b64config}/stream/{type}/{id}.json format
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - IMDB ID (tt0111161) or series with season/episode (tt0903747:1:1)
 * @param {Object} options - { debridProvider, debridApiKey, cometConfig }
 * @param {Function} log - Logging function
 */
async function fetchCometStreams(type, id, options = {}, log = ()=>{}) {
 // Build config with debrid credentials if provided
 let config = options.cometConfig;
 if (!config && options.debridProvider && options.debridApiKey) {
  config = buildCometConfig(options.debridProvider, options.debridApiKey);
 }
 config = config || COMET_DEFAULT_CONFIG;
 
 const url = buildCometUrl(BASE_COMET, type, id, config);
 const cached = cometCache.get(url);
 if (cached) return cached;
 
 log('comet', 'Fetching from:', url);
 
 // Comet doesn't need proxy - ElfHosted generally allows cloud IPs
 const result = await fetchJson(url, 15000, (m,...a)=>log('comet',m,...a), false);
 const j = result.ok ? result.data : null;
 let arr = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
 arr = Array.isArray(arr) ? arr : [];
 
 // Filter out error/info streams (non-debrid disabled messages, etc.)
 arr = arr.filter(stream => {
  if (!stream || !stream.name) return false;
  // Filter out error streams that contain warning messages
  const name = stream.name.toLowerCase();
  const desc = (stream.description || '').toLowerCase();
  if (name.includes('⚠') || name.includes('❌') || name.includes('🚫')) return false;
  if (desc.includes('non-debrid') || desc.includes('disabled')) return false;
  if (desc.includes('obsolete') || desc.includes('reconfigure')) return false;
  return true;
 });
 
 const preservedStreams = arr.map(stream => {
 const preserved = preserveStreamMetadata(stream, 'comet');
 preserved.autostreamOrigin = 'comet';
 // Mark Comet streams as debrid since they come pre-resolved from Comet's debrid service
 preserved._isDebrid = true;
 preserved._debrid = true;
 return preserved;
 });
 
 log('comet', `Found ${preservedStreams.length} streams`);
 cometCache.set(url, preservedStreams);
 return preservedStreams;
}

module.exports = { fetchTorrentioStreams, fetchTPBStreams, fetchNuvioStreams, fetchMediaFusionStreams, fetchCometStreams };
