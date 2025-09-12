'use strict';
const { fetchWithTimeout } = require('../utils/http');

// Quick in-memory cache per provider (fast hits during a run)

// PATCH helpers: finalize direct URL and warm it
async function _finalizeDirectUrl(u) {
  try {
    const res = await fetchWithTimeout(u, { method: 'HEAD', redirect: 'follow' }, 8000);
    if (res && typeof res.url === 'string' && res.url.startsWith('http')) return res.url;
  } catch (e) {}
  return u;
}
// Warmup helper: issue a tiny ranged GET to spin up CDN, fallback to HEAD
function _warmUrl(u) {
  setTimeout(() => {
    fetchWithTimeout(u, { 
      method: 'GET', 
      headers: { Range: 'bytes=0-0' } 
    }, 7000).catch(() => {
      fetchWithTimeout(u, { method: 'HEAD' }, 5000).catch(() => {});
    });
  }, 0);
}
const debridCache = { ad: new Map(), rd: new Map(), pm: new Map(), tb: new Map(), oc: new Map() };

// Cross-episode TTL caches (60 minutes)
const _TTL = 60 * 60 * 1000;
function _now() { return Date.now(); }
function _getTTL(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.expires <= _now()) { map.delete(key); return null; }
  return v;
}
function _setTTL(map, key, value) {
  map.set(key, { expires: _now() + _TTL, value: value });
}

// Per-provider heavier-result caches
const adFileListCache = new Map();   // `${apiKey}|${infoHash}` -> { files, isSeason }
const adFileUrlCache  = new Map();   // `${apiKey}|${infoHash}|${fileId}` -> { url }
const tbFileUrlCache  = new Map();   // `${apiKey}|${infoHash}|${fileId}` -> { url }
const ocUrlCache      = new Map();   // `${apiKey}|${infoHashOrMagnet}` -> { url }
const rdFileUrlCache  = new Map();   // `${apiKey}|${infoHash}|${fileId}` -> { url }
// Concurrency limiter for debrid unlocks (throttle to ~3)
const MAX_DEBRID_CONCURRENCY = 3;
let _debridActive = 0;
const _debridQueue = [];
function _withDebridLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      _debridActive++;
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      finally {
        _debridActive--;
        const next = _debridQueue.shift();
        if (next) next();
      }
    };
    if (_debridActive < MAX_DEBRID_CONCURRENCY) run();
    else _debridQueue.push(run);
  });
}


// ---------- season-pack heuristics ----------
const _SEASON_KEYWORDS = ['complete', 'full season'];
const _RE_SEASON = /S\d{1,2}(?:\s|\.|_|-)?(?:Season)?/i;
const _RE_EP = /S(\d{1,2})E(\d{1,2})/i;
const GB = 1024 * 1024 * 1024;

function isSeasonPackLike(args) {
  const name = args && args.name ? String(args.name) : '';
  const sizeBytes = args && args.sizeBytes ? args.sizeBytes : 0;
  const files = args && Array.isArray(args.files) ? args.files : [];

  const nm = name.toLowerCase();
  for (var i = 0; i < _SEASON_KEYWORDS.length; i++) {
    if (nm.indexOf(_SEASON_KEYWORDS[i]) !== -1) return true;
  }
  if (_RE_SEASON.test(nm) && !_RE_EP.test(nm)) return true;

  var epCount = 0;
  for (var j = 0; j < files.length; j++) {
    const fn = String(files[j].name || files[j].filename || files[j].path || '');
    if (_RE_EP.test(fn)) epCount++;
  }
  if (epCount >= 3) return true;

  if (sizeBytes && sizeBytes / GB > 25) return true;
  return false;
}

function findEpisodeFile(files, season, episode) {
  if (!Array.isArray(files)) return null;

  // Prefer explicit SxxEyy
  for (var i = 0; i < files.length; i++) {
    const fn = String(files[i].name || files[i].filename || files[i].path || '');
    const m = fn.match(_RE_EP);
    if (m) {
      const s = parseInt(m[1], 10);
      const e = parseInt(m[2], 10);
      if (s === season && e === episode) return files[i];
    }
  }
  // If index exists, try episode-1
  for (var k = 0; k < files.length; k++) {
    if (typeof files[k].index === 'number') {
      return files[episode - 1] || files[k];
    }
  }
  // Fallback by order
  return files[episode - 1] || files[0] || null;
}

