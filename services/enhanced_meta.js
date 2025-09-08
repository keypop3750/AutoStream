#!/usr/bin/env node
/**
 * Enhanced Metadata Service with ID Validation
 * Implements com    // Step 1: Validate and potentially correct IMDB ID
    const validationResult = await validateAndCorrectIMDBID(originalId);
    const validatedId = validationResult.id;
    const idChanged = validatedId !== originalId;
    
    // If validation already fetched metadata, use it
    if (validationResult.meta) {
      log(`🎯 Using metadata from validation: "${validationResult.meta.name}"`);
      
      const enhancedMeta = {
        ...validationResult.meta,
        _originalId: originalId,
        _correctedId: idChanged ? validatedId : null,
        _fetchedAt: new Date().toISOString()
      };
      
      // Cache successful result
      metaCache.set(cacheKey, {
        data: enhancedMeta,
        timestamp: Date.now()
      });
      
      return enhancedMeta;
    }
    
    // If no cached metadata from validation, fetch it separatelyhensive metadata fetching with ID correction
 */

const { fetchWithTimeout } = require('../utils/http');

// Cache for metadata to avoid repeated requests
const metaCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_CACHE_SIZE = 1000; // Limit cache size to prevent memory leaks

// Cleanup function to remove expired entries and limit cache size
function cleanupMetaCache() {
  const now = Date.now();
  
  // Remove expired entries
  for (const [key, value] of metaCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      metaCache.delete(key);
    }
  }
  
  // If still too large, remove oldest entries (LRU-style)
  if (metaCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(metaCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // Sort by timestamp (oldest first)
    
    const toRemove = entries.slice(0, metaCache.size - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => metaCache.delete(key));
    
    console.log(`🧹 Cleaned metadata cache: removed ${toRemove.length} old entries, ${metaCache.size} remaining`);
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupMetaCache, 30 * 60 * 1000);

// Function to clear metadata cache (called on addon restart/install)
function clearMetadataCache() {
  const size = metaCache.size;
  metaCache.clear();
  console.log(`🧹 Cleared metadata cache: ${size} entries removed`);
  return size;
}

// Export the clear function for use in server restart
module.exports = {
  fetchEnhancedMeta,
  clearMetadataCache
};

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
  // Use the new dynamic validation system
  try {
    const { validateAndCorrectIMDBID: dynamicValidate } = require('../utils/id-correction');
    
    const result = await dynamicValidate(id, expectedTitle ? { title: expectedTitle } : null);
    
    if (result.needsCorrection) {
      console.log(`🔧 Dynamic correction: ${id} → ${result.correctedId}`);
      return { 
        id: result.correctedId, 
        meta: result.metadata,
        corrected: true 
      };
    } else if (result.metadata) {
      return { 
        id: result.originalId, 
        meta: result.metadata,
        corrected: false 
      };
    } else {
      // No metadata available
      return { id: result.originalId };
    }
  } catch (error) {
    console.log(`⚠️ Dynamic validation failed, using original ID: ${error.message}`);
    return { id };
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
    const validationResult = await validateAndCorrectIMDBID(originalId);
    const validatedId = validationResult.id;
    const validatedMeta = validationResult.meta; // Get the already-fetched metadata
    const idChanged = validationResult.corrected;
    
    if (idChanged) {
      log(`🔧 ID corrected: ${originalId} → ${validatedId}`);
    }
    
    // Step 2: Use already-fetched metadata if available, otherwise fetch it
    let result;
    if (validatedMeta) {
      log(`🎯 Using already-validated metadata: "${validatedMeta.name}"`);
      result = { meta: validatedMeta };
    } else {
      // Fetch metadata with validated ID
      const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${validatedId.split(':')[0]}.json`;
      log(`📡 Fetching metadata from: ${metaUrl}`);
      result = await fetchJson(metaUrl, 15000);
    }
    
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
      'tt6741278': 'Invincible',
      'tt10293840': 'The White Lotus', // HBO limited series
      'tt12637874': 'Fallout', // Amazon Prime series
      'tt1870479': 'The Newsroom', // HBO series
      'tt13751472': 'Bump', // Australian series  
      'tt14452776': 'The Bear' // FX comedy-drama
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
  IMDB_ID_CORRECTIONS,
  clearMetadataCache
};
