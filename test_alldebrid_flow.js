#!/usr/bin/env node
'use strict';

// Test the full debrid flow with new AllDebrid API client
console.log('🧪 Testing AllDebrid integration with API client...');

const http = require('http');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data.length > 0 ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function testAllDebridFlow() {
  try {
    console.log('🔗 Testing manifest generation...');
    
    // Test manifest with AllDebrid key
    const manifestUrl = 'http://localhost:7010/oEvvPkMgD2Z9aDfNoAMc/manifest.json';
    const manifestResponse = await makeRequest(manifestUrl);
    
    if (manifestResponse.status === 200) {
      console.log('✅ Manifest generated successfully');
      console.log('   Addon ID:', manifestResponse.body.id);
      console.log('   Addon Name:', manifestResponse.body.name);
    } else {
      console.log('❌ Manifest generation failed');
      console.log('   Status:', manifestResponse.status);
      console.log('   Body:', manifestResponse.body);
      return;
    }
    
    console.log('🔍 Testing stream request with AllDebrid...');
    
    // Test stream request with a popular movie
    const streamUrl = 'http://localhost:7010/oEvvPkMgD2Z9aDfNoAMc/stream/movie/tt0111161.json';
    const streamResponse = await makeRequest(streamUrl);
    
    if (streamResponse.status === 200 && streamResponse.body && streamResponse.body.streams) {
      console.log('✅ Stream request successful');
      const streams = streamResponse.body.streams;
      console.log(`   Found ${streams.length} streams`);
      
      if (streams.length > 0) {
        const firstStream = streams[0];
        console.log('   First stream:', firstStream.name || firstStream.title);
        console.log('   Stream URL starts with:', firstStream.url.substring(0, 50) + '...');
        
        // Test the actual play URL (this will test our AllDebrid API client)
        if (firstStream.url.includes('localhost:7010/play')) {
          console.log('🎬 Testing AllDebrid play resolution...');
          
          try {
            const playResponse = await makeRequest(firstStream.url);
            
            if (playResponse.status === 302) {
              console.log('✅ AllDebrid resolution successful');
              console.log('   Redirected to:', playResponse.headers.location ? 'Valid URL' : 'Unknown');
            } else if (playResponse.status === 400) {
              console.log('⚠️ AllDebrid error (expected with test key)');
              console.log('   Error:', playResponse.body);
              
              // Check if we're getting a proper error instead of NO_SERVER
              if (playResponse.body && playResponse.body.error !== 'NO_SERVER') {
                console.log('✅ NO_SERVER error is FIXED! Getting proper error codes now.');
              } else {
                console.log('❌ Still getting NO_SERVER error');
              }
            } else {
              console.log('🤔 Unexpected play response');
              console.log('   Status:', playResponse.status);
              console.log('   Body:', playResponse.body);
            }
          } catch (playError) {
            console.log('❌ Play request failed:', playError.message);
          }
        }
      }
    } else {
      console.log('❌ Stream request failed');
      console.log('   Status:', streamResponse.status);
      console.log('   Body:', streamResponse.body);
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('   Stack:', error.stack);
  }
}

// Run the test
testAllDebridFlow().catch(console.error);