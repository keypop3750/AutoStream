/**
 * scoring_v6.js
 * Simplified scoring with penalty-based reliability system
 * 
 * Features:
 * - Penalty-based reliability (no permanent exclusion, no cooldowns)
 * - Quality/resolution scoring  
 * - Connection quality detection
 * - Cookie stream scoring
 * - Stream type bonuses
 */

const penaltyReliability = require('../services/penaltyReliability');

/**
 * Compute stream score with penalty-based reliability
 * @param {Object} stream - Stream object
 * @param {Object} req - HTTP request object (for client identification)
 * @param {Object} opts - Scoring options
 */
function computeStreamScore(stream, req, opts = {}) {
  const url = stream.url || stream.externalUrl || '';
  const hasInfoHash = !!(stream.infoHash);
  const isMagnet = /^magnet:/i.test(url);
  
  // Allow scoring for torrents (they get URLs later via debrid)
  if (!url && !hasInfoHash && !isMagnet) {
    return { score: 0, reason: 'no_url_or_torrent', breakdown: {} };
  }

  let score = 800; // Base score for valid streams
  let penalties = [];
  let bonuses = [];

  // PENALTY-BASED RELIABILITY (core system)
  // For torrents, use infoHash for penalty lookup
  const reliabilityUrl = url || (hasInfoHash ? `magnet:?xt=urn:btih:${stream.infoHash}` : '');
  const reliabilityPenalty = reliabilityUrl ? penaltyReliability.getPenalty(reliabilityUrl) : 0;
  score -= reliabilityPenalty;
  if (reliabilityPenalty > 0) {
    penalties.push(`reliability_penalty(-${reliabilityPenalty})`);
  }

  // SEEDER VALIDATION (prevent showing bad torrents)
  const seederScore = getSeederScore(stream);
  score += seederScore.score;
  if (seederScore.score < 0) {
    penalties.push(`low_seeders(${seederScore.score})`);
  }

  // QUALITY SCORING
  const qualityScore = getQualityScore(stream);
  score += qualityScore.score;
  if (qualityScore.score > 0) {
    bonuses.push(`quality_bonus(+${qualityScore.score})`);
  }

  // COOKIE-BASED SCORING
  const cookieScore = getCookieScore(stream, opts);
  score += cookieScore.score;
  if (cookieScore.score !== 0) {
    if (cookieScore.score > 0) {
      bonuses.push(`cookie_bonus(+${cookieScore.score})`);
    } else {
      penalties.push(`cookie_penalty(${cookieScore.score})`);
    }
  }

  // STREAM QUALITY VALIDATION (for direct hosts)
  const streamQualityScore = getStreamQualityScore(stream);
  score += streamQualityScore.score;
  if (streamQualityScore.score < 0) {
    penalties.push(`stream_quality(${streamQualityScore.score})`);
  } else if (streamQualityScore.score > 0) {
    bonuses.push(`stream_quality(+${streamQualityScore.score})`);
  }

  // CONNECTION QUALITY DETECTION  
  const connectionScore = getConnectionScore(stream);
  score += connectionScore.score;
  if (connectionScore.score !== 0) {
    if (connectionScore.score > 0) {
      bonuses.push(`connection_bonus(+${connectionScore.score})`);
    } else {
      penalties.push(`connection_penalty(${connectionScore.score})`);
    }
  }

  // STREAM TYPE BONUSES
  const typeScore = getStreamTypeScore(stream);
  score += typeScore.score;
  if (typeScore.score > 0) {
    bonuses.push(`type_bonus(+${typeScore.score})`);
  }

  return {
    score,
    reason: 'scored',
    penalties,
    bonuses,
    breakdown: {
      reliability: { penalty: reliabilityPenalty },
      quality: qualityScore,
      cookie: cookieScore,
      connection: connectionScore,
      type: typeScore
    }
  };
}

