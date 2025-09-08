const https = require('https');
const http = require('http');

const SERVER_URL = 'http://localhost:7010';

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ streams: [] });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function testAdditionalStreamFix() {
  console.log('🚀 Testing Additional Stream Resolution Targeting Fix...\n');
  
  try {
    // Test with The Toxic Avenger (known to have multiple resolutions)
    const testId = 'tt0090190'; // The Toxic Avenger (1984)
    const testUrl = `${SERVER_URL}/stream/movie/${testId}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
    
    console.log(`📡 Testing: ${testUrl}`);
    console.log('🔍 Expected: Two streams with different resolutions\n');
    
    const response = await makeRequest(testUrl);
    const streams = response.streams || [];
    
    console.log(`✅ Response received - ${streams.length} streams found\n`);
    
    if (streams.length >= 2) {
      console.log('📺 STREAM ANALYSIS:');
      streams.forEach((stream, idx) => {
        console.log(`Stream ${idx + 1}:`);
        console.log(`  Title: ${stream.title}`);
        console.log(`  Name: ${stream.name}`);
        
        // Extract resolution from title/name
        const title = stream.title || stream.name || '';
        const resMatch = title.match(/(\d+)p/i);
        const resolution = resMatch ? resMatch[1] : 'Unknown';
        
        console.log(`  Detected Resolution: ${resolution}p`);
        console.log(`  URL: ${stream.url?.substring(0, 60)}...`);
        console.log('');
      });
      
      // Check if resolutions are different
      const stream1Res = extractResolution(streams[0]);
      const stream2Res = extractResolution(streams[1]);
      
      console.log('🎯 RESOLUTION COMPARISON:');
      console.log(`Primary Stream: ${stream1Res}p`);
      console.log(`Secondary Stream: ${stream2Res}p`);
      
      if (stream1Res !== stream2Res) {
        console.log('✅ SUCCESS: Streams have different resolutions!');
        
        // Verify fallback logic
        const expectedSecondary = getExpectedFallback(stream1Res);
        if (stream2Res === expectedSecondary || stream2Res < stream1Res) {
          console.log(`✅ FALLBACK LOGIC: Correct (${stream1Res}p → ${stream2Res}p)`);
        } else {
          console.log(`⚠️  FALLBACK LOGIC: Unexpected (expected ${expectedSecondary}p, got ${stream2Res}p)`);
        }
      } else {
        console.log('❌ ISSUE: Both streams have the same resolution!');
        console.log('   This indicates the additional stream logic needs further debugging.');
      }
      
    } else if (streams.length === 1) {
      console.log('⚠️  Only one stream returned (additional stream not added)');
      console.log('   This could mean no suitable secondary stream was found.');
    } else {
      console.log('❌ No streams returned');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running. Please start with: node server.js');
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

function extractResolution(stream) {
  const title = stream.title || stream.name || '';
  const resMatch = title.match(/(\d+)p/i);
  return resMatch ? parseInt(resMatch[1]) : 0;
}

function getExpectedFallback(primaryRes) {
  if (primaryRes >= 2160) return 1080; // 4K → 1080p
  if (primaryRes >= 1080) return 720;  // 1080p → 720p
  if (primaryRes >= 720) return 480;   // 720p → 480p
  return 0; // No fallback for lower resolutions
}

// Run the test
testAdditionalStreamFix();
