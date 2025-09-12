/**
 * Detailed diagnosis of remote server behavior
 */

async function testRemoteServerStatus() {
  console.log('🔍 REMOTE SERVER DIAGNOSIS');
  console.log('==========================');
  
  // Test 1: Basic server health
  try {
    const healthResponse = await fetch('https://autostream-addon.onrender.com/');
    console.log('🌐 Server Health:', healthResponse.status, healthResponse.statusText);
  } catch (e) {
    console.log('🌐 Server Health: ERROR -', e.message);
  }
  
  // Test 2: Manifest endpoint
  try {
    const manifestResponse = await fetch('https://autostream-addon.onrender.com/manifest.json');
    console.log('📄 Manifest:', manifestResponse.status, manifestResponse.statusText);
  } catch (e) {
    console.log('📄 Manifest: ERROR -', e.message);
  }
  
  // Test 3: Stream endpoint (should work)
  try {
    const streamResponse = await fetch('https://autostream-addon.onrender.com/stream/movie/tt3402138.json');
    console.log('🎬 Stream Endpoint:', streamResponse.status, streamResponse.statusText);
    
    if (streamResponse.ok) {
      const streamData = await streamResponse.json();
      console.log('📊 Streams found:', streamData.streams?.length || 0);
    }
  } catch (e) {
    console.log('🎬 Stream Endpoint: ERROR -', e.message);
  }
  
  // Test 4: Play endpoint (minimal)
  try {
    const playResponse = await fetch('https://autostream-addon.onrender.com/play', {
      method: 'HEAD',
      redirect: 'manual'
    });
    console.log('▶️  Play Endpoint (no params):', playResponse.status, playResponse.statusText);
  } catch (e) {
    console.log('▶️  Play Endpoint: ERROR -', e.message);
  }
  
  console.log('\n🎯 DIAGNOSIS COMPLETE');
  console.log('The remote server might not have the NO_SERVER fix deployed yet.');
  console.log('Our local tests show the fix works, so we should deploy it.');
}

testRemoteServerStatus();
