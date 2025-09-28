'use strict';
const { TTLCache } = require('../utils/cache');
const { fetchWithTimeout } = require('../utils/http');
const { BASE_TORRENTIO, BASE_TPB, BASE_NUVIO } = require('../constants');

const torrentioCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 });
const tpbCache       = new TTLCache({ max: 300, ttlMs: 60 * 60 * 1000 });
const nuvioCache     = new TTLCache({ max: 500, ttlMs: 12 * 60 * 1000 });

function buildUrl(base, type, id, query) {
  const qs = new URLSearchParams(query || {}).toString();
  return `${base.replace(/\/+$/, '')}/stream/${type}/${encodeURIComponent(id)}.json${qs ? ('?' + qs) : ''}`;
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
async function fetchJson(url, timeoutMs, log = ()=>{}) {
  try {
    const r = await fetchWithTimeout(url, { redirect: 'follow' }, timeoutMs || 12000);
    if (!r || !r.ok) { log('status', r && r.status, url); return null; }
    return await r.json();
  } catch (e) { log('error', e && e.message || e); return null; }
}
async function fetchTorrentioStreams(type, id, query, log = ()=>{}) {
  const url = buildUrl(BASE_TORRENTIO, type, id, query);
  const cached = torrentioCache.get(url); 
  if (cached) return cached;
  
  let streams = [];
  
  // Step 1: Try normal episode format
  const j = await fetchJson(url, 12000, (m,...a)=>log('torrentio',m,...a));
  let arr = Array.isArray(j) ? j : (j && Array.isArray(j.streams) ? j.streams : []);
  streams = Array.isArray(arr) ? arr : [];
  
  // Apply metadata preservation to normal streams
  streams = streams.map(stream => {
    const preserved = preserveStreamMetadata(stream, 'torrentio');
    preserved.autostreamOrigin = 'torrentio'; // Set origin for downstream processing
    return preserved;
  });
  
  // Step 2: If no streams and this is a series episode, try season pack format
  if (streams.length === 0 && type === 'series' && id.includes(':')) {
    const seasonId = id.split(':')[0]; // Extract just the IMDB ID
    const seasonUrl = buildUrl(BASE_TORRENTIO, type, seasonId, query);
    
    log('torrentio', `Episode format returned 0 streams, trying season pack: ${seasonId}`);
    
    const seasonJ = await fetchJson(seasonUrl, 12000, (m,...a)=>log('torrentio-season',m,...a));
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
  const j = await fetchJson(url, 12000, (m,...a)=>log('tpb',m,...a));
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
  const j = await fetchJson(url, 12000, (m,...a)=>log('nuvio',m,...a));
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
module.exports = { fetchTorrentioStreams, fetchTPBStreams, fetchNuvioStreams };
