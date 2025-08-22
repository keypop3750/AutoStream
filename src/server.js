'use strict';
// AutoStream server with language priority + video size limit
const http = require('http');
const { URL } = require('url');

const { PORT, AUTOSTREAM_DEBUG } = require('./constants');
const { setCors, writeJson } = require('./utils/http');
const { createLogger } = require('./utils/logger');
const { fetchMeta } = require('./services/meta');
const { fetchTorrentioStreams, fetchTPBStreams } = require('./services/sources');
const { applyDebridToStreams } = require('./services/debrid');
const { filterByMaxSize, sortByLanguagePreference } = require('./core/filters');
const { pickStreams } = require('./core/score');
const { formatStreams } = require('./core/format'); // needed for clean titles

// Robust provider tag helper (works with URLSearchParams or plain object)
// Also supports ?debrid=ad|rd|pm|tb|oc
function providerTagFromParams(params) {
  const getter = (k) => {
    if (!params) return '';
    if (typeof params.get === 'function') return params.get(k) || '';
    return params[k] || '';
  };
  // direct keys (ad/rd/pm/tb/oc)
  if (getter('ad')) return 'AD';
  if (getter('rd')) return 'RD';
  if (getter('pm')) return 'PM';
  if (getter('tb')) return 'TB';
  if (getter('oc')) return 'OC';
  // debrid=ad|rd|pm|tb|oc
  const d = String(getter('debrid') || '').toLowerCase();
  if (['ad','rd','pm','tb','oc'].includes(d)) return d.toUpperCase();
  return null;
}

function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    try {
      setCors(res);

      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const q = url.searchParams;

      const debug = AUTOSTREAM_DEBUG || q.get('debug') === '1';
      const log = (...args) => { if (debug) console.log('[AutoStream]', ...args); };

      // 1) Quick connectivity check
      if (path === '/ping') {
        return writeJson(res, {
          ok: true,
          ua: String(req.headers['user-agent'] || ''),
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        }, 200);
      }

      // 2) What manifest is Android actually getting?
      if (path === '/manifest.debug') {
        const ua = String(req.headers['user-agent'] || '');
        const paramsObj = Object.fromEntries(q.entries());
        return writeJson(res, { ua, params: paramsObj }, 200);
      }


      // Helpers
      function getDebridParams() {
        // Copy only supported provider keys (ad/rd/pm/tb/oc)
        const p = new URLSearchParams();
        ['ad','rd','pm','tb','oc'].forEach(k => { if (q.has(k) && q.get(k)) p.set(k, q.get(k)); });
        // Back-compat: also accept ?debrid=rd&apikey=... and map it
        const d = String(q.get('debrid')||'').toLowerCase();
        const apikey = q.get('apikey');
        if (d && apikey && !p.has(d)) p.set(d, apikey);
        return p;
      }
      const debridParams = getDebridParams();
      const useDebrid = ['ad','rd','pm','tb','oc'].some(k => debridParams.has(k));
      const include1080 = q.has('fallback') ? q.get('fallback') === '1' : true;

      // New prefs
      const maxSize  = Number(q.get('max_size') || 0);
      const langPrio = String(q.get('lang_prio') || '').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);

      // Configure UI
      if (path === '/' || path === '/configure') {
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const { configureHtml } = require('./ui/configure');
        const html = configureHtml(origin);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

// Manifest
if (path === '/manifest.json') {
  // If the app/browser tries to "open" the manifest like a page,
  // show the Configure UI instead (fixes Configure button opening JSON in-app)
  const accept = String(req.headers['accept'] || '').toLowerCase();
  const isDocLike = accept.includes('text/html') || accept.includes('text/*');
  if (isDocLike || q.get('config') === '1') {
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    res.writeHead(302, { Location: origin + '/configure' });
    return res.end();
  }

  const paramsObj = Object.fromEntries(q.entries());
  const tag = providerTagFromParams(paramsObj);

  // Broad Android client detection (phones, TV, okhttp)
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const isAndroidLike = ua.includes('android') || ua.includes('okhttp') || ua.includes('stremio tv');

  const base = {
    id: 'com.stremio.autostream.addon',
    version: '2.4.3', // bump so Android refetches
    name: tag ? `AutoStream (${tag})` : 'AutoStream',
    description: 'Curated best-pick streams with optional debrid; includes 1080p fallback, season-pack acceleration, and pre-warmed next-episode caching.',
    logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',

    // Top-level declarations for widest compatibility
    types: ['movie', 'series'],
    idPrefixes: ['tt'],

    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  };

  // Android gets the simplest form; desktop/web keep both
  const manifest = isAndroidLike
    ? { ...base, resources: ['stream'] }
    : { ...base, resources: ['stream', { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }] };

  return writeJson(res, manifest, 200);
}


// Fallback: some Android builds call /stream/<id>.json without the type segment.
// We infer type: ID with `:season:episode` -> series, otherwise movie.
{
  const m0 = path.match(/^\/stream\/([^\/]+)\.json$/);
  if (m0 && !/^(movie|series)$/.test(m0[1])) {
    const idOnly = decodeURIComponent(m0[1]); // tt... or tt...:S:E
    const inferredType = idOnly.includes(':') ? 'series' : 'movie';
    const redirectTo = `/stream/${inferredType}/${encodeURIComponent(idOnly)}.json${url.search || ''}`;
    res.writeHead(302, { Location: redirectTo });
    return res.end();
  }
}




      // /stream/:type/:id.json
      const m = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
      if (m) {
        const type = m[1];
        const id = decodeURIComponent(m[2]);
        log('Request:', type, id);

        // Optional meta (for debrid helpers etc.)
        let meta = null;
        try { meta = await fetchMeta(type, id, log); } catch(_) {}

        // Fetch from sources in parallel
        const [a, b] = await Promise.all([
          fetchTorrentioStreams(type, id, {}, log),
          fetchTPBStreams(type, id, {}, log)
        ]);
        let combined = [].concat(a || [], b || []);
        log('Fetched streams:', combined.length);

        // Apply prefs BEFORE selection
        combined = filterByMaxSize(combined, maxSize);
        combined = sortByLanguagePreference(combined, langPrio);

        // Pick winners (respects include1080 + debrid-awareness)
        const selected = pickStreams(combined, useDebrid, include1080, log);

        // Clean titles + "AutoStream (AD/RD/...)" name
        const metaInfo = (meta && meta.name) ? meta : await fetchMeta(type, id, log);
        const providerTag = providerTagFromParams(q); // works with URLSearchParams
        let streams = formatStreams(metaInfo, selected, providerTag);

        // Fully unlock the final list so Stremio starts from a direct URL
        const unlockParams = new URLSearchParams(q);
        unlockParams.set('debridAll', '1'); // resolve every returned stream (not just top 2)
        streams = await applyDebridToStreams(streams, unlockParams, log, meta);

        // Cache hints for faster UI (like Torrentio)
        return writeJson(res, {
          streams,
          cacheMaxAge: 3600,      // 1 hour
          staleRevalidate: 21600, // 6 hours
          staleError: 86400       // 24 hours
        }, 200);
      }

      // default 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');

    } catch (e) {
      console.error('Server error:', e && e.stack || e);
      writeJson(res, { streams: [] }, 200);
    }
  });

  server.listen(port, () => {
    console.log('AutoStream addon running at http://localhost:' + port);
    console.log('Configure at: http://localhost:' + port + '/configure');
    console.log('Debug: append ?debug=1 to any request or set AUTOSTREAM_DEBUG=1');
  });
  return server;
}

if (require.main === module) startServer(PORT);

module.exports = { startServer };
