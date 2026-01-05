/**
 * scoring_v6.js
 * Simplified scoring with penalty-based reliability system
 * 
 * Features:
 * - Penalty-based reliability (no permanent exclusion, no cooldowns)
 if (/\b(x265|hevc|h\.?265)\b/.test(title)) {
 if (deviceType === 'tv') {
 // Android TV prefers x264 but x265 4K should still beat x264 1080p
 // Reduced penalty from -15 to -5 to allow x265 4K streams
 score -= 5;
 factors.push('x265_codec_tv_penalty');
 } else {
 // Other devices handle x265 well - small bonus for efficiency
 score += 8;
 factors.push('x265_codec');
 }
 } else if (/\b(x264|avc|h\.?264)\b/.test(title)) {/resolution scoring 
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
 if (/\b(smart[-\s]?tv|tizen|webos|vidaa|roku|fire[-\s]?tv|android[-\s]?tv|chromecast|shield\s*android\s*tv|lg\s*browser|samsung.*tizen|aosp\s*tv|android.*tv|tv.*android)\b/i.test(userAgent)) {
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
 // Use specialized Comet scoring for Comet streams
 if (stream.autostreamOrigin === 'comet') {
 return computeCometStreamScore(stream, req, opts);
 }
 
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

 // QUALITY SCORING (device-aware for codec compatibility)
 const qualityScore = getQualityScore(stream, req);
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
 * ============================================================================
 * COMET-SPECIFIC SCORING SYSTEM
 * ============================================================================
 * Comet returns pre-resolved debrid streams with rich metadata in description.
 * This scoring system extracts and scores based on:
 * - Resolution (from name/filename)
 * - Audio quality (Atmos, TrueHD, DTS-X, etc.)
 * - Video codec (HEVC, HDR, DV)
 * - Source type (BluRay REMUX > WEB-DL > WEBRip > HDRip)
 * - File size (larger = better quality, with diminishing returns)
 * - Release group reputation
 * - Language availability
 */
function computeCometStreamScore(stream, req, opts = {}) {
 const url = stream.url || '';
 if (!url) {
 return { score: 0, reason: 'no_url', breakdown: {} };
 }

 let score = 850; // Higher base for Comet (pre-resolved debrid)
 let penalties = [];
 let bonuses = [];
 const breakdown = {};

 // Extract all text for analysis
 const filename = stream.behaviorHints?.filename || '';
 const description = stream.description || '';
 const name = stream.name || '';
 const allText = `${filename} ${description} ${name}`.toLowerCase();

 // === RESOLUTION SCORING (0-80 points) ===
 const resolutionScore = getCometResolutionScore(name, filename, allText);
 score += resolutionScore.score;
 breakdown.resolution = resolutionScore;
 if (resolutionScore.score > 0) bonuses.push(`resolution(+${resolutionScore.score})`);

 // === VIDEO QUALITY SCORING (0-50 points) ===
 const videoScore = getCometVideoScore(allText);
 score += videoScore.score;
 breakdown.video = videoScore;
 if (videoScore.score > 0) bonuses.push(`video(+${videoScore.score})`);
 if (videoScore.score < 0) penalties.push(`video(${videoScore.score})`);

 // === AUDIO QUALITY SCORING (0-40 points) ===
 const audioScore = getCometAudioScore(allText, description);
 score += audioScore.score;
 breakdown.audio = audioScore;
 if (audioScore.score > 0) bonuses.push(`audio(+${audioScore.score})`);

 // === SOURCE TYPE SCORING (0-60 points) ===
 const sourceScore = getCometSourceScore(allText);
 score += sourceScore.score;
 breakdown.source = sourceScore;
 if (sourceScore.score > 0) bonuses.push(`source(+${sourceScore.score})`);
 if (sourceScore.score < 0) penalties.push(`source(${sourceScore.score})`);

 // === FILE SIZE SCORING (0-30 points) ===
 const sizeScore = getCometSizeScore(stream.behaviorHints?.videoSize, allText);
 score += sizeScore.score;
 breakdown.size = sizeScore;
 if (sizeScore.score > 0) bonuses.push(`size(+${sizeScore.score})`);
 if (sizeScore.score < 0) penalties.push(`size(${sizeScore.score})`);

 // === RELEASE GROUP SCORING (-20 to +25 points) ===
 const groupScore = getCometReleaseGroupScore(filename);
 score += groupScore.score;
 breakdown.group = groupScore;
 if (groupScore.score > 0) bonuses.push(`group(+${groupScore.score})`);
 if (groupScore.score < 0) penalties.push(`group(${groupScore.score})`);

 // === LANGUAGE SCORING (0-15 points) ===
 const langScore = getCometLanguageScore(allText, description, opts);
 score += langScore.score;
 breakdown.language = langScore;
 if (langScore.score > 0) bonuses.push(`language(+${langScore.score})`);

 // === DEBRID PROVIDER BONUS (always +35 for Comet) ===
 score += 35;
 bonuses.push('debrid_resolved(+35)');
 breakdown.debrid = { score: 35, reason: 'comet_debrid' };

 return {
 score,
 reason: 'comet_scored',
 penalties,
 bonuses,
 breakdown
 };
}

