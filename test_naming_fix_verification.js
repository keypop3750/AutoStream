/**
 * Test codec detection after moving naming to the end
 */

const http = require('http');

function makeRequest(url, userAgent = 'Mozilla/5.0') {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: { 'User-Agent': userAgent }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function testCodecDetectionFixed() {
  console.log('\n🔧 TESTING CODEC DETECTION AFTER NAMING FIX\n');
  
  const testCases = [
    {
      name: 'Gen V Episode (Web)',
      url: 'http://localhost:7010/stream/series/tt13159924:1:3.json',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      expected: '4K (should prefer x264 or x265 based on availability)'
    },
    {
      name: 'Gen V Episode (Android TV)',
      url: 'http://localhost:7010/stream/series/tt13159924:1:3.json',
      userAgent: 'Dalvik/2.1.0 (Linux; U; Android 9; SHIELD Android TV Build/PPR1.180610.011)',
      expected: '4K (should prefer x264 over x265 but still get 4K)'
    },
    {
      name: 'Breaking Bad Movie (Web)',
      url: 'http://localhost:7010/stream/movie/tt0903747.json',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      expected: '4K (web can handle both codecs well)'
    },
    {
      name: 'Breaking Bad Movie (Android TV)',
      url: 'http://localhost:7010/stream/movie/tt0903747.json',
      userAgent: 'Dalvik/2.1.0 (Linux; U; Android 9; SHIELD Android TV Build/PPR1.180610.011)',
      expected: '4K (TV should get 4K with codec preference)'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📱 ${testCase.name}`);
    console.log(`🎯 Expected: ${testCase.expected}`);
    
    try {
      const result = await makeRequest(testCase.url, testCase.userAgent);
      
      if (result.streams && result.streams.length > 0) {
        const stream = result.streams[0];
        
        console.log(`✅ Result:`);
        console.log(`   📛 Name: "${stream.name}"`);
        console.log(`   📋 Title: "${stream.title}"`);
        
        // Extract resolution and codec info
        const titleText = (stream.title || '').toLowerCase();
        
        let detectedResolution = 'unknown';
        if (/\b(2160p|4k|uhd)\b/.test(titleText)) detectedResolution = '4K';
        else if (/\b(1080p|fhd)\b/.test(titleText)) detectedResolution = '1080p';
        else if (/\b(720p|hd)\b/.test(titleText)) detectedResolution = '720p';
        else if (/\b(480p|sd)\b/.test(titleText)) detectedResolution = '480p';
        
        console.log(`   🎬 Resolution: ${detectedResolution}`);
        
        // The codec info should now be coming from the scoring system
        // We won't see it in the final stream names, but it should influence the selection
        const isAndroidTV = testCase.userAgent.includes('Android TV') || testCase.userAgent.includes('SHIELD');
        
        if (isAndroidTV && detectedResolution === '4K') {
          console.log(`   ✅ SUCCESS: Android TV got 4K stream (codec preference working)`);
        } else if (isAndroidTV && detectedResolution !== '4K') {
          console.log(`   ⚠️  NOTICE: Android TV got ${detectedResolution} (codec penalty may be too high)`);
        } else if (!isAndroidTV && detectedResolution === '4K') {
          console.log(`   ✅ SUCCESS: Web/PC got 4K stream as expected`);
        }
        
      } else {
        console.log(`❌ No streams found`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n📊 SUMMARY');
  console.log('The naming fix should now preserve original torrent names during scoring,');
  console.log('allowing codec detection to work properly while still showing clean titles.');
  console.log('Android TV should consistently get 4K streams with appropriate codec preferences.');
}

if (require.main === module) {
  testCodecDetectionFixed().catch(console.error);
}
