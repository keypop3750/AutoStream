#!/usr/bin/env node

const { computeStreamScore, detectDeviceType } = require('./core/scoring_v6');

console.log('🧪 Testing Increased x265 Penalty for TV Devices\n');

// Mock Android TV request
const tvRequest = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) KODI/20.2.0'
  }
};

// Mock Web request
const webRequest = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
  }
};

// Test streams with different codecs
const streams = [
  {
    title: 'Lilo & Stitch The Series S01E11 1080p x265 HEVC',
    name: 'x265 Test Stream',
    url: 'magnet:test'
  },
  {
    title: 'Lilo & Stitch The Series S01E11 1080p x264 H264',
    name: 'x264 Test Stream', 
    url: 'magnet:test'
  }
];

console.log('📺 Android TV Device Results:');
console.log('Device Type:', detectDeviceType(tvRequest));
streams.forEach(stream => {
  const result = computeStreamScore(stream, tvRequest, {});
  console.log(`\n${stream.title}`);
  console.log(`Score: ${result.score}`);
  console.log(`Bonuses: ${result.bonuses.join(', ') || 'none'}`);
  console.log(`Penalties: ${result.penalties.join(', ') || 'none'}`);
});

console.log('\n🌐 Web Device Results:');
console.log('Device Type:', detectDeviceType(webRequest));
streams.forEach(stream => {
  const result = computeStreamScore(stream, webRequest, {});
  console.log(`\n${stream.title}`);
  console.log(`Score: ${result.score}`);
  console.log(`Bonuses: ${result.bonuses.join(', ') || 'none'}`);
  console.log(`Penalties: ${result.penalties.join(', ') || 'none'}`);
});

console.log('\n🎯 Expected Results:');
console.log('- TV x265: Should have -60 penalty for codec');
console.log('- TV x264: Should have +25 bonus for codec');
console.log('- Web x265: Should have +8 bonus for codec');
console.log('- Web x264: Should have +3 bonus for codec');
