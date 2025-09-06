#!/usr/bin/env node
/**
 * Enhanced Metadata Service with ID Validation
 * Implements comprehensive metadata fetching with ID correction
 */

const { fetchWithTimeout } = require('../utils/http');

// Known IMDB ID corrections for common mismatches
const IMDB_ID_CORRECTIONS = {
  'tt13623136': 'tt13159924', // Gen V correction
  // Add more corrections as discovered
};

// Cache for metadata to avoid repeated requests
const metaCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchJson(url, timeout = 15000) {
  try {
    const response = await fetchWithTimeout(url, {}, timeout);
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function validateAndCorrectIMDBID(id, expectedTitle = null) {
  console.log(`🔍 Validating IMDB ID: ${id}`);
  
  // Step 1: Check if this ID needs correction
  if (IMDB_ID_CORRECTIONS[id]) {
    const correctedId = IMDB_ID_CORRECTIONS[id];
    console.log(`🔧 Auto-correcting ${id} → ${correctedId}`);
    return correctedId;
  }
  
  // Step 2: Validate metadata exists and is reasonable
  try {
    const metaUrl = `https://v3-cinemeta.strem.io/meta/series/${id}.json`;
    const result = await fetchJson(metaUrl, 10000);
    
    if (result.error) {
      console.log(`❌ Metadata validation failed: ${result.error}`);
      return id; // Return original if validation fails
    }
    
    const meta = result.meta;
    
    // Check if metadata looks suspicious (empty or generic)
    if (!meta?.name || meta.name === 'Unknown' || !meta.imdb_id) {
      console.log(`⚠️ Suspicious metadata for ${id}: empty or generic data`);
      
      // If we have an expected title, try to find alternatives
      if (expectedTitle) {
        console.log(`🔍 Searching for alternative ID for "${expectedTitle}"`);
        // Future: Could implement title-based search here
      }
    } else {
      console.log(`✅ Valid metadata: "${meta.name}" (${meta.year})`);
    }
    
    return id; // Return original ID if validation passes
    
  } catch (error) {
    console.log(`❌ ID validation error: ${error.message}`);
    return id; // Return original on error
  }
}

async function fetchEnhancedMeta(type, originalId, log = () => {}) {
  const cacheKey = `${type}:${originalId}`;
  
  // Check cache first
  const cached = metaCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    log(`📦 Using cached metadata for ${originalId}`);
    return cached.data;
  }
  
  try {
    // Step 1: Validate and potentially correct the ID
    const validatedId = await validateAndCorrectIMDBID(originalId);
    const idChanged = validatedId !== originalId;
    
    if (idChanged) {
      log(`🔧 ID corrected: ${originalId} → ${validatedId}`);
    }
    
    // Step 2: Fetch metadata with corrected ID
    const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${validatedId}.json`;
    log(`📡 Fetching metadata from: ${metaUrl}`);
    
    const result = await fetchJson(metaUrl, 15000);
    
    if (result.error) {
      log(`❌ Metadata fetch failed: ${result.error}`);
      
      // Fallback: Create basic metadata from ID
      const fallbackMeta = createFallbackMeta(originalId, type);
      log(`🔄 Using fallback metadata: "${fallbackMeta.name}"`);
      
      // Cache fallback for shorter time
      metaCache.set(cacheKey, {
        data: fallbackMeta,
        timestamp: Date.now()
      });
      
      return fallbackMeta;
    }
    
    const meta = result.meta;
    
    // Step 3: Enhance metadata with additional info
    const enhancedMeta = {
      ...meta,
      _originalId: originalId,
      _correctedId: idChanged ? validatedId : null,
      _fetchedAt: new Date().toISOString()
    };
    
    log(`✅ Metadata fetched: "${meta?.name}" (${meta?.year})`);
    
    // Cache successful result
    metaCache.set(cacheKey, {
      data: enhancedMeta,
      timestamp: Date.now()
    });
    
    return enhancedMeta;
    
  } catch (error) {
    log(`❌ Enhanced metadata fetch failed: ${error.message}`);
    
    // Return fallback metadata
    const fallbackMeta = createFallbackMeta(originalId, type);
    return fallbackMeta;
  }
}

function createFallbackMeta(id, type) {
  // Extract episode info if present
  const match = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
  
  if (match) {
    const [, imdbId, season, episode] = match;
    
    // Use known titles if available
    const knownTitles = {
      'tt13159924': 'Gen V',
      'tt13623136': 'Gen V', // Assume Gen V even for wrong ID
      'tt1190634': 'The Boys',
      'tt6741278': 'Invincible'
    };
    
    const baseName = knownTitles[imdbId] || `Content ${imdbId.replace('tt', '')}`;
    
    return {
      name: baseName,
      type: type,
      imdb_id: imdbId,
      year: 'Unknown',
      season: season ? parseInt(season) : null,
      episode: episode ? parseInt(episode) : null,
      _fallback: true
    };
  }
  
  return {
    name: `Content ${id}`,
    type: type,
    imdb_id: id,
    year: 'Unknown',
    _fallback: true
  };
}

// Legacy compatibility
async function fetchMeta(type, id, log = () => {}) {
  return await fetchEnhancedMeta(type, id, log);
}

module.exports = {
  fetchMeta,
  fetchEnhancedMeta,
  validateAndCorrectIMDBID,
  IMDB_ID_CORRECTIONS
};
