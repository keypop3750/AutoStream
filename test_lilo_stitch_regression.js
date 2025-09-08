// Test Lilo and Stitch regression issue
const http = require('http');

function testLiloStitch() {
  // Test with a Lilo and Stitch episode ID
  const testId = 'tt0762298:1:22'; // Season 1 Episode 22
  const url = `http://localhost:7010/stream/series/${testId}.json`;
  
  console.log('Testing Lilo and Stitch episode 22...');
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
          console.log('First stream:', JSON.stringify(parsed.streams[0], null, 2));
        } else {
          console.log('No streams found!');
          console.log('Full response:', JSON.stringify(parsed, null, 2));
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

function testNewsroom() {
  // Test Newsroom S3E1 that used to work
  const testId = 'tt1870479:3:1'; // Season 3 Episode 1
  const url = `http://localhost:7010/stream/series/${testId}.json`;
  
  console.log('\nTesting Newsroom S3E1...');
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
            console.log(`Stream ${i+1}:`, {
              name: stream.name,
              title: stream.title,
              url: stream.url ? 'Has URL' : 'No URL',
              infoHash: stream.infoHash ? 'Has InfoHash' : 'No InfoHash',
              behaviorHints: stream.behaviorHints
            });
          });
        } else {
          console.log('No streams found!');
          console.log('Full response:', JSON.stringify(parsed, null, 2));
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

// Test both
testLiloStitch();
setTimeout(() => testNewsroom(), 5000);
