#!/usr/bin/env node

/**
 * Newsroom Stream Analysis
 * Deep dive into why Newsroom only shows 720p on TV
 */

const http = require('http');

console.log('🔍 Deep Analysis: Newsroom Stream Investigation\n');

function makeRequest(url, userAgent = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36') {
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
          resolve(JSON.parse(data));
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

function analyzeStreamScoring(streams) {
  console.log('\n📊 Stream Analysis (All Found Streams):');
  console.log('='.repeat(80));
  
  if (!streams || streams.length === 0) {
    console.log('❌ No streams to analyze');
    return;
  }
  
  // Simulate scoring analysis
  streams.forEach((stream, i) => {
    console.log(`\n${i + 1}. Stream Analysis:`);
    console.log(`   Name: ${stream.name || 'N/A'}`);
    console.log(`   Title: ${stream.title || 'N/A'}`);
    console.log(`   URL: ${stream.url?.substring(0, 60)}...`);
    
    // Extract quality indicators
    const fullText = `${stream.name || ''} ${stream.title || ''} ${stream.url || ''}`.toLowerCase();
    
    // Resolution detection
    let resolution = 'Unknown';
    if (/\b(2160p|4k|uhd)\b/.test(fullText)) resolution = '4K';
    else if (/\b(1080p|fhd)\b/.test(fullText)) resolution = '1080p';
    else if (/\b(720p|hd)\b/.test(fullText)) resolution = '720p';
    else if (/\b(480p|sd)\b/.test(fullText)) resolution = '480p';
    
    // Codec detection
    let codec = 'Unknown';
    if (/\bx265\b|\bhevc\b|\bh\.?265\b/.test(fullText)) codec = 'x265/HEVC';
    else if (/\bx264\b|\bh\.?264\b|\bavc\b/.test(fullText)) codec = 'x264/AVC';
    
    // Container detection
    let container = 'Unknown';
    if (/\.mkv\b/.test(fullText)) container = 'MKV';
    else if (/\.mp4\b/.test(fullText)) container = 'MP4';
    else if (/\.avi\b/.test(fullText)) container = 'AVI';
    
    // Size detection
    let size = 'Unknown';
    const sizeMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(?:gb|mb)/i);
    if (sizeMatch) {
      const value = parseFloat(sizeMatch[1]);
      const unit = sizeMatch[0].toLowerCase().includes('gb') ? 'GB' : 'MB';
      size = `${value}${unit}`;
    }
    
    console.log(`   📐 Resolution: ${resolution}`);
    console.log(`   🎞️  Codec: ${codec}`);
    console.log(`   📦 Container: ${container}`);
    console.log(`   💾 Size: ${size}`);
    
    // Calculate estimated TV penalties
    let estimatedScore = 100; // Base score
    let penalties = [];
    let bonuses = [];
    
    // TV Quality scoring simulation
    if (resolution === '4K') {
      estimatedScore += 40;
      bonuses.push('4K_quality(+40)');
    } else if (resolution === '1080p') {
      estimatedScore += 30;
      bonuses.push('1080p_quality(+30)');
    } else if (resolution === '720p') {
      estimatedScore += 20;
      bonuses.push('720p_quality(+20)');
    }
    
    // TV Codec penalties
    if (codec === 'x265/HEVC') {
      estimatedScore -= 60;
      penalties.push('x265_codec(-60)');
    }
    
    // TV Container penalties
    if (container === 'MKV') {
      estimatedScore -= 20;
      penalties.push('mkv_container(-20)');
    }
    
    console.log(`   🎯 Estimated TV Score: ${estimatedScore}`);
    if (bonuses.length > 0) console.log(`   ✅ Bonuses: ${bonuses.join(', ')}`);
    if (penalties.length > 0) console.log(`   ❌ Penalties: ${penalties.join(', ')}`);
    
    // TV compatibility assessment
    if (codec === 'x265/HEVC') {
      console.log(`   📺 TV Compatibility: ⚠️  POOR (x265 may not play on older TVs)`);
    } else if (container === 'MKV') {
      console.log(`   📺 TV Compatibility: ⚠️  FAIR (MKV support varies)`);
    } else {
      console.log(`   📺 TV Compatibility: ✅ GOOD`);
    }
  });
}

