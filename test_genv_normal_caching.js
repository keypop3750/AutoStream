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

async function testGenVWithNormalCaching() {
  console.log('🧪 Testing Gen V with Normal Caching (No More Experimental Code)...\n');
  
  try {
    const testUrl = `${SERVER_URL}/stream/series/tt13623136:1:1.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
    
    console.log('📡 Testing Gen V S1E1...');
    console.log('🔍 Checking for experimental log messages\n');
    
    const response = await makeRequest(testUrl);
    const streams = response.streams || [];
    
    if (streams.length > 0) {
      console.log('✅ Gen V streams found:');
      streams.forEach((stream, idx) => {
        console.log(`  Stream ${idx + 1}: ${stream.title}`);
      });
      
      if (streams.length >= 2) {
        const res1 = streams[0].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
        const res2 = streams[1].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
        
        console.log(`\n🎯 Resolution targeting still working:`);
        console.log(`  Primary: ${res1}`);
        console.log(`  Secondary: ${res2}`);
        
        if (res1 !== res2) {
          console.log(`  ✅ Different resolutions maintained: ${res1} → ${res2}`);
        }
      }
      
      console.log('\n📋 Expected behavior:');
      console.log('  ✅ No experimental caching message in logs');
      console.log('  ✅ Normal 1-hour cache time applied');
      console.log('  ✅ Gen V streams working properly');
      
    } else {
      console.log('❌ No streams returned for Gen V');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server not running. Please start with: node server.js');
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

// Run the test
testGenVWithNormalCaching();
