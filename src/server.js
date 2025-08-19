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
const { computeScore, pickStreams } = require('./core/score');

function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    try {
      setCors(res);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const q = url.searchParams;
      const debug = AUTOSTREAM_DEBUG || q.get('debug') === '1';
      const log = (...args) => { if (debug) console.log('[AutoStream]', ...args); };

      // Helpers
      function getDebridParams() {
        // Copy only supported provider keys (ad/rd/pm/tb/oc)
        const p = new URLSearchParams();
        ['ad','rd','pm','tb','oc'].forEach(k => { if (q.has(k) && q.get(k)) p.set(k, q.get(k)); });
        // Back-compat: also accept ?debrid=rd&apikey=... and map it
        const map = { ad:'ad', rd:'rd', pm:'pm', tb:'tb', oc:'oc' };
        const d = String(q.get('debrid')||'').toLowerCase();
        const apikey = q.get('apikey');
        if (d && apikey && !p.has(d) && map[d]) p.set(map[d], apikey);
        return p;
      }
      const debridParams = getDebridParams();
      const useDebrid = ['ad','rd','pm','tb','oc'].some(k => debridParams.has(k));
      const include1080 = q.get('fallback') === '1';

      // New prefs
      const maxSize = Number(q.get('max_size') || 0);
      const langPrio = String(q.get('lang_prio') || '').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);

      if (path === '/' || path === '/configure') {
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const { configureHtml } = require('./ui/configure');
        const html = configureHtml(origin);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

const parsedUrl = url.parse(req.url);
const pathname = parsedUrl.pathname;

if (pathname === '/manifest.json') {
  const params = querystring.parse(parsedUrl.query);

  const manifest = {
    id: 'com.stremio.autostream.addon',
    version: '2.1.1',
    name: (providerTagFromParams(params) ? ('AutoStream (' + providerTagFromParams(params) + ')') : 'AutoStream'),
    description: 'Curated best-pick streams with optional debrid; includes 1080p fallback, season-pack acceleration, and pre-warmed next-episode caching.',
    logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  };

  writeJson(res, manifest, 200);
  return;
}



      // /stream/:type/:id.json
      const m = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
      if (m) {
        const type = m[1];
        const id = decodeURIComponent(m[2]);
        log('Request:', type, id);

        // Optional meta (for naming in debrid, etc.)
        let meta = null;
        try { meta = await fetchMeta(type, id); } catch(_) {}

        // Fetch from sources in parallel
        const [a, b] = await Promise.all([
          fetchTorrentioStreams(type, id, {}, log),
          fetchTPBStreams(type, id, {}, log)
        ]);
        let streams = [].concat(a || [], b || []);
        log('Fetched streams:', streams.length);

        // Debrid resolving / marking
        streams = await applyDebridToStreams(streams, debridParams, log, meta);

        // Apply new prefs
        streams = filterByMaxSize(streams, maxSize);
        streams = sortByLanguagePreference(streams, langPrio);

        // Final selection (keeps your existing quality/speed logic)
        const picked = pickStreams(streams, useDebrid, include1080, log);
        return writeJson(res, { streams: picked });
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
