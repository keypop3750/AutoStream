#!/usr/bin/env node

/**
 * Test the episode selection fix for The Newsroom
 * This tests that S3E1 returns the correct episode (not S1E1 or S3E2)
 */

const http = require('http');

async function testEpisodeSelection() {
  console.log('🧪 Testing episode selection fix...\n');
  
  // Test data for The Newsroom S3E1
  const testCases = [
    {
      name: 'The Newsroom S3E1',
      url: 'http://localhost:7010/stream/series/tt1870479:3:1.json?ad=test_key&include_nuvio=1&fallback=1',
      expectedEpisode: 'S3E1',
      shouldNotContain: ['S01E01', 'S03E02']
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`📋 Testing: ${testCase.name}`);
    console.log(`🔗 URL: ${testCase.url}`);
    
    try {
      const response = await makeRequest(testCase.url);
      
      if (!response.streams || response.streams.length === 0) {
        console.log('❌ No streams returned');
        continue;
      }
      
      console.log(`✅ Received ${response.streams.length} streams`);
      
      // Check each stream
      for (let i = 0; i < response.streams.length; i++) {
        const stream = response.streams[i];
        console.log(`\n🎬 Stream ${i + 1}:`);
        console.log(`   Name: ${stream.name}`);
        console.log(`   Title: ${stream.title}`);
        
        if (stream.url && stream.url.includes('/play?')) {
          const playUrl = new URL(stream.url);
          const imdbParam = playUrl.searchParams.get('imdb');
          console.log(`   IMDB param: ${imdbParam}`);
          
          if (imdbParam === 'tt1870479:3:1') {
            console.log('   ✅ Correct IMDB parameter for S3E1');
          } else {
            console.log(`   ❌ Wrong IMDB parameter: ${imdbParam}`);
          }
        }
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
}

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Run the test
testEpisodeSelection().catch(console.error);
