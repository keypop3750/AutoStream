// Test TV compatibility fix for Newsroom S3E1
const http = require('http');

async function testTVCompatibilityFix() {
  console.log('=== TESTING TV COMPATIBILITY FIX FOR NEWSROOM S3E1 ===\n');
  
  const newsroomId = 'tt1870479:3:1'; // Season 3 Episode 1
  const url = `http://localhost:7010/stream/series/${newsroomId}.json`;
  
  console.log('Testing AutoStream response after TV compatibility fix...');
  console.log('URL:', url);
  
  const req = http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log('Response status:', res.statusCode);
        console.log('Number of streams returned:', parsed.streams ? parsed.streams.length : 0);
        
        if (parsed.streams && parsed.streams.length > 0) {
          parsed.streams.forEach((stream, i) => {
            console.log(`\nStream ${i+1}:`);
            console.log('  name:', stream.name);
            console.log('  title:', stream.title);
            console.log('  filename:', stream.behaviorHints?.filename || 'No filename');
            
            // Analyze TV compatibility of selected stream
            const filename = stream.behaviorHints?.filename || stream.title || '';
            const compatibility = [];
            
            if (filename.includes('x264') || filename.includes('H.264')) {
              compatibility.push('✅ H.264 codec (TV-friendly)');
            } else if (filename.includes('x265') || filename.includes('HEVC')) {
              compatibility.push('❌ HEVC/x265 codec (TV-problematic)');
            }
            
            if (filename.includes('.mp4')) {
              compatibility.push('✅ MP4 container (TV-friendly)');
            } else if (filename.includes('.mkv')) {
              compatibility.push('❌ MKV container (TV-problematic)');
            }
            
            if (filename.includes('RARBG')) {
              compatibility.push('❌ RARBG release (TV-problematic)');
            }
            
            console.log('  TV compatibility:', compatibility.join(', '));
            
            if (compatibility.filter(c => c.startsWith('✅')).length >= 2) {
              console.log('  🎯 RESULT: TV-COMPATIBLE STREAM SELECTED!');
            } else {
              console.log('  ⚠️  RESULT: Stream may still have TV compatibility issues');
            }
          });
          
          // Compare with previous problematic selection
          console.log('\n=== COMPARISON ===');
          console.log('❌ OLD (problematic): The.Newsroom.2012.S03E01.1080p.BluRay.x265-RARBG.mp4');
          console.log('   Issues: x265 codec + RARBG release = "video not supported" on TV');
          
          const selectedFilename = parsed.streams[0].behaviorHints?.filename || '';
          console.log(`✅ NEW (selected): ${selectedFilename}`);
          
          if (selectedFilename !== 'The.Newsroom.2012.S03E01.1080p.BluRay.x265-RARBG.mp4') {
            console.log('   🎉 SUCCESS: Different stream selected! TV compatibility improved.');
          } else {
            console.log('   ⚠️  WARNING: Still selecting the problematic stream. May need more scoring adjustments.');
          }
          
        } else {
          console.log('No streams found!');
        }
      } catch (e) {
        console.log('Parse error:', e.message);
        console.log('Raw response:', data.slice(0, 500));
      }
    });
  });
  
  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });
  
  req.setTimeout(30000, () => {
    console.log('Request timeout');
    req.destroy();
  });
}

testTVCompatibilityFix();
