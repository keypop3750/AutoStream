#!/usr/bin/env node
'use strict';

// Debug stream request to see what's happening
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

async function debugStreamRequest() {
  console.log('🔍 Debugging stream request...');
  
  try {
    // Test different movies
    const testUrls = [
      'http://localhost:7010/stream/movie/tt0111161.json?ad=oEvvPkMgD2Z9aDfNoAMc', // Shawshank Redemption
      'http://localhost:7010/stream/movie/tt0068646.json?ad=oEvvPkMgD2Z9aDfNoAMc', // The Godfather
      'http://localhost:7010/stream/series/tt13159924:1:3.json?ad=oEvvPkMgD2Z9aDfNoAMc' // Gen V
    ];
    
    for (const url of testUrls) {
      console.log(`\n📡 Testing: ${url.split('?')[0]}`);
      
      const response = await makeRequest(url);
      console.log('   Status:', response.status);
      
      if (response.status === 200) {
        try {
          const data = JSON.parse(response.data);
          console.log('   Streams found:', data.streams?.length || 0);
          
          if (data.streams && data.streams.length > 0) {
            console.log('   First stream:', data.streams[0].name);
            console.log('   Stream URL:', data.streams[0].url?.substring(0, 60) + '...');
            
            // Test this play URL
            console.log('   🎬 Testing play URL...');
            const playResponse = await makeRequest(data.streams[0].url);
            console.log('   Play status:', playResponse.status);
            
            if (playResponse.status === 302) {
              console.log('   ✅ Redirect to:', playResponse.headers.location?.substring(0, 80) + '...');
            } else {
              console.log('   Response:', playResponse.data.substring(0, 200));
            }
            
            break; // Found working streams, stop testing
          } else {
            console.log('   No streams in response');
          }
        } catch (parseError) {
          console.log('   Parse error:', parseError.message);
          console.log('   Raw response:', response.data.substring(0, 200));
        }
      } else {
        console.log('   Error response:', response.data.substring(0, 200));
      }
    }
    
  } catch (error) {
    console.log('❌ Debug failed:', error.message);
  }
}

// Run the debug
debugStreamRequest().catch(console.error);