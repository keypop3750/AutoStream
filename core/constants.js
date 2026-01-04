'use strict';

/**
 * Constants Module
 * Centralized configuration constants to avoid magic numbers
 */

// ============ CACHE TIMEOUTS ============
const CACHE_TTL = {
  METADATA: 6 * 60 * 60 * 1000,      // 6 hours for metadata
  FEATURES: 5 * 60 * 1000,            // 5 minutes for features
  DEBRID_KEY: 5 * 60 * 1000,          // 5 minutes for API key validation
  RESOLVE_CACHE: 15 * 60 * 1000,      // 15 minutes for resolved URLs
  SERIES_CACHE: 60 * 60 * 1000,       // 60 minutes for series data
};

// ============ RATE LIMITING ============
const RATE_LIMITS = {
  GENERAL_MAX_REQUESTS: 50,
  GENERAL_WINDOW_MS: 60000,           // 1 minute
  PLAY_MAX_REQUESTS: 30,
  PLAY_WINDOW_MS: 60000,              // 1 minute
  DEBRID_MAX_PER_MINUTE: 30,
  DEBRID_MAX_PER_HOUR: 1000,
};

// ============ PENALTY SYSTEM ============
const PENALTY = {
  PER_FAILURE: 50,
  RECOVERY_PER_SUCCESS: 50,
  MAX_PENALTY: 500,
  CLEANUP_INTERVAL: 60 * 60 * 1000,   // 1 hour
  SAVE_DEBOUNCE: 5000,                // 5 seconds
};

// ============ SIZE LIMITS ============
const SIZE_LIMITS = {
  MAX_CACHE_SIZE: 200,
  MAX_BLACKLIST_TERMS: 100,
  MAX_LANGUAGE_PRIORITIES: 10,
  MIN_VIDEO_FILE_SIZE: 50 * 1024 * 1024,  // 50MB
};

// ============ POLLING ============
const POLLING = {
  MAX_ITERATIONS: 15,
  INTERVAL_MS: 2000,
};

// ============ TIMEOUTS ============
const TIMEOUTS = {
  DEBRID_API: 30000,                  // 30 seconds
  SOURCE_FETCH: 12000,                // 12 seconds
  PLAY_REQUEST: 25000,                // 25 seconds
  HEALTH_CHECK: 5000,                 // 5 seconds
};

// ============ HTTP ============
const HTTP = {
  DEFAULT_PORT: 7010,
  DEFAULT_HOST: '0.0.0.0',
};

// ============ QUALITY SCORING ============
const QUALITY_SCORES = {
  RESOLUTION_4K: 60,
  RESOLUTION_1080P: 30,
  RESOLUTION_720P: 20,
  RESOLUTION_480P: 5,
  
  HDR_DOLBY_VISION: 15,
  HDR_HDR10: 10,
  
  BLURAY_SOURCE: 10,
  WEB_SOURCE: 8,
  HDTV_SOURCE: 6,
  
  SUBTITLES: 3,
  HARDCODED_SUBS: 1,
  NO_SUBTITLES: -5,
};

// ============ SEEDER SCORING ============
const SEEDER_SCORES = {
  ZERO: -50,
  ONE: -25,
  TWO: -15,
  FEW: -8,        // 3-4
  LOW: -3,        // 5-9
  ADEQUATE: 0,    // 10-19
  GOOD: 5,        // 20-49
  MANY: 10,       // 50-99
  EXCELLENT: 15,  // 100+
};

module.exports = {
  CACHE_TTL,
  RATE_LIMITS,
  PENALTY,
  SIZE_LIMITS,
  POLLING,
  TIMEOUTS,
  HTTP,
  QUALITY_SCORES,
  SEEDER_SCORES
};
