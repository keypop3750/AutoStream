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

async function testUnifiedResolutionSystem() {
  console.log('🚀 Testing Unified Resolution Display System...\n');
  
  const testCases = [
    { id: 'tt0090190', type: 'movie', title: 'The Toxic Avenger (1984) - Movie' },
    { id: 'tt0364774:1:20', type: 'series', title: 'Lilo & Stitch S1E20 - Series' },
    { id: 'tt13623136:1:1', type: 'series', title: 'Gen V S1E1 - Series' }
  ];
  
  for (const testCase of testCases) {
    console.log(`📺 Testing: ${testCase.title}`);
    console.log(`🔗 ${testCase.type}/${testCase.id}\n`);
    
    try {
      const testUrl = `${SERVER_URL}/stream/${testCase.type}/${testCase.id}.json?additionalstream=1&ad=YOUR_AD_KEY_HERE`;
      const response = await makeRequest(testUrl);
      const streams = response.streams || [];
      
      if (streams.length > 0) {
        console.log('📊 RESOLUTION DISPLAY ANALYSIS:');
        streams.forEach((stream, idx) => {
          console.log(`  Stream ${idx + 1}:`);
          console.log(`    Title: "${stream.title}"`);
          console.log(`    Name: "${stream.name}"`);
          
          // Check for resolution patterns
          const title = stream.title || '';
          const hasResolution = /(4K|2K|1080p|720p|480p|2160p|1440p)/i.test(title);
          const resolution = title.match(/(4K|2K|1080p|720p|480p|2160p|1440p)/i)?.[0] || 'None';
          
          console.log(`    Resolution: ${resolution} ${hasResolution ? '✅' : '❌'}`);
          
          // Check for redundant resolution
          const redundant = title.includes('4K') && title.includes('2160p') ||
                           title.includes('2K') && title.includes('1440p') ||
                           title.match(/(1080p.*1080p|720p.*720p|480p.*480p)/i);
          
          if (redundant) {
            console.log(`    ⚠️  REDUNDANT resolution detected!`);
          }
          
          console.log('');
        });
        
        // Check if different resolutions
        if (streams.length >= 2) {
          const res1 = streams[0].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
          const res2 = streams[1].title.match(/(4K|2K|1080p|720p|480p)/i)?.[0];
          
          console.log(`🎯 RESOLUTION TARGETING:`);
          console.log(`  Primary: ${res1 || 'Unknown'}`);
          console.log(`  Secondary: ${res2 || 'Unknown'}`);
          
          if (res1 && res2 && res1 !== res2) {
            console.log(`  ✅ Different resolutions: ${res1} → ${res2}`);
          } else if (res1 && res2) {
            console.log(`  ❌ Same resolution: ${res1} = ${res2}`);
          } else {
            console.log(`  ⚠️  Missing resolution info`);
          }
        }
        
      } else {
        console.log('❌ No streams returned');
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log(''.padEnd(50, '-')); // Separator
    console.log('');
  }
}

// Run the test
testUnifiedResolutionSystem();
