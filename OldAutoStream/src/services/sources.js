'use strict';
const { TTLCache } = require('../utils/cache');
const { fetchWithTimeout } = require('../utils/http');
const { BASE_TORRENTIO, BASE_TPB } = require('../constants');

// Cache raw results for 60 minutes
const torrentioCache = new TTLCache({ max: 500, ttlMs: 60 * 60 * 1000 });
const tpbCache       = new TTLCache({ max: 300, ttlMs: 60 * 60 * 1000 });

function buildUrl(base, type, id, query) {
  const qs = new URLSearchParams(query || {}).toString();
  return `${base}/stream/${type}/${id}.json${qs ? ('?' + qs) : ''}`;
}

async function fetchTorrentioStreams(type, id, query, log = () => {}) {
  const url = buildUrl(BASE_TORRENTIO, type, id, query);
  const cached = torrentioCache.get(url);
  if (cached) { log('Torrentio cache HIT:', url); return cached; }

  log('Fetch Torrentio:', url);
  const res = await fetchWithTimeout(url, { method: 'GET' }, 15000);
  if (!res.ok) throw new Error(`Torrentio fetch failed: ${res.status}`);
  const json = await res.json();
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  torrentioCache.set(url, streams);
  log('Torrentio streams:', streams.length);
  return streams;
}

async function fetchTPBStreams(type, id, query, log = () => {}) {
  const url = buildUrl(BASE_TPB, type, id, query);
  const cached = tpbCache.get(url);
  if (cached) { log('TPB+ cache HIT:', url); return cached; }

  try {
    log('Fetch TPB+:', url);
    const res = await fetchWithTimeout(url, { method: 'GET' }, 15000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const streams = Array.isArray(data.streams) ? data.streams : [];
    tpbCache.set(url, streams);
    return streams;
  } catch (err) {
    log('Error fetching TPB streams:', err && err.message ? err.message : err);
    return [];
  }
}

module.exports = { fetchTorrentioStreams, fetchTPBStreams };