/**
 * Comet Resolution Scoring
 */
function getCometResolutionScore(name, filename, allText) {
 // Check name first (e.g., "[AD⚡] Comet 2160p")
 if (/2160p|4k|uhd/i.test(name) || /2160p|4k|uhd/i.test(filename)) {
 return { score: 80, reason: '4k', source: 'name/filename' };
 }
 if (/1080p|fhd/i.test(name) || /1080p|fhd/i.test(filename)) {
 return { score: 50, reason: '1080p', source: 'name/filename' };
 }
 if (/720p|hd(?!r)/i.test(name) || /720p/i.test(filename)) {
 return { score: 25, reason: '720p', source: 'name/filename' };
 }
 if (/480p|sd/i.test(allText)) {
 return { score: 5, reason: '480p', source: 'text' };
 }
 // Fallback: check all text
 if (/2160p|4k|uhd/i.test(allText)) return { score: 80, reason: '4k', source: 'text' };
 if (/1080p/i.test(allText)) return { score: 50, reason: '1080p', source: 'text' };
 if (/720p/i.test(allText)) return { score: 25, reason: '720p', source: 'text' };
 
 return { score: 0, reason: 'unknown' };
}

/**
 * Comet Video Quality Scoring (HDR, DV, codec)
 */
function getCometVideoScore(allText) {
 let score = 0;
 const factors = [];

 // HDR formats (cumulative)
 if (/dolby.?vision|dovi|\bdv\b/i.test(allText)) {
 score += 25;
 factors.push('dolby_vision');
 }
 if (/hdr10\+/i.test(allText)) {
 score += 20;
 factors.push('hdr10+');
 } else if (/\bhdr\b/i.test(allText)) {
 score += 15;
 factors.push('hdr');
 }

 // Bit depth
 if (/10.?bit/i.test(allText)) {
 score += 5;
 factors.push('10bit');
 }

 // Codec (HEVC preferred for efficiency, but not penalized)
 if (/hevc|h\.?265|x265/i.test(allText)) {
 score += 5;
 factors.push('hevc');
 } else if (/avc|h\.?264|x264/i.test(allText)) {
 score += 0; // Neutral
 factors.push('avc');
 }

 // Hybrid releases (combined DV+HDR)
 if (/hybrid/i.test(allText)) {
 score += 5;
 factors.push('hybrid');
 }

 return { score, reason: factors.join('+') || 'standard', factors };
}

/**
 * Comet Audio Quality Scoring
 */
function getCometAudioScore(allText, description) {
 let score = 0;
 const factors = [];

 // Premium audio formats
 if (/atmos/i.test(allText)) {
 score += 40;
 factors.push('atmos');
 } else if (/truehd/i.test(allText)) {
 score += 35;
 factors.push('truehd');
 } else if (/dts[-.]?x/i.test(allText)) {
 score += 35;
 factors.push('dts-x');
 } else if (/dts[-.]?hd/i.test(allText)) {
 score += 30;
 factors.push('dts-hd');
 } else if (/flac|lpcm/i.test(allText)) {
 score += 25;
 factors.push('lossless');
 } else if (/eac3|ddp|dd\+|dolby.?digital.?plus/i.test(allText)) {
 score += 20;
 factors.push('ddp');
 } else if (/dts(?![-.]?hd|[-.]?x)/i.test(allText)) {
 score += 15;
 factors.push('dts');
 } else if (/ac3|dolby.?digital/i.test(allText)) {
 score += 10;
 factors.push('ac3');
 } else if (/aac/i.test(allText)) {
 score += 5;
 factors.push('aac');
 }

 // Channel count bonus
 if (/7\.1/i.test(allText)) {
 score += 5;
 factors.push('7.1ch');
 } else if (/5\.1/i.test(allText)) {
 score += 3;
 factors.push('5.1ch');
 }

 return { score, reason: factors.join('+') || 'standard', factors };
}

