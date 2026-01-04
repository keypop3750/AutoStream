/**
 * penaltyReliability.js
 * 
 * Permanent penalty-based reliability system with file persistence
 * - Hosts get -50 points per failure (permanent until success)
 * - Hosts regain +50 points per success (only up to their natural score)
 * - No time-based expiry, no permanent exclusion
 * - Simple persistent penalty counter per host
 * - File-based persistence for reliability across restarts
 */

const fs = require('fs');
const path = require('path');

// File path for persistence
const DATA_DIR = path.join(__dirname, '..', 'data');
const PENALTY_FILE = path.join(DATA_DIR, 'penalties.json');

// In-memory penalty storage
const hostPenalties = new Map(); // host -> penalty points (always >= 0)

// Configuration
const PENALTY_PER_FAILURE = 50;
const RECOVERY_PER_SUCCESS = 50;
const MAX_PENALTY = 500; // Cap to prevent excessive penalties
const MAX_HOSTS = 5000; // Max hosts to track (LRU eviction after this)
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour cleanup
const SAVE_DEBOUNCE = 5000; // 5 seconds debounce for saves

// Debounce timer for saves
let saveTimer = null;

/**
 * Load penalties from file on startup
 */
function loadPenalties() {
 try {
 // Ensure data directory exists
 if (!fs.existsSync(DATA_DIR)) {
 fs.mkdirSync(DATA_DIR, { recursive: true });
 }
 
 if (fs.existsSync(PENALTY_FILE)) {
 const data = JSON.parse(fs.readFileSync(PENALTY_FILE, 'utf-8'));
 let count = 0;
 for (const [host, penalty] of Object.entries(data)) {
 if (typeof penalty === 'number' && penalty > 0) {
 hostPenalties.set(host, Math.min(penalty, MAX_PENALTY));
 count++;
 }
 }
 if (count > 0) {
 console.log(` Loaded ${count} host penalties from file`);
 }
 }
 } catch (e) {
 console.warn(`[WARN] Could not load penalties file: ${e.message}`);
 }
}

/**
 * Save penalties to file (debounced)
 */
function savePenalties() {
 // Clear any existing timer
 if (saveTimer) {
 clearTimeout(saveTimer);
 }
 
 // Debounce saves to avoid excessive I/O
 saveTimer = setTimeout(() => {
 try {
 // Ensure data directory exists
 if (!fs.existsSync(DATA_DIR)) {
 fs.mkdirSync(DATA_DIR, { recursive: true });
 }
 
 const data = Object.fromEntries(hostPenalties.entries());
 fs.writeFileSync(PENALTY_FILE, JSON.stringify(data, null, 2));
 } catch (e) {
 console.warn(`[WARN] Could not save penalties file: ${e.message}`);
 }
 }, SAVE_DEBOUNCE);
}

// Load penalties on module initialization
loadPenalties();

class PenaltyReliability {
 constructor() {
 this.startCleanupTimer();
 }

 /**
 * Extract hostname from URL
 */
 hostFromUrl(url) {
 try {
 const { hostname } = new URL(url);
 return hostname.toLowerCase();
 } catch (e) {
 return null;
 }
 }

 /**
 * Mark a stream failure - adds penalty points
 */
 markFail(url) {
 const host = this.hostFromUrl(url);
 if (!host) return;

 const currentPenalty = hostPenalties.get(host) || 0;
 const newPenalty = Math.min(currentPenalty + PENALTY_PER_FAILURE, MAX_PENALTY);
 
 hostPenalties.set(host, newPenalty);
 savePenalties(); // Persist to file
 
 console.log(`[FAIL] Stream failure: ${host} (penalty: ${currentPenalty} → ${newPenalty})`);
 }

 /**
 * Mark a stream success - reduces penalty points (if any)
 */
 markOk(url) {
 const host = this.hostFromUrl(url);
 if (!host) return;

 const currentPenalty = hostPenalties.get(host) || 0;
 if (currentPenalty === 0) return; // No penalty to recover from

 const newPenalty = Math.max(0, currentPenalty - RECOVERY_PER_SUCCESS);
 
 if (newPenalty === 0) {
 hostPenalties.delete(host);
 } else {
 hostPenalties.set(host, newPenalty);
 }
 
 savePenalties(); // Persist to file
 console.log(`[OK] Stream success: ${host} (penalty: ${currentPenalty} → ${newPenalty})`);
 }

