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
  
  // Step 2: If no streams and this is a series episode, try season pack format
  if (streams.length === 0 && type === 'series' && id.includes(':')) {
    const seasonId = id.split(':')[0]; // Extract just the IMDB ID
    const seasonUrl = buildUrl(BASE_TORRENTIO, type, seasonId, query);
    
    log('torrentio', `Episode format returned 0 streams, trying season pack: ${seasonId}`);
    
    const seasonJ = await fetchJson(seasonUrl, 12000, (m,...a)=>log('torrentio-season',m,...a));
    let seasonArr = Array.isArray(seasonJ) ? seasonJ : (seasonJ && Array.isArray(seasonJ.streams) ? seasonJ.streams : []);
    const seasonStreams = Array.isArray(seasonArr) ? seasonArr : [];
    
    if (seasonStreams.length > 0) {
      // Mark these as season pack streams
      seasonStreams.forEach(stream => {
        stream.autostreamSeasonPack = true;
        stream.name = (stream.name || 'Stream') + ' (Season Pack)';
      });
      
      streams = seasonStreams;
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
  tpbCache.set(url, arr);
  return arr;
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
    s.autostreamOrigin = 'nuvio';
    if (cookie && s.url && /^https?:\/\//i.test(s.url)) {
      const bh = Object.assign({}, s.behaviorHints || {});
      const headers = Object.assign({}, bh.proxyHeaders || {});
      headers.Cookie = `ui=${cookie}`;
      s.behaviorHints = Object.assign({}, bh, { proxyHeaders: headers });
    }
    return s;
  });
  nuvioCache.set(cacheKey, streams);
  return streams;
}
module.exports = { fetchTorrentioStreams, fetchTPBStreams, fetchNuvioStreams };
