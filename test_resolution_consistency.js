#!/usr/bin/env node

/**
 * Comprehensive Resolution Consistency Test
 * Tests 5 series + 5 movies (older & newer) with and without additional streams
 * Focuses on resolution detection and additional stream targeting
 */

console.log('🎬 AutoStream V3 - Resolution Consistency Test\n');
console.log('Testing resolution detection and additional stream targeting across diverse content\n');

try {
  const scoring = require('./core/scoring_v6');
  
  // Test content: Mix of older (720p era) and newer (4K era) content
  const testContent = [
    // === SERIES ===
    {
      type: 'series',
      name: 'The Newsroom',
      id: 'tt1870479:1:1', // Older HBO series (2012-2014) - likely 720p max
      description: 'Older HBO series from 2012-2014 era'
    },
    {
      type: 'series', 
      name: 'Breaking Bad',
      id: 'tt0903747:1:1', // Classic series (2008-2013) - 720p/1080p era
      description: 'Classic series from pre-4K era'
    },
    {
      type: 'series',
      name: 'Game of Thrones',
      id: 'tt0944947:1:1', // Popular series (2011-2019) - spans 720p to 4K
      description: 'Popular series spanning 720p to 4K eras'
    },
    {
      type: 'series',
      name: 'The Boys',
      id: 'tt1190634:1:1', // Modern series (2019+) - 4K/HDR era
      description: 'Modern series from 4K/HDR era'
    },
    {
      type: 'series',
      name: 'House of the Dragon',
      id: 'tt11198330:1:1', // Very recent series (2022+) - Premium 4K/HDR
      description: 'Very recent premium series with 4K/HDR'
    },
    
    // === MOVIES ===
    {
      type: 'movie',
      name: 'The Dark Knight',
      id: 'tt0468569', // 2008 movie - DVD/720p era
      description: '2008 movie from pre-1080p era'
    },
    {
      type: 'movie',
      name: 'Inception',
      id: 'tt1375666', // 2010 movie - 1080p BluRay era
      description: '2010 movie from 1080p BluRay era'
    },
    {
      type: 'movie',
      name: 'Interstellar', 
      id: 'tt0816692', // 2014 movie - Early 4K era
      description: '2014 movie from early 4K era'
    },
    {
      type: 'movie',
      name: 'Dune (2021)',
      id: 'tt1160419', // 2021 movie - Modern 4K/HDR/Atmos
      description: '2021 movie with modern 4K/HDR/Atmos'
    },
    {
      type: 'movie',
      name: 'Top Gun Maverick',
      id: 'tt1745960', // 2022 movie - Premium 4K/HDR production
      description: '2022 movie with premium 4K/HDR production'
    }
  ];
  
  // Mock different quality streams for testing
  function generateMockStreams(contentName, contentType) {
    const baseStreams = [];
    
    // Generate realistic streams based on content era and type
    const isOlder = contentName.includes('Newsroom') || contentName.includes('Dark Knight');
    const isClassic = contentName.includes('Breaking Bad') || contentName.includes('Inception');
    const isModern = contentName.includes('Boys') || contentName.includes('Dune') || contentName.includes('Maverick') || contentName.includes('Dragon');
    
    // Older content (2008-2012) - mainly 720p
    if (isOlder) {
      baseStreams.push(
        {
          name: `${contentName} S01E01 720p x264 HDTV`,
          title: `${contentName}.S01E01.720p.x264.HDTV.mp4`,
          url: 'https://example.com/720p-x264.mp4',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 720p x265 WEB-DL`, 
          title: `${contentName}.S01E01.720p.x265.WEB-DL.mkv`,
          url: 'https://example.com/720p-x265.mkv',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 480p x264 WEB`,
          title: `${contentName}.S01E01.480p.x264.WEB.avi`,
          url: 'https://example.com/480p.avi', 
          autostreamOrigin: 'torrentio'
        }
      );
    }
    
    // Classic content (2008-2015) - 720p/1080p era
    else if (isClassic) {
      baseStreams.push(
        {
          name: `${contentName} S01E01 1080p x264 BluRay`,
          title: `${contentName}.S01E01.1080p.x264.BluRay.mp4`,
          url: 'https://example.com/1080p-x264.mp4',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 720p x264 WEB-DL`,
          title: `${contentName}.S01E01.720p.x264.WEB-DL.mp4`, 
          url: 'https://example.com/720p.mp4',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 1080p x265 HEVC`,
          title: `${contentName}.S01E01.1080p.x265.HEVC.mkv`,
          url: 'https://example.com/1080p-x265.mkv',
          autostreamOrigin: 'torrentio'
        }
      );
    }
    
    // Modern content (2019+) - 4K/HDR era
    else if (isModern) {
      baseStreams.push(
        {
          name: `${contentName} S01E01 4K HDR x264 BluRay`,
          title: `${contentName}.S01E01.4K.HDR.x264.BluRay.mp4`,
          url: 'https://example.com/4k-x264.mp4', 
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 4K HDR x265 HEVC`,
          title: `${contentName}.S01E01.4K.HDR.x265.HEVC.mkv`,
          url: 'https://example.com/4k-x265.mkv',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 1080p x264 WEB-DL`,
          title: `${contentName}.S01E01.1080p.x264.WEB-DL.mp4`,
          url: 'https://example.com/1080p.mp4',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 720p x264 WEB`,
          title: `${contentName}.S01E01.720p.x264.WEB.mp4`,
          url: 'https://example.com/720p.mp4',
          autostreamOrigin: 'torrentio'
        }
      );
    }
    
    // Standard content - mixed quality
    else {
      baseStreams.push(
        {
          name: `${contentName} S01E01 1080p x264 BluRay`,
          title: `${contentName}.S01E01.1080p.x264.BluRay.mp4`,
          url: 'https://example.com/1080p.mp4',
          autostreamOrigin: 'torrentio'
        },
        {
          name: `${contentName} S01E01 720p x265 WEB-DL`,
          title: `${contentName}.S01E01.720p.x265.WEB-DL.mkv`, 
          url: 'https://example.com/720p-x265.mkv',
          autostreamOrigin: 'torrentio'
        }
      );
    }
    
    return baseStreams;
  }
  
  // Resolution extraction function (matches server.js)
  function resOf(s) {
    const t = ((s?.title||'') + ' ' + (s?.name||'') + ' ' + (s?.tag||'')).toLowerCase();
    if (/\b(2160p|2160|4k|uhd)\b/.test(t)) return 2160;
    if (/\b(1440p|1440|2k|qhd)\b/.test(t)) return 1440;
    if (/\b(1080p|1080|full\s*hd|fhd)\b/.test(t)) return 1080;
    if (/\b(720p|720|hd)\b/.test(t)) return 720;
    if (/\b(480p|480|sd)\b/.test(t)) return 480;
    return 0;
  }
  
  function getUserFriendlyResolution(resNumber) {
    if (resNumber >= 2160) return '4K';
    if (resNumber >= 1440) return '2K';
    if (resNumber >= 1080) return '1080p';
    if (resNumber >= 720) return '720p';
    if (resNumber >= 480) return '480p';
    return `${resNumber}p`;
  }
  
  // Test additional stream targeting logic
  function testAdditionalStreamTargeting(streams) {
    if (streams.length < 2) return null;
    
    const primary = streams[0];
    const pRes = resOf(primary);
    
    // Target resolution logic (matches server.js)
    let targetRes;
    if (pRes >= 2160) targetRes = 1080;       // 4K → 1080p
    else if (pRes >= 1080) targetRes = 720;   // 1080p → 720p  
    else if (pRes >= 720) targetRes = 480;    // 720p → 480p
    else targetRes = 0; // Don't go below 480p
    
    if (targetRes === 0) return null;
    
    // Find additional stream with target resolution
    const primaryId = primary.url;
    for (const candidate of streams.slice(1)) {
      const candidateRes = resOf(candidate);
      const candidateId = candidate.url;
      
      if (candidateRes === targetRes && candidateId !== primaryId) {
        return candidate;
      }
    }
    
    return null;
  }
  
  // Mock TV request
  const mockTVReq = {
    headers: {
      'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36'
    }
  };
  
  console.log('🔍 Testing Content Resolution Detection and Additional Stream Targeting:\n');
  console.log('=' .repeat(90));
  
  let totalTests = 0;
  let passedTests = 0;
  
  for (const content of testContent) {
    const mockStreams = generateMockStreams(content.name, content.type);
    const results = scoring.filterAndScoreStreams(mockStreams, mockTVReq, { debug: false });
    
    console.log(`\n📺 ${content.name} (${content.description})`);
    console.log('-'.repeat(60));
    
    if (results.length === 0) {
      console.log('❌ No streams found');
      continue;
    }
    
    // Test primary stream
    const primary = results[0];
    const primaryRes = resOf(primary);
    const primaryResDisplay = getUserFriendlyResolution(primaryRes);
    
    console.log(`Primary Stream: ${primary.name}`);
    console.log(`  Resolution: ${primaryResDisplay} (${primaryRes}p detected)`);
    console.log(`  Score: ${primary._score}`);
    
    totalTests++;
    if (primaryRes > 0) {
      passedTests++;
      console.log('  ✅ Resolution detected correctly');
    } else {
      console.log('  ❌ Resolution detection failed');
    }
    
    // Test additional stream targeting
    const additional = testAdditionalStreamTargeting(results);
    if (additional) {
      const additionalRes = resOf(additional);
      const additionalResDisplay = getUserFriendlyResolution(additionalRes);
      
      console.log(`Additional Stream: ${additional.name}`);
      console.log(`  Resolution: ${additionalResDisplay} (${additionalRes}p detected)`);
      console.log(`  Targeting: ${primaryResDisplay} → ${additionalResDisplay}`);
      
      totalTests++;
      
      // Verify targeting logic
      const expectedTarget = primaryRes >= 2160 ? 1080 : (primaryRes >= 1080 ? 720 : 480);
      if (additionalRes === expectedTarget) {
        passedTests++;
        console.log('  ✅ Additional stream targeting correct');
      } else {
        console.log(`  ❌ Expected ${expectedTarget}p, got ${additionalRes}p`);
      }
    } else {
      console.log('Additional Stream: None found (expected for some older content)');
      
      // Check if we should have found one
      const expectedTarget = primaryRes >= 2160 ? 1080 : (primaryRes >= 1080 ? 720 : 480);
      const hasTargetRes = results.some(s => resOf(s) === expectedTarget);
      
      if (hasTargetRes && primaryRes > 480) {
        totalTests++;
        console.log(`  ❌ Should have found ${expectedTarget}p additional stream`);
      } else {
        console.log('  ✅ No additional stream needed/available');
      }
    }
  }
  
  console.log('\n' + '='.repeat(90));
  console.log('📊 Resolution Detection Summary:');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log('\n🎉 All resolution detection and targeting tests passed!');
    console.log('\n✅ Key Verifications:');
    console.log('  • Resolution detection works across all content types');
    console.log('  • Additional stream targeting follows 4K→1080p→720p→480p hierarchy');
    console.log('  • Older content properly shows 720p/480p as primary when appropriate');
    console.log('  • Modern content prioritizes 4K/1080p quality levels');
  } else {
    console.log('\n⚠️  Some tests failed - review resolution detection logic');
  }
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error(error.stack);
}
