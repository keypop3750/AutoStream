'use strict';

/**
 * Rate Limiter Middleware
 * Prevents abuse and protects debrid APIs
 */

class RateLimiter {
 constructor(maxRequests = 50, windowMs = 60000) {
 this.requests = new Map();
 this.maxRequests = maxRequests;
 this.windowMs = windowMs;
 this.maxCacheSize = 10000; // Prevent memory leaks
 
 // Cleanup old entries every minute
 setInterval(() => this.cleanup(), 60000);
 }
 
 isAllowed(key) {
 const now = Date.now();
 const userRequests = this.requests.get(key) || [];
 
 // Remove old requests outside the window
 const validRequests = userRequests.filter(time => now - time < this.windowMs);
 
 if (validRequests.length >= this.maxRequests) {
 return false;
 }
 
 validRequests.push(now);
 this.requests.set(key, validRequests);
 return true;
 }
 
 cleanup() {
 const now = Date.now();
 const keysToDelete = [];
 
 for (const [key, requests] of this.requests.entries()) {
 const validRequests = requests.filter(time => now - time < this.windowMs);
 if (validRequests.length === 0) {
 keysToDelete.push(key);
 } else {
 this.requests.set(key, validRequests);
 }
 }
 
 // Delete empty entries
 keysToDelete.forEach(key => this.requests.delete(key));
 
 // Prevent unbounded growth
 if (this.requests.size > this.maxCacheSize) {
 const entries = Array.from(this.requests.entries());
 const toRemove = entries
 .sort((a, b) => Math.max(...a[1]) - Math.max(...b[1]))
 .slice(0, this.requests.size - this.maxCacheSize);
 toRemove.forEach(([key]) => this.requests.delete(key));
 console.log(`[RateLimiter] Cleaned ${toRemove.length} entries to prevent memory leak`);
 }
 }
 
 getStats() {
 return {
 activeKeys: this.requests.size,
 maxCacheSize: this.maxCacheSize
 };
 }
}

// Singleton instance for general rate limiting
const generalRateLimiter = new RateLimiter(50, 60000);

// Stricter rate limiter for play requests (debrid API calls)
const playRateLimiter = new RateLimiter(30, 60000);

module.exports = {
 RateLimiter,
 generalRateLimiter,
 playRateLimiter
};
