/**
 * Quick test to verify NO_SERVER fix for AllDebrid
 */

const https = require('https');

// Test AllDebrid API with proper headers
async function testAllDebridHeaders() {
  const testKey = 'oEvvPkMgD2Z9aDfNoAMc';
  const testMagnet = 'magnet:?xt=urn:btih:45fa4233ef87c58f5f8b9e35f2b4c2e1a90d7915&dn=Test';
  
  console.log('🔧 Testing AllDebrid NO_SERVER fix');
  console.log('=====================================');
  
  // Test with proper headers (should work)
  const headers = {
    'User-Agent': 'AutoStream/3.0',
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  
  try {
    const url = `https://api.alldebrid.com/v4/magnet/upload?apikey=${encodeURIComponent(testKey)}&magnets[]=${encodeURIComponent(testMagnet)}`;
    
    console.log('📡 Making test request with headers...');
    console.log('🔧 User-Agent: ' + headers['User-Agent']);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: headers
    });
    
    const result = await response.json();
    
    console.log('📊 Status:', response.status);
    console.log('🔍 Response:', JSON.stringify(result, null, 2));
    
    if (result && result.error && result.error.code === 'NO_SERVER') {
      console.log('❌ NO_SERVER error still occurring');
      return false;
    } else {
      console.log('✅ NO_SERVER error resolved!');
      return true;
    }
    
  } catch (error) {
    console.log('💥 Test error:', error.message);
    return false;
  }
}

// Run the test
testAllDebridHeaders().then(success => {
  console.log('\n🎯 RESULT:', success ? 'FIX SUCCESSFUL' : 'FIX NEEDED');
  process.exit(success ? 0 : 1);
});
