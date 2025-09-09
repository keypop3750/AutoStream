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
 * - Device-aware scoring for TV/Mobile/Web optimization
 */

const penaltyReliability = require('../services/penaltyReliability');

/**
 * Detect device type from request headers
 * @param {Object} req - HTTP request object
 * @returns {string} - 'tv', 'mobile', or 'web'
 */
function detectDeviceType(req) {
  if (!req || !req.headers) return 'web'; // Default fallback
  
  const userAgent = req.headers['user-agent'] || '';
  
  // TV detection patterns (comprehensive)
  if (/\b(smart[-\s]?tv|tizen|webos|vidaa|roku|fire[-\s]?tv|android[-\s]?tv|chromecast|shield\s*android\s*tv|lg\s*browser|samsung.*tizen)\b/i.test(userAgent)) {
    return 'tv';
  }
  
  // Mobile detection patterns (excluding TV)
  if (/\b(android|iphone|ipad|mobile|phone)\b/i.test(userAgent) && 
      !/\b(tv|television|chromecast|shield)\b/i.test(userAgent)) {
    return 'mobile';
  }
  
  // Stremio-specific headers (if they exist in future)
  const stremioDevice = req.headers['stremio-device-type'];
  if (stremioDevice) return stremioDevice.toLowerCase();
  
  return 'web'; // Default to web/desktop
}

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

  // QUALITY SCORING (device-aware, platform-specific)
  const deviceType = detectDeviceType(req);
  const qualityScore = getCompleteQualityScore(stream, deviceType);
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
 * TV-optimized scoring - prioritizes compatibility over efficiency
 */
function getTVQualityScore(title, factors) {
  let score = 0;

  // TV Resolution scoring - TVs handle 4K perfectly, prioritize quality
  if (/\b(2160p|4k|uhd)\b/.test(title)) {
    score += 40; // HIGHEST bonus - 4K is excellent on modern TVs
    factors.push('4k_tv_excellent');
  } else if (/\b(1080p|fhd)\b/.test(title)) {
    score += 30; // Good bonus - standard quality
    factors.push('1080p_tv_standard');
  } else if (/\b(720p|hd)\b/.test(title)) {
    score += 20; // Decent bonus
    factors.push('720p_tv_decent');
  } else if (/\b(480p|sd)\b/.test(title)) {
    score += 10; // Basic quality
    factors.push('480p_tv_basic');
  }

  // TV HDR/DV scoring - cautious approach
  if (/\b(hdr10\+|dolby.?vision|dv)\b/.test(title)) {
    score += 15; // Lower bonus - DV support varies on TVs
    factors.push('dolby_vision_tv_limited');
  } else if (/\bhdr\b/.test(title)) {
    score += 10; // Standard HDR is more widely supported
    factors.push('hdr_tv_standard');
  }

  // TV 10-bit compatibility - major penalty
  if (/\b(10bit|10.?bit|hi10p)\b/.test(title)) {
    score -= 25; // Heavy penalty - many Smart TVs can't handle 10-bit
    factors.push('10bit_tv_incompatible');
  }

  // TV Codec scoring - compatibility is CRITICAL
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) {
    score -= 60; // Massive penalty - primary cause of "video not supported"
    factors.push('x265_tv_major_risk');
  } else if (/\b(x264|avc|h\.?264)\b/.test(title)) {
    score += 40; // Huge bonus - universal TV compatibility
    factors.push('x264_tv_universal');
  }

  // TV Audio scoring - simpler audio usually works better
  if (/\b(atmos|dts.?x)\b/.test(title)) {
    score += 8; // Lower bonus - advanced audio may not work on all TVs
    factors.push('premium_audio_tv_limited');
  } else if (/\b(truehd|dts.?hd|lpcm)\b/.test(title)) {
    score += 12; // Good bonus - widely supported
    factors.push('high_quality_audio_tv');
  } else if (/\b(dts|dd\+|eac3)\b/.test(title)) {
    score += 15; // Higher bonus - standard formats work everywhere
    factors.push('standard_audio_tv_reliable');
  }

  return score;
}

