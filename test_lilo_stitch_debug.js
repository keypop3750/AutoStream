// Debug Lilo and Stitch issue - check if it's completely blank
const http = require('http');

async function testLiloStitchDebug() {
  console.log('=== DEBUGGING LILO AND STITCH BLANK STREAMS ===\n');
  
  // Test different IDs we discovered
  const testCases = [
    { id: 'tt0762298:1:22', desc: 'Old wrong ID (tt0762298) - should fail' },
    { id: 'tt0364774:1:22', desc: 'Correct ID (tt0364774) - should work' },
    { id: 'tt0364774:1:1', desc: 'Correct ID S1E1 - should work' },
    { id: 'tt0364774:2:1', desc: 'Correct ID S2E1 - should work' }
  ];
  
  for (const test of testCases) {
    console.log(`Testing: ${test.desc}`);
    console.log(`URL: http://localhost:7010/stream/series/${test.id}.json`);
    
    try {
      const req = http.get(`http://localhost:7010/stream/series/${test.id}.json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            console.log(`  Status: ${res.statusCode}`);
            console.log(`  Streams: ${result.streams ? result.streams.length : 0}`);
            
            if (result.streams && result.streams.length > 0) {
              const first = result.streams[0];
              console.log(`  First stream: ${first.title || first.name}`);
              if (first.name === '🚫 No Streams Available') {
                console.log(`  Result: Shows "No Streams Available" message`);
              } else {
                console.log(`  Result: Has actual streams!`);
              }
            } else {
              console.log(`  Result: Completely blank (no streams array or empty)`);
            }
          } catch (e) {
            console.log(`  Parse error: ${e.message}`);
            console.log(`  Raw response: ${data.substring(0, 200)}...`);
          }
        });
      });
      
      req.on('error', (e) => {
        console.log(`  Request error: ${e.message}`);
      });
      
      req.setTimeout(10000, () => {
        console.log(`  Request timeout`);
        req.destroy();
      });
      
      // Wait for this request to complete before next one
      await new Promise(resolve => {
        req.on('close', resolve);
        req.on('error', resolve);
        setTimeout(resolve, 15000); // Max wait
      });
      
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    
    console.log('');
  }
  
  // Also test what Torrentio returns for comparison
  console.log('=== TORRENTIO COMPARISON ===');
  console.log('Testing what official Torrentio returns...');
  
  // We'll need to use a different method for HTTPS
  const https = require('https');
  
  try {
    const req = https.get('https://torrentio.strem.fun/stream/series/tt0364774:1:22.json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`Torrentio Status: ${res.statusCode}`);
          console.log(`Torrentio Streams: ${result.streams ? result.streams.length : 0}`);
          
          if (result.streams && result.streams.length > 0) {
            console.log(`Torrentio has streams - AutoStream should too!`);
            console.log(`First stream: ${result.streams[0].title}`);
          } else {
            console.log(`Torrentio also has no streams - content may not be available`);
          }
        } catch (e) {
          console.log(`Torrentio parse error: ${e.message}`);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`Torrentio error: ${e.message}`);
    });
    
  } catch (e) {
    console.log(`Torrentio test error: ${e.message}`);
  }
}

testLiloStitchDebug().catch(console.error);
