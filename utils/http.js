'use strict';
async function fetchWithTimeout(url, init = {}, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || 12000);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    return res;
  } finally { clearTimeout(t); }
}
function setCors(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, X-Requested-With');
  } catch (_) {}
}
function writeJson(res, obj, code = 200) {
  try {
    if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (_) {}
  try { res.end(JSON.stringify(obj)); } catch (_) {}
}
module.exports = { fetchWithTimeout, setCors, writeJson };
