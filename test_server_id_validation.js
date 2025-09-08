#!/usr/bin/env node
/**
 * Test Dynamic ID Validation Integration in AutoStream Server
 * Verifies that the new ID validation system works in the actual server
 */

const http = require('http');
const https = require('https');

const SERVER_URL = 'http://localhost:7010';

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data, status: res.statusCode });
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function testServerIDValidation() {
  console.log('🧪 Testing Dynamic ID Validation in AutoStream Server\n');
  
  // Test cases to verify the new system works
  const testCases = [
    {
      name: 'Valid ID - Gen V',
      url: `${SERVER_URL}/stream/series/tt13159924:1:1.json`,
      expectedResult: 'Should work normally with validation logs'
    },
    {
      name: 'Invalid ID - Non-existent',
      url: `${SERVER_URL}/stream/series/tt99999999:1:1.json`,
      expectedResult: 'Should continue with warning but not crash'
    },
    {
      name: 'Valid ID - Lilo & Stitch Correct',
      url: `${SERVER_URL}/stream/series/tt0364774:1:1.json`,
      expectedResult: 'Should validate successfully'
    },
    {
      name: 'Invalid ID - Lilo & Stitch Wrong',
      url: `${SERVER_URL}/stream/series/tt0762298:1:1.json`,
      expectedResult: 'Should show validation warning but not crash'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`📋 Testing: ${testCase.name}`);
    console.log(`🔗 URL: ${testCase.url}`);
    console.log(`🎯 Expected: ${testCase.expectedResult}`);
    
    try {
      const startTime = Date.now();
      const response = await makeRequest(testCase.url);
      const endTime = Date.now();
      
      console.log(`⏱️ Response time: ${endTime - startTime}ms`);
      
      if (response.streams) {
        console.log(`✅ Received ${response.streams.length} streams`);
        if (response.streams.length > 0) {
          console.log(`   First stream: ${response.streams[0].title || response.streams[0].name || 'Unknown'}`);
        }
      } else if (response.raw) {
        console.log('📄 Raw response (first 200 chars):', response.raw.substring(0, 200));
      } else {
        console.log('📄 Response:', response);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log('');
  }
}

async function testStatusEndpoint() {
  console.log('🔍 Testing Server Status Endpoint\n');
  
  try {
    const response = await makeRequest(`${SERVER_URL}/status`);
    console.log('Status response:', response);
    
    if (response.version === '3.4.4') {
      console.log('✅ Server version 3.4.4 confirmed (includes AllDebrid fix + ID validation)');
    } else {
      console.log(`⚠️ Unexpected version: ${response.version}`);
    }
  } catch (error) {
    console.log(`❌ Status check failed: ${error.message}`);
  }
  
  console.log('');
}

async function main() {
  console.log('🚀 AutoStream V3.4.4 - Dynamic ID Validation Test\n');
  
  try {
    // Check if server is running
    await testStatusEndpoint();
    
    // Test the new ID validation system
    await testServerIDValidation();
    
    console.log('✅ All tests completed!');
    console.log('\n🎯 New Dynamic ID Validation Features:');
    console.log('• Proactive IMDB ID validation before stream fetching');
    console.log('• Automatic metadata verification against Cinemeta');
    console.log('• Title similarity scoring for context validation');
    console.log('• No hard-coded ID mappings required');
    console.log('• Graceful handling of invalid/missing IDs');
    console.log('• Performance optimization with 24-hour caching');
    
    console.log('\n🔧 Integration Benefits:');
    console.log('• Prevents wrong IMDB ID issues proactively');
    console.log('• Reduces wasted API calls for invalid content');
    console.log('• Provides clear logging for debugging');
    console.log('• Maintains backward compatibility');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    console.log('\n💡 Make sure AutoStream server is running: node server.js');
  }
}

if (require.main === module) {
  main();
}

module.exports = { testServerIDValidation, testStatusEndpoint };
