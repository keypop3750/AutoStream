const axios = require('axios');

// Cache for tracker enhancement results (24h TTL as per analysis)
const enhancementCache = new Map(); // infoHash -> { trackers: [], ts: number }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 2000; // Prevent unbounded memory growth

// Fallback trackers - well-known, stable trackers for when SeedSphere is down
const FALLBACK_TRACKERS = [
 'udp://tracker.opentrackr.org:1337/announce',
 'udp://tracker.openbittorrent.com:6969/announce',
 'udp://9.rarbg.to:2710/announce',
 'udp://exodus.desync.com:6969/announce',
 'https://tracker.nanoha.org:443/announce',
 'udp://open.stealth.si:80/announce',
 'udp://tracker.tiny-vps.com:6969/announce',
 'udp://fasttracker.foreverpirates.co:6969/announce'
];

// Configuration
const MAX_TRACKERS_TOTAL = 15; // Cap to prevent URI bloat
const UDP_RATIO = 0.7; // 70% UDP, 30% HTTP(S) for balanced mix
const ENHANCEMENT_TIMEOUT = 2000; // 2s timeout for sidecar call

/**
 * Heuristic to determine if a stream should get tracker enhancement
 * Based on analysis: low-seed content and optionally mid-seed with slow start
 */
function shouldEnhance(streamMetadata) {
 const { seeds = 0, peers = 0, avgStartTime = 0, name = '' } = streamMetadata;
 
 // Debug logging to trace enhancement decisions
 const decision = (() => {
 // Always enhance for low-health content
 if (seeds < 10) return { enhance: true, reason: `low_seeds(${seeds})` };
 
 // Optionally enhance mid-health if slow start times
 if (seeds < 50 && avgStartTime > 3000) return { enhance: true, reason: `mid_seeds_slow_start(${seeds},${avgStartTime}ms)` };
 
 return { enhance: false, reason: `high_seeds(${seeds})` };
 })();
 
 // Log decision for debugging
 if (decision.enhance) {
 console.log(`[LINK] Will enhance "${name}" - ${decision.reason}`);
 } else {
 console.log(`⏭ Skip enhance "${name}" - ${decision.reason}`);
 }
 
 return decision.enhance;
}

/**
 * Parse existing trackers from magnet URL
 */
function parseExistingTrackers(magnetUrl) {
 try {
 const url = new URL(magnetUrl);
 const trackers = url.searchParams.getAll('tr');
 return trackers;
 } catch (error) {
 return [];
 }
}

/**
 * Extract info hash from magnet URL
 */
function extractInfoHash(magnetUrl) {
 try {
 const url = new URL(magnetUrl);
 const xt = url.searchParams.get('xt');
 if (xt && xt.startsWith('urn:btih:')) {
 return xt.substring(9); // Remove 'urn:btih:' prefix
 }
 return null;
 } catch (error) {
 return null;
 }
}

/**
 * Curate tracker list: dedupe, balance UDP/HTTP, cap total
 */
function curateTrackers(existingTrackers, newTrackers) {
 // Dedupe against existing trackers
 const existing = new Set(existingTrackers.map(t => t.toLowerCase()));
 const candidates = newTrackers.filter(t => !existing.has(t.toLowerCase()));
 
 if (candidates.length === 0) return [];
 
 // Separate UDP and HTTP trackers
 const udpTrackers = candidates.filter(t => t.startsWith('udp://'));
 const httpTrackers = candidates.filter(t => t.startsWith('http'));
 
 // Calculate how many we can add (respecting total cap)
 const currentTotal = existingTrackers.length;
 const availableSlots = Math.max(0, MAX_TRACKERS_TOTAL - currentTotal);
 
 if (availableSlots === 0) return [];
 
 // Calculate balanced mix
 const targetUdp = Math.floor(availableSlots * UDP_RATIO);
 const targetHttp = availableSlots - targetUdp;
 
 // Select balanced set
 const selectedUdp = udpTrackers.slice(0, Math.min(targetUdp, udpTrackers.length));
 const selectedHttp = httpTrackers.slice(0, Math.min(targetHttp, httpTrackers.length));
 
 return [...selectedUdp, ...selectedHttp];
}

/**
 * Call SeedSphere-style tracker enhancement service
 * In real implementation, this would call an actual SeedSphere instance
 */
