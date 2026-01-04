'use strict';

/**
 * Final-pass decorator. Safe, no-op by default if pieces are missing.
 * - Ensures Cookie header for Nuvio/ShowBox-ish links if a ?cookie/dcookie/nuvio_cookie is present on the request URL.
 * - Adds a + prefix when cookie-powered.
 * - Optionally wraps to /autoplay if buildAutoplayUrl is supplied and ?autoplay_wrap=1 is set AND the item is not already wrapped.
 */
function decorateStreams(ctx, streams) {
 try {
 if (!Array.isArray(streams) || !streams.length) return streams;
 ctx = ctx || {};
 const req = ctx.req;
 const imdb = ctx.imdb;
 const provider = ctx.provider || 'nuvio';
 const buildAutoplayUrl = ctx.buildAutoplayUrl;

 // Parse cookie + autoplay flag from the request URL (best-effort)
 let cookieToken = '';
 let autoplayFlag = false;
 try {
 const url = new URL(req.url, `http://${req.headers.host}`);
 cookieToken = url.searchParams.get('cookie') || url.searchParams.get('dcookie') || url.searchParams.get('nuvio_cookie') || '';
 autoplayFlag = url.searchParams.get('autoplay_wrap') === '1';
 } catch {}

 const hasCookie = !!cookieToken;

 // pass 1: header + labels
 streams = streams.map(s => {
 try {
 if (!s || s.autostreamOrigin !== provider) return s;
 if (!s.url || !/^https?:\/\//i.test(String(s.url))) return s;

 const nameTitle = `${s.name || ''} ${s.title || ''}`.toLowerCase();
 const urlStr = String(s.url || '').toLowerCase();
 const isShowBoxish = /showbox|febbox|fbox/.test(nameTitle) || /showbox|febbox|fbox/.test(urlStr);

 if (hasCookie && isShowBoxish) {
 const bh = Object.assign({}, s.behaviorHints || {});
 const headers = Object.assign({}, bh.proxyHeaders || {});
 if (!headers.Cookie) headers.Cookie = `ui=${cookieToken}`;
 s.behaviorHints = Object.assign({}, bh, { proxyHeaders: headers });

 if (typeof s.name === 'string' && !s.name.includes('+')) s.name = `+ ${s.name}`;
 if (typeof s.title === 'string' && !s.title.includes('+')) s.title = `+ ${s.title}`;
 }
 } catch {}
 return s;
 });

 // pass 2: fallback wrapper (only if explicitly requested and we have a URL builder)
 if (autoplayFlag && typeof buildAutoplayUrl === 'function') {
 const nuvioItems = streams.filter(s => s && s.autostreamOrigin === provider && s.url && /^https?:\/\//i.test(String(s.url)));
 if (nuvioItems.length >= 1) {
 const primary = nuvioItems[0].url;
 const backup = (nuvioItems[1] && nuvioItems[1].url) || '';
 streams = streams.map(s => {
 try {
 if (!s || s.autostreamOrigin !== provider) return s;
 if (typeof s.url === 'string' && s.url.startsWith('/autoplay')) return s; // already wrapped by core
 const url = buildAutoplayUrl(req, {
 primary,
 backup,
 imdb,
 provider,
 cookie: cookieToken,
 sizeBytes: s.sizeBytes || s.size || undefined
 });
 return Object.assign({}, s, { url });
 } catch { return s; }
 });
 }
 }

 return streams;
 } catch {
 return streams;
 }
}


// Phase 3 helper: parse a "6.6 GB"/"950 MB" number from stream title
function _parseSizeBytesFromTitle(title) {
 try {
 const m = /([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|GiB|MiB)/i.exec(String(title || ''));
 if (!m) return 0;
 const val = parseFloat(m[1]);
 const unit = m[2].toUpperCase();
 if (!isFinite(val)) return 0;
 const mult = unit.startsWith('G') ? (1024*1024*1024) : (1024*1024);
 return Math.round(val * mult);
 } catch (e) { return 0; }
}
module.exports = { decorateStreams };
