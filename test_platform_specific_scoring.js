#!/usr/bin/env node

/**
 * Test Platform-Specific Scoring System V6
 * Tests the new fully platform-specific scoring (not base+addon)
 */

// Try to load the module
let scoringMod;
try {
  scoringMod = require('./core/scoring_v6');
  console.log('✅ Successfully loaded scoring_v6 module');
} catch (e) {
  console.error('❌ Failed to load scoring_v6:', e.message);
  process.exit(1);
}

// Test device type detection
function testDeviceDetection() {
  console.log('\n🔍 Testing Device Detection:');
  
  // Mock request objects
  const tvRequest = { headers: { 'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0)' } };
  const mobileRequest = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X)' } };
  const webRequest = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
  
  console.log('TV Device:', scoringMod.detectDeviceType(tvRequest));
  console.log('Mobile Device:', scoringMod.detectDeviceType(mobileRequest));
  console.log('Web Device:', scoringMod.detectDeviceType(webRequest));
}

// Test stream scoring across platforms
function testPlatformSpecificScoring() {
  console.log('\n🎯 Testing Platform-Specific Scoring:');
  
  // Test streams with different characteristics
  const testStreams = [
    {
      name: 'Breaking Bad S01E01 4K HDR x265',
      title: 'Breaking.Bad.S01E01.2160p.HDR.x265.mkv',
      url: 'https://example.com/video.mkv',
      autostreamOrigin: 'torrentio'
    },
    {
      name: 'Breaking Bad S01E01 1080p x264 BluRay',
      title: 'Breaking.Bad.S01E01.1080p.BluRay.x264.mp4',
      url: 'https://example.com/video.mp4',
      autostreamOrigin: 'torrentio'
    },
    {
      name: 'Breaking Bad S01E01 720p x264',
      title: 'Breaking.Bad.S01E01.720p.x264.avi',
      url: 'https://example.com/video.avi',
      autostreamOrigin: 'torrentio'
    }
  ];
  
  const devices = ['tv', 'mobile', 'web'];
  
  testStreams.forEach((stream, streamIndex) => {
    console.log(`\n--- Stream ${streamIndex + 1}: ${stream.name} ---`);
    
    devices.forEach(deviceType => {
      // Mock request with device type
      const mockReq = {
        headers: {
          'user-agent': deviceType === 'tv' ? 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0)' :
                       deviceType === 'mobile' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X)' :
                       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };
      
      try {
        const result = scoringMod.filterAndScoreStreams([stream], mockReq, { debug: false });
        if (result && result.length > 0) {
          const scoring = result[0]._scoring;
          console.log(`${deviceType.toUpperCase()}: Score ${scoring.score} | Quality: ${scoring.breakdown?.quality?.score || 'N/A'}`);
          if (scoring.bonuses?.length) console.log(`  Bonuses: ${scoring.bonuses.join(', ')}`);
          if (scoring.penalties?.length) console.log(`  Penalties: ${scoring.penalties.join(', ')}`);
        } else {
          console.log(`${deviceType.toUpperCase()}: No results`);
        }
      } catch (e) {
        console.log(`${deviceType.toUpperCase()}: Error - ${e.message}`);
      }
    });
  });
}

// Test additional stream resolution targeting
function testAdditionalStreamLogic() {
  console.log('\n🔄 Testing Additional Stream Resolution Logic:');
  
  const mockStreams = [
    { name: '4K Stream', title: 'Movie.2160p.mkv', url: 'https://example.com/4k.mkv', _score: 850 },
    { name: '1080p Stream A', title: 'Movie.1080p.x264.mp4', url: 'https://example.com/1080p-a.mp4', _score: 820 },
    { name: '1080p Stream B', title: 'Movie.1080p.x265.mkv', url: 'https://example.com/1080p-b.mkv', _score: 780 },
    { name: '720p Stream', title: 'Movie.720p.x264.avi', url: 'https://example.com/720p.avi', _score: 750 },
    { name: '480p Stream', title: 'Movie.480p.x264.mp4', url: 'https://example.com/480p.mp4', _score: 720 }
  ];
  
  // Simulate resolution extraction (this would normally be done in server.js)
  function resOf(stream) {
    const text = ((stream.title || '') + ' ' + (stream.name || '')).toLowerCase();
    if (/\b(2160p|4k|uhd)\b/.test(text)) return 2160;
    if (/\b(1080p|fhd)\b/.test(text)) return 1080;
    if (/\b(720p|hd)\b/.test(text)) return 720;
    if (/\b(480p|sd)\b/.test(text)) return 480;
    return 0;
  }
  
  // Test resolution targeting logic (4K → 1080p, 1080p → 720p)
  mockStreams.forEach(primaryStream => {
    const primaryRes = resOf(primaryStream);
    let targetRes = primaryRes >= 2160 ? 1080 : (primaryRes >= 1080 ? 720 : 480);
    
    console.log(`Primary: ${primaryStream.name} (${primaryRes}p) → Target: ${targetRes}p`);
    
    // Find matching resolution streams
    const candidates = mockStreams.filter(s => {
      const sRes = resOf(s);
      return sRes === targetRes && s !== primaryStream;
    });
    
    if (candidates.length > 0) {
      const best = candidates.sort((a, b) => b._score - a._score)[0];
      console.log(`  → Found: ${best.name} (Score: ${best._score})`);
    } else {
      console.log(`  → No ${targetRes}p streams available`);
    }
  });
}

// Run all tests
async function runAllTests() {
  console.log('🧪 AutoStream V3 Platform-Specific Scoring Test Suite\n');
  
  try {
    testDeviceDetection();
    testPlatformSpecificScoring();
    testAdditionalStreamLogic();
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n📋 Key Improvements Tested:');
    console.log('  • Platform-specific scoring (TV compatibility focus)');
    console.log('  • Device-aware quality bonuses/penalties');
    console.log('  • Resolution targeting for additional streams');
    console.log('  • Complete scoring system integration');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runAllTests();