/**
 * Quality-based scoring with detailed differentiation
 */
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
  } else if (/\b(480p|sd)\b/.test(title)) {
    score += 5;
    factors.push('480p_base');
  }

  // HDR/DV bonuses (significant quality improvement)
  if (/\b(hdr10\+|dolby.?vision|dv)\b/.test(title)) {
    score += 15;
    factors.push('dolby_vision');
  } else if (/\bhdr\b/.test(title)) {
    score += 10;
    factors.push('hdr');
  }

  // Codec preferences (efficiency and quality)
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) {
    score += 8;
    factors.push('x265_codec');
  } else if (/\b(x264|avc|h\.?264)\b/.test(title)) {
    score += 3;
    factors.push('x264_codec');
  }

  // Audio quality bonuses
  if (/\b(atmos|dts.?x)\b/.test(title)) {
    score += 12;
    factors.push('premium_audio');
  } else if (/\b(truehd|dts.?hd|lpcm)\b/.test(title)) {
    score += 8;
    factors.push('high_quality_audio');
  } else if (/\b(dts|dd\+|eac3)\b/.test(title)) {
    score += 4;
    factors.push('good_audio');
  }

  // Release source quality (in order of preference)
  if (/\b(bluray|bd|bdrip|brrip)\b/.test(title)) {
    score += 10;
    factors.push('bluray_source');
  } else if (/\b(webrip|web.?dl)\b/.test(title)) {
    score += 7;
    factors.push('web_source');
  } else if (/\b(dvdrip|dvd)\b/.test(title)) {
    score += 3;
    factors.push('dvd_source');
  } else if (/\b(hdtv|tv|tvrip)\b/.test(title)) {
    score += 1;
    factors.push('tv_source');
  }

  // Reputable release groups (known for quality)
  const premiumGroups = [
    'yts', 'rarbg', 'ettv', 'eztv', 'torrentgalaxy', 'tgx',
    'framestor', 'tigole', 'qxr', 'joy', 'ntg', 'flux'
  ];
  
  if (premiumGroups.some(group => title.includes(`[${group}]`) || title.includes(`-${group}`))) {
    score += 5;
    factors.push('premium_group');
  }

  // File size indicators (very rough quality estimation)
  const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*gb?\b/);
  if (sizeMatch) {
    const sizeGB = parseFloat(sizeMatch[1]);
    
    // For 4K content
    if (score >= 30) { // 4K content
      if (sizeGB >= 15) { score += 8; factors.push('large_4k'); }
      else if (sizeGB >= 8) { score += 4; factors.push('medium_4k'); }
      else if (sizeGB < 3) { score -= 5; factors.push('small_4k'); }
    }
    // For 1080p content  
    else if (score >= 20) { // 1080p content
      if (sizeGB >= 8) { score += 6; factors.push('large_1080p'); }
      else if (sizeGB >= 3) { score += 3; factors.push('medium_1080p'); }
      else if (sizeGB < 1.5) { score -= 3; factors.push('small_1080p'); }
    }
  }

  // Language penalties/bonuses could be added here based on opts.preferredLanguages

  return { 
    score, 
    reason: factors.length > 0 ? factors.join(',') : 'no_quality_detected',
    factors 
  };
}

/**
 * Cookie-based scoring
 * Enhanced: Penalize Nuvio+ streams without valid cookies
 */
function getCookieScore(stream, opts) {
  const hasCookie = stream._usedCookie || 
                    (stream.behaviorHints?.proxyHeaders?.Cookie);
  const isNuvio = stream.autostreamOrigin === 'nuvio';
  
  if (!hasCookie) {
    // Heavy penalty for Nuvio streams without cookies (they likely won't work)
    if (isNuvio) {
      return { score: -400, reason: 'nuvio_no_cookie' };
    }
    return { score: 0, reason: 'no_cookie' };
  }

  // Cookie bonus for streams that actually have cookies
  const cookieBonus = opts.conservativeCookie ? 1 : 3;
  
  return { 
    score: cookieBonus, 
    reason: 'cookie_stream',
    conservative: opts.conservativeCookie 
  };
}

/**
 * Connection quality scoring based on host patterns
 * Enhanced: Torrents get strong preference to ensure they rank above Nuvio+
 */
