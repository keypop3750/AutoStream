#!/usr/bin/env node

// Test script to verify debrid fixes
const http = require('http');

console.log('🧪 Testing Debrid Fixes\n');

// Test debrid stream request
function testDebridStream() {
  return new Promise((resolve, reject) => {
    console.log('💳 Test: Debrid stream (should have better headers and deduplication)');
    
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: '/stream/series/tt0364774:1:15.json?ad=test_key_123',
      method: 'GET',
      headers: {
        'User-Agent': 'AndroidTV/13 (Stremio/1.6.0; ExoPlayer/2.18.7)',
        'Accept': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const streams = response.streams || [];
          
          console.log(`   📊 Returned ${streams.length} streams`);
          
          if (streams.length > 0) {
            const stream = streams[0];
            console.log(`   🔍 Stream analysis:`);
            console.log(`      Name: "${stream.name || 'N/A'}"`);
            console.log(`      Has URL: ${!!stream.url}`);
            console.log(`      URL type: ${stream.url && stream.url.includes('/play?ih=') ? 'Play URL (GOOD)' : 'Other/None'}`);
            
            if (stream.url && stream.url.includes('/play?ih=')) {
              console.log(`   ✅ SUCCESS: Debrid stream has proper /play URL`);
              return resolve(stream);
            } else {
              console.log(`   ❌ ISSUE: Debrid stream missing proper /play URL`);
              return resolve(stream);
            }
          } else {
            console.log(`   ❌ No streams returned`);
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => reject(new Error('Timeout')));
    req.end();
  });
}

// Test multiple simultaneous requests to check deduplication
function testRequestDeduplication() {
  return new Promise((resolve, reject) => {
    console.log('\n🔄 Test: Request deduplication (multiple simultaneous /play requests)');
    
    const playUrl = '/play?ih=9bd95b321b1c15134759a33e33382cc60674b32c&idx=14&imdb=tt0364774:1:15&ad=test_key_123';
    
    console.log('   🚀 Sending 5 simultaneous requests...');
    
    const requests = [];
    const startTime = Date.now();
    
    for (let i = 0; i < 5; i++) {
      const promise = new Promise((resolveReq, rejectReq) => {
        const options = {
          hostname: 'localhost',
          port: 7010,
          path: playUrl,
          method: 'GET',
          headers: {
            'User-Agent': 'AndroidTV/13 (Stremio/1.6.0; ExoPlayer/2.18.7)'
          }
        };
        
        const req = http.request(options, (res) => {
          resolveReq({
            status: res.statusCode,
            headers: res.headers,
            requestId: i + 1
          });
        });
        
        req.on('error', rejectReq);
        req.setTimeout(5000, () => rejectReq(new Error('Timeout')));
        req.end();
      });
      
      requests.push(promise);
    }
    
    Promise.all(requests)
      .then(results => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`   ⏱️  All requests completed in ${duration}ms`);
        console.log(`   📊 Results:`);
        
        results.forEach(result => {
          console.log(`      Request ${result.requestId}: ${result.status} ${result.status === 302 ? '(Redirect - GOOD)' : '(Not redirect)'}`);
          if (result.headers['cache-control']) {
            console.log(`         Cache-Control: ${result.headers['cache-control']}`);
          }
          if (result.headers['accept-ranges']) {
            console.log(`         Accept-Ranges: ${result.headers['accept-ranges']}`);
          }
        });
        
        const successCount = results.filter(r => r.status === 302).length;
        console.log(`   ✅ ${successCount}/5 requests succeeded`);
        
        if (duration < 5000 && successCount >= 4) {
          console.log(`   🎯 SUCCESS: Fast responses suggest good caching/deduplication`);
        } else {
          console.log(`   ⚠️  Responses took ${duration}ms - may indicate API calls not being deduplicated`);
        }
        
        resolve(results);
      })
      .catch(reject);
  });
}

// Run tests
async function runTests() {
  try {
    // Test 1: Debrid stream format
    await testDebridStream();
    
    // Test 2: Request deduplication (note: will fail without real API key, but we can test the mechanism)
    await testRequestDeduplication();
    
    console.log('\n🏆 Test Summary:');
    console.log('• Extended cache to 15 minutes to reduce AllDebrid API calls');
    console.log('• Added request deduplication to prevent simultaneous identical requests');
    console.log('• Enhanced HTTP headers for better player compatibility');
    console.log('• Added proper CORS and range request headers');
    console.log('\n💡 Expected improvements:');
    console.log('• Fewer "switching to VLC player" errors due to better headers');
    console.log('• Reduced AllDebrid API usage due to longer caching and deduplication');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

runTests();
