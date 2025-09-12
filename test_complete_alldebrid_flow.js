#!/usr/bin/env node
'use strict';

// Test complete AllDebrid flow with the new API client implementation
const http = require('http');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Request timeout')));
    req.end();
  });
}

async function testAllDebridFlow() {
  console.log('🧪 Testing complete AllDebrid flow with new API client...');
  
  try {
    // Test 1: Basic server health
    console.log('\n1️⃣ Testing server health...');
    const health = await makeRequest('http://localhost:7010/');
    console.log('✅ Server is running');
    console.log('   Status:', health.status);
    
    // Test 2: Manifest with AllDebrid key
    console.log('\n2️⃣ Testing manifest generation with AllDebrid key...');
    const manifestUrl = 'http://localhost:7010/manifest.json?ad=oEvvPkMgD2Z9aDfNoAMc';
    const manifest = await makeRequest(manifestUrl);
    
    if (manifest.status === 200 && manifest.data.id) {
      console.log('✅ Manifest generated successfully');
      console.log('   Addon ID:', manifest.data.id);
      console.log('   Resources:', manifest.data.resources?.length || 0);
    } else {
      console.log('❌ Manifest generation failed');
      console.log('   Status:', manifest.status);
      console.log('   Data:', manifest.data);
      return;
    }
    
    // Test 3: Stream request for a known content
    console.log('\n3️⃣ Testing stream request...');
    const streamUrl = 'http://localhost:7010/stream/movie/tt0111161.json?ad=oEvvPkMgD2Z9aDfNoAMc';
    const streams = await makeRequest(streamUrl);
    
    if (streams.status === 200 && streams.data.streams) {
      console.log('✅ Stream request successful');
      console.log('   Found streams:', streams.data.streams.length);
      
      if (streams.data.streams.length > 0) {
        const firstStream = streams.data.streams[0];
        console.log('   First stream:', firstStream.name || firstStream.title);
        console.log('   Stream URL structure:', firstStream.url?.substring(0, 50) + '...');
      }
    } else {
      console.log('❌ Stream request failed');
      console.log('   Status:', streams.status);
      console.log('   Data:', streams.data);
    }
    
    // Test 4: Configure page
    console.log('\n4️⃣ Testing configure page...');
    const configure = await makeRequest('http://localhost:7010/configure');
    
    if (configure.status === 200) {
      console.log('✅ Configure page accessible');
      console.log('   Response length:', configure.data.length);
    } else {
      console.log('❌ Configure page failed');
      console.log('   Status:', configure.status);
    }
    
    console.log('\n🎉 AllDebrid flow test completed!');
    
  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('   Stack:', error.stack);
  }
}

// Run the test
testAllDebridFlow().catch(console.error);