/**
 * Comet Source Type Scoring
 */
function getCometSourceScore(allText) {
 // Premium sources (highest quality)
 if (/remux/i.test(allText)) {
 return { score: 60, reason: 'remux' };
 }
 if (/blu[-.]?ray|bdremux|bdrip/i.test(allText) && !/remux/i.test(allText)) {
 return { score: 45, reason: 'bluray' };
 }
 
 // WEB sources (common for new releases)
 if (/web[-.]?dl/i.test(allText)) {
 return { score: 35, reason: 'web-dl' };
 }
 if (/\bweb\b/i.test(allText) && !/webrip/i.test(allText)) {
 return { score: 30, reason: 'web' };
 }
 if (/webrip/i.test(allText)) {
 return { score: 25, reason: 'webrip' };
 }
 
 // TV sources
 if (/hdtv/i.test(allText)) {
 return { score: 15, reason: 'hdtv' };
 }
 
 // Low quality sources (penalty)
 if (/hdcam|cam|ts|telesync|telecine|scr|screener|dvdscr/i.test(allText)) {
 return { score: -50, reason: 'cam/screener' };
 }
 if (/hdrip|hd[-.]?rip/i.test(allText)) {
 return { score: 10, reason: 'hdrip' };
 }

 return { score: 0, reason: 'unknown' };
}

/**
 * Comet File Size Scoring
 * Larger files generally = better quality, with diminishing returns
 */
function getCometSizeScore(videoSize, allText) {
 if (!videoSize || videoSize <= 0) {
 // Try to extract from description (e.g., "💾 22.8 GB")
 const sizeMatch = allText.match(/(\d+(?:\.\d+)?)\s*(gb|mb|tb)/i);
 if (sizeMatch) {
 const size = parseFloat(sizeMatch[1]);
 const unit = sizeMatch[2].toLowerCase();
 if (unit === 'tb') videoSize = size * 1024 * 1024 * 1024 * 1024;
 else if (unit === 'gb') videoSize = size * 1024 * 1024 * 1024;
 else if (unit === 'mb') videoSize = size * 1024 * 1024;
 }
 }
 
 if (!videoSize || videoSize <= 0) {
 return { score: 0, reason: 'unknown_size' };
 }

 const sizeGB = videoSize / (1024 * 1024 * 1024);
 
 // Scoring based on file size (for movies)
 if (sizeGB >= 50) return { score: 30, reason: 'massive', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 30) return { score: 25, reason: 'very_large', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 15) return { score: 20, reason: 'large', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 8) return { score: 15, reason: 'medium_large', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 4) return { score: 10, reason: 'medium', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 2) return { score: 5, reason: 'small', sizeGB: sizeGB.toFixed(1) };
 if (sizeGB >= 1) return { score: 0, reason: 'very_small', sizeGB: sizeGB.toFixed(1) };
 
 // Very small files are likely low quality
 return { score: -10, reason: 'tiny', sizeGB: sizeGB.toFixed(1) };
}

/**
 * Comet Release Group Scoring
 * Trusted groups get bonus, known bad groups get penalty
 */
function getCometReleaseGroupScore(filename) {
 // Extract release group (typically at end before extension)
 const groupMatch = filename.match(/[-.]([A-Za-z0-9]+)(?:\.[a-z]{2,4})?$/i);
 const group = groupMatch ? groupMatch[1].toUpperCase() : '';
 
 // Premium/trusted release groups
 const premiumGroups = [
 'SPARKS', 'GECKOS', 'TERMINAL', 'FLUX', 'CMRG', 'EVO', 'RARBG',
 'FRAMESTOR', 'EPSILON', 'NAHOM', 'TEPES', 'PLAYREADY', 'HIFI',
 'DON', 'BMF', 'W4NK3R', 'EDPH', 'TayTo', 'REMUX', 'FGT'
 ];
 
 // Good groups
 const goodGroups = [
 'YIFY', 'YTS', 'AOC', 'SYNCOPY', 'NTRODUCTION', 'FW', 'AMZN',
 'NTG', 'SiGMA', 'ETHEL', 'MZABI', 'NTb', 'STRIFE', 'RUMOUR'
 ];
 
 // Problematic groups (cam, low quality)
 const badGroups = [
 'BONE', 'PTNK', 'EXT', 'BLURRY', 'KIRA', 'ARTIFACT'
 ];

 if (premiumGroups.includes(group)) {
 return { score: 25, reason: 'premium_group', group };
 }
 if (goodGroups.includes(group)) {
 return { score: 10, reason: 'good_group', group };
 }
 if (badGroups.includes(group)) {
 return { score: -20, reason: 'bad_group', group };
 }
 
 return { score: 0, reason: 'unknown_group', group };
}