/**
 * Mobile-optimized scoring - balance between quality and efficiency/battery
 */
function getMobileQualityScore(title, factors) {
  let score = 0;

  // Mobile Resolution scoring - balance quality with bandwidth/battery
  if (/\b(2160p|4k|uhd)\b/.test(title)) {
    score += 20; // Lower bonus - 4K drains battery and uses lots of data
    factors.push('4k_mobile_battery_drain');
  } else if (/\b(1080p|fhd)\b/.test(title)) {
    score += 35; // Highest bonus - best balance of quality and efficiency
    factors.push('1080p_mobile_optimal');
  } else if (/\b(720p|hd)\b/.test(title)) {
    score += 25; // Good for mobile screens and data usage
    factors.push('720p_mobile_efficient');
  } else if (/\b(480p|sd)\b/.test(title)) {
    score += 15; // Decent for small screens and low bandwidth
    factors.push('480p_mobile_data_saver');
  }

  // Mobile HDR/DV scoring - many mobile screens support HDR well
  if (/\b(hdr10\+|dolby.?vision|dv)\b/.test(title)) {
    score += 20; // Good bonus - premium mobile devices support DV
    factors.push('dolby_vision_mobile_premium');
  } else if (/\b(hdr)\b/.test(title)) {
    score += 15; // Standard HDR widely supported
    factors.push('hdr_mobile_standard');
  }

  // Mobile 10-bit scoring - modern mobiles handle it well
  if (/\b(10bit|10.?bit|hi10p)\b/.test(title)) {
    score -= 10; // Minor penalty - some older devices struggle
    factors.push('10bit_mobile_older_devices');
  }

  // Mobile Codec scoring - efficiency matters for battery
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) {
    score += 10; // Bonus - efficient codec saves battery
    factors.push('x265_mobile_efficient');
  } else if (/\b(x264|avc|h\.?264)\b/.test(title)) {
    score += 20; // Higher bonus - universal compatibility
    factors.push('x264_mobile_universal');
  }

  // Mobile Audio scoring - mobile speakers are limited anyway
  if (/\b(atmos|dts.?x)\b/.test(title)) {
    score += 15; // Good bonus - premium devices have good speakers
    factors.push('premium_audio_mobile');
  } else if (/\b(truehd|dts.?hd|lpcm)\b/.test(title)) {
    score += 12; // Standard bonus
    factors.push('high_quality_audio_mobile');
  } else if (/\b(dts|dd\+|eac3)\b/.test(title)) {
    score += 8; // Basic bonus
    factors.push('standard_audio_mobile');
  }

  return score;
}

/**
 * Web-optimized scoring - balance between quality and compatibility
 */
function getWebQualityScore(title, factors) {
  let score = 0;

  // Web Resolution scoring - web browsers handle high resolution excellently
  if (/\b(2160p|4k|uhd)\b/.test(title)) {
    score += 40; // HIGHEST bonus - web browsers excel at 4K
    factors.push('4k_web_excellent');
  } else if (/\b(1080p|fhd)\b/.test(title)) {
    score += 30; // Good bonus - standard quality
    factors.push('1080p_web_standard');
  } else if (/\b(720p|hd)\b/.test(title)) {
    score += 20; // Decent bonus
    factors.push('720p_web_decent');
  } else if (/\b(480p|sd)\b/.test(title)) {
    score += 10; // Low bonus - web users expect higher quality
    factors.push('480p_web_low_quality');
  }

  // Web HDR/DV scoring - modern browsers support HDR
  if (/\b(hdr10\+|dolby.?vision|dv)\b/.test(title)) {
    score += 25; // High bonus - modern browsers support advanced HDR
    factors.push('dolby_vision_web_modern');
  } else if (/\b(hdr)\b/.test(title)) {
    score += 20; // Good bonus
    factors.push('hdr_web_supported');
  }

  // Web 10-bit scoring - modern browsers handle it
  if (/\b(10bit|10.?bit|hi10p)\b/.test(title)) {
    score -= 5; // Minor penalty - some compatibility issues
    factors.push('10bit_web_minor_issues');
  }

  // Web Codec scoring - web browsers are flexible
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) {
    score += 5; // Small bonus - efficiency is nice but not critical
    factors.push('x265_web_efficient');
  } else if (/\b(x264|avc|h\.?264)\b/.test(title)) {
    score += 20; // Higher bonus - universal compatibility
    factors.push('x264_web_compatible');
  }

  // Web Audio scoring - web users often have good audio setups
  if (/\b(atmos|dts.?x)\b/.test(title)) {
    score += 20; // High bonus - web users may have premium audio
    factors.push('premium_audio_web');
  } else if (/\b(truehd|dts.?hd|lpcm)\b/.test(title)) {
    score += 15; // Good bonus
    factors.push('high_quality_audio_web');
  } else if (/\b(dts|dd\+|eac3)\b/.test(title)) {
    score += 10; // Standard bonus
    factors.push('standard_audio_web');
  }

  return score;
}