/** Flatten AllDebrid file trees into a simple list */
function flattenAllDebridFiles(nodes) {
  const out = [];
  function visit(arr) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it) continue;

      const hasLeaf = it.name || it.filename || it.file;
      if (hasLeaf) {
        out.push({
          id: it.id || it.file_id || it.fileId || it.ident || null,
          index: (typeof it.index === 'number') ? it.index
               : (typeof it.idx === 'number') ? it.idx
               : (typeof it.fileIdx === 'number') ? it.fileIdx
               : null,
          name: it.name || it.filename || (it.file && it.file.name) || '',
          size: it.size || it.filesize || (it.file && it.file.size) || 0,
          link: it.link || (it.file && it.file.link) || it.l || null,
          l: it.l
        });
      }
      if (Array.isArray(it.files)) visit(it.files);
      if (Array.isArray(it.children)) visit(it.children);
    }
  }
  visit(nodes);
  return out;
}

// ----------------------------
// AllDebrid
// ----------------------------
async function resolveAllDebrid(infoHash, apiKey, log, opts) {
  log = typeof log === 'function' ? log : function(){};
  opts = opts || {};
  const agent = 'AutoStream/1.0';
  const magnet = 'magnet:?xt=urn:btih:' + infoHash;

  // Upload (idempotent if cached on AD side)
  const uploadUrl = 'https://api.alldebrid.com/v4/magnet/upload' +
    '?apikey=' + encodeURIComponent(apiKey) +
    '&magnets[]=' + encodeURIComponent(magnet);

  var magnetId = null;
  var magnetName = '';
  var magnetSize = 0;

  try {
    const res = await fetchWithTimeout(uploadUrl, { method: 'GET', headers: { 'User-Agent': agent } }, 15000);
    if (!res.ok) return null;
    const uj = await res.json();
    const arr = uj && uj.data && uj.data.magnets;
    if (uj && uj.status === 'success' && Array.isArray(arr) && arr.length > 0) {
      const m0 = arr[0];
      magnetId = m0.id;
      magnetName = m0.filename || m0.name || '';
      magnetSize = m0.size || m0.bytes || 0;
    } else {
      return null;
    }
  } catch (e) { return null; }
  if (!magnetId) return null;

  function pickFirstMagnet(json) {
    if (!json || !json.data) return null;
    if (Array.isArray(json.data.magnets) && json.data.magnets.length) return json.data.magnets[0];
    if (json.data.magnet) return json.data.magnet;
    if (json.data.magnets && typeof json.data.magnets === 'object') {
      const keys = Object.keys(json.data.magnets);
      if (keys.length) return json.data.magnets[keys[0]];
    }
    return null;
  }
  async function adStatusById(id) {
    const url = 'https://api.alldebrid.com/v4/magnet/status?apikey=' + encodeURIComponent(apiKey) + '&id=' + encodeURIComponent(id);
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': agent } }, 15000);
    if (!r.ok) return null;
    return r.json();
  }
  async function adStatusByIdsArray(id) {
    const url = 'https://api.alldebrid.com/v4/magnet/status?apikey=' + encodeURIComponent(apiKey) + '&ids[]=' + encodeURIComponent(id);
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': agent } }, 15000);
    if (!r.ok) return null;
    return r.json();
  }

  // Poll to hydrate metadata or grab file list when available
  var mg = null;
  for (var i = 0; i < 8; i++) {
    try {
      var sj = await adStatusById(magnetId);
      mg = pickFirstMagnet(sj);
      if (!mg) {
        sj = await adStatusByIdsArray(magnetId);
        mg = pickFirstMagnet(sj);
      }
      if (mg) {
        magnetName = magnetName || mg.filename || mg.name || magnetName;
        magnetSize = magnetSize || mg.size || mg.bytes || magnetSize;
        break;
      }
    } catch (e) {}
    await new Promise(function(r){ setTimeout(r, 1500); });
  }

  // Files listing
  var filesArr = null;
  try {
    const filesUrl = 'https://api.alldebrid.com/v4/magnet/files?apikey=' + encodeURIComponent(apiKey) + '&id=' + encodeURIComponent(magnetId);
    const fres = await fetchWithTimeout(filesUrl, { method: 'GET', headers: { 'User-Agent': agent } }, 15000);
    if (fres.ok) {
      const fj = await fres.json();
      if (fj && fj.status === 'success') {
        if (fj.data && Array.isArray(fj.data.files)) filesArr = flattenAllDebridFiles(fj.data.files);
        else if (fj.data && fj.data.magnets && fj.data.magnets[0] && fj.data.magnets[0].files) filesArr = flattenAllDebridFiles(fj.data.magnets[0].files);
        else if (fj.data && fj.data.magnet && fj.data.magnet.files) filesArr = flattenAllDebridFiles(fj.data.magnet.files);
      }
    }
  } catch (e) {}

  if ((!filesArr || !filesArr.length) && mg && mg.files) filesArr = flattenAllDebridFiles(mg.files);
  if (!filesArr || !filesArr.length) return null;

  const seasonLike = isSeasonPackLike({ name: magnetName, sizeBytes: magnetSize, files: filesArr });
  try { _setTTL(adFileListCache, apiKey + '|' + infoHash, { files: filesArr, isSeason: seasonLike }); } catch (e) {}

  const desiredFileIdx = (typeof opts.fileIdx === 'number') ? opts.fileIdx : null;
  var top = null;

  if (desiredFileIdx !== null) {
    // by index property or by array index
    for (var a = 0; a < filesArr.length; a++) {
      if (typeof filesArr[a].index === 'number' && filesArr[a].index === desiredFileIdx) { top = filesArr[a]; break; }
    }
    if (!top) top = filesArr[desiredFileIdx] || null;
  }

  if (!top && seasonLike && opts.meta && opts.meta.type === 'series' &&
      typeof opts.meta.season === 'number' && typeof opts.meta.episode === 'number') {
    top = findEpisodeFile(filesArr, opts.meta.season, opts.meta.episode);
  }

  if (!top) {
    filesArr.sort(function(a,b){ return (b.size || 0) - (a.size || 0); });
    top = filesArr[0];
  }
  if (!top) return null;

  var hosterLink = null;
  if (top.link) hosterLink = Array.isArray(top.link) ? top.link[0] : top.link;
  if (!hosterLink && top.l) hosterLink = Array.isArray(top.l) ? top.l[0] : top.l;
  if (!hosterLink) return null;

  const fileId = top.id || top.file_id || top.fileId || top.name || String(desiredFileIdx !== null ? desiredFileIdx : 0);
  const urlKey = apiKey + '|' + infoHash + '|' + fileId;
  const cachedUrl = _getTTL(adFileUrlCache, urlKey);
  if (cachedUrl && cachedUrl.value) return cachedUrl.value;

  const unlocked = await adUnlock(hosterLink, apiKey);
  if (unlocked) { try { _setTTL(adFileUrlCache, urlKey, unlocked); } catch (e) {} }
  return unlocked || null;
}

