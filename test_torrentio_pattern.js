#!/usr/bin/env node

// Test script to verify the Torrentio pattern implementation
const http = require('http');

console.log('🧪 Testing Torrentio Pattern Implementation\n');

// Test 1: Non-debrid request (should return infoHash + sources, no URL)
function testNonDebrid() {
  return new Promise((resolve, reject) => {
    console.log('📱 Test 1: Non-debrid request (Android TV simulation)');
    
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: '/stream/series/tt13159924:1:3.json',
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
            console.log(`   🔍 First stream analysis:`);
            console.log(`      Name: "${stream.name || 'N/A'}"`);
            console.log(`      URL: ${stream.url ? `"${stream.url}"` : 'null (GOOD - Torrentio pattern)'}`);
            console.log(`      InfoHash: ${stream.infoHash ? `"${stream.infoHash.substring(0, 8)}..."` : 'null'}`);
            console.log(`      Sources: ${stream.sources ? stream.sources.length : 0} available`);
            
            // Check if it matches Torrentio pattern
            const isTorrentioPattern = !stream.url && stream.infoHash && stream.sources && stream.sources.length > 0;
            console.log(`   ✅ Torrentio Pattern: ${isTorrentioPattern ? 'PASS' : 'FAIL'}`);
            
            if (isTorrentioPattern) {
              console.log(`   🎯 SUCCESS: Stream follows Torrentio pattern (infoHash + sources, no URL)`);
              console.log(`   📱 This should work on Android TV because Stremio handles it internally`);
            } else {
              console.log(`   ❌ FAIL: Stream doesn't follow Torrentio pattern`);
            }
          } else {
            console.log(`   ❌ No streams returned`);
          }
          
          resolve(streams[0]);
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

// Test 2: Debrid request (should return /play URLs)
function testDebrid() {
  return new Promise((resolve, reject) => {
    console.log('\n💳 Test 2: Debrid request simulation');
    
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: '/stream/series/tt13159924:1:3.json?ad=test_key_123',
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
            console.log(`   🔍 First stream analysis:`);
            console.log(`      Name: "${stream.name || 'N/A'}"`);
            console.log(`      URL: ${stream.url ? `"${stream.url.substring(0, 50)}..."` : 'null'}`);
            console.log(`      InfoHash: ${stream.infoHash ? `"${stream.infoHash.substring(0, 8)}..."` : 'null'}`);
            
            // Check if it has a play URL for debrid
            const hasPlayUrl = stream.url && stream.url.includes('/play?ih=');
            console.log(`   ✅ Has Play URL: ${hasPlayUrl ? 'PASS' : 'FAIL'}`);
            
            if (hasPlayUrl) {
              console.log(`   🎯 SUCCESS: Debrid stream has /play URL for resolution`);
            } else {
              console.log(`   ❌ FAIL: Debrid stream missing /play URL`);
            }
          } else {
            console.log(`   ❌ No streams returned`);
          }
          
          resolve(streams[0]);
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

// Run tests
async function runTests() {
  try {
    await testNonDebrid();
    await testDebrid();
    
    console.log('\n🏆 Test Summary:');
    console.log('• Non-debrid streams use Torrentio pattern (infoHash + sources, no URL)');
    console.log('• Debrid streams use /play URLs for click-time resolution');
    console.log('• This approach should work universally including Android TV');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