/**
 * Platform-specific source quality scoring
 */
function getSourceQualityScore(title, deviceType, factors) {
  let score = 0;

  // Release source quality - same across all platforms but different weights
  if (/\b(bluray|bd|bdrip|brrip)\b/.test(title)) {
    if (deviceType === 'tv') {
      score += 15; // Higher bonus for TV - BluRay usually has better TV compatibility
      factors.push('bluray_source_tv');
    } else {
      score += 10; // Standard bonus
      factors.push('bluray_source');
    }
  } else if (/\b(webrip|web.?dl)\b/.test(title)) {
    score += 7; // Same across platforms
    factors.push('web_source');
  } else if (/\b(dvdrip|dvd)\b/.test(title)) {
    score += 3; // Same across platforms  
    factors.push('dvd_source');
  } else if (/\b(hdtv|tv|tvrip)\b/.test(title)) {
    score += 1; // Same across platforms
    factors.push('tv_source');
  }

  return score;
}

/**
 * Platform-specific container format scoring
 */
function getContainerScore(title, deviceType, factors) {
  let score = 0;

  if (/\.mp4\b/.test(title)) {
    if (deviceType === 'tv') {
      score += 25; // Maximum bonus for TV - MP4 is universally supported
      factors.push('mp4_tv_perfect_compat');
    } else if (deviceType === 'mobile') {
      score += 20; // Good for mobile - efficient streaming
      factors.push('mp4_mobile_efficient');
    } else {
      score += 15; // Standard bonus for web
      factors.push('mp4_web_standard');
    }
  } else if (/\.mkv\b/.test(title)) {
    if (deviceType === 'tv') {
      score -= 20; // Strong penalty for TV - MKV support varies significantly
      factors.push('mkv_tv_major_risk');
    } else if (deviceType === 'mobile') {
      score -= 10; // Moderate penalty for mobile - can be problematic
      factors.push('mkv_mobile_issues');
    } else {
      score -= 5; // Light penalty for web - usually works but not optimal
      factors.push('mkv_web_minor_issues');
    }
  } else if (/\.avi\b/.test(title)) {
    if (deviceType === 'tv') {
      score += 15; // Good for TV - older but very compatible format
      factors.push('avi_tv_legacy_compat');
    } else {
      score += 8; // Standard compatibility for other platforms
      factors.push('avi_standard_compat');
    }
  }

  return score;
}

/**
 * Integrate all platform-specific quality scoring components
 */
