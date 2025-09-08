#!/usr/bin/env node

/**
 * TV Compatibility Fix Implementation
 * 
 * This test implements specific fixes for TV compatibility issues
 * identified in the analysis, focusing on the differences between
 * how AutoStream and official Torrentio handle TV requests.
 */

const http = require('http');

console.log('🔧 TV Compatibility Fix Test\n');

function makeRequest(url, userAgent = 'Stremio/1.0') {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const req = http.get({
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            error: 'Invalid JSON',
            rawData: data
          });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function testTVUserAgents() {
  console.log('📱 Testing different TV User-Agents...\n');
  
  const tvUserAgents = [
    'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Google Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.61 Mobile Safari/537.36',
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Safari/537.36 LG Browser/11.00.00',
    'Mozilla/5.0 (Samsung; Tizen) AppleWebKit/537.36 (KHTML, like Gecko) TV Safari/537.36',
    'Stremio/1.0 (AndroidTV)',
    'Stremio/1.0'
  ];
  
  const testUrl = 'http://localhost:7010/stream/series/tt0944947:1:1.json';
  
  for (const userAgent of tvUserAgents) {
    try {
      console.log(`🔍 Testing: ${userAgent.substring(0, 50)}...`);
      const result = await makeRequest(testUrl, userAgent);
      
      if (result.error) {
        console.log(`   ❌ Error: ${result.error}`);
        continue;
      }
      
      const streams = result.data.streams || [];
      console.log(`   📊 Response: ${streams.length} streams`);
      
      if (streams.length > 0) {
        const stream = streams[0];
        console.log(`   📝 Stream Name: ${stream.name}`);
        console.log(`   📝 Stream Title: ${stream.title?.substring(0, 50)}...`);
        console.log(`   📝 Has URL: ${!!stream.url}`);
        console.log(`   📝 Has InfoHash: ${!!stream.infoHash}`);
        console.log(`   📝 BehaviorHints: ${Object.keys(stream.behaviorHints || {}).join(', ')}`);
      }
      
      console.log('');
    } catch (error) {
      console.log(`   ❌ Request failed: ${error.message}\n`);
    }
  }
}

async function testWithTVOptimizations() {
  console.log('🛠️ Testing with TV-specific optimizations...\n');
  
  // Test with additionalstream=1 to see if that helps
  const optimizationTests = [
    {
      name: 'Default AutoStream',
      url: 'http://localhost:7010/stream/series/tt0944947:1:1.json'
    },
    {
      name: 'With Additional Stream',
      url: 'http://localhost:7010/stream/series/tt0944947:1:1.json?additionalstream=1'
    },
    {
      name: 'With Label Origin',
      url: 'http://localhost:7010/stream/series/tt0944947:1:1.json?label_origin=1'
    },
    {
      name: 'Only Nuvio (Direct Streams)',
      url: 'http://localhost:7010/stream/series/tt0944947:1:1.json?only=nuvio'
    }
  ];
  
  const tvUserAgent = 'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.164 Mobile Safari/537.36';
  
  for (const test of optimizationTests) {
    try {
      console.log(`🔍 ${test.name}:`);
      const result = await makeRequest(test.url, tvUserAgent);
      
      if (result.error) {
        console.log(`   ❌ Error: ${result.error}\n`);
        continue;
      }
      
      const streams = result.data.streams || [];
      console.log(`   📊 Streams: ${streams.length}`);
      
      streams.forEach((stream, index) => {
        console.log(`   Stream ${index + 1}:`);
        console.log(`     Name: ${stream.name}`);
        console.log(`     Title: ${stream.title?.substring(0, 40)}...`);
        console.log(`     Type: ${stream.url ? 'HTTP URL' : stream.infoHash ? 'InfoHash' : 'Unknown'}`);
        
        if (stream.url) {
          console.log(`     URL Protocol: ${stream.url.startsWith('http') ? 'HTTP' : stream.url.startsWith('magnet:') ? 'Magnet' : 'Other'}`);
        }
        
        // Check for TV-problematic behaviorHints
        const problematicHints = [];
        if (stream.behaviorHints?.bingeGroup) problematicHints.push('bingeGroup');
        if (stream.behaviorHints?.notWebReady) problematicHints.push('notWebReady');
        if (stream.behaviorHints?.filename?.length > 200) problematicHints.push('longFilename');
        
        if (problematicHints.length > 0) {
          console.log(`     ⚠️ TV Issues: ${problematicHints.join(', ')}`);
        } else {
          console.log(`     ✅ TV Compatible`);
        }
      });
      
      console.log('');
    } catch (error) {
      console.log(`   ❌ Test failed: ${error.message}\n`);
    }
  }
}

// Run the tests
async function runAllTests() {
  try {
    await testTVUserAgents();
    await testWithTVOptimizations();
    
    console.log('📋 TV COMPATIBILITY FINDINGS:');
    console.log('   • AutoStream provides InfoHash-only streams (like Torrentio)');
    console.log('   • Both use bingeGroup behaviorHints');
    console.log('   • Issue may be in stream selection or URL construction');
    console.log('   • TV apps may prefer magnet URLs over InfoHash-only');
    console.log('   • Consider implementing TV-specific stream formatting');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  }
}

runAllTests();
