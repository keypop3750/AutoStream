
'use strict';

/**
 * Lightweight in-memory stats aggregator.
 * Safe to require multiple times (single module instance).
 */
const stats = {
 streamsServed: 0,
 providers: Object.create(null), // { provider: { count, totalLatencyMs } }
 lastReset: Date.now(),
 cookies: Object.create(null) // { cookieHash: { bytes: number, last: ts } } // if used by router/reliability
};

function recordStreamServed({ provider, latencyMs }) {
 stats.streamsServed++;
 const p = String(provider || 'unknown').toLowerCase();
 if (!stats.providers[p]) stats.providers[p] = { count: 0, totalLatencyMs: 0 };
 stats.providers[p].count++;
 if (typeof latencyMs === 'number' && isFinite(latencyMs) && latencyMs >= 0) {
 stats.providers[p].totalLatencyMs += latencyMs;
 }
}

function averageLatencyMs(provider) {
 const p = String(provider || 'unknown').toLowerCase();
 const ent = stats.providers[p];
 if (!ent || !ent.count) return null;
 return Math.round(ent.totalLatencyMs / ent.count);
}

function snapshot({ reliability } = {}) {
 let blacklisted = 0;
 let cookieSummary = {};
 try {
 if (reliability && typeof reliability.dump === 'function') {
 const d = reliability.dump() || {};
 const hosts = d.hosts || {};
 const now = Date.now();
 blacklisted = Object.values(hosts).filter(h => h && h.blUntil && h.blUntil > now).length;
 cookieSummary = d.cookies || {};
 }
 } catch (_) {}
 const avgByProvider = {};
 Object.keys(stats.providers).forEach(p => {
 const avg = averageLatencyMs(p);
 if (avg != null) avgByProvider[p] = avg;
 });
 return {
 since: stats.lastReset,
 streamsServed: stats.streamsServed,
 avgLatencyMs: avgByProvider,
 providers: stats.providers,
 blacklistedHosts: blacklisted,
 cookieUsage: cookieSummary
 };
}

function reset() {
 stats.streamsServed = 0;
 stats.providers = Object.create(null);
 stats.lastReset = Date.now();
}

module.exports = { recordStreamServed, snapshot, reset };
