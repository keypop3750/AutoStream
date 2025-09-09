#!/usr/bin/env node

// Comprehensive Resolution System Analysis

const http = require('http');

async function makeRequest(url, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/96.0.4664.110') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7010,
      path: url.replace('http://localhost:7010', ''),
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
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Request timeout')));
    req.end();
  });
}

async function analyzeResolutionSystems() {
  console.log('🔍 COMPREHENSIVE RESOLUTION SYSTEM ANALYSIS\n');
  console.log('Testing all systems that affect resolution detection and additional streams\n');

  // Test cases with different content types
  const testCases = [
    {
      name: 'Vinland Saga S1E1',
      id: 'tt1079342:1:1',
      type: 'series'
    },
    {
      name: 'Hunter x Hunter S1E1',
      id: 'tt0219349:1:1', 
      type: 'series'
    },
    {
      name: 'Naruto Shippuden S1E1',
      id: 'tt0988818:1:1',
      type: 'series'
    },
    {
      name: 'Breaking Bad S1E1',
      id: 'tt0903747:1:1',
      type: 'series'
    },
    {
      name: 'The Office S1E1',
      id: 'tt0386676:1:1',
      type: 'series'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📺 TESTING: ${testCase.name}`);
    console.log(`🆔 ID: ${testCase.id}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // Test 1: Single stream request
      console.log('📋 Test 1: Single Stream Request');
      console.log('--------------------------------');
      const singleUrl = `http://localhost:7010/stream/${testCase.type}/${testCase.id}.json?ad=test123&verbose=1`;
      const singleResponse = await makeRequest(singleUrl);
      
      console.log(`Found ${singleResponse.streams?.length || 0} streams`);
      if (singleResponse.streams && singleResponse.streams.length > 0) {
        const stream = singleResponse.streams[0];
        console.log(`Primary Stream: "${stream.title || stream.name}"`);
        
        // Analyze resolution detection
        const title = stream.title || stream.name || '';
        const hasResInTitle = /\b(4k|2160p|1440p|1080p|720p|480p)\b/i.test(title);
        console.log(`Has resolution in title: ${hasResInTitle ? '✅' : '❌'}`);
        
        if (stream.behaviorHints?.filename) {
          const filename = stream.behaviorHints.filename;
          const hasResInFilename = /\b(4k|2160p|1440p|1080p|720p|480p)\b/i.test(filename);
          console.log(`Filename: "${filename.substring(0, 60)}..."`);
          console.log(`Has resolution in filename: ${hasResInFilename ? '✅' : '❌'}`);
        }
      }

      // Test 2: Additional stream request
      console.log('\n📋 Test 2: Additional Stream Request');
      console.log('------------------------------------');
      const additionalUrl = `http://localhost:7010/stream/${testCase.type}/${testCase.id}.json?ad=test123&additionalstream=1&verbose=1`;
      const additionalResponse = await makeRequest(additionalUrl);
      
      console.log(`Found ${additionalResponse.streams?.length || 0} streams`);
      if (additionalResponse.streams && additionalResponse.streams.length > 0) {
        additionalResponse.streams.forEach((stream, i) => {
          const title = stream.title || stream.name || '';
          const resMatch = title.match(/\b(4k|2160p|1440p|1080p|720p|480p)\b/i);
          const resolution = resMatch ? resMatch[0] : 'No Resolution';
          
          console.log(`${i+1}. "${title}" - Resolution: ${resolution}`);
          
          // Check raw stream data for resolution clues
          if (stream.behaviorHints?.filename) {
            const filename = stream.behaviorHints.filename;
            const fileResMatch = filename.match(/\b(4k|2160p|1440p|1080p|720p|480p)\b/i);
            if (fileResMatch) {
              console.log(`   Filename Resolution: ${fileResMatch[0]}`);
            }
          }
        });

        // Analyze resolution hierarchy
        const resolutions = additionalResponse.streams.map(stream => {
          const title = stream.title || stream.name || '';
          const resMatch = title.match(/\b(4k|2160p|1440p|1080p|720p|480p)\b/i);
          return resMatch ? resMatch[0].toLowerCase() : 'unknown';
        });

        console.log(`\nResolution Distribution: ${resolutions.join(' → ')}`);
        
        const hasLowerThan1080p = resolutions.some(res => 
          res.includes('720p') || res.includes('480p') || res.includes('360p')
        );
        
        console.log(`Has streams below 1080p: ${hasLowerThan1080p ? '✅ YES' : '❌ NO'}`);
        
        if (!hasLowerThan1080p) {
          console.log('🚨 ISSUE DETECTED: No streams below 1080p found!');
        }
      }

      // Test 3: Debug request to see all available streams
      console.log('\n📋 Test 3: Raw Stream Analysis');
      console.log('-------------------------------');
      const debugUrl = `http://localhost:7010/stream/${testCase.type}/${testCase.id}.json?ad=test123&verbose=1&debug=1`;
      const debugResponse = await makeRequest(debugUrl);
      
      if (debugResponse.streams) {
        // Count resolution distribution in all streams
        const allResolutions = {};
        debugResponse.streams.forEach(stream => {
          const title = (stream.title || stream.name || '').toLowerCase();
          const filename = stream.behaviorHints?.filename || '';
          const fullText = `${title} ${filename}`;
          
          if (/\b(4k|2160p)\b/i.test(fullText)) allResolutions['4K'] = (allResolutions['4K'] || 0) + 1;
          else if (/\b(1440p|2k)\b/i.test(fullText)) allResolutions['2K'] = (allResolutions['2K'] || 0) + 1;
          else if (/\b1080p\b/i.test(fullText)) allResolutions['1080p'] = (allResolutions['1080p'] || 0) + 1;
          else if (/\b720p\b/i.test(fullText)) allResolutions['720p'] = (allResolutions['720p'] || 0) + 1;
          else if (/\b480p\b/i.test(fullText)) allResolutions['480p'] = (allResolutions['480p'] || 0) + 1;
          else allResolutions['Unknown'] = (allResolutions['Unknown'] || 0) + 1;
        });
        
        console.log('Resolution Distribution in All Available Streams:');
        Object.entries(allResolutions).forEach(([res, count]) => {
          console.log(`  ${res}: ${count} streams`);
        });
        
        // Check if lower resolutions exist in raw data but aren't being selected
        const hasRaw720p = allResolutions['720p'] > 0;
        const hasRaw480p = allResolutions['480p'] > 0;
        
        if ((hasRaw720p || hasRaw480p) && !hasLowerThan1080p) {
          console.log('🚨 CRITICAL ISSUE: Lower resolution streams exist in raw data but not in final output!');
          console.log('This suggests a filtering or selection problem in the additional stream logic.');
        }
      }

    } catch (error) {
      console.log(`❌ Error testing ${testCase.name}: ${error.message}`);
    }

    console.log('\n' + '⎯'.repeat(60));
  }

  console.log('\n🔍 ANALYSIS SUMMARY');
  console.log('==================');
  console.log('Systems that affect resolution detection and selection:');
  console.log('1. extractResolution() in core/format.js - Resolution detection from stream data');
  console.log('2. resOf() in server.js - Numeric resolution extraction for comparisons');
  console.log('3. buildContentTitle() in core/format.js - Adds resolution to display titles');
  console.log('4. Additional stream targeting logic in server.js (lines 1440-1480)');
  console.log('5. Stream scoring in core/scoring_v6.js - May affect which streams are available');
  console.log('6. Source fetching in services/sources.js - What streams are available initially');
  console.log('7. Episode filtering logic - May remove streams before resolution analysis');
  console.log('\nLook for conflicts between these systems that might prevent lower resolutions from showing.');
}

if (require.main === module) {
  analyzeResolutionSystems().catch(console.error);
}

module.exports = { analyzeResolutionSystems };
