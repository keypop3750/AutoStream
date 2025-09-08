#!/usr/bin/env node

/**
 * Test codec compatibility scoring for TV compatibility
 */

async function testCodecScoring() {
  console.log('🧪 Testing codec compatibility scoring...\n');
  
  // Load the scoring module
  let scoring;
  try {
    scoring = require('./core/scoring_v6');
    console.log('✅ Loaded scoring module');
  } catch (e) {
    console.log('❌ Failed to load scoring module:', e.message);
    return;
  }
  
  // Test streams with different codecs and containers
  const testStreams = [
    {
      name: 'The Newsroom S3E1 720p BluRay x265 HEVC-PSA.mkv',
      title: 'The Newsroom S3E1 - 720p x265',
      url: 'http://example.com/test.mkv',
      expected: 'Lower score due to x265 720p TV compatibility issues'
    },
    {
      name: 'The Newsroom S3E1 720p BluRay x264-DIMENSION.mp4',
      title: 'The Newsroom S3E1 - 720p x264',
      url: 'http://example.com/test.mp4',
      expected: 'Higher score due to x264 720p TV compatibility'
    },
    {
      name: 'The Newsroom S3E1 1080p BluRay x265 HEVC-PSA.mkv',
      title: 'The Newsroom S3E1 - 1080p x265',
      url: 'http://example.com/test.mkv',
      expected: 'Normal x265 bonus for 1080p'
    }
  ];
  
  console.log('Testing codec/container compatibility:\n');
  
  for (const stream of testStreams) {
    try {
      // Create a mock request object
      const mockReq = { headers: { 'user-agent': 'test' } };
      const result = scoring.filterAndScoreStreams([stream], mockReq, { debug: true });
      
      if (result.length > 0) {
        const scored = result[0];
        console.log(`📺 Stream: ${stream.name.substring(0, 60)}...`);
        console.log(`   Score: ${scored.score}`);
        console.log(`   Expected: ${stream.expected}`);
        if (scored.bonuses) console.log(`   Bonuses: ${scored.bonuses.join(', ')}`);
        if (scored.penalties) console.log(`   Penalties: ${scored.penalties.join(', ')}`);
        console.log('');
      }
    } catch (e) {
      console.log(`❌ Error scoring ${stream.name}: ${e.message}`);
    }
  }
  
  console.log('🎯 Look for:');
  console.log('  - x265 720p should have "x265_720p_compat_issue" penalty');
  console.log('  - x264 720p should have "x264_720p_compat" bonus');
  console.log('  - MP4 container should have bonus over MKV for 720p');
}

// Run the test
testCodecScoring().catch(console.error);
