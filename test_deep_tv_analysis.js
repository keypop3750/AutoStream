// Deep TV Compatibility Analysis
// Check for specific differences that could cause TV issues

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

async function analyzeDetailedDifferences() {
  console.log('🔍 Deep TV Compatibility Analysis for Multiple Shows...\n');
  
  // Test multiple problematic cases
  const testCases = [
    { name: 'Lilo & Stitch', imdb: 'tt0275847', type: 'movie' },
    { name: 'Breaking Bad S1E1', imdb: 'tt0903747:1:1', type: 'series' },
    { name: 'The Office S1E1', imdb: 'tt0386676:1:1', type: 'series' }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n=== TESTING: ${testCase.name} ===`);
    
    const autoStreamUrl = `http://localhost:7010/stream/${testCase.type}/${testCase.imdb}.json`;
    const torrentioUrl = `https://torrentio.strem.fun/stream/${testCase.type}/${testCase.imdb}.json`;
    
    try {
      const autoResponse = await makeRequest(autoStreamUrl);
      const torrentioResponse = await makeRequest(torrentioUrl);
      
      // Check if both have streams
      const autoStreams = autoResponse.streams || [];
      const torrentioStreams = torrentioResponse.streams || [];
      
      console.log(`🤖 AutoStream: ${autoStreams.length} streams`);
      console.log(`⚡ Torrentio: ${torrentioStreams.length} streams`);
      
      if (autoStreams.length > 0 && torrentioStreams.length > 0) {
        const autoFirst = autoStreams[0];
        const torrentioFirst = torrentioStreams[0];
        
        // Deep comparison of first stream
        console.log('\nFIRST STREAM COMPARISON:');
        
        // Check all properties
        const autoProps = Object.keys(autoFirst);
        const torrentioProps = Object.keys(torrentioFirst);
        
        console.log(`🤖 AutoStream properties: ${autoProps.join(', ')}`);
        console.log(`⚡ Torrentio properties: ${torrentioProps.join(', ')}`);
        
        // Find missing properties
        const autoMissing = torrentioProps.filter(prop => !autoProps.includes(prop));
        const torrentioMissing = autoProps.filter(prop => !torrentioProps.includes(prop));
        
        if (autoMissing.length > 0) {
          console.log(`❌ AutoStream missing: ${autoMissing.join(', ')}`);
          autoMissing.forEach(prop => {
            console.log(`   ${prop}: ${JSON.stringify(torrentioFirst[prop])}`);
          });
        }
        
        if (torrentioMissing.length > 0) {
          console.log(`➕ AutoStream extra: ${torrentioMissing.join(', ')}`);
          torrentioMissing.forEach(prop => {
            console.log(`   ${prop}: ${JSON.stringify(autoFirst[prop])}`);
          });
        }
        
        // Check specific TV-relevant properties
        console.log('\nTV-RELEVANT PROPERTIES:');
        
        const tvProps = ['url', 'infoHash', 'fileIdx', 'sources', 'behaviorHints'];
        tvProps.forEach(prop => {
          const autoVal = autoFirst[prop];
          const torrentioVal = torrentioFirst[prop];
          
          if (JSON.stringify(autoVal) !== JSON.stringify(torrentioVal)) {
            console.log(`❌ DIFF ${prop}:`);
            console.log(`   🤖 AutoStream: ${JSON.stringify(autoVal)}`);
            console.log(`   ⚡ Torrentio: ${JSON.stringify(torrentioVal)}`);
          } else if (autoVal !== undefined) {
            console.log(`✅ SAME ${prop}: ${JSON.stringify(autoVal)}`);
          }
        });
        
        // Check for any TV-specific hints in behaviorHints
        const autoBH = autoFirst.behaviorHints || {};
        const torrentioBH = torrentioFirst.behaviorHints || {};
        
        // Look for patterns that might affect TV
        const tvSuspiciousProps = ['notWebReady', 'webReady', 'proxyHeaders', 'countryWhitelist'];
        const foundSuspicious = tvSuspiciousProps.some(prop => 
          autoBH[prop] !== undefined || torrentioBH[prop] !== undefined
        );
        
        if (foundSuspicious) {
          console.log('\n🚨 TV-SUSPICIOUS BEHAVIOR HINTS FOUND:');
          tvSuspiciousProps.forEach(prop => {
            if (autoBH[prop] !== undefined || torrentioBH[prop] !== undefined) {
              console.log(`   ${prop}:`);
              console.log(`     🤖 AutoStream: ${JSON.stringify(autoBH[prop])}`);
              console.log(`     ⚡ Torrentio: ${JSON.stringify(torrentioBH[prop])}`);
            }
          });
        }
        
      } else {
        console.log('❌ One or both services returned no streams');
      }
      
    } catch (error) {
      console.error(`❌ Test failed for ${testCase.name}:`, error.message);
    }
  }
  
  console.log('\n=== CONCLUSIONS ===');
  console.log('Look for patterns in the differences above that could explain TV compatibility issues.');
  console.log('Pay special attention to:');
  console.log('1. Missing fileIdx property');
  console.log('2. Different behaviorHints properties');
  console.log('3. Presence/absence of sources array');
  console.log('4. Any notWebReady or similar flags');
}

// Run the analysis
analyzeDetailedDifferences();
