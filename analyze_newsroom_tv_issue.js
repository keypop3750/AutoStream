// Investigate Newsroom S3E1 "video not supported" issue
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

async function analyzeNewsroomIssue() {
  console.log('=== ANALYZING NEWSROOM S3E1 TV COMPATIBILITY ISSUE ===\n');
  
  const newsroomId = 'tt1870479:3:1'; // Season 3 Episode 1
  
  console.log('1. AutoStream response analysis:');
  try {
    const autoUrl = `http://localhost:7010/stream/series/${newsroomId}.json`;
    const autoRes = await fetch(autoUrl);
    const autoData = await autoRes.json();
    
    console.log('AutoStream result:', {
      streamCount: autoData.streams ? autoData.streams.length : 0,
      status: autoRes.status
    });
    
    if (autoData.streams && autoData.streams.length > 0) {
      autoData.streams.forEach((stream, i) => {
        console.log(`\nStream ${i+1} analysis:`);
        console.log('  name:', stream.name);
        console.log('  title:', stream.title);
        console.log('  url:', stream.url ? 'Present' : 'MISSING');
        console.log('  infoHash:', stream.infoHash ? 'Present' : 'Missing');
        console.log('  behaviorHints:', JSON.stringify(stream.behaviorHints, null, 4));
        
        // Check for TV incompatible elements
        const issues = [];
        if (!stream.url && stream.infoHash) {
          issues.push('InfoHash-only (no direct URL)');
        }
        if (stream.behaviorHints && stream.behaviorHints.bingeGroup) {
          issues.push('Has bingeGroup (may confuse TV)');
        }
        if (stream.behaviorHints && stream.behaviorHints.filename) {
          const filename = stream.behaviorHints.filename;
          if (filename.includes('.mkv')) {
            issues.push('MKV container (limited TV support)');
          }
          if (filename.includes('x265') || filename.includes('HEVC')) {
            issues.push('HEVC codec (limited TV support)');
          }
          if (filename.includes('RARBG')) {
            issues.push('RARBG release (may have compatibility issues)');
          }
        }
        
        if (issues.length > 0) {
          console.log('  🚨 TV compatibility issues:', issues);
        } else {
          console.log('  ✅ No obvious TV compatibility issues');
        }
      });
    }
  } catch (e) {
    console.log('AutoStream error:', e.message);
  }
  
  console.log('\n\n2. Torrentio comparison:');
  try {
    const torrentioUrl = `https://torrentio.strem.fun/stream/series/${newsroomId}.json`;
    const torrentioRes = await fetch(torrentioUrl);
    const torrentioData = await torrentioRes.json();
    
    console.log('Torrentio result:', {
      streamCount: torrentioData.streams ? torrentioData.streams.length : 0,
      status: torrentioRes.status
    });
    
    if (torrentioData.streams && torrentioData.streams.length > 0) {
      console.log('\nFirst 3 Torrentio streams:');
      torrentioData.streams.slice(0, 3).forEach((stream, i) => {
        console.log(`\nTorrentio Stream ${i+1}:`);
        console.log('  title:', stream.title);
        console.log('  url:', stream.url ? 'Present' : 'MISSING');
        console.log('  infoHash:', stream.infoHash ? 'Present' : 'Missing');
        console.log('  behaviorHints:', JSON.stringify(stream.behaviorHints, null, 4));
      });
    }
  } catch (e) {
    console.log('Torrentio error:', e.message);
  }
  
  console.log('\n\n3. Key differences analysis:');
  console.log('Looking for differences that could cause TV "video not supported"...');
}

analyzeNewsroomIssue().catch(console.error);
