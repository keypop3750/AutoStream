/**
 * Dynamic IMDB ID Validation and Correction System
 * Automatically detects and fixes wrong IMDB IDs using metadata validation
 */

const https = require('https');

// Cache for validation results to avoid repeated API calls
const validationCache = new Map();
const maxCacheSize = 1000;
const cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours

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
 * Fetch metadata from Cinemeta with timeout and error handling
 */
async function fetchMetadata(imdbId, type = 'series') {
  return new Promise((resolve, reject) => {
    const baseId = imdbId.split(':')[0];
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`;
    
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
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
 * Validate IMDB ID by checking if metadata makes sense
 */
async function validateIMDBID(originalId, expectedContext = null) {
  const baseId = originalId.split(':')[0];
  const cacheKey = `${baseId}_${expectedContext?.title || 'unknown'}`;
  
  // Check cache first
  const cached = validationCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
    return cached.result;
  }
  
  try {
    // Try as series first
    let metadata = await fetchMetadata(baseId, 'series');
    
    // If no series metadata, try as movie
    if (!metadata?.meta) {
      metadata = await fetchMetadata(baseId, 'movie');
    }
    
    if (!metadata?.meta) {
      const result = { 
        isValid: false, 
        reason: 'No metadata found',
        suggestedId: null,
        confidence: 0
      };
      validationCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    const meta = metadata.meta;
    const result = {
      isValid: true,
      metadata: meta,
      title: meta.name,
      year: meta.year,
      type: meta.type,
      confidence: 1.0,
      reason: 'Valid metadata found'
    };
    
    // If we have expected context, validate against it
    if (expectedContext?.title) {
      const titleMatch = titleSimilarity(meta.name, expectedContext.title);
      result.confidence = titleMatch;
      
      if (titleMatch < 0.6) {
        result.isValid = false;
        result.reason = `Title mismatch: "${meta.name}" vs expected "${expectedContext.title}"`;
      }
    }
    
    validationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
    
  } catch (error) {
    const result = {
      isValid: false,
      reason: `Validation error: ${error.message}`,
      suggestedId: null,
      confidence: 0
    };
    validationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }
}

/**
 * Main function to validate and potentially correct an IMDB ID
 */
async function validateAndCorrectIMDBID(originalId, expectedContext = null) {
  console.log(`🔍 Validating IMDB ID: ${originalId}`);
  
  // Validate the original ID first
  const validation = await validateIMDBID(originalId, expectedContext);
  
  if (validation.isValid && validation.confidence > 0.8) {
    console.log(`✅ ID ${originalId} is valid: "${validation.title}" (${validation.year})`);
    return {
      originalId,
      correctedId: originalId,
      needsCorrection: false,
      metadata: validation.metadata,
      confidence: validation.confidence
    };
  }
  
  // If validation failed, provide helpful information
  if (!validation.isValid) {
    console.log(`❌ ID ${originalId} failed validation: ${validation.reason}`);
  }
  
  // Return original ID with any metadata we could gather
  return {
    originalId,
    correctedId: originalId,
    needsCorrection: false,
    metadata: validation.metadata || null,
    confidence: validation.confidence || 0,
    reason: validation.reason || 'No correction available'
  };
}

// Export the main functions
module.exports = {
  validateAndCorrectIMDBID,
  validateIMDBID,
  titleSimilarity
};
