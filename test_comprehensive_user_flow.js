#!/usr/bin/env node
/**
 * Comprehensive User Flow Testing
 * Tests typical user scenarios with verbose logging to verify system behavior
 */

const http = require('http');

const SERVER_URL = 'http://localhost:7010';

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const endTime = Date.now();
        try {
          const result = JSON.parse(data);
          result._responseTime = endTime - startTime;
          result._statusCode = res.statusCode;
          resolve(result);
        } catch (e) {
          resolve({ 
            raw: data, 
            _responseTime: endTime - startTime, 
            _statusCode: res.statusCode,
            _parseError: e.message 
          });
        }
      });
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
    req.on('error', reject);
  });
}

function analyzeStreams(streams) {
  if (!streams || !Array.isArray(streams)) return { total: 0 };
  
  const analysis = {
    total: streams.length,
    resolutions: {},
    sources: {},
    types: {},
    urls: {}
  };
  
  streams.forEach(stream => {
    // Analyze resolution
    const title = (stream.title || stream.name || '').toLowerCase();
    if (title.includes('4k') || title.includes('2160p')) {
      analysis.resolutions['4K'] = (analysis.resolutions['4K'] || 0) + 1;
    } else if (title.includes('1080p')) {
      analysis.resolutions['1080p'] = (analysis.resolutions['1080p'] || 0) + 1;
    } else if (title.includes('720p')) {
      analysis.resolutions['720p'] = (analysis.resolutions['720p'] || 0) + 1;
    } else if (title.includes('480p')) {
      analysis.resolutions['480p'] = (analysis.resolutions['480p'] || 0) + 1;
    } else {
      analysis.resolutions['Unknown'] = (analysis.resolutions['Unknown'] || 0) + 1;
    }
    
    // Analyze URL type
    if (stream.url) {
      if (stream.url.includes('/play?')) {
        analysis.urls['Debrid'] = (analysis.urls['Debrid'] || 0) + 1;
      } else if (stream.url.startsWith('http')) {
        analysis.urls['Direct'] = (analysis.urls['Direct'] || 0) + 1;
      } else if (stream.url.startsWith('magnet:')) {
        analysis.urls['Magnet'] = (analysis.urls['Magnet'] || 0) + 1;
      }
    } else if (stream.infoHash) {
      analysis.urls['InfoHash'] = (analysis.urls['InfoHash'] || 0) + 1;
    }
    
    // Analyze source tags (if present)
    if (stream.name && stream.name.includes('⚡')) {
      analysis.sources['Nuvio'] = (analysis.sources['Nuvio'] || 0) + 1;
    }
  });
  
  return analysis;
}

