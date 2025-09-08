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

async function testMultipleMovies() {
  console.log('🚀 Testing Additional Stream Logic with Multiple Movies...\n');
  
  const testCases = [
    { id: 'tt0090190', title: 'The Toxic Avenger (1984)' },
    { id: 'tt0111161', title: 'The Shawshank Redemption (1994)' },
    { id: 'tt0468569', title: 'The Dark Knight (2008)' }
  ];
  
  for (const testCase of testCases) {
    console.log(`🎬 Testing: ${testCase.title}`);
    console.log(`📡 ID: ${testCase.id}\n`);
    
    try {
      const testUrl = `${SERVER_URL}/stream/movie/${testCase.id}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
      const response = await makeRequest(testUrl);
      const streams = response.streams || [];
      
      if (streams.length >= 2) {
        const stream1Res = extractResolution(streams[0]);
        const stream2Res = extractResolution(streams[1]);
        
        console.log(`  Primary: ${streams[0].title || streams[0].name} (${stream1Res}p)`);
        console.log(`  Secondary: ${streams[1].title || streams[1].name} (${stream2Res}p)`);
        
        if (stream1Res !== stream2Res) {
          console.log(`  ✅ Different resolutions: ${stream1Res}p → ${stream2Res}p`);
        } else {
          console.log(`  ❌ Same resolution: ${stream1Res}p = ${stream2Res}p`);
        }
      } else {
        console.log(`  ⚠️  Only ${streams.length} stream(s) found`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    console.log(''); // Spacing
  }
}

function extractResolution(stream) {
  const title = stream.title || stream.name || '';
  const resMatch = title.match(/(\d+)p/i);
  return resMatch ? parseInt(resMatch[1]) : 0;
}

// Run the test
testMultipleMovies();
