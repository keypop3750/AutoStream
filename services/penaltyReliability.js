/**
 * penaltyReliability.js
 * 
 * Permanent penalty-based reliability system
 * - Hosts get -50 points per failure (permanent until success)
 * - Hosts regain +50 points per success (only up to their natural score)
 * - No time-based expiry, no permanent exclusion
 * - Simple persistent penalty counter per host
 */

// In-memory penalty storage
const hostPenalties = new Map(); // host -> penalty points (always >= 0)

// Configuration
const PENALTY_PER_FAILURE = 50;
const RECOVERY_PER_SUCCESS = 50;
const MAX_PENALTY = 500; // Cap to prevent excessive penalties
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour cleanup

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
    
    console.log(`❌ Stream failure: ${host} (penalty: ${currentPenalty} → ${newPenalty})`);
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
    
    console.log(`✅ Stream success: ${host} (penalty: ${currentPenalty} → ${newPenalty})`);
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
      console.log(`🧹 Cleared penalty for ${host}`);
    }
    
    return hadPenalty;
  }

  /**
   * Clear all penalties (reset system)
   */
  clearAllPenalties() {
    const count = hostPenalties.size;
    hostPenalties.clear();
    console.log(`🧹 Cleared all penalties (${count} hosts)`);
    return count;
  }

  /**
   * Cleanup - remove hosts with zero penalty (shouldn't happen, but safety)
   */
  cleanup() {
    let cleaned = 0;
    for (const [host, penalty] of hostPenalties.entries()) {
      if (penalty <= 0) {
        hostPenalties.delete(host);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Penalty cleanup: removed ${cleaned} zero-penalty hosts`);
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
