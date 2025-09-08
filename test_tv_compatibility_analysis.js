#!/usr/bin/env node

/**
 * TV Compatibility Analysis for AutoStream
 * 
 * This test analyzes why some streams work on TV while others show 
 * "This video is not supported" error, specifically comparing AutoStream 
 * vs official Torrentio output.
 */

const http = require('http');
const https = require('https');

console.log('🔍 TV Compatibility Analysis\n');
console.log('Testing stream responses to identify TV compatibility issues...\n');

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Invalid JSON', data });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

function analyzeStream(stream, source) {
  console.log(`\n🔍 ${source} Stream Analysis:`);
  console.log(`   Name: ${stream.name || 'N/A'}`);
  console.log(`   Title: ${stream.title || 'N/A'}`);
  
  // URL Analysis
  if (stream.url) {
    console.log(`   URL: Present (${stream.url.length} chars)`);
    console.log(`   URL Protocol: ${stream.url.startsWith('http') ? 'HTTP' : stream.url.startsWith('magnet:') ? 'Magnet' : 'Other'}`);
  } else if (stream.infoHash) {
    console.log(`   URL: None (InfoHash only)`);
    console.log(`   InfoHash: ${stream.infoHash}`);
  } else {
    console.log(`   URL: None`);
  }
  
  // BehaviorHints Analysis
  if (stream.behaviorHints) {
    console.log(`   BehaviorHints:`);
    Object.entries(stream.behaviorHints).forEach(([key, value]) => {
      if (key === 'proxyHeaders') {
        console.log(`     ${key}: ${Object.keys(value || {}).join(', ')}`);
      } else {
        console.log(`     ${key}: ${typeof value === 'string' ? value.substring(0, 50) + (value.length > 50 ? '...' : '') : JSON.stringify(value)}`);
      }
    });
  } else {
    console.log(`   BehaviorHints: None`);
  }
  
  // TV Compatibility Flags
  const tvIssues = [];
  
  // Check for problematic behaviorHints
  if (stream.behaviorHints?.notWebReady) {
    tvIssues.push('notWebReady flag present');
  }
  
  if (stream.behaviorHints?.bingeGroup) {
    tvIssues.push('bingeGroup present (may confuse TV apps)');
  }
  
  if (stream.behaviorHints?.filename && stream.behaviorHints.filename.length > 200) {
    tvIssues.push('Long filename may cause TV parsing issues');
  }
  
  // Check for missing required fields
  if (!stream.name || stream.name.length === 0) {
    tvIssues.push('Missing or empty name field');
  }
  
  if (!stream.title || stream.title.length === 0) {
    tvIssues.push('Missing or empty title field');
  }
  
  // Check for InfoHash without URL (TV apps may not handle this well)
  if (stream.infoHash && !stream.url) {
    tvIssues.push('InfoHash-only stream (TV apps prefer direct URLs)');
  }
  
  // Check for unusual URL patterns
  if (stream.url && !stream.url.match(/^https?:\/\//)) {
    tvIssues.push('Non-HTTP URL format');
  }
  
  if (tvIssues.length > 0) {
    console.log(`   🚨 Potential TV Issues:`);
    tvIssues.forEach(issue => console.log(`     • ${issue}`));
  } else {
    console.log(`   ✅ No obvious TV compatibility issues detected`);
  }
  
  return tvIssues;
}

async function testTVCompatibility() {
  try {
    // Test AutoStream response
    console.log('📥 Testing AutoStream response...');
    const autoStreamUrl = 'http://localhost:7010/stream/series/tt0944947:1:1.json';
    const autoStreamResult = await makeRequest(autoStreamUrl);
    
    if (autoStreamResult.error) {
      console.log(`❌ AutoStream request failed: ${autoStreamResult.error}`);
      return;
    }
    
    console.log(`📊 AutoStream: ${autoStreamResult.streams?.length || 0} streams found`);
    
    const autoStreamIssues = [];
    if (autoStreamResult.streams?.length > 0) {
      autoStreamResult.streams.forEach((stream, index) => {
        const issues = analyzeStream(stream, `AutoStream Stream ${index + 1}`);
        autoStreamIssues.push(...issues);
      });
    }
    
    // Test official Torrentio for comparison
    console.log('\n📥 Testing official Torrentio response...');
    const torrentioUrl = 'https://torrentio.strem.fun/stream/series/tt0944947:1:1.json';
    
    try {
      const torrentioResult = await makeRequest(torrentioUrl);
      
      if (torrentioResult.error) {
        console.log(`❌ Torrentio request failed: ${torrentioResult.error}`);
      } else {
        console.log(`📊 Torrentio: ${torrentioResult.streams?.length || 0} streams found`);
        
        const torrentioIssues = [];
        if (torrentioResult.streams?.length > 0) {
          // Analyze first few streams from Torrentio
          const samplesToAnalyze = Math.min(3, torrentioResult.streams.length);
          for (let i = 0; i < samplesToAnalyze; i++) {
            const issues = analyzeStream(torrentioResult.streams[i], `Torrentio Stream ${i + 1}`);
            torrentioIssues.push(...issues);
          }
        }
        
        // Comparison
        console.log('\n📊 COMPATIBILITY COMPARISON:');
        console.log(`AutoStream Issues: ${autoStreamIssues.length} (${[...new Set(autoStreamIssues)].join(', ')})`);
        console.log(`Torrentio Issues: ${torrentioIssues.length} (${[...new Set(torrentioIssues)].join(', ')})`);
        
        // Find differences
        const autoStreamUniqueIssues = autoStreamIssues.filter(issue => !torrentioIssues.includes(issue));
        const torrentioUniqueIssues = torrentioIssues.filter(issue => !autoStreamIssues.includes(issue));
        
        if (autoStreamUniqueIssues.length > 0) {
          console.log('\n🎯 AUTOSTREAM-SPECIFIC TV ISSUES:');
          [...new Set(autoStreamUniqueIssues)].forEach(issue => {
            console.log(`   • ${issue}`);
          });
        }
        
        if (torrentioUniqueIssues.length > 0) {
          console.log('\n🎯 TORRENTIO-SPECIFIC TV ISSUES:');
          [...new Set(torrentioUniqueIssues)].forEach(issue => {
            console.log(`   • ${issue}`);
          });
        }
      }
    } catch (torrentioError) {
      console.log(`❌ Torrentio test failed: ${torrentioError.message}`);
    }
    
    // TV Compatibility Recommendations
    console.log('\n🔧 TV COMPATIBILITY RECOMMENDATIONS:');
    
    const recommendations = [];
    
    if (autoStreamIssues.includes('InfoHash-only stream (TV apps prefer direct URLs)')) {
      recommendations.push('Convert InfoHash streams to magnet URLs for TV compatibility');
    }
    
    if (autoStreamIssues.includes('bingeGroup present (may confuse TV apps)')) {
      recommendations.push('Remove or simplify bingeGroup behaviorHints for TV');
    }
    
    if (autoStreamIssues.includes('Long filename may cause TV parsing issues')) {
      recommendations.push('Truncate filename in behaviorHints to under 200 characters');
    }
    
    if (autoStreamIssues.includes('notWebReady flag present')) {
      recommendations.push('Remove notWebReady flag (already implemented)');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('No immediate fixes needed based on analysis');
      recommendations.push('Issue may be related to stream content or network connectivity');
      recommendations.push('Consider adding HTTP headers for better TV compatibility');
    }
    
    recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
    
    // Additional TV-specific recommendations
    console.log('\n🎯 ADDITIONAL TV OPTIMIZATION SUGGESTIONS:');
    console.log('   • Ensure CORS headers include Range and Accept-Ranges');
    console.log('   • Add User-Agent detection for TV apps');
    console.log('   • Consider providing magnet URLs alongside InfoHash');
    console.log('   • Test with shorter stream titles and names');
    console.log('   • Validate Content-Type headers for video streams');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testTVCompatibility().then(() => {
  console.log('\n✅ TV compatibility analysis complete');
}).catch(err => {
  console.error('❌ Analysis failed:', err.message);
});
