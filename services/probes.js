'use strict';

async function withTimeout(promiseFactory, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await promiseFactory(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function headOnce(url, { timeoutMs = 900 } = {}) {
  try {
    const res = await withTimeout((signal) => fetch(url, { method: 'HEAD', redirect: 'manual', signal }), timeoutMs);
    return res;
  } catch { return null; }
}

async function rangeOnce(url, { timeoutMs = 1200, start = 0, bytes = 1 } = {}) {
  try {
    const end = start + Math.max(0, bytes - 1);
    const res = await withTimeout((signal) => fetch(url, {
      method: 'GET',
      headers: { 'Range': `bytes=${start}-${end}` },
      redirect: 'manual',
      signal
    }), timeoutMs);
    return res;
  } catch { return null; }
}

async function probeLatency(url, { timeoutMs = 900 } = {}) {
  const t0 = Date.now();
  const res = await headOnce(url, { timeoutMs });
  if (res && res.status >= 200 && res.status < 400) {
    return { ok: true, status: res.status, latencyMs: Math.max(1, Date.now() - t0) };
  }
  const t1 = Date.now();
  const r2 = await rangeOnce(url, { timeoutMs, bytes: 1 });
  if (r2 && r2.status >= 200 && r2.status < 400) {
    return { ok: true, status: r2.status, latencyMs: Math.max(1, Date.now() - t1) };
  }
  return { ok: false, status: (res && res.status) || (r2 && r2.status) || 0, latencyMs: 0 };
}

async function probeThroughput(url, { timeoutMs = 1200, bytes = 512 * 1024 } = {}) {
  const t0 = Date.now();
  const res = await rangeOnce(url, { timeoutMs, start: 0, bytes });
  if (!res || !(res.status >= 200 && res.status < 400)) {
    return { ok: false, status: res ? res.status : 0, throughputMBps: 0 };
  }
  const buf = await res.arrayBuffer();
  const dt = (Date.now() - t0) / 1000;
  const got = buf.byteLength || 0;
  const mbps = dt > 0 ? (got / (1024 * 1024)) / dt : 0;
  return { ok: true, status: res.status, bytes: got, throughputMBps: mbps };
}

module.exports = { probeLatency, probeThroughput };
