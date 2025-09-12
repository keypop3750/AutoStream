#!/usr/bin/env node
'use strict';

// Test actual AllDebrid play resolution with the new API client
const http = require('http');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ 
          status: res.statusCode, 
          headers: res.headers,
          data: data 
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Request timeout')));
    req.end();
  });
}

async function testAllDebridPlayResolution() {
  console.log('🎬 Testing AllDebrid play resolution with API client...');
  
  try {
    // First get streams to find a play URL
    console.log('\n1️⃣ Getting streams for a movie...');
    const streamUrl = 'http://localhost:7010/stream/movie/tt0111161.json?ad=oEvvPkMgD2Z9aDfNoAMc';
    const streams = await makeRequest(streamUrl);
    
    if (streams.status !== 200 || !streams.data.streams || streams.data.streams.length === 0) {
      console.log('❌ No streams found');
      return;
    }
    
    const streamData = JSON.parse(streams.data);
    const firstStream = streamData.streams[0];
    console.log('✅ Found stream:', firstStream.name);
    console.log('   Play URL:', firstStream.url.substring(0, 80) + '...');
    
    // Test the play resolution
    console.log('\n2️⃣ Testing play resolution...');
    const playResponse = await makeRequest(firstStream.url);
    
    console.log('   Status:', playResponse.status);
    console.log('   Headers:', Object.keys(playResponse.headers));
    
    if (playResponse.status === 302) {
      console.log('✅ Redirect response (expected for debrid)');
      console.log('   Location:', playResponse.headers.location?.substring(0, 100) + '...');
      
      // Check if it's a proper debrid URL or fallback magnet
      if (playResponse.headers.location?.startsWith('magnet:')) {
        console.log('⚠️ Redirected to magnet (fallback mode)');
      } else if (playResponse.headers.location?.includes('alldebrid.com')) {
        console.log('✅ Redirected to AllDebrid URL (success!)');
      } else {
        console.log('🤔 Redirected to unknown URL type');
      }
      
    } else if (playResponse.status === 400) {
      console.log('❌ Bad request - checking error details...');
      try {
        const errorData = JSON.parse(playResponse.data);
        console.log('   Error code:', errorData.error);
        console.log('   Message:', errorData.message);
        console.log('   Permanent:', errorData.permanent);
        
        if (errorData.error === 'NO_SERVER') {
          console.log('🚨 NO_SERVER error still occurring! API client didn\'t solve it.');
        } else if (errorData.error === 'AUTH_BAD_APIKEY') {
          console.log('🔑 API key validation failed');
        } else {
          console.log('🤔 Other error type');
        }
      } catch {
        console.log('   Raw response:', playResponse.data.substring(0, 500));
      }
      
    } else if (playResponse.status === 401) {
      console.log('❌ Unauthorized - API key issue');
      
    } else if (playResponse.status === 404) {
      console.log('⏳ Caching in progress or content not found');
      try {
        const cacheData = JSON.parse(playResponse.data);
        console.log('   Caching:', cacheData.caching);
        console.log('   Message:', cacheData.msg);
      } catch {
        console.log('   Raw response:', playResponse.data);
      }
      
    } else {
      console.log('🤔 Unexpected status code');
      console.log('   Response:', playResponse.data.substring(0, 500));
    }
    
    console.log('\n🎬 AllDebrid play test completed!');
    
  } catch (error) {
    console.log('❌ Play test failed with error:', error.message);
    console.log('   Stack:', error.stack);
  }
}

// Run the test
testAllDebridPlayResolution().catch(console.error);