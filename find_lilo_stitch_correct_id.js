// Find correct Lilo and Stitch IMDB ID and episode numbering
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
          text: () => Promise.resolve(data),
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

async function findLiloStitchId() {
  console.log('=== FINDING CORRECT LILO AND STITCH SERIES ID ===\n');
  
  // Try different potential IMDB IDs for Lilo and Stitch series
  const potentialIds = [
    'tt0762298', // The one we tried
    'tt0762275', // Alternative
    'tt0347876', // Another potential
    'tt0364782', // Another potential
  ];
  
  for (const baseId of potentialIds) {
    console.log(`Testing base ID: ${baseId}`);
    
    // Test movie vs series
    const movieUrl = `https://torrentio.strem.fun/stream/movie/${baseId}.json`;
    const seriesUrl = `https://torrentio.strem.fun/stream/series/${baseId}:1:1.json`;
    
    try {
      console.log(`  Movie test (${baseId}):`);
      const movieRes = await fetch(movieUrl);
      const movieData = await movieRes.json();
      console.log(`    Status: ${movieRes.status}, Streams: ${movieData.streams ? movieData.streams.length : 0}`);
      
      if (movieData.streams && movieData.streams.length > 0) {
        console.log(`    First stream: ${movieData.streams[0].title}`);
      }
    } catch (e) {
      console.log(`    Movie test failed: ${e.message}`);
    }
    
    try {
      console.log(`  Series test (${baseId}:1:1):`);
      const seriesRes = await fetch(seriesUrl);
      const seriesData = await seriesRes.json();
      console.log(`    Status: ${seriesRes.status}, Streams: ${seriesData.streams ? seriesData.streams.length : 0}`);
      
      if (seriesData.streams && seriesData.streams.length > 0) {
        console.log(`    First stream: ${seriesData.streams[0].title}`);
      }
    } catch (e) {
      console.log(`    Series test failed: ${e.message}`);
    }
    
    console.log('');
  }
  
  // Also test with cinemeta to get proper metadata
  console.log('=== TESTING CINEMETA METADATA ===');
  const cinemetaUrl = 'https://v3-cinemeta.strem.io/meta/series/tt0762298.json';
  
  try {
    const res = await fetch(cinemetaUrl);
    const data = await res.json();
    console.log('Cinemeta metadata:', {
      status: res.status,
      title: data.meta ? data.meta.name : 'No title',
      type: data.meta ? data.meta.type : 'No type',
      year: data.meta ? data.meta.year : 'No year',
      seasons: data.meta && data.meta.videos ? data.meta.videos.length : 0
    });
    
    if (data.meta && data.meta.videos && data.meta.videos.length > 0) {
      console.log('Sample episodes:');
      data.meta.videos.slice(0, 5).forEach(ep => {
        console.log(`  ${ep.id}: ${ep.title} (Season ${ep.season}, Episode ${ep.episode})`);
      });
    }
  } catch (e) {
    console.log('Cinemeta test failed:', e.message);
  }
}

findLiloStitchId().catch(console.error);
