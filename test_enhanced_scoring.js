#!/usr/bin/env node
/**
 * Test Enhanced Scoring with Premium Hosts and Size Analysis
 */

const path = require('path');
process.chdir(path.dirname(__filename));

const scoring = require('./core/scoring_v6');

function testEnhancedScoring() {
  console.log('🔍 ENHANCED SCORING TEST - Premium Hosts & Size Analysis');
  console.log('=' .repeat(70));
  
  const testStreams = [
    {
      title: 'Shogun S1E1 4K HDR 15GB x265-FRAMESTOR',
      name: 'Premium 4K with optimal size',
      url: 'https://drive.google.com/file/d/abc123',
      autostreamOrigin: 'nuvio'
    },
    {
      title: 'Shogun S1E1 4K HDR 2GB x265-YIFY',
      name: 'Premium 4K with small size', 
      url: 'https://mega.nz/file/abc123',
      autostreamOrigin: 'nuvio'
    },
    {
      title: 'Shogun S1E1 1080p BluRay 8GB x264-JOY',
      name: 'Optimal 1080p with good size',
      infoHash: 'abc123def456',
      autostreamOrigin: 'torrentio'
    },
    {
      title: 'Shogun S1E1 1080p WEBRip 1GB x265-TIGOLE',
      name: 'Small 1080p with premium group',
      infoHash: 'def456abc789',
      autostreamOrigin: 'torrentio'
    },
    {
      title: 'Shogun S1E1 720p HDTV 3GB x264-LOL',
      name: 'Good 720p with optimal size',
      url: 'https://dropbox.com/s/abc123',
      autostreamOrigin: 'nuvio'
    },
    {
      title: 'Shogun S1E1 720p HDTV 0.5GB x264',
      name: 'Small 720p with poor size',
      url: 'https://some-random-host.com/video.mp4',
      autostreamOrigin: 'nuvio'
    }
  ];

  const mockReq = {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  };

  console.log('Testing individual scoring components:\n');

  testStreams.forEach((stream, index) => {
    console.log(`Stream ${index + 1}: ${stream.title}`);
    console.log('-'.repeat(50));

    // Test quality scoring
    const qualityScore = scoring.getCompleteQualityScore ? 
      scoring.getCompleteQualityScore(stream, 'web') : 
      getQualityScore(stream);
    
    // Test connection scoring  
    const connectionScore = getConnectionScore(stream);
    
    // Test overall score
    const overallScore = scoring.computeStreamScore(stream, mockReq, {});
    
    console.log(`  Quality Score: ${qualityScore.score} (${qualityScore.factors?.join(', ') || qualityScore.reason})`);
    console.log(`  Connection Score: ${connectionScore.score} (${connectionScore.reason})`);
    console.log(`  Overall Score: ${overallScore.score}`);
    console.log(`  Bonuses: ${overallScore.bonuses?.join(', ') || 'none'}`);
    console.log(`  Penalties: ${overallScore.penalties?.join(', ') || 'none'}`);
    console.log();
  });

  // Test premium host detection
  console.log('Premium Host Detection Test:');
  console.log('-'.repeat(30));
  
  const hostTests = [
    'https://drive.google.com/file/d/abc123',
    'https://mega.nz/file/abc123', 
    'https://dropbox.com/s/abc123',
    'https://onedrive.live.com/download?id=abc123',
    'https://archive.org/download/abc123',
    'https://random-site.com/video.mp4',
    'https://content.cloudfront.net/video.mp4'
  ];

  hostTests.forEach(url => {
    const testStream = { url, title: 'Test Stream', name: 'Test' };
    const connectionScore = getConnectionScore(testStream);
    console.log(`  ${new URL(url).hostname}: ${connectionScore.score} (${connectionScore.reason})`);
  });
}

// Import the scoring functions directly for testing
function getQualityScore(stream) {
  const title = ((stream.title || '') + ' ' + (stream.name || '')).toLowerCase();
  let score = 0;
  const factors = [];

  // Base resolution scoring
  if (/\b(2160p|4k|uhd)\b/.test(title)) {
    score += 30;
    factors.push('4k_base');
  } else if (/\b(1080p|fhd)\b/.test(title)) {
    score += 20;
    factors.push('1080p_base');
  } else if (/\b(720p|hd)\b/.test(title)) {
    score += 10;
    factors.push('720p_base');
  }

  // File size analysis
  const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*gb?\b/);
  if (sizeMatch) {
    const sizeGB = parseFloat(sizeMatch[1]);
    
    if (score >= 30) { // 4K
      if (sizeGB >= 15) { score += 8; factors.push('optimal_4k_size'); }
      else if (sizeGB >= 8) { score += 4; factors.push('good_4k_size'); }
      else if (sizeGB < 3) { score -= 5; factors.push('small_4k_size'); }
    } else if (score >= 20) { // 1080p
      if (sizeGB >= 8) { score += 6; factors.push('optimal_1080p_size'); }
      else if (sizeGB >= 3) { score += 3; factors.push('good_1080p_size'); }
      else if (sizeGB < 1.5) { score -= 3; factors.push('small_1080p_size'); }
    } else if (score >= 10) { // 720p
      if (sizeGB >= 4) { score += 4; factors.push('optimal_720p_size'); }
      else if (sizeGB >= 1.5) { score += 2; factors.push('good_720p_size'); }
      else if (sizeGB < 0.8) { score -= 2; factors.push('small_720p_size'); }
    }
  }

  // Premium groups
  const premiumGroups = ['framestor', 'yify', 'joy', 'tigole'];
  if (premiumGroups.some(group => title.includes(group))) {
    score += 5;
    factors.push('premium_group');
  }

  return { score, factors, reason: factors.join(',') };
}

function getConnectionScore(stream) {
  const url = stream.url || '';
  const hasInfoHash = !!(stream.infoHash);
  
  if (hasInfoHash) {
    return { score: 30, reason: 'torrent_to_debrid' };
  }
  
  if (!url) return { score: 0, reason: 'no_url' };

  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    
    const premiumHosts = [
      'drive.google.com', 'onedrive.live.com', 'dropbox.com', 'mega.nz', 'archive.org'
    ];
    
    if (premiumHosts.some(p => host.includes(p))) {
      return { score: 25, reason: 'premium_host' };
    }

    const cdnPatterns = [/\.cloudfront\.net$/, /\.fastly\.com$/, /\.amazonaws\.com$/];
    if (cdnPatterns.some(pattern => pattern.test(host))) {
      return { score: 15, reason: 'cdn_host' };
    }

    return { score: 3, reason: 'direct_http' };
  } catch (e) {
    return { score: -5, reason: 'invalid_url' };
  }
}

if (require.main === module) {
  testEnhancedScoring();
}

module.exports = { testEnhancedScoring };