 /**
 * Get current penalty for a host
 */
 getPenalty(url) {
 const host = this.hostFromUrl(url);
 if (!host) return 0;
 
 return hostPenalties.get(host) || 0;
 }

 /**
 * Get penalty for host by hostname
 */
 getPenaltyByHost(hostname) {
 return hostPenalties.get(hostname.toLowerCase()) || 0;
 }

 /**
 * Check if host has any penalty (for compatibility)
 */
 isCooling(url) {
 return this.getPenalty(url) > 0;
 }

 /**
 * Get all hosts with penalties
 */
 getAllPenalties() {
 const result = {};
 for (const [host, penalty] of hostPenalties.entries()) {
 result[host] = penalty;
 }
 return result;
 }

 /**
 * Get statistics
 */
 getState() {
 const hosts = {};
 let totalPenalties = 0;
 let maxPenalty = 0;
 
 for (const [host, penalty] of hostPenalties.entries()) {
 hosts[host] = {
 penalty,
 failures: Math.round(penalty / PENALTY_PER_FAILURE),
 score_impact: -penalty
 };
 totalPenalties += penalty;
 maxPenalty = Math.max(maxPenalty, penalty);
 }

 return {
 ok: true,
 hosts,
 stats: {
 total_penalized_hosts: hostPenalties.size,
 total_penalty_points: totalPenalties,
 max_penalty: maxPenalty,
 avg_penalty: hostPenalties.size > 0 ? Math.round(totalPenalties / hostPenalties.size) : 0
 }
 };
 }

 /**
 * Clear penalty for specific host (manual override)
 */
 clearPenalty(url) {
 const host = this.hostFromUrl(url);
 if (!host) return false;

 const hadPenalty = hostPenalties.has(host);
 hostPenalties.delete(host);
 
 if (hadPenalty) {
 savePenalties(); // Persist to file
 console.log(`[CLEANUP] Cleared penalty for ${host}`);
 }
 
 return hadPenalty;
 }

 /**
 * Clear all penalties (reset system)
 */
 clearAllPenalties() {
 const count = hostPenalties.size;
 hostPenalties.clear();
 savePenalties(); // Persist to file
 console.log(`[CLEANUP] Cleared all penalties (${count} hosts)`);
 return count;
 }

 /**
 * Cleanup - remove hosts with zero penalty and enforce max size
 */
 cleanup() {
 let cleaned = 0;
 
 // Remove zero-penalty hosts
 for (const [host, penalty] of hostPenalties.entries()) {
 if (penalty <= 0) {
 hostPenalties.delete(host);
 cleaned++;
 }
 }
 
 // LRU eviction if over limit (remove hosts with lowest penalties first)
 if (hostPenalties.size > MAX_HOSTS) {
 const entries = Array.from(hostPenalties.entries());
 const toRemove = entries
 .sort((a, b) => a[1] - b[1]) // Sort by penalty (lowest first)
 .slice(0, hostPenalties.size - MAX_HOSTS);
 toRemove.forEach(([key]) => hostPenalties.delete(key));
 cleaned += toRemove.length;
 console.log(`[CLEANUP] Penalty LRU eviction: removed ${toRemove.length} low-penalty hosts`);
 }
 
 if (cleaned > 0) {
 console.log(`[CLEANUP] Penalty cleanup: removed ${cleaned} hosts total, ${hostPenalties.size} remaining`);
 }
 }

 /**
 * Start periodic cleanup
 */
 startCleanupTimer() {
 setInterval(() => {
 this.cleanup();
 }, CLEANUP_INTERVAL);
 }
}

// Export singleton instance
const penaltyReliability = new PenaltyReliability();

module.exports = {
 markFail: (url) => penaltyReliability.markFail(url),
 markOk: (url) => penaltyReliability.markOk(url),
 getPenalty: (url) => penaltyReliability.getPenalty(url),
 getPenaltyByHost: (hostname) => penaltyReliability.getPenaltyByHost(hostname),
 isCooling: (url) => penaltyReliability.isCooling(url), // Compatibility
 getState: () => penaltyReliability.getState(),
 clearPenalty: (url) => penaltyReliability.clearPenalty(url),
 clearAllPenalties: () => penaltyReliability.clearAllPenalties(),
 
 // For direct access to the class if needed
 instance: penaltyReliability
};
