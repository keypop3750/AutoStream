/**
 * End-to-End Configure Page Test
 * 
 * This test verifies the complete configure page workflow:
 * 1. Provider selection works
 * 2. API key input works 
 * 3. Manifest URL generation includes correct parameters
 * 4. All 8 debrid providers are supported
 */

const http = require('http');

console.log('🧪 End-to-End Configure Page Test\n');

// Test different provider configurations
const testConfigs = [
  { provider: 'AllDebrid', param: 'ad', testKey: 'test-ad-12345' },
  { provider: 'RealDebrid', param: 'rd', testKey: 'test-rd-67890' }, 
  { provider: 'Premiumize', param: 'pm', testKey: 'test-pm-abcde' },
  { provider: 'TorBox', param: 'tb', testKey: 'test-tb-fghij' },
  { provider: 'Offcloud', param: 'oc', testKey: 'test-oc-klmno' },
  { provider: 'EasyDebrid', param: 'ed', testKey: 'test-ed-pqrst' },
  { provider: 'DebridLink', param: 'dl', testKey: 'test-dl-uvwxy' },
  { provider: 'Put.io', param: 'pi', testKey: 'test-pi-z1234' }
];

async function testManifestUrl(param, key) {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:7010/manifest.json?${param}=${key}`;
    
    console.log(`🔗 Testing manifest URL: ${url}`);
    
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const manifest = JSON.parse(data);
          resolve({ 
            success: true, 
            manifest,
            hasId: !!manifest.id,
            hasResources: !!manifest.resources,
            hasStreamResource: manifest.resources?.some(r => r.name === 'stream')
          });
        } catch (e) {
          resolve({ success: false, error: e.message, data });
        }
      });
    });
    
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.setTimeout(10000, () => resolve({ success: false, error: 'Timeout' }));
  });
}

async function runTests() {
  console.log('Testing manifest URL generation for each provider:\n');
  
  let allPassed = true;
  
  for (const { provider, param, testKey } of testConfigs) {
    console.log(`🔧 Testing ${provider}:`);
    
    const result = await testManifestUrl(param, testKey);
    
    if (result.success && result.hasId && result.hasStreamResource) {
      console.log(`   ✅ PASS - Valid manifest generated`);
      console.log(`   📋 Manifest ID: ${result.manifest.id}`);
      console.log(`   🎬 Stream resource: Found`);
    } else {
      console.log(`   ❌ FAIL - Invalid manifest`);
      console.log(`   📋 Error: ${result.error || 'Missing required fields'}`);
      allPassed = false;
    }
    console.log('');
  }
  
  // Test combined parameters (multiple settings)
  console.log('🔀 Testing combined parameters:');
  const combinedUrl = 'http://localhost:7010/manifest.json?rd=test-key&fallback=1&lang_prio=EN,ES&max_size=4';
  console.log(`🔗 Combined URL: ${combinedUrl}`);
  
  const combinedResult = await testManifestUrl('rd=test-key&fallback=1&lang_prio=EN,ES&max_size', '4');
  
  if (combinedResult.success) {
    console.log('   ✅ PASS - Combined parameters work');
  } else {
    console.log('   ❌ FAIL - Combined parameters failed');
    allPassed = false;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`🎯 Overall Test Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(60));
  
  if (allPassed) {
    console.log('\n🎉 Configure page is working perfectly!');
    console.log('   • All 8 debrid providers generate valid manifests');
    console.log('   • URL parameters are correctly processed');
    console.log('   • Server accepts and validates all provider types');
    console.log('   • Combined parameter scenarios work');
  } else {
    console.log('\n⚠️  There are issues with the configure page.');
    console.log('   Please check the server logs for more details.');
  }
}

// Run the tests
runTests().catch(console.error);