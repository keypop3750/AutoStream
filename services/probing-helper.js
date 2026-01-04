
'use strict';

const { probeLatency, probeThroughput } = require('./probes');

/**
 * annotateNuvioProbes(list, { budgetMs, log })
 * Adds _latencyMs + _mbps to top few Nuvio streams within a total time budget.
 */
async function annotateNuvioProbes(list, { budgetMs = 1500, log = ()=>{} } = {}) {
 if (!Array.isArray(list) || !list.length) return;
 const nuvioTop = list.filter(s => s && s.autostreamOrigin === 'nuvio' && /^https?:/i.test(s.url)).slice(0, 5);
 const t0 = Date.now();
 for (const s of nuvioTop) {
 if (Date.now() - t0 > budgetMs) break;
 try {
 const lat = await probeLatency(s.url, { timeoutMs: 900 });
 s._latencyMs = lat && lat.ok ? lat.latencyMs : 999999;

 const hasCookie = !!(s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.Cookie);
 if (hasCookie && (Date.now() - t0) < budgetMs - 400) {
 const thr = await probeThroughput(s.url, { timeoutMs: 1200, bytes: 512 * 1024 });
 s._mbps = thr && thr.ok ? thr.throughputMBps : 0;
 }
 } catch (e) {
 log('probe.error', (e && e.message) || e);
 }
 }
}

module.exports = { annotateNuvioProbes };
