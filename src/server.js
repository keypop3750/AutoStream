'use strict';
const http = require('http');
const { URL } = require('url');

const { PORT, AUTOSTREAM_DEBUG } = require('./constants');
const { setCors, writeJson } = require('./utils/http');
const { fetchMeta } = require('./services/meta');
const { fetchTorrentioStreams, fetchTPBStreams } = require('./services/sources');
// const { providerTagFromParams } = require('./utils/config');
const { formatStreams } = require('./core/format');
const { applyDebridToStreams } = require('./services/debrid');
const { filterByMaxSize, sortByLanguagePreference } = require('./core/filters');
const { pickStreams } = require('./core/score');

// restore providerTagFromParams
function providerTagFromParams(params) {
  if (params.ad) return "AD";
  if (params.rd) return "RD";
  if (params.pm) return "PM";
  if (params.tb) return "TB";
  if (params.oc) return "OC";
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

      // --- Debrid params
      function getDebridParams() {
        const p = new URLSearchParams();
        ['ad','rd','pm','tb','oc'].forEach(k => { if (q.has(k) && q.get(k)) p.set(k, q.get(k)); });
        const map = { ad:'ad', rd:'rd', pm:'pm', tb:'tb', oc:'oc' };
        const d = String(q.get('debrid')||'').toLowerCase();
        const apikey = q.get('apikey');
        if (d && apikey && !p.has(d) && map[d]) p.set(map[d], apikey);
        return p;
      }
      const debridParams = getDebridParams();
      const useDebrid = ['ad','rd','pm','tb','oc'].some(k => debridParams.has(k));
      const include1080 = q.get('fallback') === '1';

      // new filters
      const maxSize = Number(q.get('max_size') || 0);
      const langPrio = String(q.get('lang_prio') || '').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);

      // UI configure page
      if (path === '/' || path === '/configure') {
        const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
        const { configureHtml } = require('./ui/configure');
        const html = configureHtml(origin);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      // manifest.json
      if (path === '/manifest.json') {
        const params = Object.fromEntries(q.entries());
        const manifest = {
          id: 'com.stremio.autostream.addon',
          version: '2.2.1',
          name: (providerTagFromParams(params) ? ('AutoStream (' + providerTagFromParams(params) + ')') : 'AutoStream'),
          description: 'Curated best-pick streams with optional debrid; includes 1080p fallback, season-pack acceleration, and pre-warmed next-episode caching.',
          logo: 'https://github.com/keypop3750/AutoStream/blob/main/logo.png?raw=true',
          resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
          types: ['movie', 'series'],
          catalogs: [],
          behaviorHints: { configurable: true, configurationRequired: false }
        };
        return writeJson(res, manifest, 200);
      }

// /stream route
const m = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
if (m) {
  const type = m[1];
  const id = decodeURIComponent(m[2]);
  log('Request:', type, id);

  let meta = null;
  try { meta = await fetchMeta(type, id); } catch(_) {}

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

  // Final selection
  const selected = pickStreams(streams, useDebrid, include1080, log);

  // Beautify titles
  const metaInfo = await fetchMeta(type, id, log);          
  const paramsObj = Object.fromEntries(q.entries());
  const providerTag = providerTagFromParams(paramsObj);
  let formatted = formatStreams(metaInfo, selected, providerTag);

  // Respond
  return writeJson(res, { streams: formatted }, 200);
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
