const https = require('https');
const http = require('http');

const SERVER_URL = 'http://localhost:7010';

// Quick test - just log what's happening
async function debugGenV() {
  console.log('🔍 Debug: What data do streams actually contain?');
  
  const url = `${SERVER_URL}/stream/series/tt13623136:1:1.json?additionalstream=1&ad=YOUR_AD_KEY_HERE&verbose=1`;
  
  const req = http.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        const streams = result.streams || [];
        
        console.log('\n📊 STREAM DATA ANALYSIS:');
        streams.forEach((stream, idx) => {
          console.log(`\nStream ${idx + 1}:`);
          console.log(`  title: "${stream.title}"`);
          console.log(`  name: "${stream.name}"`);
          console.log(`  description: "${stream.description || 'N/A'}"`);
          console.log(`  tag: "${stream.tag || 'N/A'}"`);
          console.log(`  filename: "${stream.behaviorHints?.filename || 'N/A'}"`);
          
          // Manual resolution check
          const text = `${stream.title || ''} ${stream.name || ''}`.toLowerCase();
          const hasRes = /(4k|2k|1080p|720p|480p|2160p|1440p)/i.test(text);
          console.log(`  Has resolution in title/name: ${hasRes ? 'YES' : 'NO'}`);
          if (hasRes) {
            const match = text.match(/(4k|2k|1080p|720p|480p|2160p|1440p)/i);
            console.log(`  Found: "${match[0]}"`);
          }
        });
        
      } catch (e) {
        console.log('Error parsing response:', e.message);
      }
    });
  });
  
  req.on('error', (e) => {
    console.log('Request error:', e.message);
  });
}

debugGenV();
