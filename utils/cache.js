'use strict';
class TTLCache {
 constructor({ max = 500, ttlMs = 60 * 60 * 1000 } = {}) {
 this.max = max; this.ttlMs = ttlMs; this.map = new Map();
 }
 get(key) {
 const e = this.map.get(key);
 if (!e) return undefined;
 if (e.expires > Date.now()) return e.val;
 this.map.delete(key);
 return undefined;
 }
 set(key, val) {
 if (this.map.size >= this.max) {
 const k = this.map.keys().next().value;
 if (k !== undefined) this.map.delete(k);
 }
 this.map.set(key, { val, expires: Date.now() + this.ttlMs });
 }
}
module.exports = { TTLCache };
