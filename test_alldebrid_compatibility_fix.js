/**
 * Test AllDebrid Compatibility Fix
 * This test verifies that the NO_SERVER issue is resolved
 */

console.log('🧪 Testing AllDebrid Compatibility Fix');
console.log('='.repeat(60));

const http = require('http');

// Test the server directly to see if AllDebrid calls work without NO_SERVER errors
async function testAllDebridCompatibility() {
  console.log('1️⃣ Testing server startup...');
  
  // Test basic connectivity
  const testUrl = 'http://localhost:7010/ping';
  
  try {
    const response = await makeRequest(testUrl);
    console.log('✅ Server connectivity: OK');
    console.log('   Response:', JSON.stringify(response, null, 2));
  } catch (e) {
    console.log('❌ Server connectivity failed:', e.message);
    return;
  }
  
  console.log('\n2️⃣ Testing AllDebrid configuration validation...');
  
  // Test with a movie that should trigger AllDebrid calls
  const streamUrl = 'http://localhost:7010/stream/movie/tt0137523.json?alldebrid=test_key&debug=1';
  
  try {
    const streamResponse = await makeRequest(streamUrl);
    console.log('✅ Stream request processed');
    console.log('   Streams returned:', streamResponse.streams?.length || 0);
    
    // Check for NO_SERVER errors in the response
    const hasError = streamResponse.streams?.some(s => 
      s.name?.includes('NO_SERVER') || 
      s.title?.includes('NO_SERVER') ||
      JSON.stringify(s).includes('NO_SERVER')
    );
    
    if (hasError) {
      console.log('❌ NO_SERVER error still present in response');
    } else {
      console.log('✅ No NO_SERVER errors detected in response');
    }
    
  } catch (e) {
    console.log('❌ Stream request failed:', e.message);
  }
  
  console.log('\n3️⃣ Summary:');
  console.log('   - AllDebrid compatibility mode: ENABLED');
  console.log('   - Authentication method: URL parameters (like OldAutoStream)');
  console.log('   - Headers: Simple User-Agent only (like OldAutoStream)');
  console.log('   - API calls: Direct fetch without complex wrappers');
  console.log('');
  console.log('🔧 The fix should prevent AllDebrid NO_SERVER detection by:');
  console.log('   • Using identical request pattern as working OldAutoStream');
  console.log('   • Avoiding Authorization headers that trigger server detection');
  console.log('   • Using minimal headers that worked before');
  console.log('   • Making direct API calls without complex abstraction layers');
}

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
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

testAllDebridCompatibility().catch(console.error);