function getConnectionScore(stream) {
  const url = stream.url || '';
  const hasInfoHash = !!(stream.infoHash);
  const isMagnet = /^magnet:/i.test(url);
  
  // Torrents get strong preference (increased from 20 to 30)
  if (hasInfoHash || isMagnet) {
    return { score: 30, reason: 'torrent_to_debrid' };
  }
  
  if (!url) return { score: 0, reason: 'no_url' };

  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    
    // Known high-quality hosts (bonus)
    const premiumHosts = [
      'drive.google.com',
      'onedrive.live.com', 
      'dropbox.com',
      'mega.nz',
      'archive.org'
    ];
    
    if (premiumHosts.some(p => host.includes(p))) {
      return { score: 25, reason: 'premium_host', host };
    }

    // CDN patterns (bonus)
    const cdnPatterns = [
      /\.cloudfront\.net$/,
      /\.fastly\.com$/,
      /\.amazonaws\.com$/,
      /\.cloudflare\.com$/
    ];
    
    if (cdnPatterns.some(pattern => pattern.test(host))) {
      return { score: 15, reason: 'cdn_host', host };
    }

    // Direct HTTP streams get small bonus (reduced from 5 to 3)
    if (url.startsWith('http')) {
      return { score: 3, reason: 'direct_http' };
    }

    // Known problematic patterns (penalty)
    const problematicPatterns = [
      /^(\d{1,3}\.){3}\d{1,3}$/, // Direct IP
      /:\d{4,5}$/, // Non-standard ports  
      /\.tk$|\.ml$|\.cf$|\.ga$/ // Free TLD domains
    ];
    
    if (problematicPatterns.some(pattern => pattern.test(host))) {
      return { score: -10, reason: 'problematic_host', host };
    }

    return { score: 0, reason: 'neutral_host', host };
    
  } catch (e) {
    return { score: -5, reason: 'invalid_url' };
  }
}

/**
 * Stream type scoring
 */
function getStreamTypeScore(stream) {
  const url = stream.url || '';
  
  // Direct file extensions (bonus)
  if (/\.(mp4|mkv|avi|mov|m4v)(\?|$)/i.test(url)) {
    return { score: 10, reason: 'direct_video_file' };
  }

  // HLS/DASH streams (bonus)
  if (/\.(m3u8|mpd)(\?|$)/i.test(url)) {
    return { score: 15, reason: 'streaming_manifest' };
  }

  // Magnet links (neutral)
  if (url.startsWith('magnet:')) {
    return { score: 0, reason: 'magnet_link' };
  }

  return { score: 0, reason: 'unknown_type' };
}

/**
 * Filter and score streams with penalty-based system
 */
function filterAndScoreStreams(streams, req, opts = {}) {
  if (!Array.isArray(streams)) return [];

  const results = streams.map(stream => {
    const scoring = computeStreamScore(stream, req, opts);
    return {
      ...stream,
      _scoring: scoring,
      _score: scoring.score
    };
  });

  // Sort by score (highest first)
  results.sort((a, b) => b._score - a._score);

  // Log scoring details in debug mode
  if (opts.debug) {
    console.log('\n🎯 Stream Scoring Results:');
    results.slice(0, 5).forEach((stream, i) => {
      const scoring = stream._scoring;
      console.log(`${i + 1}. ${stream.name || 'Unnamed'} (Score: ${scoring.score})`);
      if (scoring.bonuses?.length) console.log(`   Bonuses: ${scoring.bonuses.join(', ')}`);
      if (scoring.penalties?.length) console.log(`   Penalties: ${scoring.penalties.join(', ')}`);
    });
  }

  return results;
}

/**
 * Mark stream failure (adds penalty)
 */
function markStreamFailure(req, url, failureType = 'timeout') {
  penaltyReliability.markFail(url);
  console.log(`❌ Stream failure: ${url} (${failureType})`);
}

/**
 * Mark stream success (reduces penalty if any)
 */
function markStreamSuccess(req, url) {
  penaltyReliability.markOk(url);
  console.log(`✅ Stream success: ${url}`);
}

/**
 * Get seeder score based on magnet URL metadata or title
 */
