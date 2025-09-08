// Test Running Man availability
const http = require('http');
const https = require('https');

async function testRunningMan() {
  console.log('=== TESTING RUNNING MAN AVAILABILITY ===\n');
  
  // Running Man is Korean variety show IMDB tt2617548
  // S2018E384 would be 2018 season episode 384
  const runningManId = 'tt2617548:2018:384';
  
  console.log('1. Testing AutoStream...');
  try {
    const req = http.get(`http://localhost:7010/stream/series/${runningManId}.json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`AutoStream Status: ${res.statusCode}`);
          console.log(`AutoStream Streams: ${result.streams ? result.streams.length : 0}`);
          
          if (result.streams && result.streams.length > 0) {
            const first = result.streams[0];
            console.log(`First stream: ${first.title || first.name}`);
          }
        } catch (e) {
          console.log(`AutoStream parse error: ${e.message}`);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`AutoStream error: ${e.message}`);
    });
    
    await new Promise(resolve => {
      req.on('close', resolve);
      setTimeout(resolve, 10000);
    });
  } catch (e) {
    console.log(`AutoStream test error: ${e.message}`);
  }
  
  console.log('\n2. Testing Torrentio...');
  try {
    const req = https.get(`https://torrentio.strem.fun/stream/series/${runningManId}.json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`Torrentio Status: ${res.statusCode}`);
          console.log(`Torrentio Streams: ${result.streams ? result.streams.length : 0}`);
          
          if (result.streams && result.streams.length > 0) {
            console.log(`First stream: ${result.streams[0].title}`);
          } else {
            console.log('Torrentio also has no streams for this episode');
          }
        } catch (e) {
          console.log(`Torrentio parse error: ${e.message}`);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log(`Torrentio error: ${e.message}`);
    });
    
    await new Promise(resolve => {
      req.on('close', resolve);
      setTimeout(resolve, 10000);
    });
  } catch (e) {
    console.log(`Torrentio test error: ${e.message}`);
  }
  
  console.log('\n3. Testing different episode numbers...');
  
  // Try different episodes to see if any work
  const episodes = ['1:1', '1:10', '2018:1', '2018:100'];
  
  for (const ep of episodes) {
    console.log(`\nTesting tt2617548:${ep}...`);
    try {
      const req = https.get(`https://torrentio.strem.fun/stream/series/tt2617548:${ep}.json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            console.log(`  ${ep}: ${result.streams ? result.streams.length : 0} streams`);
            if (result.streams && result.streams.length > 0) {
              console.log(`  First: ${result.streams[0].title.substring(0, 60)}...`);
            }
          } catch (e) {
            console.log(`  ${ep}: Parse error`);
          }
        });
      });
      
      req.on('error', () => {});
      
      await new Promise(resolve => {
        req.on('close', resolve);
        setTimeout(resolve, 5000);
      });
    } catch (e) {
      console.log(`  ${ep}: Error`);
    }
  }
  
  console.log('\n=== CONCLUSIONS ===');
  console.log('Running Man is a Korean variety show that may not have widespread torrents.');
  console.log('Korean content is often limited on English torrent sites.');
  console.log('The specific episode S2018E384 may not exist or be available.');
}

testRunningMan().catch(console.error);
