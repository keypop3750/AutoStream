// TV Compatibility Fix Test - Lilo and Stitch
// Tests the hypothesis that TV apps need magnet URLs while web can use infoHash-only

const http = require('http');
const https = require('https');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Failed to parse JSON', raw: data });
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Request timeout')));
    req.on('error', reject);
  });
}

async function testTVCompatibility() {
  console.log('🔍 Testing TV Compatibility for Lilo and Stitch...\n');
  
  // Test AutoStream current behavior vs official Torrentio
  const liloIMDB = 'tt0275847'; // Lilo & Stitch (2002)
  
  const autoStreamUrl = `http://localhost:7010/stream/movie/${liloIMDB}.json`;
  const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${liloIMDB}.json`;
  
  try {
    // Get both responses
    console.log('📡 Fetching AutoStream response...');
    const autoResponse = await makeRequest(autoStreamUrl);
    
    console.log('📡 Fetching official Torrentio response...');
    const torrentioResponse = await makeRequest(torrentioUrl);
    
    console.log('\n=== STREAM FORMAT COMPARISON ===');
    
    if (autoResponse.streams && autoResponse.streams.length > 0) {
      console.log('\n🤖 AutoStream streams:');
      autoResponse.streams.slice(0, 3).forEach((stream, i) => {
        console.log(`\nStream ${i + 1}:`);
        console.log(`  title: ${stream.title || 'N/A'}`);
        console.log(`  name: ${stream.name || 'N/A'}`);
        console.log(`  url: ${stream.url ? 'YES' : 'NO'} ${stream.url ? `(${stream.url.substring(0, 50)}...)` : ''}`);
        console.log(`  infoHash: ${stream.infoHash ? 'YES' : 'NO'} ${stream.infoHash ? `(${stream.infoHash})` : ''}`);
        console.log(`  behaviorHints: ${JSON.stringify(stream.behaviorHints || {})}`);
      });
    } else {
      console.log('🤖 AutoStream: No streams found');
    }
    
    if (torrentioResponse.streams && torrentioResponse.streams.length > 0) {
      console.log('\n⚡ Official Torrentio streams:');
      torrentioResponse.streams.slice(0, 3).forEach((stream, i) => {
        console.log(`\nStream ${i + 1}:`);
        console.log(`  title: ${stream.title || 'N/A'}`);
        console.log(`  name: ${stream.name || 'N/A'}`);
        console.log(`  url: ${stream.url ? 'YES' : 'NO'} ${stream.url ? `(${stream.url.substring(0, 50)}...)` : ''}`);
        console.log(`  infoHash: ${stream.infoHash ? 'YES' : 'NO'} ${stream.infoHash ? `(${stream.infoHash})` : ''}`);
        console.log(`  behaviorHints: ${JSON.stringify(stream.behaviorHints || {})}`);
      });
    } else {
      console.log('⚡ Official Torrentio: No streams found');
    }
    
    // Analysis
    console.log('\n=== TV COMPATIBILITY ANALYSIS ===');
    
    const autoHasUrl = autoResponse.streams && autoResponse.streams.some(s => s.url);
    const torrentioHasUrl = torrentioResponse.streams && torrentioResponse.streams.some(s => s.url);
    
    console.log(`\n🤖 AutoStream provides URL field: ${autoHasUrl ? 'YES' : 'NO'}`);
    console.log(`⚡ Official Torrentio provides URL field: ${torrentioHasUrl ? 'YES' : 'NO'}`);
    
    if (!autoHasUrl && torrentioHasUrl) {
      console.log('\n❌ ISSUE FOUND: AutoStream removes URL field but Torrentio keeps it!');
      console.log('   This could explain TV compatibility issues.');
      console.log('   TV apps may need the magnet URL for proper torrent handling.');
    } else if (autoHasUrl && torrentioHasUrl) {
      console.log('\n✅ Both provide URL field - compatibility issue likely elsewhere');
    } else if (!autoHasUrl && !torrentioHasUrl) {
      console.log('\n🔍 Both use infoHash-only - compatibility issue likely elsewhere');
    }
    
    // Check behaviorHints differences
    const autoBehaviorHints = autoResponse.streams && autoResponse.streams[0] && autoResponse.streams[0].behaviorHints;
    const torrentioBehaviorHints = torrentioResponse.streams && torrentioResponse.streams[0] && torrentioResponse.streams[0].behaviorHints;
    
    console.log('\n=== BEHAVIOR HINTS COMPARISON ===');
    console.log(`🤖 AutoStream behaviorHints: ${JSON.stringify(autoBehaviorHints || {}, null, 2)}`);
    console.log(`⚡ Torrentio behaviorHints: ${JSON.stringify(torrentioBehaviorHints || {}, null, 2)}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testTVCompatibility();
