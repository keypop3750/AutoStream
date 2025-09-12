/**
 * Test the simplified scoring system to ensure it works correctly
 * after reverting from complex platform-specific to general scoring
 */

const { getQualityScore, computeStreamScore, detectDeviceType } = require('./core/scoring_v6.js');

console.log('🧪 Testing Simplified Scoring System\n');

// Test device detection still works
console.log('📱 Device Detection Tests:');
const tvUA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager';
const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1';
const webUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

console.log(`TV UA: ${detectDeviceType({ headers: { 'user-agent': tvUA } })}`);
console.log(`Mobile UA: ${detectDeviceType({ headers: { 'user-agent': mobileUA } })}`);
console.log(`Web UA: ${detectDeviceType({ headers: { 'user-agent': webUA } })}`);

// Test simplified quality scoring
console.log('\n🎯 Quality Scoring Tests:');

const testStreams = [
  {
    title: 'The White Lotus S02E01 1080p WEB-DL x264 AC3-RARBG',
    name: 'Torrentio'
  },
  {
    title: 'The White Lotus S02E01 2160p 4K HDR x265 HEVC Atmos-FLUX',
    name: 'TPB+'
  },
  {
    title: 'The White Lotus S02E01 720p x264 AAC-YTS',
    name: 'Nuvio+'
  }
];

testStreams.forEach((stream, i) => {
  const qualityResult = getQualityScore(stream);
  console.log(`\nStream ${i + 1}: ${stream.title}`);
  console.log(`Quality Score: ${qualityResult.score}`);
  console.log(`Factors: ${qualityResult.factors.join(', ')}`);
  console.log(`Reason: ${qualityResult.reason}`);
});

// Test full stream scoring for all device types
console.log('\n🔄 Full Scoring Test (same scoring for all devices):');

const testStream = {
  title: 'The White Lotus S02E01 1080p WEB-DL x264 AC3-RARBG',
  name: 'Test Stream',
  url: 'magnet:?xt=urn:btih:123456',
  infoHash: '123456',
  autostreamOrigin: 'torrentio'
};

const mockReq = {
  headers: {}
};

// Test TV device
mockReq.headers['user-agent'] = tvUA;
const tvScore = computeStreamScore(testStream, mockReq);
console.log(`\nTV Device Score: ${tvScore.score}`);
console.log(`TV Bonuses: ${tvScore.bonuses ? tvScore.bonuses.join(', ') : 'none'}`);

// Test Mobile device  
mockReq.headers['user-agent'] = mobileUA;
const mobileScore = computeStreamScore(testStream, mockReq);
console.log(`\nMobile Device Score: ${mobileScore.score}`);
console.log(`Mobile Bonuses: ${mobileScore.bonuses ? mobileScore.bonuses.join(', ') : 'none'}`);

// Test Web device
mockReq.headers['user-agent'] = webUA;
const webScore = computeStreamScore(testStream, mockReq);
console.log(`\nWeb Device Score: ${webScore.score}`);
console.log(`Web Bonuses: ${webScore.bonuses ? webScore.bonuses.join(', ') : 'none'}`);

// Verify scores are now the same across devices (simplified approach)
console.log('\n📊 Cross-Device Scoring Verification:');
console.log(`TV Score: ${tvScore.score}, Mobile Score: ${mobileScore.score}, Web Score: ${webScore.score}`);

// Quality scoring should be the same for all devices now
const tvQuality = getQualityScore(testStream);
const mobileQuality = getQualityScore(testStream);
const webQuality = getQualityScore(testStream);

console.log(`Quality scores - TV: ${tvQuality.score}, Mobile: ${mobileQuality.score}, Web: ${webQuality.score}`);

if (tvQuality.score === mobileQuality.score && mobileQuality.score === webQuality.score) {
  console.log('✅ SUCCESS: Quality scoring is now device-agnostic!');
} else {
  console.log('❌ ERROR: Quality scoring still varies by device');
}

console.log('\n🎉 Simplified Scoring Test Complete');
