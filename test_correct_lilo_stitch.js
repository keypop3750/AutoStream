// Test correct Lilo and Stitch ID: tt0364774
const http = require('http');
const https = require('https');

function fetch(url) {
  const httpModule = url.startsWith('https:') ? https : http;
  
  return new Promise((resolve, reject) => {
    const req = httpModule.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          json: () => Promise.resolve(JSON.parse(data))
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function testCorrectLiloStitch() {
  console.log('=== TESTING CORRECT LILO AND STITCH ID: tt0364774 ===\n');
  
  const correctId = 'tt0364774';
  
  // Test different episodes
  const episodes = [
    '1:1',   // S1E1
    '1:22',  // S1E22 (the one you mentioned)
    '2:1',   // S2E1
    '1:5'    // S1E5
  ];
  
  for (const ep of episodes) {
    console.log(`Testing ${correctId}:${ep}:`);
    
    // Test AutoStream
    try {
      const autoUrl = `http://localhost:7010/stream/series/${correctId}:${ep}.json`;
      const autoRes = await fetch(autoUrl);
      const autoData = await autoRes.json();
      console.log(`  AutoStream: ${autoData.streams ? autoData.streams.length : 0} streams`);
      
      if (autoData.streams && autoData.streams.length > 0) {
        const first = autoData.streams[0];
        if (first.name === '🚫 No Streams Available') {
          console.log(`    No streams found`);
        } else {
          console.log(`    Found: ${first.title || first.name}`);
        }
      }
    } catch (e) {
      console.log(`  AutoStream error: ${e.message}`);
    }
    
    // Test Torrentio
    try {
      const torrentioUrl = `https://torrentio.strem.fun/stream/series/${correctId}:${ep}.json`;
      const torrentioRes = await fetch(torrentioUrl);
      const torrentioData = await torrentioRes.json();
      console.log(`  Torrentio: ${torrentioData.streams ? torrentioData.streams.length : 0} streams`);
      
      if (torrentioData.streams && torrentioData.streams.length > 0) {
        console.log(`    First: ${torrentioData.streams[0].title}`);
      }
    } catch (e) {
      console.log(`  Torrentio error: ${e.message}`);
    }
    
    console.log('');
  }
  
  // Test metadata
  console.log('=== METADATA TEST ===');
  try {
    const metaUrl = `https://v3-cinemeta.strem.io/meta/series/${correctId}.json`;
    const metaRes = await fetch(metaUrl);
    const metaData = await metaRes.json();
    
    console.log('Metadata:', {
      title: metaData.meta ? metaData.meta.name : 'Unknown',
      year: metaData.meta ? metaData.meta.year : 'Unknown',
      episodeCount: metaData.meta && metaData.meta.videos ? metaData.meta.videos.length : 0
    });
    
    if (metaData.meta && metaData.meta.videos && metaData.meta.videos.length > 0) {
      console.log('Episodes around 22:');
      metaData.meta.videos
        .filter(ep => ep.episode >= 20 && ep.episode <= 25 && ep.season === 1)
        .forEach(ep => {
          console.log(`  ${ep.id}: ${ep.title} (S${ep.season}E${ep.episode})`);
        });
    }
  } catch (e) {
    console.log('Metadata error:', e.message);
  }
}

testCorrectLiloStitch().catch(console.error);