// ----------------------------
// Real-Debrid
// ----------------------------
async function resolveRealDebrid(infoHash, apiKey, log, opts) {
  log = typeof log === 'function' ? log : function(){};
  opts = opts || {};
  try {
    const base = 'https://api.real-debrid.com/rest/1.0';
    const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/x-www-form-urlencoded' };
    const magnet = 'magnet:?xt=urn:btih:' + infoHash;

    const addRes = await fetchWithTimeout(base + '/torrents/addMagnet', {
      method: 'POST', headers: headers, body: new URLSearchParams({ magnet: magnet }).toString()
    }, 12000);
    if (!addRes.ok) return null;
    const addJson = await addRes.json();
    const torrentId = (addJson && (addJson.id || addJson.hash || (addJson.torrent && addJson.torrent.id))) || null;
    if (!torrentId) return null;

    async function rdInfo(id) {
      const r = await fetchWithTimeout(base + '/torrents/info/' + encodeURIComponent(id), { headers: headers }, 12000);
      if (!r.ok) return null;
      return r.json();
    }

    let info = await rdInfo(torrentId);
    if (!info) return null;

    var files = [];
    if (Array.isArray(info.files)) {
      for (var i = 0; i < info.files.length; i++) {
        var f = info.files[i];
        files.push({
          id: f.id,
          name: f.path || f.filename || '',
          size: f.bytes || f.filesize || 0
        });
      }
    }

    const seasonLike = isSeasonPackLike({ name: info.filename || '', sizeBytes: info.bytes || 0, files: files });

    const desiredFileIdx = (typeof opts.fileIdx === 'number') ? opts.fileIdx : null;
    var pick = null;
    if (desiredFileIdx !== null) {
      for (var a = 0; a < files.length; a++) {
        if (files[a].id === desiredFileIdx) { pick = files[a]; break; }
      }
      if (!pick) pick = files[desiredFileIdx] || null;
    }
    if (!pick && seasonLike && opts.meta && opts.meta.type === 'series' &&
        typeof opts.meta.season === 'number' && typeof opts.meta.episode === 'number') {
      pick = findEpisodeFile(files, opts.meta.season, opts.meta.episode);
    }
    if (!pick) {
      files.sort(function(x,y){ return (y.size||0)-(x.size||0); });
      pick = files[0];
    }
    if (!pick) return null;

    const selRes = await fetchWithTimeout(base + '/torrents/selectFiles/' + encodeURIComponent(torrentId), {
      method: 'POST', headers: headers, body: new URLSearchParams({ files: String(pick.id) }).toString()
    }, 12000);
    if (!selRes.ok) return null;

    var links = null;
    const start = Date.now();
    while (Date.now() - start < 20000) {
      info = await rdInfo(torrentId);
      if (info && Array.isArray(info.links) && info.links.length) { links = info.links; break; }
      await new Promise(function(r){ setTimeout(r, 1500); });
    }
    if (!links || !links.length) return null;

    var link = links[0];
    if (pick && pick.name) {
      const low = String(pick.name).toLowerCase().split('/').pop().slice(0, 12);
      for (var li = 0; li < links.length; li++) {
        const L = String(links[li]).toLowerCase();
        if (L.indexOf(low) !== -1) { link = links[li]; break; }
      }
    }

    const urlKey = apiKey + '|' + infoHash + '|' + pick.id;
    const cachedUrl = _getTTL(rdFileUrlCache, urlKey);
    if (cachedUrl && cachedUrl.value) return cachedUrl.value;

    const unres = await fetchWithTimeout(base + '/unrestrict/link', {
      method: 'POST', headers: headers, body: new URLSearchParams({ link: link }).toString()
    }, 12000);
    if (!unres.ok) return null;
    const uj = await unres.json();
    const direct = uj && uj.download;
    if (typeof direct === 'string' && direct.indexOf('http') === 0) {
      const finalUrl = await _finalizeDirectUrl(direct);
      try { _setTTL(rdFileUrlCache, urlKey, finalUrl); } catch (e) {}
      _warmUrl(finalUrl);
      return finalUrl;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// ----------------------------
// Premiumize (stub - safe no-op)
// ----------------------------
async function resolvePremiumize(infoHash, apiKey, log, opts) {
  return null;
}

// ----------------------------
// TorBox
// ----------------------------
async function resolveTorBox(infoHashOrMagnet, apiKey, log, opts) {
  log = typeof log === 'function' ? log : function(){};
  opts = opts || {};
  try {
    const isMagnet = (typeof infoHashOrMagnet === 'string') && infoHashOrMagnet.indexOf('magnet:') === 0;
    const body = isMagnet ? { magnet: infoHashOrMagnet } : { hash: infoHashOrMagnet };

    const infoRes = await fetchWithTimeout('https://api.torbox.app/v1/api/torrents/torrentinfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body)
    }, 12000);
    if (!infoRes.ok) return null;
    const info = await infoRes.json();

    const files = (info && info.data && Array.isArray(info.data.files)) ? info.data.files : [];
    if (!files.length) return null;

    const desiredFileIdx = (typeof opts.fileIdx === 'number') ? opts.fileIdx : null;
    var pick = null;
    if (desiredFileIdx !== null) {
      for (var a = 0; a < files.length; a++) {
        if (typeof files[a].index === 'number' && files[a].index === desiredFileIdx) { pick = files[a]; break; }
      }
      if (!pick) pick = files[desiredFileIdx] || null;
    }
    if (!pick && opts.meta && opts.meta.type === 'series' &&
        typeof opts.meta.season === 'number' && typeof opts.meta.episode === 'number') {
      pick = findEpisodeFile(files, opts.meta.season, opts.meta.episode);
    }
    if (!pick) {
      // biggest file
      files.sort(function(x,y){ return (y.size||0)-(x.size||0); });
      pick = files[0];
    }
    if (!pick) return null;

    const fileId = pick.id || pick.file_id || pick.fileId || pick.name || String(desiredFileIdx !== null ? desiredFileIdx : 0);
    const urlKey = apiKey + '|' + infoHashOrMagnet + '|' + fileId;
    const cached = _getTTL(tbFileUrlCache, urlKey);
    if (cached && cached.value) return cached.value;

    const streamRes = await fetchWithTimeout('https://api.torbox.app/v1/api/stream/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ id: pick.id })
    }, 12000);
    if (!streamRes.ok) return null;
    const stream = await streamRes.json();
    const url = (stream && stream.data && stream.data.url) ? stream.data.url : (stream && stream.url) ? stream.url : null;
    if (typeof url === 'string' && url.indexOf('http') === 0) {
      const finalUrl = await _finalizeDirectUrl(url);
      try { _setTTL(tbFileUrlCache, urlKey, finalUrl); } catch (e) {}
      _warmUrl(finalUrl);
      return finalUrl;
    }
    return null;
  } catch (err) { return null; }
}

// ----------------------------
// Offcloud
// ----------------------------
async function resolveOffcloud(linkOrMagnet, apiKey, log, opts) {
  log = typeof log === 'function' ? log : function(){};
  opts = opts || {};
  try {
    const cacheKey = apiKey + '|' + linkOrMagnet;
    const cached = _getTTL(ocUrlCache, cacheKey);
    if (cached && cached.value) return cached.value;

    const submitUrl = 'https://offcloud.com/api/remote/download';
    const params = new URLSearchParams({ key: apiKey, url: linkOrMagnet });
    const submitRes = await fetchWithTimeout(submitUrl + '?' + params.toString(), { method: 'POST' }, 12000);
    if (!submitRes.ok) return null;
    const submit = await submitRes.json();
    const taskId = submit && (submit.requestId || submit.id || (submit.result && submit.result.id));
    if (!taskId) return null;

    const statusUrl = 'https://offcloud.com/api/remote/status';
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const st = await fetchWithTimeout(statusUrl + '?' + new URLSearchParams({ key: apiKey, id: String(taskId) }), { method: 'POST' }, 8000);
      if (!st.ok) break;
      const body = await st.json();
      const ready = (body && (body.status === 'done' || body.status === 'finished')) || (body && body.result && body.result.status === 'done');
      const url = (body && body.url) || (body && body.result && body.result.url);
      if (ready && url) {
  try { _setTTL(ocUrlCache, cacheKey, url); } catch (e) {}
  const finalUrl = await _finalizeDirectUrl(url);
  _warmUrl(finalUrl);
  return finalUrl; }
      await new Promise(function(r){ setTimeout(r, 1500); });
    }
    return null;
  } catch (err) { return null; }
}

