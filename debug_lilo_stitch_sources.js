// Debug Lilo and Stitch source fetching
const http = require('http');

async function debugLiloStitch() {
  console.log('=== DEBUGGING LILO AND STITCH SOURCE FETCHING ===\n');
  
  // Test if the issue is with episode filtering or source fetching
  const testId = 'tt0762298:1:22'; // Season 1 Episode 22
  
  console.log('1. Testing AutoStream response:');
  const url = `http://localhost:7010/stream/series/${testId}.json`;
  console.log('URL:', url);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log('AutoStream result:', {
      status: response.status,
      streamCount: data.streams ? data.streams.length : 0,
      hasError: data.streams && data.streams[0] && data.streams[0].name === '🚫 No Streams Available'
    });
    
    if (data.streams && data.streams[0] && data.streams[0].name === '🚫 No Streams Available') {
      console.log('No streams message:', data.streams[0].title);
    }
  } catch (e) {
    console.log('AutoStream fetch error:', e.message);
  }
  
  console.log('\n2. Testing direct Torrentio source:');
  // Test what Torrentio returns for the same content
  const torrentioUrl = `https://torrentio.strem.fun/stream/series/${testId}.json`;
  console.log('Torrentio URL:', torrentioUrl);
  
  try {
    const response = await fetch(torrentioUrl);
    const data = await response.json();
    console.log('Torrentio result:', {
      status: response.status,
      streamCount: data.streams ? data.streams.length : 0,
      firstStreamTitle: data.streams && data.streams[0] ? data.streams[0].title : 'None'
    });
    
    if (data.streams && data.streams.length > 0) {
      console.log('Sample Torrentio streams:');
      data.streams.slice(0, 3).forEach((stream, i) => {
        console.log(`  Stream ${i+1}:`, {
          title: stream.title,
          hasUrl: !!stream.url,
          hasInfoHash: !!stream.infoHash
        });
      });
    }
  } catch (e) {
    console.log('Torrentio fetch error:', e.message);
  }
  
  console.log('\n3. Testing IMDB ID validation:');
  // Check if the IMDB ID is valid
  const imdbUrl = `https://www.imdb.com/title/tt0762298/`;
  console.log('IMDB URL:', imdbUrl);
  
  try {
    const response = await fetch(imdbUrl);
    console.log('IMDB validation:', {
      status: response.status,
      validId: response.status === 200
    });
  } catch (e) {
    console.log('IMDB validation error:', e.message);
  }
}

// Use node-fetch equivalent
function fetch(url) {
  const urlModule = require('url');
  const httpModule = url.startsWith('https:') ? require('https') : require('http');
  
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

debugLiloStitch().catch(console.error);