async function testUserFlow() {
  console.log('🧪 Comprehensive User Flow Testing with Verbose Logging\n');
  console.log('This will test typical user scenarios to verify system behavior\n');
  
  const testCases = [
    // Movies
    {
      name: 'Popular Movie - The Batman (2022)',
      url: `${SERVER_URL}/stream/movie/tt1877830.json?verbose=1`,
      type: 'movie',
      expectedContent: 'Recent popular movie should have multiple quality options'
    },
    {
      name: 'Classic Movie - The Shawshank Redemption',
      url: `${SERVER_URL}/stream/movie/tt0111161.json?verbose=1`,
      type: 'movie', 
      expectedContent: 'Classic movie should have good availability'
    },
    
    // Popular TV Series
    {
      name: 'Breaking Bad S1E1',
      url: `${SERVER_URL}/stream/series/tt0903747:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Popular series should have multiple quality options'
    },
    {
      name: 'The Office S1E1',
      url: `${SERVER_URL}/stream/series/tt0386676:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Popular comedy series should be well available'
    },
    {
      name: 'Game of Thrones S1E1',
      url: `${SERVER_URL}/stream/series/tt0944947:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Premium HBO series should have high quality streams'
    },
    
    // Recent/Current Series
    {
      name: 'Gen V S1E1 (2023)',
      url: `${SERVER_URL}/stream/series/tt13159924:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Recent series should work with ID validation'
    },
    {
      name: 'The Bear S1E1',
      url: `${SERVER_URL}/stream/series/tt14452776:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'FX series should have good quality'
    },
    
    // With Debrid (if available)
    {
      name: 'Breaking Bad S1E1 with AllDebrid',
      url: `${SERVER_URL}/stream/series/tt0903747:1:1.json?ad=test_key&verbose=1`,
      type: 'series',
      expectedContent: 'Should attempt debrid conversion (may fail with test key)'
    },
    
    // Different configurations
    {
      name: 'Additional Stream Test',
      url: `${SERVER_URL}/stream/series/tt0903747:1:1.json?additionalstream=1&verbose=1`,
      type: 'series',
      expectedContent: 'Should provide secondary stream option'
    },
    {
      name: 'Language Priority Test',
      url: `${SERVER_URL}/stream/series/tt0903747:1:1.json?lang_prio=EN,ES&verbose=1`,
      type: 'series',
      expectedContent: 'Should prioritize English and Spanish content'
    },
    
    // Edge cases
    {
      name: 'Non-existent Content',
      url: `${SERVER_URL}/stream/series/tt99999999:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Should handle gracefully with no streams message'
    },
    {
      name: 'Wrong ID - Lilo & Stitch',
      url: `${SERVER_URL}/stream/series/tt0762298:1:1.json?verbose=1`,
      type: 'series',
      expectedContent: 'Should show ID validation in action'
    }
  ];
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`${'='.repeat(80)}`);
    console.log(`📋 Test ${i + 1}/${testCases.length}: ${testCase.name}`);
    console.log(`🔗 URL: ${testCase.url}`);
    console.log(`🎯 Expected: ${testCase.expectedContent}`);
    console.log(`${'='.repeat(80)}`);
    
    try {
      const response = await makeRequest(testCase.url);
      
      console.log(`⏱️ Response Time: ${response._responseTime}ms`);
      console.log(`📊 Status Code: ${response._statusCode}`);
      
      if (response.streams) {
        const analysis = analyzeStreams(response.streams);
        console.log(`✅ Streams Found: ${analysis.total}`);
        
        if (analysis.total > 0) {
          console.log('📈 Stream Analysis:');
          console.log(`   Resolutions: ${JSON.stringify(analysis.resolutions)}`);
          console.log(`   URL Types: ${JSON.stringify(analysis.urls)}`);
          if (Object.keys(analysis.sources).length > 0) {
            console.log(`   Sources: ${JSON.stringify(analysis.sources)}`);
          }
          
          // Show first stream details
          const firstStream = response.streams[0];
          console.log('🎬 First Stream Details:');
          console.log(`   Title: ${firstStream.title || 'N/A'}`);
          console.log(`   Name: ${firstStream.name || 'N/A'}`);
          if (firstStream.url) {
            const urlType = firstStream.url.includes('/play?') ? 'Debrid URL' : 
                           firstStream.url.startsWith('http') ? 'Direct URL' : 'Other';
            console.log(`   URL Type: ${urlType}`);
            if (firstStream.url.includes('/play?')) {
              const url = new URL(firstStream.url);
              const params = Object.fromEntries(url.searchParams.entries());
              console.log(`   Debrid Params: ${JSON.stringify(params)}`);
            }
          }
          if (firstStream.infoHash) {
            console.log(`   InfoHash: ${firstStream.infoHash.substring(0, 16)}...`);
          }
          
          // Show additional stream if available
          if (response.streams.length > 1) {
            const secondStream = response.streams[1];
            console.log('🎬 Second Stream Details:');
            console.log(`   Title: ${secondStream.title || 'N/A'}`);
            console.log(`   Name: ${secondStream.name || 'N/A'}`);
          }
        }
      } else if (response.raw) {
        console.log('📄 Raw Response (first 300 chars):');
        console.log(response.raw.substring(0, 300));
      } else {
        console.log('📄 Response:', response);
      }
      
      // Performance analysis
      if (response._responseTime < 1000) {
        console.log('🚀 Performance: Excellent (< 1s)');
      } else if (response._responseTime < 3000) {
        console.log('⚡ Performance: Good (< 3s)');
      } else if (response._responseTime < 10000) {
        console.log('⏳ Performance: Slow (< 10s)');
      } else {
        console.log('🐌 Performance: Very Slow (> 10s)');
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log(''); // Space between tests
    
    // Add small delay between requests to avoid overwhelming server
    if (i < testCases.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`${'='.repeat(80)}`);
  console.log('✅ Comprehensive User Flow Testing Complete!');
  console.log(`${'='.repeat(80)}`);
  
  console.log('\n🎯 Key Observations to Look For:');
  console.log('• ID validation logs showing metadata verification');
  console.log('• Stream source aggregation from multiple providers'); 
  console.log('• Resolution detection and quality prioritization');
  console.log('• Debrid URL conversion (if API key provided)');
  console.log('• Episode filtering for series content');
  console.log('• Performance optimization through caching');
  console.log('• Graceful error handling for edge cases');
}

if (require.main === module) {
  main();
}

async function main() {
  try {
    await testUserFlow();
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    console.log('\n💡 Make sure AutoStream server is running with: node server.js');
  }
}

module.exports = { testUserFlow, analyzeStreams };
