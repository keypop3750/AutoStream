/**
 * Test to see actual stream data and resolution detection before/after naming
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

async function testStreamData() {
  console.log('\n🔍 TESTING STREAM DATA AND RESOLUTION DETECTION\n');
  
  const testCases = [
    {
      name: 'Breaking Bad (Movie)',
      url: 'http://localhost:7010/stream/movie/tt0903747.json',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    {
      name: 'Breaking Bad (Android TV)',
      url: 'http://localhost:7010/stream/movie/tt0903747.json', 
      userAgent: 'Dalvik/2.1.0 (Linux; U; Android 9; SHIELD Android TV Build/PPR1.180610.011)'
    },
    {
      name: 'Gen V Episode (Web)',
      url: 'http://localhost:7010/stream/series/tt13159924:1:3.json',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    {
      name: 'Gen V Episode (Android TV)',
      url: 'http://localhost:7010/stream/series/tt13159924:1:3.json',
      userAgent: 'Dalvik/2.1.0 (Linux; U; Android 9; SHIELD Android TV Build/PPR1.180610.011)'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📱 ${testCase.name}`);
    console.log(`🌐 User Agent: ${testCase.userAgent.substring(0, 50)}...`);
    
    try {
      const result = await makeRequest(testCase.url, testCase.userAgent);
      
      if (result.streams && result.streams.length > 0) {
        const stream = result.streams[0];
        
        console.log(`✅ Stream found:`);
        console.log(`   📛 Name: "${stream.name}"`);
        console.log(`   📋 Title: "${stream.title}"`);
        
        // Try to extract resolution info manually
        const nameText = (stream.name || '').toLowerCase();
        const titleText = (stream.title || '').toLowerCase();
        const combinedText = `${nameText} ${titleText}`;
        
        let detectedResolution = 'unknown';
        if (/\b(2160p|4k|uhd)\b/.test(combinedText)) detectedResolution = '4K';
        else if (/\b(1080p|fhd)\b/.test(combinedText)) detectedResolution = '1080p';
        else if (/\b(720p|hd)\b/.test(combinedText)) detectedResolution = '720p';
        else if (/\b(480p|sd)\b/.test(combinedText)) detectedResolution = '480p';
        
        console.log(`   🎬 Detected Resolution: ${detectedResolution}`);
        
        // Check codec info
        let codecInfo = 'unknown';
        if (/\b(x265|hevc|h\.?265)\b/.test(combinedText)) codecInfo = 'x265/HEVC';
        else if (/\b(x264|avc|h\.?264)\b/.test(combinedText)) codecInfo = 'x264/AVC';
        
        console.log(`   🎭 Detected Codec: ${codecInfo}`);
        
        // Check if this looks like original torrent data or processed data
        if (stream.name.includes('AutoStream')) {
          console.log(`   ⚠️  Stream name already processed with addon name`);
        } else {
          console.log(`   ✅ Stream name contains original torrent info`);
        }
        
      } else {
        console.log(`❌ No streams found`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
}

if (require.main === module) {
  testStreamData().catch(console.error);
}