function getSeederScore(stream) {
  const url = stream.url || stream.externalUrl || '';
  const title = stream.title || '';
  
  // Only check torrents/magnets or streams with seeder info in title
  const hasInfoHash = !!(stream.infoHash);
  const isMagnet = url && /^magnet:/i.test(url);
  
  // Skip if it's not a torrent-related stream
  if (!isMagnet && !hasInfoHash) {
    return { score: 0, reason: 'not_torrent' };
  }
  
  // Try to extract seeder count from URL first, then from title
  let seederText = '';
  if (url) {
    try {
      seederText = decodeURIComponent(url);
    } catch (e) {
      seederText = url;
    }
  }
  
  // If no URL or no seeder info in URL, check title
  if (!seederText || !seederText.includes('👤')) {
    seederText = title;
  }
  
  // Extract seeder count from text
  // Format: "👤 1 💾" - match seeder emoji, number, then file size emoji
  const match = seederText.match(/👤\s*(\d+)\s*💾/);
  if (!match) {
    return { score: 0, reason: 'no_seeder_info' };
  }

  const seeders = parseInt(match[1], 10);
  
  // Heavy penalties for low seeders to prevent showing bad torrents
  if (seeders === 0) {
    return { score: -1000, reason: 'zero_seeders' }; // Effectively exclude
  } else if (seeders < 3) {
    return { score: -300, reason: 'very_low_seeders' }; // Heavy penalty
  } else if (seeders < 5) {
    return { score: -100, reason: 'low_seeders' }; // Moderate penalty
  } else if (seeders < 10) {
    return { score: -20, reason: 'few_seeders' }; // Light penalty
  }
  
  // Good seeder counts get no bonus (base score is already good)
  return { score: 0, reason: 'adequate_seeders' };
}

/**
 * Get stream quality score based on actual stream validation
 * Tests reachability, seekability, content type, size, and throughput
 */
function getStreamQualityScore(stream) {
  const url = stream.url || stream.externalUrl || '';
  const origin = stream.autostreamOrigin;
  
  // Only validate direct HTTP streams (not torrents)
  if (!url || !/^https?:/i.test(url) || origin !== 'nuvio') {
    return { score: 0, reason: 'not_direct_stream' };
  }
  
  // For now, return a placeholder - actual validation would be async
  // This would need to be implemented as a separate validation service
  // that runs probes and caches results with TTL
  
  // Check if this is a cookie stream without proper cookie
  const hasCookie = stream.behaviorHints?.proxyHeaders?.Cookie;
  const isNuvioPlus = stream.name?.includes('Nuvio+') || hasCookie;
  
  if (isNuvioPlus && !hasCookie) {
    // Heavy penalty for Nuvio+ streams without valid cookies
    return { score: -200, reason: 'nuvio_plus_no_cookie' };
  }
  
  // Small penalty for all direct hosts compared to torrents
  // (torrents with good seeders are generally more reliable)
  return { score: -10, reason: 'direct_host_uncertainty' };
}

/**
 * Async stream validation service (placeholder for future implementation)
 * This would perform actual HTTP probes to validate stream quality
 */
async function validateStreamQuality(streamUrl, quality = '1080p') {
  // Implementation would include:
  // 1. HEAD request to check reachability (200/206 good, 403/401/5xx bad)
  // 2. Range request to test seekability (Range: bytes=0-1, expect 206)
  // 3. Content-Type validation (video/* or application/octet-stream good)
  // 4. Size validation (Content-Length check for quality expectations)
  // 5. Throughput test (1-2MB range request with timing)
  // 6. Latency measurement (TTFB)
  // 7. Resume robustness (mid-file range request)
  // 8. Cookie validation if present
  
  return {
    reachable: true,
    seekable: true,
    contentType: 'video/mp4',
    sizeMB: 1500,
    throughputMbps: 12,
    latencyMs: 300,
    resumable: true,
    score: 0 // Calculated based on above metrics
  };
}

// Helper function to check if stream has Nuvio cookie
function hasNuvioCookie(stream) {
  if (!stream.behaviorHints || !stream.behaviorHints.proxyHeaders) {
    return false;
  }
  return !!(stream.behaviorHints.proxyHeaders.Cookie);
}

/**
 * Get reliability statistics
 */
function getReliabilityStats() {
  return {
    penaltySystem: penaltyReliability.getState(),
    timestamp: Date.now()
  };
}

module.exports = {
  computeStreamScore,
  filterAndScoreStreams,
  markStreamFailure,
  markStreamSuccess,
  getReliabilityStats,
  
  // Individual scoring functions for testing
  getQualityScore,
  getCookieScore,
  getConnectionScore,
  getStreamTypeScore
};
