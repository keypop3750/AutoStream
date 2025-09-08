const http = require('http');

console.log('🧪 Testing Breaking Bad S1E1 resolution detection...\n');

const options = {
  hostname: 'localhost',
  port: 7010,
  path: '/stream/series/tt0903747:1:1.json?lang=EN',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      console.log('✅ Server response received');
      
      if (response.streams && response.streams.length > 0) {
        console.log(`\n📊 Found ${response.streams.length} streams:`);
        
        response.streams.forEach((stream, i) => {
          console.log(`\n🎬 Stream ${i + 1}:`);
          console.log(`  Title: "${stream.title}"`);
          console.log(`  Name: "${stream.name}"`);
          
          // Check if resolution is in the title
          const hasResolution = /\b(4K|2K|1080p|720p|480p)\b/.test(stream.title);
          console.log(`  Has Resolution: ${hasResolution ? '✅' : '❌'}`);
          
          if (stream.filename) {
            console.log(`  Filename: "${stream.filename}"`);
          }
          
          if (stream.behaviorHints?.filename) {
            console.log(`  BehaviorHints Filename: "${stream.behaviorHints.filename}"`);
          }
        });
        
        console.log('\n🎯 Resolution Detection Test:');
        const titlesWithResolution = response.streams.filter(s => /\b(4K|2K|1080p|720p|480p)\b/.test(s.title));
        console.log(`  Streams with resolution in title: ${titlesWithResolution.length}/${response.streams.length}`);
        
        if (titlesWithResolution.length === response.streams.length) {
          console.log('  ✅ SUCCESS: All streams have resolution in title!');
        } else if (titlesWithResolution.length > 0) {
          console.log('  ⚠️  PARTIAL: Some streams have resolution, some don\'t');
        } else {
          console.log('  ❌ ISSUE: No streams have resolution in title');
        }
        
      } else {
        console.log('❌ No streams found');
        console.log('Raw response:', data.substring(0, 200));
      }
    } catch (error) {
      console.error('❌ Error parsing response:', error.message);
      console.log('Raw response:', data.substring(0, 500));
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error.message);
});

req.end();
