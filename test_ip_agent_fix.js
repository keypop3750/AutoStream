#!/usr/bin/env node
'use strict';

// Test the IP handling and agent fix for AllDebrid
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

async function testIpAndAgentFix() {
  console.log('🧪 Testing IP handling and agent fix for AllDebrid...');
  
  try {
    // Test a play URL that should trigger AllDebrid
    const testUrls = [
      'http://localhost:7010/stream/movie/tt0111161.json?ad=oEvvPkMgD2Z9aDfNoAMc',
    ];
    
    for (const url of testUrls) {
      console.log(`\n📡 Testing: ${url}`);
      
      const response = await makeRequest(url);
      console.log('   Status:', response.status);
      
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.data);
          console.log('   Streams found:', data.streams?.length || 0);
          
          if (data.streams && data.streams.length > 0) {
            const firstStream = data.streams[0];
            console.log('   Stream name:', firstStream.name);
            console.log('   Stream URL:', firstStream.url?.substring(0, 60) + '...');
            
            // Test the play URL with proper IP handling
            console.log('   🎬 Testing play URL with new IP handling...');
            const playResponse = await makeRequest(firstStream.url);
            console.log('   Play status:', playResponse.status);
            
            if (playResponse.status === 302) {
              const location = playResponse.headers.location;
              console.log('   ✅ Redirect successful!');
              console.log('   Location type:', location?.startsWith('magnet:') ? 'MAGNET (fallback)' : 
                                          location?.includes('alldebrid.com') ? 'ALLDEBRID (success!)' : 
                                          'OTHER');
              console.log('   Location:', location?.substring(0, 80) + '...');
            } else if (playResponse.status === 400) {
              console.log('   ❌ Still getting error - checking details...');
              try {
                const errorData = JSON.parse(playResponse.data);
                console.log('   Error code:', errorData.error);
                console.log('   Message:', errorData.message);
                
                if (errorData.error === 'NO_SERVER') {
                  console.log('   🚨 NO_SERVER error still present!');
                } else {
                  console.log('   ✅ Different error - NO_SERVER fixed!');
                }
              } catch {
                console.log('   Raw response:', playResponse.data.substring(0, 200));
              }
            } else {
              console.log('   Unexpected status:', playResponse.status);
              console.log('   Response:', playResponse.data.substring(0, 200));
            }
            
            break; // Stop after first successful stream
          }
        } catch (parseError) {
          console.log('   Parse error:', parseError.message);
        }
      } else {
        console.log('   Error response:', response.data.substring(0, 200));
      }
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

// Run the test
testIpAndAgentFix().catch(console.error);