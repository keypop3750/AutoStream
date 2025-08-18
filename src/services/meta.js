'use strict';
const { BASE_CINEMETA } = require('../constants');
const { fetchWithTimeout } = require('../utils/http');

// --------- In-memory Cinemeta cache (TTL + LRU) ---------
const META_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const META_MAX = 500;
const metaCache = new Map(); // key -> { value, ts }

function _metaKey(type, id) {
  return type + '|' + id;
}

function _metaGet(type, id) {
  const k = _metaKey(type, id);
  const rec = metaCache.get(k);
  if (!rec) return null;
  if ((Date.now() - rec.ts) > META_TTL_MS) { metaCache.delete(k); return null; }
  // refresh LRU
  metaCache.delete(k); metaCache.set(k, rec);
  return rec.value;
}

function _metaSet(type, id, value) {
  const k = _metaKey(type, id);
  if (metaCache.has(k)) metaCache.delete(k);
  metaCache.set(k, { value, ts: Date.now() });
  // simple trim (LRU behavior via re-insertion order)
  while (metaCache.size > META_MAX) {
    const firstKey = metaCache.keys().next().value;
    metaCache.delete(firstKey);
  }
}

async function fetchMeta(type, id, log) {
  const cached = _metaGet(type, id);
  if (cached) { log('Meta cache hit'); return cached; }
  try {
    let imdb = id;
    let season = null;
    let episode = null;
    if (type === 'series' && id.includes(':')) {
      const parts = id.split(':');
      imdb = parts[0];
      season = parts[1] ? parseInt(parts[1], 10) : null;
      episode = parts[2] ? parseInt(parts[2], 10) : null;
    }
    const metaUrl = BASE_CINEMETA + '/' + type + '/' + imdb + '.json';
    log('Fetch meta:', metaUrl);
    const res = await fetch(metaUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const name = json.meta && json.meta.name ? json.meta.name : imdb;
    const out = { name, season, episode };
    _metaSet(type, id, out);
    return out;
  } catch (err) {
    log('Error fetching Cinemeta meta:', err.message || err);
    if (id.includes(':')) {
      const parts = id.split(':');
      const imdb = parts[0];
      const season = parts[1] ? parseInt(parts[1], 10) : null;
      const episode = parts[2] ? parseInt(parts[2], 10) : null;
      const out = { name: imdb, season, episode };
      _metaSet(type, id, out);
      return out;
    }
    const out = { name: id, season: null, episode: null };
    _metaSet(type, id, out);
    return out;
  }
}

module.exports = { fetchMeta };
