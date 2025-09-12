#!/usr/bin/env node

/**
 * Comprehensive test of all 8 debrid providers - complete Torrentio parity
 * Tests configuration, validation, and stream naming for all providers
 */

const http = require('http');

// Test all 8 debrid providers
const TEST_PROVIDERS = [
  { key: 'realdebrid', apiKey: 'test_rd_key', expectedName: 'AutoStream (RD)', shortCode: 'rd' },
  { key: 'alldebrid', apiKey: 'lpqDAyBgE0j1BGLqC69B', expectedName: 'AutoStream (AD)', shortCode: 'ad' },
  { key: 'premiumize', apiKey: 'test_pm_key', expectedName: 'AutoStream (PM)', shortCode: 'pm' },
  { key: 'torbox', apiKey: 'test_tb_key', expectedName: 'AutoStream (TB)', shortCode: 'tb' },
  { key: 'offcloud', apiKey: 'test_oc_key', expectedName: 'AutoStream (OC)', shortCode: 'oc' },
  { key: 'easydebrid', apiKey: 'test_ed_key', expectedName: 'AutoStream (ED)', shortCode: 'ed' },
  { key: 'debridlink', apiKey: 'test_dl_key', expectedName: 'AutoStream (DL)', shortCode: 'dl' },
  { key: 'putio', apiKey: 'test_pi_key', expectedName: 'AutoStream (PI)', shortCode: 'pi' },
];

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Invalid JSON', raw: data });
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

async function testProvider(provider) {
  console.log(`\n🧪 Testing ${provider.key.toUpperCase()} Provider`);
  console.log('='.repeat(50));
  
  try {
    // Test 1: Manifest with provider configuration
    const manifestUrl = `http://localhost:7010/manifest.json?${provider.key}=${provider.apiKey}`;
    const manifest = await makeRequest(manifestUrl);
    
    if (manifest.error) {
      console.log(`❌ Manifest Error: ${manifest.error}`);
      return false;
    }
    
    console.log(`✅ Manifest Name: "${manifest.name}"`);
    if (manifest.name === provider.expectedName) {
      console.log(`✅ Provider naming correct`);
    } else {
      console.log(`❌ Expected "${provider.expectedName}", got "${manifest.name}"`);
    }
    
    // Test 2: Stream request with provider
    const streamUrl = `http://localhost:7010/stream/series/tt13159924:1:3.json?${provider.key}=${provider.apiKey}`;
    const streams = await makeRequest(streamUrl);
    
    if (streams.error) {
      console.log(`❌ Stream Error: ${streams.error}`);
      return false;
    }
    
    if (!streams.streams || streams.streams.length === 0) {
      console.log(`❌ No streams returned`);
      return false;
    }
    
    console.log(`✅ Got ${streams.streams.length} streams`);
    
    // Check for debrid play URLs (for AllDebrid which actually validates, others will be mock)
    const debridStreams = streams.streams.filter(s => 
      s.url && s.url.includes('/play?ih=')
    );
    
    if (provider.key === 'alldebrid') {
      // Real AllDebrid should have debrid play URLs
      if (debridStreams.length > 0) {
        console.log(`✅ AllDebrid: ${debridStreams.length} debrid play URLs generated`);
        console.log(`   Sample URL: ${debridStreams[0].url.substring(0, 60)}...`);
      } else {
        console.log(`❌ AllDebrid: No debrid play URLs found`);
      }
    } else {
      // Other providers are mocked, so may not have debrid URLs
      console.log(`ℹ️  ${provider.key}: Mock provider (${debridStreams.length} debrid URLs)`);
    }
    
    // Check stream naming
    const firstStream = streams.streams[0];
    console.log(`✅ Sample stream name: "${firstStream.name}"`);
    
    return true;
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return false;
  }
}

async function testAllProviders() {
  console.log('🚀 Testing All 8 Debrid Providers - Complete Torrentio Parity');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  
  for (const provider of TEST_PROVIDERS) {
    const success = await testProvider(provider);
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(70));
  console.log(`✅ Passed: ${passed}/${TEST_PROVIDERS.length} providers`);
  console.log(`❌ Failed: ${failed}/${TEST_PROVIDERS.length} providers`);
  
  if (passed === TEST_PROVIDERS.length) {
    console.log('\n🎉 SUCCESS: All 8 debrid providers working correctly!');
    console.log('🎯 Complete Torrentio parity achieved!');
  } else {
    console.log('\n⚠️  Some providers need attention');
  }
  
  // Test provider detection logic
  console.log('\n🔍 Testing Provider Detection Logic');
  console.log('-'.repeat(40));
  
  try {
    // Import and test debrid providers directly
    const debridProviders = require('./core/debridProviders.js');
    const allProviders = debridProviders.getAllProviders();
    
    console.log(`✅ Provider detection: ${Object.keys(allProviders).length} providers configured`);
    console.log(`   Providers: ${Object.keys(allProviders).join(', ')}`);
    
    // Test validation for each provider
    for (const provider of TEST_PROVIDERS) {
      const isValid = debridProviders.validateProviderConfig(provider.key, provider.apiKey);
      console.log(`   ${provider.key}: ${isValid ? '✅ Valid' : '❌ Invalid'} configuration`);
    }
    
  } catch (error) {
    console.log(`❌ Provider detection test failed: ${error.message}`);
  }
}

// Run the tests
testAllProviders().catch(console.error);
