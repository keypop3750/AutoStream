/**
 * Enhanced IMDB ID Validation and Correction System
 * More resilient approach following Torrentio's pattern with fallback validation
 */

const https = require('https');

// Static corrections for known problematic IDs (removed hardcoded entries)
const ID_CORRECTIONS = {
  // Add corrections here only if absolutely necessary
};

// Cache for validation results to avoid repeated API calls
const validationCache = new Map();
const maxCacheSize = 1000;
const cacheTimeout = 60 * 60 * 1000; // 1 hour

// Cleanup cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of validationCache.entries()) {
    if (now - value.timestamp > cacheTimeout) {
      validationCache.delete(key);
    }
  }
  // Limit cache size
  if (validationCache.size > maxCacheSize) {
    const entries = Array.from(validationCache.entries());
    entries.slice(0, validationCache.size - maxCacheSize).forEach(([key]) => {
      validationCache.delete(key);
    });
  }
}, 60 * 60 * 1000); // Cleanup every hour

/**
 * Basic IMDB ID format validation (like Torrentio)
 */
function isValidIMDBFormat(id) {
  const baseId = id.split(':')[0]; // Handle series IDs like tt12345:1:2
  return /^tt\d{5,10}$/.test(baseId);
}

/**
 * Fetch metadata from Cinemeta with timeout and error handling
 * More resilient version with shorter timeout and better error handling
 */
async function fetchMetadata(imdbId, type = 'series') {
  return new Promise((resolve, reject) => {
    const baseId = imdbId.split(':')[0];
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`;
    
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.meta && result.meta.name) {
            resolve(result);
          } else {
            reject(new Error('No valid metadata found'));
          }
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.on('error', reject);
  });
}

/**
 * Calculate title similarity (simple algorithm)
 */
function titleSimilarity(title1, title2) {
  if (!title1 || !title2) return 0;
  
  const clean1 = title1.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const clean2 = title2.toLowerCase().replace(/[^\w\s]/g, '').trim();
  
  if (clean1 === clean2) return 1.0;
  
  // Check if one contains the other
  if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.8;
  
  // Word overlap scoring
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
  const commonWords = words1.filter(word => words2.includes(word) && word.length > 2);
  
  const overlap = commonWords.length / Math.max(words1.length, words2.length);
  return overlap;
}

/**
 * Main function to validate and potentially correct an IMDB ID
 * Enhanced resilient approach with fallback validation
 */
async function validateAndCorrectIMDBID(originalId, expectedContext = null) {
  const baseId = originalId.split(':')[0]; // Handle series IDs like tt12345:1:2
  const cacheKey = `${baseId}_resilient`;
  
  // Check cache first
  const cached = validationCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
    // Preserve original ID format for series
    const result = { ...cached.result };
    result.originalId = originalId;
    result.correctedId = originalId.replace(baseId, cached.result.correctedId.split(':')[0]);
    return result;
  }
  
  // Step 1: Basic format validation (like Torrentio)
  const isValidFormat = isValidIMDBFormat(originalId);
  
  if (!isValidFormat) {
    const result = {
      originalId,
      correctedId: originalId,
      needsCorrection: false,
      reason: "Invalid IMDB ID format",
      confidence: 0
    };
    validationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
  
  // Step 2: Check against known corrections
  const correctedId = ID_CORRECTIONS[baseId] ? originalId.replace(baseId, ID_CORRECTIONS[baseId]) : originalId;
  const needsCorrection = correctedId !== originalId;
  
  if (needsCorrection) {
    const result = {
      originalId,
      correctedId,
      needsCorrection: true,
      reason: "Corrected using known mapping",
      confidence: 1.0
    };
    validationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
  
  // Step 3: Try external validation only if we have a good format and no correction
  // This is optional - if it fails, we still consider the ID valid
  try {
    let metadata = await fetchMetadata(baseId, 'series');
    
    // If no series metadata, try as movie
    if (!metadata?.meta) {
      metadata = await fetchMetadata(baseId, 'movie');
    }
    
    if (metadata?.meta?.name) {
      const result = {
        originalId,
        correctedId: originalId,
        needsCorrection: false,
        metadata: metadata.meta,
        reason: "External validation successful",
        confidence: 1.0
      };
      validationCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
  } catch (error) {
    // Don't fail validation on API errors - just log and continue
    // The ID format is valid, so we'll accept it even if external validation fails
  }
  
  // Step 4: Return success with basic format validation (Torrentio approach)
  const result = {
    originalId,
    correctedId: originalId,
    needsCorrection: false,
    reason: "Format validation passed",
    confidence: 0.8 // Good format but no external validation
  };
  
  validationCache.set(cacheKey, { result, timestamp: Date.now() });
  return result;
}

// Export the main functions
module.exports = {
  validateAndCorrectIMDBID,
  isValidIMDBFormat,
  titleSimilarity,
  ID_CORRECTIONS
};