/**
 * Comet Language Scoring
 * Bonus for multi-language, user's preferred language
 */
function getCometLanguageScore(allText, description, opts) {
 let score = 0;
 const factors = [];
 
 // Multi-language bonus
 if (/multi/i.test(allText) || /dual/i.test(allText)) {
 score += 10;
 factors.push('multi_language');
 }
 
 // Check for subtitles
 if (/\bsub\b/i.test(allText) || /subtitle/i.test(allText)) {
 score += 5;
 factors.push('has_subtitles');
 }
 
 // Language flags in description (🇬🇧/🇮🇹 etc)
 if (/🇬🇧|🇺🇸|english|\ben\b/i.test(description)) {
 factors.push('english');
 }
 
 return { score, reason: factors.join('+') || 'standard', factors };
}

/**
 * Quality-based scoring with detailed differentiation (device-agnostic)
 * Based on the working old version - same scoring for all devices
 */
function getQualityScore(stream, req) {
 const title = ((stream.title || '') + ' ' + (stream.name || '')).toLowerCase();
 let score = 0;
 const factors = [];

 // Base resolution scoring - increased 4K bonus to compete with seeder penalties
 if (/\b(2160p|4k|uhd)\b/.test(title)) {
 score += 60; // Increased from 30 to better compete with seeder penalties
 factors.push('4k_base');
 } else if (/\b(1080p|fhd)\b/.test(title)) {
 score += 30; // Increased from 20
 factors.push('1080p_base');
 } else if (/\b(720p|hd)\b/.test(title)) {
 score += 15; // Increased from 10
 factors.push('720p_base');
 } else if (/\b(480p|sd)\b/.test(title)) {
 score += 5;
 factors.push('480p_base');
 }

 // HDR/DV handling - device-aware (these require specific hardware)
 const deviceType = detectDeviceType(req);
 
 if (deviceType === 'tv') {
 // On TV: HDR/DV can be risky if TV doesn't support it
 // Apply smaller bonuses since not all TVs support these
 if (/\b(dolby.?vision|dovi|dv)\b/i.test(title)) {
 score += 5; // Reduced from 15 - DV requires specific hardware
 factors.push('dolby_vision_tv');
 } else if (/\bhdr10\+/i.test(title)) {
 score += 3; // HDR10+ requires specific hardware
 factors.push('hdr10plus_tv');
 } else if (/\bhdr/i.test(title)) {
 score += 5; // Basic HDR10 is more widely supported
 factors.push('hdr_tv');
 }
 } else {
 // On other devices: full HDR/DV bonuses
 if (/\b(hdr10\+|dolby.?vision|dovi|dv)\b/i.test(title)) {
 score += 15;
 factors.push('dolby_vision');
 } else if (/\bhdr\b/i.test(title)) {
 score += 10;
 factors.push('hdr');
 }
 }

 // ============================================================
 // CODEC HANDLING - RISK-FACTOR BASED (not blanket penalties)
 // ============================================================
 // x265/HEVC itself is fine on modern TVs. The REAL issues are:
 // - 10-bit color depth (requires Main 10 profile)
 // - MKV container (some TVs struggle with demuxing)
 // - Lossless audio (TrueHD/DTS-HD)
 // - Very high bitrate REMUXes
 // ============================================================
 
 const isHEVC = /\b(x265|hevc|h\.?265)\b/i.test(title);
 const isAVC = /\b(x264|avc|h\.?264)\b/i.test(title);
 
 if (isHEVC) {
 if (deviceType === 'tv') {
 // BASE: x265 is neutral on TV (modern TVs handle it)
 // Apply risk-factor penalties for problematic combinations
 
 // 10-bit color depth - requires Main 10 profile hardware support
 if (/\b(10bit|10-bit|hi10|hi10p|main\s*10)\b/i.test(title)) {
 score -= 10;
 factors.push('hevc_10bit_tv_risk');
 }
 
 // 4K REMUX - very high bitrate, may stutter
 if (/\b(2160p|4k|uhd)\b/i.test(title) && /\bremux\b/i.test(title)) {
 score -= 10;
 factors.push('hevc_4k_remux_tv_risk');
 }
 
 // Safe x265: MP4 container or WEB-DL source = bonus
 if (/\.mp4\b/i.test(title) || /\bmp4\b/i.test(title)) {
 score += 5;
 factors.push('hevc_mp4_safe');
 } else if (/\bweb-?dl\b/i.test(title)) {
 score += 3;
 factors.push('hevc_webdl_safe');
 }
 } else {
 // Non-TV devices handle x265 well - efficiency bonus
 score += 8;
 factors.push('x265_codec');
 }
 } else if (isAVC) {
 if (deviceType === 'tv') {
 // x264 is universally compatible - bonus on TV
 score += 8;
 factors.push('x264_codec_tv_bonus');
 } else {
 score += 3;
 factors.push('x264_codec');
 }
 }
 
 // CONTAINER FORMAT - Additional penalties (separate from codec)
 if (deviceType === 'tv') {
 if (/\.mkv\b/i.test(title) || /\bmkv\b/i.test(title)) {
 // MKV penalty - but only if also HEVC (compound risk)
 if (isHEVC) {
 score -= 5;
 factors.push('hevc_mkv_container_risk');
 }
 }
 }
 
 // PROBLEMATIC AUDIO - May fail on devices without proper passthrough
 if (deviceType === 'tv') {
 if (/\b(truehd|dts-?hd|dts\.hd|lpcm)\b/i.test(title)) {
 score -= 5;
 factors.push('lossless_audio_tv_risk');
 }
 }

 // Audio quality bonuses
 if (/\b(atmos|dts.?x)\b/.test(title)) {
 score += 12;
 factors.push('premium_audio');
 } else if (/\b(truehd|dts.?hd|lpcm)\b/.test(title)) {
 score += 8;
 factors.push('high_quality_audio');
 } else if (/\b(dd\+|eac3|ac3)\b/.test(title)) {
 score += 4;
 factors.push('standard_audio');
 }

 // SUBTITLE DETECTION - minor bonus for streams with subtitles
 // Stremio has OpenSubtitles integration, so subtitle scoring is just a tie-breaker
 // Using conservative patterns to avoid false positives
 // Note: [\s.\-_]* matches separators like space, dot, dash, underscore
 if (/\b(subtitles?|subtitled|english[\s.\-_]*sub|multi[\s.\-_]*sub|multisub)\b/i.test(title)) {
 score += 3;
 factors.push('has_subtitles');
 } else if (/\b(hardcoded|hardsub|hc)\b/i.test(title)) {
 // Hardcoded subs are less desirable
 score += 1;
 factors.push('hardcoded_subs');
 }
 
 // Penalty for streams explicitly marked as having no subs
 if (/\b(nosub|no[\s\-]?subs?|raw)\b/i.test(title)) {
 score -= 5;
 factors.push('no_subtitles_penalty');
 }

 // Release source quality (in order of preference)
 if (/\b(bluray|bd|bdrip|brrip)\b/.test(title)) {
 score += 10;
 factors.push('bluray_source');
 } else if (/\b(webrip|web.?dl)\b/.test(title)) {
 score += 8;
 factors.push('web_source');
 } else if (/\b(hdtv|hdtvrip)\b/.test(title)) {
 score += 6;
 factors.push('hdtv_source');
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

 // File size indicators (detailed quality estimation based on resolution)
 const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*gb?\b/);
 if (sizeMatch) {
 const sizeGB = parseFloat(sizeMatch[1]);
 
 // For 4K content (30+ score)
 if (score >= 30) {
 if (sizeGB >= 15) { score += 8; factors.push('optimal_4k_size'); }
 else if (sizeGB >= 8) { score += 4; factors.push('good_4k_size'); }
 else if (sizeGB < 3) { score -= 5; factors.push('small_4k_size'); }
 }
 // For 1080p content (20+ score) 
 else if (score >= 20) {
 if (sizeGB >= 8) { score += 6; factors.push('optimal_1080p_size'); }
 else if (sizeGB >= 3) { score += 3; factors.push('good_1080p_size'); }
 else if (sizeGB < 1.5) { score -= 3; factors.push('small_1080p_size'); }
 }
 // For 720p content (10+ score)
 else if (score >= 10) {
 if (sizeGB >= 4) { score += 4; factors.push('optimal_720p_size'); }
 else if (sizeGB >= 1.5) { score += 2; factors.push('good_720p_size'); }
 else if (sizeGB < 0.8) { score -= 2; factors.push('small_720p_size'); }
 }
 }

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
 * Enhanced: Torrents and debrid-resolved streams get preference
 */
function getConnectionScore(stream) {
 const url = stream.url || '';
 const hasInfoHash = !!(stream.infoHash);
 const isMagnet = /^magnet:/i.test(url);
 
 // Torrents get strong preference (they'll be resolved via debrid)
 if (hasInfoHash || isMagnet) {
 return { score: 30, reason: 'torrent_to_debrid' };
 }
 
 // Comet/debrid-resolved streams get strong preference (already resolved HTTP from debrid)
 const isDebridResolved = stream._isDebrid || stream._debrid || stream.autostreamOrigin === 'comet';
 if (isDebridResolved && url.startsWith('http')) {
 return { score: 35, reason: 'debrid_resolved_http' };
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
 console.log('\n[TARGET] Stream Scoring Results:');
 results.slice(0, 5).forEach((stream, i) => {
 const scoring = stream._scoring;
 console.log(`${i + 1}. ${stream.name || 'Unnamed'} (Score: ${scoring.score})`);
 if (scoring.bonuses?.length) console.log(` Bonuses: ${scoring.bonuses.join(', ')}`);
 if (scoring.penalties?.length) console.log(` Penalties: ${scoring.penalties.join(', ')}`);
 });
 }

 return results;
}

/**
 * Mark stream failure (adds penalty)
 */
function markStreamFailure(req, url, failureType = 'timeout') {
 penaltyReliability.markFail(url);
 console.log(`[FAIL] Stream failure: ${url} (${failureType})`);
}

/**
 * Mark stream success (reduces penalty if any)
 */
function markStreamSuccess(req, url) {
 penaltyReliability.markOk(url);
 console.log(`[OK] Stream success: ${url}`);
}

/**
 * Get seeder score based on magnet URL metadata or title
 * 
 * DESIGN PHILOSOPHY: Never hide streams due to low seeders alone.
 * Low seeder streams should still appear but rank lower than high seeder streams.
 * Only truly broken (0 seeders) get meaningful penalty, but still show.
 * 
 * User's preference: "never not show streams unless CAM/480p"
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
 if (!seederText || !seederText.includes('')) {
 seederText = title;
 }
 
 // Extract seeder count from text
 // Format: " 1 [SAVE]" - match seeder emoji, number, then file size emoji
 const match = seederText.match(/\s*(\d+)\s*[SAVE]/);
 if (!match) {
 return { score: 0, reason: 'no_seeder_info' };
 }

 const seeders = parseInt(match[1], 10);
 
 // GRADUAL SEEDER SCORING CURVE
 // Philosophy: seeders matter for reliability but shouldn't dominate quality
 // Quality bonuses: 4K=+60, 1080p=+30, 720p=+20
 // Seeder range: -50 to +15 (never eliminates high quality streams)
 
 if (seeders === 0) {
 // Zero seeders = likely dead, but might work with debrid cache
 // -50 is significant but won't eliminate 4K (+60-50=+10 still positive)
 return { score: -50, reason: 'zero_seeders' };
 } else if (seeders === 1) {
 // Single seeder = could be fast uploader or slow peer
 // -25 is moderate - 4K/1 seeder (+60-25=+35) still beats 1080p/10 seeders (+30+5=+35)
 return { score: -25, reason: 'one_seeder' };
 } else if (seeders === 2) {
 // 2 seeders = minimal swarm
 return { score: -15, reason: 'two_seeders' };
 } else if (seeders < 5) {
 // 3-4 seeders = small but functional swarm
 return { score: -8, reason: 'few_seeders' };
 } else if (seeders < 10) {
 // 5-9 seeders = decent availability
 return { score: -3, reason: 'low_seeders' };
 } else if (seeders < 20) {
 // 10-19 seeders = good availability
 return { score: 0, reason: 'adequate_seeders' };
 } else if (seeders < 50) {
 // 20-49 seeders = healthy swarm
 return { score: 5, reason: 'good_seeders' };
 } else if (seeders < 100) {
 // 50-99 seeders = popular torrent
 return { score: 10, reason: 'many_seeders' };
 }
 
 // 100+ seeders = very popular, fast download guaranteed
 return { score: 15, reason: 'excellent_seeders' };
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
 getQualityScore,
 getCookieScore,
 getConnectionScore,
 getStreamTypeScore
};
