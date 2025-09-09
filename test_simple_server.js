#!/usr/bin/env node

/**
 * Simple Server Test
 * Just test one endpoint to see what's happening
 */

const http = require('http');

console.log('🔍 Simple Server Test - Breaking Bad S01E01\n');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36'
      }
    };
    
    console.log(`Making request to: http://localhost:7010${url}`);
    
    const req = http.request(options, (res) => {
      console.log(`Response status: ${res.statusCode}`);
      console.log(`Response headers:`, res.headers);
      
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        console.log(`Received chunk: ${chunk.length} bytes`);
      });
      
      res.on('end', () => {
        console.log(`Total response length: ${data.length} bytes`);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          console.log('Raw response:', data.substring(0, 500));
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`Request error:`, err);
      reject(err);
    });
    
    req.setTimeout(30000, () => {
      console.log('Request timed out');
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

async function simpleTest() {
  try {
    console.log('Testing Breaking Bad S01E01...');
    const result = await makeRequest('/stream/series/tt0903747:1:1.json?additionalstream=1');
    
    console.log('\n📊 Result Analysis:');
    console.log('Streams found:', result.streams?.length || 0);
    
    if (result.streams && result.streams.length > 0) {
      result.streams.forEach((stream, i) => {
        console.log(`\nStream ${i + 1}:`);
        console.log(`  Name: ${stream.name}`);
        console.log(`  Title: ${stream.title || 'N/A'}`);
        console.log(`  URL: ${stream.url ? stream.url.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`  Origin: ${stream.autostreamOrigin || 'N/A'}`);
        
        // Extract resolution
        const text = ((stream.title || '') + ' ' + (stream.name || '')).toLowerCase();
        let resolution = 'Unknown';
        if (/\b(2160p|4k|uhd)\b/.test(text)) resolution = '4K';
        else if (/\b(1080p|fhd)\b/.test(text)) resolution = '1080p';
        else if (/\b(720p|hd)\b/.test(text)) resolution = '720p';
        else if (/\b(480p|sd)\b/.test(text)) resolution = '480p';
        
        console.log(`  Detected Resolution: ${resolution}`);
      });
    } else {
      console.log('No streams in response');
      console.log('Full response:', JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

simpleTest();
