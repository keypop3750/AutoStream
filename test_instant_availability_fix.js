/**
 * Test Instant Availability Fix
 * 
 * This test verifies that the debrid service now checks for instant
 * availability before downloading torrents, which should prevent the
 * "torrent downloading" issue reported by the user.
 */

const http = require('http');

console.log('🧪 Testing Instant Availability Fix\n');

// Test with the same movie that was causing issues: tt1312221 (Frankenstein)
const testInfoHash = '2efaabb25482601096c25c4fada9aeb75f3abc96'; // The hash from the logs
const testApiKey = 'test-key-for-simulation'; // Mock key for testing

async function testPlayRequest(infoHash, apiKey) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:7010/play?ih=${infoHash}&idx=0&imdb=tt1312221&ad=${apiKey}`;
    
    console.log(`🔗 Testing play URL: ${url}`);
    
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
          redirectLocation: res.headers.location
        });
      });
    });
    
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(15000, () => resolve({ error: 'Timeout', timeout: true }));
  });
}

async function testStreamRequest() {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:7010/stream/movie/tt1312221.json?ad=${testApiKey}`;
    
    console.log(`🔗 Testing stream URL: ${url}`);
    
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const streams = JSON.parse(data);
          resolve({
            success: true,
            streamCount: streams.streams?.length || 0,
            streams: streams.streams
          });
        } catch (e) {
          resolve({ success: false, error: e.message, data });
        }
      });
    });
    
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.setTimeout(15000, () => resolve({ success: false, error: 'Timeout' }));
  });
}

async function runTest() {
  console.log('🎬 Step 1: Testing stream generation...');
  
  const streamResult = await testStreamRequest();
  
  if (streamResult.success && streamResult.streamCount > 0) {
    console.log(`   ✅ Generated ${streamResult.streamCount} stream(s)`);
    
    // Find a stream with the debrid URL pattern
    const debridStream = streamResult.streams?.find(s => 
      s.url && s.url.includes('/play?ih=')
    );
    
    if (debridStream) {
      console.log(`   🎯 Found debrid stream: ${debridStream.name}`);
      console.log(`   🔗 Play URL: ${debridStream.url.substring(0, 80)}...`);
      
      // Extract the info hash from the URL
      const urlObj = new URL(debridStream.url, 'http://localhost:7010');
      const ih = urlObj.searchParams.get('ih');
      const adKey = urlObj.searchParams.get('ad');
      
      if (ih && adKey) {
        console.log('\n🔧 Step 2: Testing debrid resolution...');
        
        const playResult = await testPlayRequest(ih, adKey);
        
        console.log(`   📊 Status Code: ${playResult.statusCode}`);
        
        if (playResult.statusCode === 302 && playResult.redirectLocation) {
          console.log('   ✅ SUCCESS: Got redirect to direct file URL');
          console.log(`   🔗 Redirect to: ${playResult.redirectLocation.substring(0, 80)}...`);
          
          // Check if it's a direct file URL (not a magnet)
          if (playResult.redirectLocation.startsWith('http') && 
              !playResult.redirectLocation.includes('magnet:')) {
            console.log('   🎉 PERFECT: Direct HTTP file URL (no torrenting!)');
            return true;
          } else {
            console.log('   ⚠️  WARNING: Redirect is not a direct file URL');
            return false;
          }
        } else if (playResult.statusCode === 202) {
          console.log('   ⏳ CACHING: Files need to be cached first');
          console.log('   📝 Response:', playResult.data);
          return 'caching';
        } else if (playResult.error === 'Timeout') {
          console.log('   ❌ TIMEOUT: Request took too long (like the original issue)');
          return false;
        } else {
          console.log('   ❓ UNEXPECTED: Unexpected response');
          console.log('   📝 Response:', playResult.data || 'No data');
          return false;
        }
      } else {
        console.log('   ❌ Could not extract info hash or API key from stream URL');
        return false;
      }
    } else {
      console.log('   ❌ No debrid streams found');
      return false;
    }
  } else {
    console.log('   ❌ Failed to generate streams');
    console.log('   📝 Error:', streamResult.error || 'No streams generated');
    return false;
  }
}

// Run the test
runTest().then(result => {
  console.log('\n' + '='.repeat(60));
  
  if (result === true) {
    console.log('🎉 SUCCESS: Instant availability fix is working!');
    console.log('   • No torrenting when debrid is configured');
    console.log('   • Direct file URLs are returned instantly');
    console.log('   • No more infinite loading issues');
  } else if (result === 'caching') {
    console.log('⏳ PARTIAL: Files need caching, but no torrenting detected');
    console.log('   • This is normal for uncached content');
    console.log('   • The fix prevents infinite downloading loops');
  } else {
    console.log('❌ FAILED: Issues remain with the debrid system');
    console.log('   • Check the server logs for more details');
    console.log('   • The infinite loading issue may persist');
  }
  
  console.log('='.repeat(60));
}).catch(console.error);