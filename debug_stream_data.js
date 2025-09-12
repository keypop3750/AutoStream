/**
 * Debug actual stream data to see why resolution detection fails
 */

const http = require('http');

// Test with a popular movie to see actual stream titles
const testCases = [
  {
    name: "Popular Movie (Dune 2)",
    url: "http://localhost:7010/stream/movie/tt15239678.json",
    userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/1.0 TV Safari/538.1"
  }
];

function makeRequest(url, userAgent) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url.replace('http://localhost:7010', ''),
      headers: {
        'User-Agent': userAgent
      }
    };
    
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: e.message, data });
        }
      });
    });
    
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function debugStreamData() {
  console.log('🔍 Debugging Stream Data & Resolution Detection\n');
  
  for (const testCase of testCases) {
    console.log(`\n📺 Testing: ${testCase.name}`);
    console.log(`🔗 URL: ${testCase.url}`);
    console.log(`📱 User-Agent: ${testCase.userAgent}\n`);
    
    try {
      const response = await makeRequest(testCase.url, testCase.userAgent);
      
      if (response.error) {
        console.log(`❌ Error: ${response.error}`);
        continue;
      }
      
      const streams = response.streams || [];
      console.log(`📊 Found ${streams.length} streams`);
      
      if (streams.length > 0) {
        const stream = streams[0]; // Look at the top stream
        
        console.log('\n🎯 TOP STREAM ANALYSIS:');
        console.log('Title:', stream.name || 'N/A');
        console.log('Description:', stream.description || 'N/A');
        console.log('URL:', stream.url || 'N/A');
        console.log('Info Hash:', stream.infoHash || 'N/A');
        
        // Test resolution detection manually
        const title = ((stream.name || '') + ' ' + (stream.description || '')).toLowerCase();
        console.log('\n🔍 RESOLUTION DETECTION TEST:');
        console.log('Combined text for analysis:', title);
        
        // Test each resolution pattern
        const resolutionTests = [
          { pattern: /\b(2160p|4k|uhd)\b/, name: '4K/2160p' },
          { pattern: /\b(1080p|fhd)\b/, name: '1080p' },
          { pattern: /\b(720p|hd)\b/, name: '720p' },
          { pattern: /\b(480p|sd)\b/, name: '480p' }
        ];
        
        let foundResolution = false;
        for (const test of resolutionTests) {
          if (test.pattern.test(title)) {
            console.log(`✅ Found ${test.name}: ${test.pattern}`);
            foundResolution = true;
            break;
          }
        }
        
        if (!foundResolution) {
          console.log('❌ No resolution pattern matched!');
          console.log('📝 Raw title analysis needed...');
        }
        
        // Test codec detection
        console.log('\n🎥 CODEC DETECTION TEST:');
        const codecTests = [
          { pattern: /\b(x265|hevc|h\.?265)\b/, name: 'x265/HEVC' },
          { pattern: /\b(x264|avc|h\.?264)\b/, name: 'x264/AVC' }
        ];
        
        let foundCodec = false;
        for (const test of codecTests) {
          if (test.pattern.test(title)) {
            console.log(`✅ Found ${test.name}: ${test.pattern}`);
            foundCodec = true;
            break;
          }
        }
        
        if (!foundCodec) {
          console.log('❌ No codec pattern matched!');
        }
        
        // Check if this is a magnet/torrent vs direct stream
        if (stream.infoHash && !stream.url) {
          console.log('\n🧲 TORRENT STREAM (infoHash only)');
        } else if (stream.url) {
          console.log('\n🔗 DIRECT STREAM');
          console.log('URL type:', stream.url.startsWith('http') ? 'HTTP' : 'Other');
        }
        
        console.log('\n' + '='.repeat(80));
      } else {
        console.log('❌ No streams returned');
      }
      
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
}

debugStreamData().catch(console.error);