async function fetchHealthyTrackers(infoHash, metadata) {
 // For now, simulate SeedSphere response with fallback trackers
 // In production, this would call: GET /api/trackers/enhance?ih=${infoHash}
 
 try {
 // Simulate SeedSphere call with timeout
 await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network call
 
 // Return curated fallback trackers (simulate SeedSphere response)
 return FALLBACK_TRACKERS.slice(0, 8); // Return subset of fallback trackers
 
 } catch (error) {
 console.warn('SeedSphere tracker fetch failed:', error.message);
 return FALLBACK_TRACKERS.slice(0, 5); // Minimal fallback set
 }
}

/**
 * Enhance magnet URL with additional healthy trackers
 */
async function enhanceMagnet(magnetUrl, metadata = {}) {
 // Never fail streams due to enhancement failure
 try {
 // Check if enhancement is needed
 if (!shouldEnhance(metadata)) {
 return magnetUrl;
 }
 
 const infoHash = extractInfoHash(magnetUrl);
 if (!infoHash) {
 return magnetUrl; // Can't enhance without info hash
 }
 
 // Check cache first (24h TTL)
 const now = Date.now();
 const cached = enhancementCache.get(infoHash);
 if (cached && (now - cached.ts) < CACHE_TTL_MS) {
 return buildEnhancedMagnet(magnetUrl, cached.trackers);
 }
 
 // Parse existing trackers
 const existingTrackers = parseExistingTrackers(magnetUrl);
 
 // Fetch healthy trackers with timeout
 const healthyTrackers = await Promise.race([
 fetchHealthyTrackers(infoHash, metadata),
 new Promise((_, reject) => 
 setTimeout(() => reject(new Error('Enhancement timeout')), ENHANCEMENT_TIMEOUT)
 )
 ]);
 
 // Curate tracker list
 const curatedTrackers = curateTrackers(existingTrackers, healthyTrackers);
 
 // Cache result
 enhancementCache.set(infoHash, {
 trackers: curatedTrackers,
 ts: now
 });
 
 // Build enhanced magnet
 return buildEnhancedMagnet(magnetUrl, curatedTrackers);
 
 } catch (error) {
 console.warn('Tracker enhancement failed, using original magnet:', error.message);
 return magnetUrl; // Always fallback to original
 }
}

/**
 * Build enhanced magnet URL with additional trackers
 */
function buildEnhancedMagnet(originalMagnet, additionalTrackers) {
 if (additionalTrackers.length === 0) {
 return originalMagnet;
 }
 
 try {
 const url = new URL(originalMagnet);
 
 // Add new trackers
 additionalTrackers.forEach(tracker => {
 url.searchParams.append('tr', tracker);
 });
 
 return url.toString();
 
 } catch (error) {
 console.warn('Failed to build enhanced magnet:', error.message);
 return originalMagnet;
 }
}

/**
 * Get enhancement statistics for telemetry
 */
function getEnhancementStats() {
 return {
 cacheSize: enhancementCache.size,
 cacheHits: 0, // Could track this with counters
 fallbackTrackers: FALLBACK_TRACKERS.length,
 maxTrackersTotal: MAX_TRACKERS_TOTAL,
 udpRatio: UDP_RATIO
 };
}

/**
 * Clear old cache entries (cleanup) and enforce max size
 */
function cleanupCache() {
 const now = Date.now();
 let expired = 0;
 
 // Remove expired entries
 for (const [infoHash, entry] of enhancementCache.entries()) {
 if (now - entry.ts > CACHE_TTL_MS) {
 enhancementCache.delete(infoHash);
 expired++;
 }
 }
 
 // LRU eviction if still over limit
 if (enhancementCache.size > MAX_CACHE_SIZE) {
 const entries = Array.from(enhancementCache.entries());
 const toRemove = entries
 .sort((a, b) => a[1].ts - b[1].ts)
 .slice(0, enhancementCache.size - MAX_CACHE_SIZE);
 toRemove.forEach(([key]) => enhancementCache.delete(key));
 if (toRemove.length > 0) {
 console.log(`[TrackerEnhancement] LRU evicted ${toRemove.length} entries, cache size: ${enhancementCache.size}`);
 }
 }
}

// Cleanup cache every hour
setInterval(cleanupCache, 60 * 60 * 1000);

module.exports = {
 enhanceMagnet,
 shouldEnhance,
 getEnhancementStats,
 cleanupCache
};
