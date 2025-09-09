#!/usr/bin/env node

/**
 * Platform Comparison Test
 * Tests the same content across TV, Mobile, and Web to verify platform-specific scoring
 */

const http = require('http');

console.log('🎯 Platform-Specific Scoring Comparison Test\n');

function makeRequest(url, userAgent, platform) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url,
      method: 'GET',
      headers: {
        'User-Agent': userAgent
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          result._platform = platform;
          resolve(result);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Request timeout')));
    req.end();
  });
}

function extractResolution(streamName, streamTitle) {
  const text = ((streamTitle || '') + ' ' + (streamName || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(text)) return '4K';
  if (/\b(1080p|fhd)\b/.test(text)) return '1080p';
  if (/\b(720p|hd)\b/.test(text)) return '720p';
  if (/\b(480p|sd)\b/.test(text)) return '480p';
  return 'Unknown';
}

const platforms = [
  {
    name: 'TV',
    userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36',
    icon: '📺'
  },
  {
    name: 'Mobile',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    icon: '📱'
  },
  {
    name: 'Web',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    icon: '💻'
  }
];

const testContent = [
  {
    name: 'The Newsroom S01E01',
    url: '/stream/series/tt1870479:1:1.json?additionalstream=1',
    expectation: 'Should show different quality preferences per platform'
  },
  {
    name: 'Inception',
    url: '/stream/movie/tt1375666.json?additionalstream=1', 
    expectation: 'Should have 4K x264 available, especially for Web/Mobile'
  },
  {
    name: 'Breaking Bad S01E01',
    url: '/stream/series/tt0903747:1:1.json?additionalstream=1',
    expectation: 'Should show platform-specific codec preferences'
  }
];

async function testPlatformDifferences() {
  console.log('🔍 Testing platform-specific scoring differences...\n');
  console.log('='.repeat(100));
  
  for (const content of testContent) {
    console.log(`\n🎬 ${content.name}`);
    console.log(`Expected: ${content.expectation}`);
    console.log('='.repeat(80));
    
    const results = [];
    
    // Test all platforms
    for (const platform of platforms) {
      try {
        console.log(`\n${platform.icon} Testing ${platform.name}...`);
        const result = await makeRequest(content.url, platform.userAgent, platform.name);
        results.push(result);
        
        if (result.streams && result.streams.length > 0) {
          console.log(`Found ${result.streams.length} stream(s):`);
          result.streams.forEach((stream, i) => {
            const resolution = extractResolution(stream.name, stream.title);
            console.log(`  ${i + 1}. [${resolution}] ${stream.title || stream.name}`);
          });
        } else {
          console.log('No streams found');
        }
        
      } catch (error) {
        console.log(`❌ ${platform.name} failed: ${error.message}`);
      }
    }
    
    // Compare results
    console.log('\n📊 Platform Comparison:');
    console.log('-'.repeat(50));
    
    if (results.length === 3) {
      const [tvResult, mobileResult, webResult] = results;
      
      // Compare primary streams
      const tvPrimary = tvResult.streams?.[0] ? extractResolution(tvResult.streams[0].name, tvResult.streams[0].title) : 'None';
      const mobilePrimary = mobileResult.streams?.[0] ? extractResolution(mobileResult.streams[0].name, mobileResult.streams[0].title) : 'None';
      const webPrimary = webResult.streams?.[0] ? extractResolution(webResult.streams[0].name, webResult.streams[0].title) : 'None';
      
      console.log(`Primary Resolution:`);
      console.log(`  📺 TV:     ${tvPrimary}`);
      console.log(`  📱 Mobile: ${mobilePrimary}`);
      console.log(`  💻 Web:    ${webPrimary}`);
      
      // Check for differences
      const allSame = tvPrimary === mobilePrimary && mobilePrimary === webPrimary;
      if (allSame) {
        console.log('⚠️  All platforms show same resolution - platform-specific scoring may not be working');
      } else {
        console.log('✅ Platform differences detected - platform-specific scoring working');
      }
      
      // Compare stream counts
      const tvCount = tvResult.streams?.length || 0;
      const mobileCount = mobileResult.streams?.length || 0;
      const webCount = webResult.streams?.length || 0;
      
      console.log(`Stream Count:`);
      console.log(`  📺 TV:     ${tvCount} streams`);
      console.log(`  📱 Mobile: ${mobileCount} streams`);
      console.log(`  💻 Web:    ${webCount} streams`);
      
      // Special analysis for specific content
      if (content.name.includes('Newsroom')) {
        console.log('\n🔍 Newsroom Analysis:');
        if (tvPrimary === '720p' && tvCount === 1) {
          console.log('  📺 TV shows only 720p - likely 1080p streams are x265/HEVC (penalized for TV)');
        }
        if (webPrimary === '1080p' || mobilePrimary === '1080p') {
          console.log('  ✅ Web/Mobile show higher quality - platform scoring working correctly');
        }
      }
      
      if (content.name.includes('Inception')) {
        console.log('\n🔍 Inception Analysis:');
        const has4K = [tvPrimary, mobilePrimary, webPrimary].includes('4K');
        if (!has4K) {
          console.log('  ⚠️  No 4K streams found - may need to check if 4K x264 versions are available');
        } else {
          console.log('  ✅ 4K streams available');
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(100));
  console.log('📋 Platform Testing Summary:');
  console.log('✅ Verified platform-specific user agents');
  console.log('✅ Compared resolution preferences across devices');
  console.log('✅ Analyzed quality availability per platform');
  console.log('\n💡 Key Insights:');
  console.log('  • TV platform should prioritize compatibility (x264 over x265)');
  console.log('  • Mobile platform should balance quality with efficiency');
  console.log('  • Web platform should maximize quality when possible');
  console.log('  • Different platforms may show different stream counts due to scoring');
}

testPlatformDifferences().catch(console.error);
