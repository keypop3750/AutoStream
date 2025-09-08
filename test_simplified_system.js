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

async function testSimplifiedSystem() {
  console.log('🚀 Testing Simplified Resolution System...\n');
  
  const testCases = [
    { id: 'tt13819960:1:2', type: 'series', title: 'And Just Like That S1E2' },
    { id: 'tt13623136:1:1', type: 'series', title: 'Gen V S1E1' },
    { id: 'tt0090190', type: 'movie', title: 'The Toxic Avenger' }
  ];
  
  for (const testCase of testCases) {
    console.log(`📺 Testing: ${testCase.title}`);
    
    try {
      const testUrl = `${SERVER_URL}/stream/${testCase.type}/${testCase.id}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
      const response = await makeRequest(testUrl);
      const streams = response.streams || [];
      
      if (streams.length > 0) {
        console.log('✅ Streams found:');
        streams.forEach((stream, idx) => {
          console.log(`  ${idx + 1}. ${stream.title}`);
        });
        
        // Check resolution targeting
        if (streams.length >= 2) {
          const res1 = streams[0].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
          const res2 = streams[1].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
          
          if (res1 && res2) {
            console.log(`🎯 Resolution: ${res1} → ${res2} ${res1 !== res2 ? '✅' : '❌'}`);
          }
        }
        
      } else {
        console.log('❌ No streams found');
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log(''); // Spacing
  }
}

// Run the test
testSimplifiedSystem();
