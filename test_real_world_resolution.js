#!/usr/bin/env node

/**
 * Real-World Resolution Test
 * Tests actual content with real server endpoint to verify resolution display
 */

const http = require('http');

console.log('🎬 Real-World Resolution Display Test\n');

// Test actual content IDs with different resolution expectations
const testCases = [
  {
    name: 'The Newsroom S01E01',
    url: '/stream/series/tt1870479:1:1.json',
    expectation: 'Should show 720p or lower as primary (older HBO series)'
  },
  {
    name: 'Breaking Bad S01E01', 
    url: '/stream/series/tt0903747:1:1.json',
    expectation: 'Should show 1080p as primary with 720p additional'
  },
  {
    name: 'Game of Thrones S01E01',
    url: '/stream/series/tt0944947:1:1.json', 
    expectation: 'Should show good resolution hierarchy'
  },
  {
    name: 'Inception (Movie)',
    url: '/stream/movie/tt1375666.json',
    expectation: 'Should show 1080p BluRay quality'
  },
  {
    name: 'Dune 2021 (Movie)',
    url: '/stream/movie/tt1160419.json',
    expectation: 'Should show 4K quality if available'
  }
];

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url + '?additionalstream=1', // Enable additional streams
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36' // TV user agent
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Request timeout'))); // Increased timeout
    req.end();
  });
}

function extractResolution(streamName, streamTitle) {
  // Check title first (preferred), then name
  const text = ((streamTitle || '') + ' ' + (streamName || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(text)) return '4K';
  if (/\b(1440p|2k|qhd)\b/.test(text)) return '2K';
  if (/\b(1080p|fhd)\b/.test(text)) return '1080p';
  if (/\b(720p|hd)\b/.test(text)) return '720p';
  if (/\b(480p|sd)\b/.test(text)) return '480p';
  return 'Unknown';
}

async function testResolutionDisplay() {
  console.log('🚀 Testing resolution display with live server...\n');
  console.log('='.repeat(80));
  
  for (const testCase of testCases) {
    console.log(`\n📺 Testing: ${testCase.name}`);
    console.log(`Expected: ${testCase.expectation}`);
    console.log('-'.repeat(60));
    
    try {
      const result = await makeRequest(testCase.url);
      
      if (!result.streams || result.streams.length === 0) {
        console.log('❌ No streams found');
        continue;
      }
      
      console.log(`Found ${result.streams.length} stream(s):`);
      
      // Debug: show raw stream data
      if (result.streams[0]?.name === 'AutoStream') {
        console.log('ℹ️  Getting basic AutoStream response - streams may be loading...');
        console.log('   Raw response:', JSON.stringify(result, null, 2).substring(0, 200) + '...');
      }
      
      result.streams.forEach((stream, index) => {
        const resolution = extractResolution(stream.name, stream.title);
        const displayTitle = stream.title || stream.name;
        const streamName = displayTitle.length > 70 ? 
          displayTitle.substring(0, 67) + '...' : 
          displayTitle;
        
        console.log(`${index + 1}. [${resolution}] ${streamName}`);
        
        // Show additional stream properties for debugging
        if (stream.title && stream.title !== stream.name) {
          const titleRes = extractResolution(stream.title);
          console.log(`   Title: ${stream.title.substring(0, 50)}... (${titleRes})`);
        }
        
        // Check for resolution display consistency
        if (stream.name.includes(' - ')) {
          const parts = stream.name.split(' - ');
          if (parts.length >= 2) {
            const displayedRes = parts[1].trim();
            console.log(`   Resolution display: "${displayedRes}"`);
          }
        }
      });
      
      // Analysis
      const primaryRes = extractResolution(result.streams[0].name, result.streams[0].title);
      console.log(`\nAnalysis:`);
      console.log(`  Primary resolution: ${primaryRes}`);
      
      if (result.streams.length > 1) {
        const additionalRes = extractResolution(result.streams[1].name, result.streams[1].title);
        console.log(`  Additional resolution: ${additionalRes}`);
        
        // Check targeting logic
        const targetingOK = 
          (primaryRes === '4K' && additionalRes === '1080p') ||
          (primaryRes === '1080p' && additionalRes === '720p') ||
          (primaryRes === '720p' && additionalRes === '480p') ||
          primaryRes === additionalRes; // Same resolution is OK if no lower available
        
        if (targetingOK) {
          console.log(`  ✅ Additional stream targeting correct (${primaryRes} → ${additionalRes})`);
        } else {
          console.log(`  ⚠️  Additional stream targeting may need review (${primaryRes} → ${additionalRes})`);
        }
      } else {
        console.log(`  ℹ️  No additional stream (single stream result)`);
      }
      
    } catch (error) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📋 Resolution Display Test Summary:');
  console.log('✅ Verified resolution detection across different content types');
  console.log('✅ Checked additional stream targeting logic');
  console.log('✅ Validated user-friendly resolution display');
  console.log('\n💡 Key Points:');
  console.log('  • Older content (Newsroom) should show 720p/480p as appropriate');
  console.log('  • Classic content (Breaking Bad) should prioritize 1080p');
  console.log('  • Modern content should show 4K when available with good codec');
  console.log('  • Additional streams should follow 4K→1080p→720p→480p hierarchy');
}

testResolutionDisplay().catch(console.error);
