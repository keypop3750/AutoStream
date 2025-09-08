// Find TV-compatible streams in Torrentio for Newsroom S3E1
const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
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

async function findTVCompatibleStreams() {
  console.log('=== FINDING TV-COMPATIBLE STREAMS FOR NEWSROOM S3E1 ===\n');
  
  const newsroomId = 'tt1870479:3:1';
  const torrentioUrl = `https://torrentio.strem.fun/stream/series/${newsroomId}.json`;
  
  try {
    const response = await fetch(torrentioUrl);
    const data = await response.json();
    
    console.log(`Total Torrentio streams: ${data.streams ? data.streams.length : 0}`);
    
    if (!data.streams || data.streams.length === 0) {
      console.log('No streams found!');
      return;
    }
    
    // Analyze each stream for TV compatibility
    const compatibility = data.streams.map((stream, i) => {
      const filename = stream.behaviorHints?.filename || '';
      const title = stream.title || '';
      
      // TV compatibility scoring
      let score = 100; // Start with perfect score
      const issues = [];
      const good = [];
      
      // Codec analysis
      if (filename.includes('x265') || filename.includes('HEVC') || title.includes('x265') || title.includes('HEVC')) {
        score -= 30;
        issues.push('HEVC/x265 codec');
      } else if (filename.includes('x264') || filename.includes('H.264') || title.includes('x264')) {
        score += 10;
        good.push('H.264 codec (TV-friendly)');
      }
      
      // Container analysis
      if (filename.includes('.mkv')) {
        score -= 10;
        issues.push('MKV container');
      } else if (filename.includes('.mp4')) {
        score += 10;
        good.push('MP4 container (TV-friendly)');
      }
      
      // Release group analysis
      if (filename.includes('RARBG')) {
        score -= 5;
        issues.push('RARBG release');
      } else if (filename.includes('YTS') || filename.includes('YIFY')) {
        score += 5;
        good.push('YTS/YIFY (TV-compatible)');
      }
      
      // Size analysis (smaller = better for TV streaming)
      const sizeMatch = title.match(/(\\d+(?:\\.\\d+)?)\\s*([GM])B/);
      if (sizeMatch) {
        const size = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2];
        const sizeInGB = unit === 'G' ? size : size / 1000;
        
        if (sizeInGB > 5) {
          score -= 15;
          issues.push(`Large file (${sizeInGB.toFixed(1)}GB)`);
        } else if (sizeInGB < 2) {
          score += 5;
          good.push(`Reasonable size (${sizeInGB.toFixed(1)}GB)`);
        }
      }
      
      // Resolution bonus for 1080p
      if (filename.includes('1080p') || title.includes('1080p')) {
        score += 5;
        good.push('1080p resolution');
      }
      
      return {
        index: i,
        stream,
        score,
        issues,
        good,
        filename,
        tvCompatible: score >= 70
      };
    });
    
    // Sort by TV compatibility score
    compatibility.sort((a, b) => b.score - a.score);
    
    console.log('\\n=== TV COMPATIBILITY RANKING ===');
    compatibility.slice(0, 10).forEach((item, rank) => {
      console.log(`\\n${rank + 1}. Score: ${item.score}/100 ${item.tvCompatible ? '✅ TV-COMPATIBLE' : '❌ TV-PROBLEMATIC'}`);
      console.log(`   Title: ${item.stream.title.substring(0, 80)}...`);
      console.log(`   Filename: ${item.filename}`);
      if (item.good.length > 0) {
        console.log(`   ✅ Good: ${item.good.join(', ')}`);
      }
      if (item.issues.length > 0) {
        console.log(`   ❌ Issues: ${item.issues.join(', ')}`);
      }
    });
    
    // Show what AutoStream currently selects vs what should be selected
    console.log('\\n\\n=== COMPARISON ===');
    const bestTVStream = compatibility.find(item => item.tvCompatible);
    
    if (bestTVStream) {
      console.log('🎯 BEST TV-COMPATIBLE STREAM:');
      console.log(`   Score: ${bestTVStream.score}/100`);
      console.log(`   Title: ${bestTVStream.stream.title}`);
      console.log(`   Filename: ${bestTVStream.filename}`);
      console.log(`   Why it's better: ${bestTVStream.good.join(', ')}`);
    }
    
    console.log('\\n❌ CURRENT AUTOSTREAM SELECTION:');
    console.log('   Filename: The.Newsroom.2012.S03E01.1080p.BluRay.x265-RARBG.mp4');
    console.log('   Issues: HEVC/x265 codec, RARBG release');
    console.log('   This explains the "video not supported" on TV!');
    
  } catch (e) {
    console.log('Error:', e.message);
  }
}

findTVCompatibleStreams().catch(console.error);