function getCompleteQualityScore(stream, deviceType) {
  const title = ((stream.title || '') + ' ' + (stream.name || '')).toLowerCase();
  const factors = [];
  
  // Get core quality score for the platform
  let score = 0;
  if (deviceType === 'tv') {
    score = getTVQualityScore(title, factors);
  } else if (deviceType === 'mobile') {
    score = getMobileQualityScore(title, factors);
  } else {
    score = getWebQualityScore(title, factors);
  }
  
  // Add platform-specific source quality scoring
  score += getSourceQualityScore(title, deviceType, factors);
  
  // Add platform-specific container scoring
  score += getContainerScore(title, deviceType, factors);
  
  // Add release group scoring (platform-specific)
  score += getReleaseGroupScore(title, deviceType, factors);
  
  // Add file size estimation (platform-specific)
  score += getFileSizeScore(title, deviceType, factors);
  
  return { 
    score, 
    reason: factors.length > 0 ? factors.join(',') : 'no_quality_detected',
    factors 
  };
}

/**
 * Platform-specific release group scoring
 */
function getReleaseGroupScore(title, deviceType, factors) {
  let score = 0;
  
  const premiumGroups = ['yts', 'ettv', 'eztv', 'torrentgalaxy', 'tgx', 'framestor', 'tigole', 'qxr', 'joy', 'ntg', 'flux'];
  const problematicGroups = ['rarbg']; // Known for encoding issues
  
  if (premiumGroups.some(group => title.includes(`[${group}]`) || title.includes(`-${group}`))) {
    if (deviceType === 'tv') {
      score += 12; // Higher bonus for TV - these groups usually have good TV compatibility
      factors.push('premium_group_tv');
    } else {
      score += 8; // Standard bonus
      factors.push('premium_group');
    }
  } else if (problematicGroups.some(group => title.includes(`[${group}]`) || title.includes(`-${group}`))) {
    if (deviceType === 'tv') {
      score -= 15; // Stronger penalty for TV - compatibility issues more critical
      factors.push('problematic_group_tv');
    } else {
      score -= 10; // Standard penalty
      factors.push('problematic_group');
    }
  }
  
  return score;
}

/**
 * Platform-specific file size scoring
 */
function getFileSizeScore(title, deviceType, factors) {
  let score = 0;
  
  const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*gb?\b/);
  if (sizeMatch) {
    const sizeGB = parseFloat(sizeMatch[1]);
    
    // Size scoring depends on resolution and platform
    const is4K = /\b(2160p|4k|uhd)\b/.test(title);
    const is1080p = /\b(1080p|fhd)\b/.test(title);
    
    if (is4K) {
      if (deviceType === 'mobile') {
        // Mobile users may prefer smaller 4K files to save data/battery
        if (sizeGB >= 20) { score -= 5; factors.push('large_4k_mobile_data'); }
        else if (sizeGB >= 10) { score += 5; factors.push('optimal_4k_mobile'); }
        else if (sizeGB < 5) { score -= 3; factors.push('small_4k_mobile'); }
      } else {
        // TV/Web users generally want higher quality 4K
        if (sizeGB >= 15) { score += 8; factors.push('large_4k_quality'); }
        else if (sizeGB >= 8) { score += 4; factors.push('medium_4k'); }
        else if (sizeGB < 3) { score -= 5; factors.push('small_4k_poor'); }
      }
    } else if (is1080p) {
      if (deviceType === 'mobile') {
        // Mobile 1080p size preferences
        if (sizeGB >= 6) { score += 3; factors.push('good_1080p_mobile'); }
        else if (sizeGB >= 2) { score += 6; factors.push('optimal_1080p_mobile'); }
        else if (sizeGB < 1) { score -= 3; factors.push('small_1080p_mobile'); }
      } else {
        // TV/Web 1080p size preferences  
        if (sizeGB >= 8) { score += 6; factors.push('large_1080p_quality'); }
        else if (sizeGB >= 3) { score += 3; factors.push('medium_1080p'); }
        else if (sizeGB < 1.5) { score -= 3; factors.push('small_1080p_poor'); }
      }
    }
  }
  
  return score;
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
  detectDeviceType,
  
  // Individual scoring functions for testing
  getCompleteQualityScore,
  getCookieScore,
  getConnectionScore,
  getStreamTypeScore
};
