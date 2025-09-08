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

async function testEpisodeAdditionalStreams() {
  console.log('🚀 Testing Additional Stream Logic with TV Episodes...\n');
  
  const testCases = [
    { id: 'tt13623136:1:1', title: 'Gen V S1E1' },
    { id: 'tt0944947:1:1', title: 'Game of Thrones S1E1' },
    { id: 'tt2861424:1:1', title: 'Rick and Morty S1E1' }
  ];
  
  for (const testCase of testCases) {
    console.log(`📺 Testing: ${testCase.title}`);
    console.log(`📡 ID: ${testCase.id}\n`);
    
    try {
      const testUrl = `${SERVER_URL}/stream/series/${testCase.id}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
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
testEpisodeAdditionalStreams();
