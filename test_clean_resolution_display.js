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

async function testCleanResolutionDisplay() {
  console.log('🚀 Testing Clean Resolution Display (4K, 2K, 1080p instead of 2160p, 1440p)...\n');
  
  const testCases = [
    { id: 'tt0090190', title: 'The Toxic Avenger (1984)' },
    { id: 'tt0111161', title: 'The Shawshank Redemption (1994)' }
  ];
  
  for (const testCase of testCases) {
    console.log(`🎬 Testing: ${testCase.title}`);
    console.log(`📡 ID: ${testCase.id}\n`);
    
    try {
      const testUrl = `${SERVER_URL}/stream/movie/${testCase.id}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
      const response = await makeRequest(testUrl);
      const streams = response.streams || [];
      
      if (streams.length >= 2) {
        console.log(`  ✅ Found ${streams.length} streams`);
        
        streams.forEach((stream, idx) => {
          console.log(`  Stream ${idx + 1}:`);
          console.log(`    Title: "${stream.title}"`);
          console.log(`    Name: "${stream.name}"`);
          
          // Check for clean resolution display
          const title = stream.title || '';
          const hasCleanResolution = /\b(4K|2K|1080p|720p|480p)\b/i.test(title);
          const hasRawResolution = /\b(2160p|1440p)\b/i.test(title);
          const hasRedundant = /4K.*2160p|2K.*1440p/i.test(title);
          
          if (hasRedundant) {
            console.log(`    ❌ REDUNDANT: Has both user-friendly AND raw resolution`);
          } else if (hasCleanResolution && !hasRawResolution) {
            console.log(`    ✅ CLEAN: User-friendly resolution only`);
          } else if (hasRawResolution && !hasCleanResolution) {
            console.log(`    ⚠️  RAW: Raw resolution only (${title.match(/\b\d+p\b/)?.[0] || 'unknown'})`);
          } else {
            console.log(`    ❓ UNCLEAR: Resolution format unclear`);
          }
        });
      } else {
        console.log(`  ⚠️  Only ${streams.length} stream(s) found`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
    
    console.log(''); // Spacing
  }
}

// Run the test
testCleanResolutionDisplay();