// ----------------------------
// AllDebrid link unlock
// ----------------------------
async function adUnlock(hosterLink, apiKey) {
  const unlockUrl = 'https://api.alldebrid.com/v4/link/unlock' +
    '?apikey=' + encodeURIComponent(apiKey) +
    '&link=' + encodeURIComponent(hosterLink);
  try {
    const ures = await fetchWithTimeout(unlockUrl, { method: 'GET' }, 12000);
    if (!ures.ok) return null;
    const uj = await ures.json();
    const direct = uj && uj.data && uj.data.link;
    if (typeof direct === 'string' && direct.indexOf('http') === 0) {
      const finalUrl = await _finalizeDirectUrl(direct);
      _warmUrl(finalUrl);
      return finalUrl;
    }
    return null;
  } catch (e) { return null; }
}

// ----------------------------
// Provider dispatcher
// ----------------------------
async function resolveWithDebrid(provider, infoHashOrMagnet, apiKey, log, opts) {
  log = typeof log === 'function' ? log : function(){};
  opts = opts || {};
  const cache = debridCache[provider];
  if (!cache) return null;

  const cacheKey = (typeof opts.fileIdx === 'number') ? (infoHashOrMagnet + '|' + String(opts.fileIdx)) : infoHashOrMagnet;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  var url = null;
  try {
    if (provider === 'ad') url = await resolveAllDebrid(infoHashOrMagnet, apiKey, log, opts);
    else if (provider === 'rd') url = await resolveRealDebrid(infoHashOrMagnet, apiKey, log, opts);
    else if (provider === 'pm') url = await resolvePremiumize(infoHashOrMagnet, apiKey, log, opts);
    else if (provider === 'tb') url = await resolveTorBox(infoHashOrMagnet, apiKey, log, opts);
    else if (provider === 'oc') url = await resolveOffcloud(infoHashOrMagnet, apiKey, log, opts);
  } catch (e) {}
  if (url) cache.set(cacheKey, url);
  return url || null;
}

