'use strict';

// Simple TTL + size-limited cache with LRU eviction.
class TTLCache {
  constructor({ max = 400, ttlMs = 60 * 60 * 1000 } = {}) { // default 60 minutes
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map(); // key -> { value, expiresAt }
  }

  _now() { return Date.now(); }

  _purgeIfExpired(key, entry) {
    if (!entry) return false;
    if (entry.expiresAt <= this._now()) {
      this.map.delete(key);
      return true;
    }
    return false;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this._purgeIfExpired(key, entry)) return undefined;
    // refresh LRU ordering
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    // evict if needed
    while (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: this._now() + this.ttlMs });
  }

  delete(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

module.exports = { TTLCache };