async function investigateNewsroom() {
  console.log('🎬 Analyzing: The Newsroom S01E01');
  console.log('❓ Question: Why only 720p shown on TV when 1080p should be available?');
  console.log('='.repeat(80));
  
  try {
    // Test with TV user agent and debug parameter  
    console.log('\n📺 Fetching streams with TV user agent...');
    const tvResult = await makeRequest('/stream/series/tt1870479:1:1.json?additionalstream=1&debug=1');
    
    console.log(`\n📋 Result Summary:`);
    console.log(`   Streams returned: ${tvResult.streams?.length || 0}`);
    
    if (tvResult.streams && tvResult.streams.length > 0) {
      tvResult.streams.forEach((stream, i) => {
        const resolution = extractResolution(stream.name, stream.title);
        console.log(`   ${i + 1}. [${resolution}] ${stream.title || stream.name}`);
      });
      
      // Analyze all returned streams
      analyzeStreamScoring(tvResult.streams);
    }
    
    console.log('\n💻 Now testing with Web user agent for comparison...');
    const webResult = await makeRequest('/stream/series/tt1870479:1:1.json?additionalstream=1&debug=1', 
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
    console.log(`\n📋 Web Result Summary:`);
    console.log(`   Streams returned: ${webResult.streams?.length || 0}`);
    
    if (webResult.streams && webResult.streams.length > 0) {
      webResult.streams.forEach((stream, i) => {
        const resolution = extractResolution(stream.name, stream.title);
        console.log(`   ${i + 1}. [${resolution}] ${stream.title || stream.name}`);
      });
    }
    
    // Compare results
    console.log('\n' + '='.repeat(80));
    console.log('🔍 ANALYSIS CONCLUSIONS:');
    console.log('='.repeat(80));
    
    const tvPrimary = tvResult.streams?.[0] ? extractResolution(tvResult.streams[0].name, tvResult.streams[0].title) : 'None';
    const webPrimary = webResult.streams?.[0] ? extractResolution(webResult.streams[0].name, webResult.streams[0].title) : 'None';
    
    console.log(`\n📊 Platform Comparison:`);
    console.log(`   📺 TV Primary:  ${tvPrimary} (${tvResult.streams?.length || 0} total streams)`);
    console.log(`   💻 Web Primary: ${webPrimary} (${webResult.streams?.length || 0} total streams)`);
    
    if (tvPrimary === '720p' && webPrimary !== '720p') {
      console.log('\n💡 HYPOTHESIS: TV platform is penalizing 1080p streams due to:');
      console.log('   • x265/HEVC codec compatibility issues (-60 points)');
      console.log('   • MKV container compatibility issues (-20 points)');
      console.log('   • Combined penalties making 720p x264 streams score higher');
      console.log('\n🎯 RECOMMENDATION: This is working as intended for TV compatibility');
    } else if (tvPrimary === webPrimary) {
      console.log('\n⚠️  WARNING: Platform-specific scoring may not be working properly');
      console.log('   Both platforms showing same quality suggests scoring is not platform-aware');
    }
    
  } catch (error) {
    console.log(`❌ Investigation failed: ${error.message}`);
    console.log('💡 Make sure the AutoStream server is running on localhost:7010');
  }
}

function extractResolution(streamName, streamTitle) {
  const text = ((streamTitle || '') + ' ' + (streamName || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(text)) return '4K';
  if (/\b(1080p|fhd)\b/.test(text)) return '1080p';
  if (/\b(720p|hd)\b/.test(text)) return '720p';
  if (/\b(480p|sd)\b/.test(text)) return '480p';
  return 'Unknown';
}

investigateNewsroom().catch(console.error);
