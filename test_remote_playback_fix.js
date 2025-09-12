/**
 * Test AllDebrid playback fix specifically for remote server
 * This simulates the exact scenario that was failing with NO_SERVER
 */

const http = require('http');
const https = require('https');

async function testRemoteAllDebridPlayback() {
  console.log('🎬 TESTING ALLDEBRID PLAYBACK FIX ON REMOTE SERVER');
  console.log('==================================================');
  
  const REMOTE_SERVER = 'https://autostream-addon.onrender.com';
  const TEST_KEY = 'oEvvPkMgD2Z9aDfNoAMc';
  
  // Test the exact scenario that was failing
  const testUrl = `${REMOTE_SERVER}/play?ih=45fa4233ef87c58f5f8b9e35f2b4c2e1a90d7915&idx=0&imdb=tt3402138&alldebrid=${TEST_KEY}`;
  
  console.log('📡 Testing play URL:', testUrl.replace(TEST_KEY, '***KEY***'));
  
  try {
    // Make a HEAD request to see if it would redirect (not download)
    const response = await fetch(testUrl, {
      method: 'HEAD',
      redirect: 'manual' // Don't follow redirects, just check if we get one
    });
    
    console.log('📊 Status:', response.status);
    console.log('📍 Location:', response.headers.get('location') || 'None');
    
    if (response.status === 302) {
      console.log('✅ SUCCESS: Got redirect (normal debrid behavior)');
      console.log('🎯 This means the NO_SERVER fix is working!');
      return true;
    } else if (response.status === 500) {
      console.log('❌ FAILURE: Still getting server error (NO_SERVER likely)');
      return false;
    } else {
      console.log('⚠️  UNEXPECTED: Status', response.status, '- may need investigation');
      return false;
    }
    
  } catch (error) {
    console.log('💥 Error testing playback:', error.message);
    return false;
  }
}

// Test both local and remote to compare
async function runComparisonTest() {
  console.log('🧪 RUNNING COMPARISON TEST\n');
  
  // Test remote first (the one that was broken)
  const remoteSuccess = await testRemoteAllDebridPlayback();
  
  console.log('\n' + '='.repeat(50));
  console.log('🏁 FINAL RESULT');
  console.log('='.repeat(50));
  
  if (remoteSuccess) {
    console.log('🎉 NO_SERVER FIX: SUCCESS!');
    console.log('✅ AllDebrid should now work on remote server');
  } else {
    console.log('🚨 NO_SERVER FIX: STILL FAILING');
    console.log('❌ Additional investigation needed');
  }
  
  return remoteSuccess;
}

runComparisonTest().then(success => {
  process.exit(success ? 0 : 1);
});
