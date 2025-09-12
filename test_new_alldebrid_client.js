#!/usr/bin/env node
'use strict';

// Test the new AllDebrid API client implementation
console.log('🧪 Testing new AllDebrid API client implementation...');

// Test with a known working API key (if provided)
const testApiKey = process.env.TEST_AD_KEY || 'your_test_key_here';

if (testApiKey === 'your_test_key_here') {
  console.log('❌ No test API key provided. Set TEST_AD_KEY environment variable.');
  console.log('   Example: TEST_AD_KEY=your_key node test_new_alldebrid_client.js');
  process.exit(1);
}

const AllDebridClient = require('all-debrid-api');

async function testAllDebridClient() {
  try {
    console.log('📞 Testing AllDebrid API client...');
    
    // Create client with same options as Torrentio
    const options = { ip: '127.0.0.1', base_agent: 'autostream', timeout: 10000 };
    const AD = new AllDebridClient(testApiKey, options);
    
    console.log('✅ AllDebrid client created successfully');
    console.log('   Options:', options);
    
    // Test a simple API call
    console.log('📡 Testing user info API call...');
    const userInfo = await AD.user.info();
    
    if (userInfo && userInfo.status === 'success') {
      console.log('✅ API call successful!');
      console.log('   User:', userInfo.data.username);
      console.log('   Status:', userInfo.data.isPremium ? 'Premium' : 'Free');
      
      // Test instant availability with a common magnet
      const testMagnet = 'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
      console.log('🔍 Testing instant availability...');
      
      try {
        const instantResult = await AD.magnet.instant([testMagnet]);
        console.log('✅ Instant availability check successful');
        console.log('   Response:', JSON.stringify(instantResult, null, 2));
      } catch (instantError) {
        console.log('⚠️ Instant availability check failed:', instantError.message);
        console.log('   This is normal for test magnets');
      }
      
    } else {
      console.log('❌ API call failed');
      console.log('   Response:', JSON.stringify(userInfo, null, 2));
    }
    
  } catch (error) {
    console.log('❌ Error:', error.message);
    console.log('   Code:', error.code);
    console.log('   Stack:', error.stack);
    
    // Check if this is the NO_SERVER error
    if (error.code === 'NO_SERVER') {
      console.log('🚨 NO_SERVER error still occurring!');
      console.log('   This means the AllDebrid API client is also being blocked');
    } else if (error.code === 'AUTH_BAD_APIKEY') {
      console.log('🔑 Invalid API key - please check your key');
    } else {
      console.log('🤔 Unknown error type');
    }
  }
}

// Run the test
testAllDebridClient().catch(console.error);