// ----------------------------
// Apply debrid to streams
// ----------------------------
async function applyDebridToStreams(streams, params, log, meta) {
  log = typeof log === 'function' ? log : function(){};
  meta = meta || null;
  try {
    if (!Array.isArray(streams) || streams.length === 0) return streams;

    const providers = [];
    if (params.has('ad') && params.get('ad')) providers.push(['ad', params.get('ad')]);
    if (params.has('rd') && params.get('rd')) providers.push(['rd', params.get('rd')]);
    if (params.has('pm') && params.get('pm')) providers.push(['pm', params.get('pm')]);
    if (params.has('tb') && params.get('tb')) providers.push(['tb', params.get('tb')]);
    if (params.has('oc') && params.get('oc')) providers.push(['oc', params.get('oc')]);
    if (!providers.length) return streams;

    const resolveAll = (params.get('debridAll') === '1' || params.get('resolveAll') === '1');

    const tasks = streams.map(function(s, idx) {
      return _withDebridLimit(async function () {
        const stream = Object.assign({}, s);
        if (!stream.infoHash) return stream;
        if (idx > 1 && !resolveAll) return stream; // fast path: top 2 unless overridden

        for (var p = 0; p < providers.length; p++) {
          const prov = providers[p][0];
          const key = providers[p][1];
          try {
            const unlocked = await resolveWithDebrid(prov, stream.infoHash, key, log, { fileIdx: stream.fileIdx, meta: meta });
            if (unlocked) {
              stream.url = unlocked;
              stream.behaviorHints = Object.assign({}, stream.behaviorHints || {}, { notWebReady: false });
              delete stream.infoHash;
              delete stream.fileIdx;
              break;
            }
          } catch (e) {}
        }
        return stream;
      })();
    });

    return await Promise.all(tasks);
  } catch (e) {
    return streams;
  }
}

module.exports = {
  resolveWithDebrid,
  resolveAllDebrid,
  resolveRealDebrid,
  resolvePremiumize,
  resolveTorBox,
  resolveOffcloud,
  adUnlock,
  applyDebridToStreams
};
