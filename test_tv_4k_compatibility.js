#!/usr/bin/env node

/**
 * Test TV 4K Compatibility Scoring
 * Shows how 4K x264 vs 4K x265 vs 1080p x264 score for TV users
 */

console.log('🎯 TV 4K Compatibility Test - Resolution vs Codec Priority\n');

try {
  const scoring = require('./core/scoring_v6');
  
  // Test streams representing real scenarios
  const testStreams = [
    {
      name: 'Movie 4K HDR x264 H.264 BluRay.mp4',
      title: 'Movie.4K.HDR.x264.H.264.BluRay.mp4',
      url: 'https://example.com/movie-4k-x264.mp4',
      autostreamOrigin: 'torrentio'
    },
    {
      name: 'Movie 4K HDR x265 HEVC.mkv', 
      title: 'Movie.4K.HDR.x265.HEVC.mkv',
      url: 'https://example.com/movie-4k-x265.mkv',
      autostreamOrigin: 'torrentio'
    },
    {
      name: 'Movie 1080p x264 BluRay.mp4',
      title: 'Movie.1080p.x264.BluRay.mp4', 
      url: 'https://example.com/movie-1080p-x264.mp4',
      autostreamOrigin: 'torrentio'
    },
    {
      name: 'Movie 1080p x265 HEVC.mkv',
      title: 'Movie.1080p.x265.HEVC.mkv',
      url: 'https://example.com/movie-1080p-x265.mkv', 
      autostreamOrigin: 'torrentio'
    }
  ];
  
  // Test TV device
  const mockTVReq = {
    headers: {
      'user-agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36'
    }
  };
  
  console.log('📺 TV Device Results (Your TV Experience):');
  console.log('='.repeat(60));
  
  const results = scoring.filterAndScoreStreams(testStreams, mockTVReq, { debug: false });
  
  results.forEach((stream, index) => {
    const qual = stream._scoring.breakdown?.quality?.score || 0;
    const factors = stream._scoring.breakdown?.quality?.factors || [];
    const name = stream.name.replace('Movie ', '');
    
    console.log(`${index + 1}. ${name}`);
    console.log(`   Score: ${stream._score} (Quality: ${qual > 0 ? '+' : ''}${qual})`);
    console.log(`   Key factors: ${factors.slice(0, 3).join(', ')}`);
    console.log('');
  });
  
  // Analysis
  console.log('🔍 Analysis for TV Users:');
  console.log('='.repeat(40));
  
  const pos4kx264 = results.findIndex(s => s.name.includes('4K') && s.name.includes('x264'));
  const pos4kx265 = results.findIndex(s => s.name.includes('4K') && s.name.includes('x265'));
  const pos1080px264 = results.findIndex(s => s.name.includes('1080p') && s.name.includes('x264'));
  const pos1080px265 = results.findIndex(s => s.name.includes('1080p') && s.name.includes('x265'));
  
  if (pos4kx264 === 0) {
    console.log('✅ PERFECT: 4K x264 ranks #1 - You get maximum quality with guaranteed compatibility!');
  } else if (pos1080px264 < pos4kx264) {
    console.log('⚠️  1080p x264 beats 4K x264 - May need score adjustment');
  }
  
  if (pos4kx264 < pos4kx265) {
    console.log('✅ CORRECT: 4K x264 beats 4K x265 - Codec compatibility prioritized');
  }
  
  if (pos1080px264 < pos1080px265) {
    console.log('✅ CORRECT: 1080p x264 beats 1080p x265 - Consistent codec priority');
  }
  
  console.log('');
  const score4kx264 = results[pos4kx264]?._score || 0;
  const score4kx265 = results[pos4kx265]?._score || 0;
  const score1080px264 = results[pos1080px264]?._score || 0;
  
  console.log('📊 Score Comparison:');
  console.log(`4K x264:     ${score4kx264} points`);
  console.log(`4K x265:     ${score4kx265} points (${score4kx265 - score4kx264} vs x264)`);
  console.log(`1080p x264:  ${score1080px264} points (${score1080px264 - score4kx264} vs 4K x264)`);
  
  console.log('');
  console.log('🎬 Expected TV Behavior:');
  if (score4kx264 > score1080px264) {
    console.log('✅ You will get 4K movies with compatible codecs');
    console.log('✅ No more "video not supported" errors');
    console.log('✅ Best possible quality for your TV');
  } else {
    console.log('ℹ️  1080p prioritized over 4K for maximum reliability');
  }
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
}
