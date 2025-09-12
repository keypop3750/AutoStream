/**
 * Test Resolution Analysis
 * Tests the updated scoring system (-60 x265 penalty for TV)
 * Checks what resolutions we get for different content and devices
 */

const http = require('http');

// Test scenarios: mix of popular movies and TV shows
const testScenarios = [
  // Movies
  { type: 'movie', id: 'tt0111161', name: 'The Shawshank Redemption' },
  { type: 'movie', id: 'tt0468569', name: 'The Dark Knight' },
  { type: 'movie', id: 'tt1375666', name: 'Inception' },
  { type: 'movie', id: 'tt0137523', name: 'Fight Club' },
  
  // TV Series Episodes
  { type: 'series', id: 'tt0903747:5:8', name: 'Breaking Bad S5E8' },
  { type: 'series', id: 'tt0944947:8:6', name: 'Game of Thrones S8E6' },
  { type: 'series', id: 'tt13159924:1:3', name: 'Gen V S1E3' },
  { type: 'series', id: 'tt2861424:3:1', name: 'Rick and Morty S3E1' }
];

// Device types to test
const deviceTypes = [
  { name: 'Android TV', userAgent: 'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) AppleWebKit/537.36' },
  { name: 'Chrome PC', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
  { name: 'Mobile Android', userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Mobile Safari/537.36' }
];

function makeRequest(url, userAgent) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url,
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json'
      },
      timeout: 30000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ error: 'Parse error', raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    req.end();
  });
}

function extractResolution(stream) {
  const title = stream.title || stream.name || '';
  if (/\b(2160p|4k|uhd)\b/i.test(title)) return '4K';
  if (/\b1080p\b/i.test(title)) return '1080p';
  if (/\b720p\b/i.test(title)) return '720p';
  if (/\b480p\b/i.test(title)) return '480p';
  return 'Unknown';
}

function extractCodec(stream) {
  const title = stream.title || stream.name || '';
  if (/\b(x265|hevc|h\.?265)\b/i.test(title)) return 'x265';
  if (/\b(x264|avc|h\.?264)\b/i.test(title)) return 'x264';
  return 'Unknown';
}

async function analyzeStreams(streams, deviceName) {
  if (!streams || streams.length === 0) {
    return { error: 'No streams available' };
  }

  const analysis = {
    totalStreams: streams.length,
    topStream: null,
    secondStream: null,
    resolutionBreakdown: {},
    codecBreakdown: {},
    qualityDistribution: []
  };

  // Analyze top 2 streams
  if (streams[0]) {
    analysis.topStream = {
      name: streams[0].title || streams[0].name || 'Unnamed',
      resolution: extractResolution(streams[0]),
      codec: extractCodec(streams[0]),
      score: streams[0]._score || 'No score'
    };
  }

  if (streams[1]) {
    analysis.secondStream = {
      name: streams[1].title || streams[1].name || 'Unnamed',
      resolution: extractResolution(streams[1]),
      codec: extractCodec(streams[1]),
      score: streams[1]._score || 'No score'
    };
  }

  // Resolution breakdown for top 10 streams
  const topStreams = streams.slice(0, 10);
  topStreams.forEach(stream => {
    const res = extractResolution(stream);
    analysis.resolutionBreakdown[res] = (analysis.resolutionBreakdown[res] || 0) + 1;
    
    const codec = extractCodec(stream);
    analysis.codecBreakdown[codec] = (analysis.codecBreakdown[codec] || 0) + 1;
  });

  // Quality distribution
  analysis.qualityDistribution = topStreams.map((stream, i) => ({
    rank: i + 1,
    resolution: extractResolution(stream),
    codec: extractCodec(stream),
    score: stream._score || 'No score'
  }));

  return analysis;
}

async function runTest() {
  console.log('🎬 Resolution Analysis Test');
  console.log('Testing updated scoring system with -60 x265 penalty for TV');
  console.log('=' .repeat(80));

  for (const scenario of testScenarios) {
    console.log(`\n📺 Testing: ${scenario.name} (${scenario.type})`);
    console.log('-'.repeat(60));

    for (const device of deviceTypes) {
      console.log(`\n🔍 Device: ${device.name}`);
      
      try {
        const url = `/stream/${scenario.type}/${scenario.id}.json`;
        const response = await makeRequest(url, device.userAgent);
        
        if (response.error) {
          console.log(`   ❌ Error: ${response.error}`);
          continue;
        }

        const streams = response.streams || [];
        const analysis = await analyzeStreams(streams, device.name);

        if (analysis.error) {
          console.log(`   ❌ ${analysis.error}`);
          continue;
        }

        console.log(`   📊 Total streams: ${analysis.totalStreams}`);
        
        if (analysis.topStream) {
          console.log(`   🥇 Top stream: ${analysis.topStream.resolution} ${analysis.topStream.codec} (Score: ${analysis.topStream.score})`);
          console.log(`      ${analysis.topStream.name.substring(0, 60)}...`);
        }
        
        if (analysis.secondStream) {
          console.log(`   🥈 2nd stream: ${analysis.secondStream.resolution} ${analysis.secondStream.codec} (Score: ${analysis.secondStream.score})`);
        }

        // Resolution breakdown
        const resolutions = Object.keys(analysis.resolutionBreakdown).sort((a, b) => {
          const order = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, 'Unknown': 0 };
          return (order[b] || 0) - (order[a] || 0);
        });
        
        console.log(`   📺 Resolutions (top 10): ${resolutions.map(r => `${r}(${analysis.resolutionBreakdown[r]})`).join(', ')}`);
        
        // Codec breakdown
        const codecs = Object.keys(analysis.codecBreakdown);
        console.log(`   🎞️  Codecs (top 10): ${codecs.map(c => `${c}(${analysis.codecBreakdown[c]})`).join(', ')}`);

        // Quality trend
        const topFive = analysis.qualityDistribution.slice(0, 5);
        console.log(`   📈 Quality trend: ${topFive.map((s, i) => `${i+1}.${s.resolution}${s.codec === 'Unknown' ? '' : '_' + s.codec}`).join(' → ')}`);

      } catch (error) {
        console.log(`   ❌ Request failed: ${error.message}`);
      }

      // Small delay between device tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Delay between scenarios
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('🏁 Test Complete!');
  console.log('\n📋 Summary:');
  console.log('• Check if Android TV gets x264 streams preferentially');
  console.log('• Verify PC/Web still gets high-quality streams');
  console.log('• Look for 85-point score differences between x264/x265 on TV');
  console.log('• Ensure mobile devices get balanced results');
  console.log('\n💡 Key indicators:');
  console.log('• TV devices should favor x264 over x265 (even at same resolution)');
  console.log('• PC/Web should still get 4K/1080p x265 when available');
  console.log('• No device should get significantly degraded quality');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Run the test
if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = { runTest, analyzeStreams, extractResolution, extractCodec };
