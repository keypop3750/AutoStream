'use strict';
// ============================
// File: src/server.js (patched)
// ============================
const http = require('http');
const { URL } = require('url');

const { PORT, AUTOSTREAM_DEBUG } = require('./constants');
const { setCors, writeJson } = require('./utils/http');
const { createLogger } = require('./utils/logger');
const { TTLCache } = require('./utils/cache');
const { providerTagFromParams, hasDebrid } = require('./utils/config');
const { fetchMeta } = require('./services/meta');
const { fetchTorrentioStreams, fetchTPBStreams } = require('./services/sources');
const { applyDebridToStreams } = require('./services/debrid');
const { pickStreams } = require('./core/score');
const { formatStreams } = require('./core/format');
const { configureHtml } = require('./ui/configure');

// Cache final /stream JSON responses for 60 minutes (TTL set in TTLCache default)
const streamResponseCache = new TTLCache({ max: 1000, ttlMs: 60 * 60 * 1000 });

function makeCacheKey(pathname, params) {
  return [
    pathname,
    'ad=' + (params.get('ad') || ''),
    'rd=' + (params.get('rd') || ''),
    'pm=' + (params.get('pm') || ''),
    'tb=' + (params.get('tb') || ''),
    'oc=' + (params.get('oc') || ''),
    'fallback=' + (params.get('fallback') || ''),
    'all=' + (params.get('debridAll') || params.get('resolveAll') || '')
  ].join('|');
}

// Core pipeline used by both the route handler and the pre-warmer
async function computePayload(type, id, params, log) {
  const useDebrid = hasDebrid(params);
  const include1080 = params.has('fallback') ? params.get('fallback') === '1' : true;

  // Build meta for debrid (enables season-pack episode picking)
  let meta = null;
  if (type === 'series') {
    const parts = id.split(':'); // "tt1234567:SEASON:EPISODE"
    const imdb = parts[0];
    const season = parts.length > 1 ? parseInt(parts[1], 10) : null;
    const episode = parts.length > 2 ? parseInt(parts[2], 10) : null;
    meta = { type: 'series', imdb, season, episode };
  } else {
    meta = { type: 'movie', imdb: id };
  }

  const query = Object.fromEntries(params.entries());
  const torrentio = await fetchTorrentioStreams(type, id, query, log);
  let combined = torrentio;
  if (!useDebrid) {
    const tpb = await fetchTPBStreams(type, id, query, log);
    combined = torrentio.concat(tpb);
  }
  const selected = pickStreams(combined, useDebrid, include1080, log);
  const metaInfo = await fetchMeta(type, id, log);
  const providerTag = providerTagFromParams(params);
  let streams = formatStreams(metaInfo, selected, providerTag);
  streams = await applyDebridToStreams(streams, params, log, meta);
  return { streams };
}

// Fire-and-forget next-episode prefetcher (N episodes ahead)
function prewarmNextEpisodes(type, id, params, log, count = 2) {
  try {
    if (type !== 'series') return;
    const parts = id.split(':');
    if (parts.length < 3) return;
    const imdb = parts[0];
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);
    if (!imdb || !Number.isInteger(season) || !Number.isInteger(episode)) return;

    for (let i = 1; i <= count; i++) {
      const nextId = `${imdb}:${season}:${episode + i}`;
      const pathname = `/stream/${type}/${encodeURIComponent(nextId)}.json`;
      const cacheKey = makeCacheKey(pathname, params);

      if (streamResponseCache.get(cacheKey)) {
        log('Prewarm: cache already warm for', nextId);
        continue;
      }
      setTimeout(async () => {
        const start = Date.now();
        try {
          const payload = await computePayload(type, nextId, params, () => {});
          streamResponseCache.set(cacheKey, payload);
          log('Prewarm: filled cache for', nextId, `in ${Date.now() - start}ms`);
        } catch (e) {
          log('Prewarm error for', nextId, e && e.message ? e.message : e);
        }
      }, 0);
    }
  } catch (e) {
    log('Prewarm setup error:', e && e.message ? e.message : e);
  }
}

function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://' + req.headers.host);
    const debugEnabled = AUTOSTREAM_DEBUG || urlObj.searchParams.get('debug') === '1';
    const log = createLogger(debugEnabled, req.method + ' ' + urlObj.pathname);

    try {
      setCors(res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const pathname = urlObj.pathname;
      const params = urlObj.searchParams;

      if (pathname === '/configure') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(configureHtml('http://' + req.headers.host));
        return;
      }

      if (pathname === '/manifest.json') {
        const manifest = {
          id: 'com.stremio.autostream.addon',
          version: '2.1.1',
          name: (providerTagFromParams(params) ? ('AutoStream (' + providerTagFromParams(params) + ')') : 'AutoStream'),
          description: 'Curated best-pick streams with optional debrid; includes 1080p fallback, season-pack acceleration, and pre-warmed next-episode caching.',
          logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
          resources: [ { name: 'stream', types: ['movie','series'], idPrefixes: ['tt'] } ],
          types: ['movie','series'],
          catalogs: [],
          behaviorHints: { configurable: true, configurationRequired: false }
        };
        writeJson(res, manifest, 200);
        return;
      }

      // Streams route
      const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\.]+)\.json$/);
      if (streamMatch) {
        const type = streamMatch[1];
        const id = decodeURIComponent(streamMatch[2]);

        // Trigger prewarm immediately (does not block the response)
        prewarmNextEpisodes(type, id, params, log, 2);

        const cacheKey = makeCacheKey(pathname, params);
        const skipCache = params.get('debug') === '1' || params.get('cacheBust') === '1';
        if (!skipCache) {
          const cached = streamResponseCache.get(cacheKey);
          if (cached) {
            log('Final-response cache HIT');
            writeJson(res, cached, 200);
            return;
          }
        }

        const payload = await computePayload(type, id, params, log);
        if (!skipCache) streamResponseCache.set(cacheKey, payload);
        writeJson(res, payload, 200);
        return;
      }

      writeJson(res, { err: 'Not found' }, 404);
    } catch (err) {
      console.error('Unhandled error:', err);
      writeJson(res, { err: 'Internal error' }, 500);
    }
  });
  server.listen(port, () => {
    console.log('AutoStream addon running at http://localhost:' + port);
    console.log('Configure at: http://localhost:' + port + '/configure');
    console.log('Debug: append ?debug=1 to any request or set AUTOSTREAM_DEBUG=1');
  });
  return server;
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { startServer };