#!/usr/bin/env node
/**
 * IMDB ID Correction System
 * Fixes common ID mapping issues
 */

// Known ID mappings for problematic content
const ID_CORRECTIONS = {
  // Wrong ID -> Correct ID mappings
  'tt13623136': 'tt13159924', // Gen V fix: Marvel Guardians -> Gen V
  
  // Add more corrections as discovered
  // 'tt1234567': 'tt7654321', // Example: Wrong Show -> Correct Show
};

// Known series titles for validation
const SERIES_VALIDATION = {
  'tt13159924': {
    expectedTitles: ['Gen V', 'gen v'],
    expectedYear: '2023',
    type: 'series'
  },
  'tt1190634': {
    expectedTitles: ['The Boys', 'the boys'],
    expectedYear: '2019',
    type: 'series'
  }
};

function correctIMDBID(originalId) {
  // Extract base ID from episode format (tt13623136:1:3 -> tt13623136)
  const baseId = originalId.split(':')[0];
  const episodeInfo = originalId.includes(':') ? originalId.substring(baseId.length) : '';
  
  // Check if this ID needs correction
  const correctedBaseId = ID_CORRECTIONS[baseId] || baseId;
  
  // Rebuild full ID with episode info
  const correctedId = correctedBaseId + episodeInfo;
  
  if (correctedBaseId !== baseId) {
    console.log(`🔧 ID CORRECTION: ${originalId} → ${correctedId}`);
  }
  
  return correctedId;
}

async function validateIDWithMetadata(id, fetchMeta) {
  try {
    const baseId = id.split(':')[0];
    const validation = SERIES_VALIDATION[baseId];
    
    if (!validation) {
      return { valid: true, reason: 'No validation rules' };
    }
    
    const meta = await fetchMeta('series', baseId);
    
    if (!meta || !meta.name) {
      return { valid: false, reason: 'No metadata found' };
    }
    
    // Check if title matches expected
    const titleMatches = validation.expectedTitles.some(expected => 
      meta.name.toLowerCase().includes(expected.toLowerCase())
    );
    
    if (!titleMatches) {
      return { 
        valid: false, 
        reason: `Title mismatch: got "${meta.name}", expected one of [${validation.expectedTitles.join(', ')}]`,
        suggestion: `Check if ${id} maps to correct content`
      };
    }
    
    return { valid: true, reason: 'Validation passed', meta };
    
  } catch (error) {
    return { valid: false, reason: `Validation error: ${error.message}` };
  }
}

async function enhancedIDProcessing(originalId, fetchMeta, log = console.log) {
  log(`🔍 Processing ID: ${originalId}`);
  
  // Step 1: Apply known corrections
  const correctedId = correctIMDBID(originalId);
  
  // Step 2: Validate the corrected ID
  const validation = await validateIDWithMetadata(correctedId, fetchMeta);
  
  if (validation.valid) {
    log(`✅ ID validation passed: ${correctedId}`);
    return { id: correctedId, meta: validation.meta, corrected: correctedId !== originalId };
  } else {
    log(`⚠️  ID validation failed: ${validation.reason}`);
    if (validation.suggestion) {
      log(`💡 Suggestion: ${validation.suggestion}`);
    }
    
    // Still return the corrected ID, but mark as unvalidated
    return { id: correctedId, meta: null, corrected: correctedId !== originalId, warning: validation.reason };
  }
}

// Test the system
async function testIDCorrection() {
  console.log("🧪 TESTING ID CORRECTION SYSTEM");
  console.log("=" * 50);
  
  // Mock fetchMeta function for testing
  const mockFetchMeta = async (type, id) => {
    const mockData = {
      'tt13159924': { name: 'Gen V', year: '2023–', type: 'series' },
      'tt13623136': { name: 'The Guardians of the Galaxy Holiday Special', year: '2022', type: 'movie' },
      'tt1190634': { name: 'The Boys', year: '2019–', type: 'series' }
    };
    return mockData[id] || null;
  };
  
  const testCases = [
    'tt13623136:1:3',  // Wrong Gen V ID
    'tt13159924:1:3',  // Correct Gen V ID
    'tt1190634:1:1',   // The Boys (should work)
    'tt9999999:1:1'    // Non-existent ID
  ];
  
  for (const testId of testCases) {
    console.log(`\n📺 Testing: ${testId}`);
    const result = await enhancedIDProcessing(testId, mockFetchMeta, (msg) => console.log(`  ${msg}`));
    console.log(`  Final ID: ${result.id}`);
    console.log(`  Corrected: ${result.corrected ? 'Yes' : 'No'}`);
    if (result.warning) console.log(`  Warning: ${result.warning}`);
  }
}

if (require.main === module) {
  testIDCorrection();
}

module.exports = { 
  correctIMDBID, 
  validateIDWithMetadata, 
  enhancedIDProcessing,
  ID_CORRECTIONS,
  SERIES_VALIDATION 
};
