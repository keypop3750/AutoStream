'use strict';

/**
 * Enhanced stream formatting with beautification
 */

function normaliseQuality(quality) {
 if (!quality) return '';
 
 const q = quality.toString().toLowerCase();
 
 // Normalize common quality strings
 if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return '4K';
 if (q.includes('1080')) return '1080p';
 if (q.includes('720')) return '720p';
 if (q.includes('480')) return '480p';
 if (q.includes('hdr')) return 'HDR';
 if (q.includes('dv') || q.includes('dolby')) return 'DV';
 
 return quality;
}

function extractResolution(stream) {
 // Check multiple places for resolution info
 // IMPORTANT: Check _originalMetadata first as beautification may strip resolution from current fields
 const originalMeta = stream._originalMetadata || {};
 const title = originalMeta.originalTitle || stream.title || '';
 const name = originalMeta.originalName || stream.name || '';
 const description = originalMeta.originalDescription || stream.description || '';
 const filename = stream.behaviorHints?.filename || originalMeta.filename || stream.filename || '';
 const tag = stream.tag || '';
 
 const text = `${title} ${name} ${description} ${filename} ${tag}`.toLowerCase();
 
 // Check for explicit resolution markers (most specific first)
 if (/\b(2160p|2160|4k|uhd)\b/i.test(text)) return '4K';
 if (/\b(1440p|1440|2k|qhd)\b/i.test(text)) return '2K';
 if (/\b(1080p|1080|full\s*hd|fhd)\b/i.test(text)) return '1080p';
 if (/\b(720p|720|hd)\b/i.test(text)) return '720p'; 
 if (/\b(480p|480|sd)\b/i.test(text)) return '480p';
 
 // Fallback: Use resOf-style detection logic directly here
 if (/\b(2160p|2160|4k|uhd)\b/.test(text)) return '4K';
 if (/\b(1080p|1080|fhd)\b/.test(text)) return '1080p';
 if (/\b(720p|720|hd)\b/.test(text)) return '720p';
 if (/\b(480p|480|sd)\b/.test(text)) return '480p';
 
 // Final fallback - no resolution detected, return empty string
 return '';
}

function extractQualityTags(stream) {
 const text = `${stream.title || ''} ${stream.name || ''}`;
 const tags = [];
 
 // HDR variants
 if (/\bdolby\s*vision\b/i.test(text) || /\bdv\b/i.test(text)) {
 tags.push('DV');
 } else if (/\bhdr10\+/i.test(text)) {
 tags.push('HDR10+');
 } else if (/\bhdr/i.test(text)) {
 tags.push('HDR');
 }
 
 // Audio quality
 if (/\batmos\b/i.test(text)) {
 tags.push('Atmos');
 } else if (/\bdts-x\b/i.test(text)) {
 tags.push('DTS-X');
 }
 
 return tags;
}

/**
 * Extract video codec from stream metadata
 * @param {Object} stream - Stream object
 * @returns {string} Codec identifier (HEVC, x264, AV1, etc.) or empty string
 */
function extractCodec(stream) {
 const title = stream.title || '';
 const name = stream.name || '';
 const filename = stream.behaviorHints?.filename || stream._originalMetadata?.filename || '';
 const desc = stream.description || stream._originalMetadata?.originalDescription || '';
 const text = `${title} ${name} ${filename} ${desc}`.toLowerCase();
 
 // Check for specific codecs (order matters - more specific first)
 if (/\b(x265|h\.?265|hevc)\b/i.test(text)) return 'HEVC';
 if (/\b(x264|h\.?264|avc)\b/i.test(text)) return 'x264';
 if (/\bav1\b/i.test(text)) return 'AV1';
 if (/\bvp9\b/i.test(text)) return 'VP9';
 if (/\bxvid\b/i.test(text)) return 'XviD';
 if (/\bdivx\b/i.test(text)) return 'DivX';
 
 return '';
}

/**
 * Extract source quality type (WEB-DL, BluRay, etc.)
 * @param {Object} stream - Stream object
 * @returns {string} Source quality type or empty string
 */
function extractSourceQuality(stream) {
 const title = stream.title || '';
 const name = stream.name || '';
 const filename = stream.behaviorHints?.filename || stream._originalMetadata?.filename || '';
 const desc = stream.description || stream._originalMetadata?.originalDescription || '';
 const text = `${title} ${name} ${filename} ${desc}`;
 
 // Check for source quality markers
 if (/\b(web-?dl)\b/i.test(text)) return 'WEB-DL';
 if (/\b(webrip)\b/i.test(text)) return 'WEBRip';
 if (/\b(blu-?ray|bdrip|brrip)\b/i.test(text)) return 'BluRay';
 if (/\b(hdtv)\b/i.test(text)) return 'HDTV';
 if (/\b(dvdrip)\b/i.test(text)) return 'DVDRip';
 if (/\b(cam|hdcam|ts|telesync)\b/i.test(text)) return 'CAM';
 
 return '';
}

/**
 * Extract release group from stream metadata
 * @param {Object} stream - Stream object
 * @returns {string} Release group name or empty string
 */
function extractReleaseGroup(stream) {
 const title = stream.title || '';
 const name = stream.name || '';
 const filename = stream.behaviorHints?.filename || stream._originalMetadata?.filename || '';
 const desc = stream.description || stream._originalMetadata?.originalDescription || '';
 const text = `${title} ${name} ${filename} ${desc}`;
 
 // Common release group pattern: -GroupName at end of filename (before extension)
 // Match patterns like: -FLUX, -YIFY, -RARBG, -NTG, -EVO, -SPARKS
 const groupMatch = text.match(/[-\s](FLUX|YIFY|RARBG|NTG|EVO|SPARKS|CMRG|FGT|AMZN|NF|ATVP|DSNP|HMAX|PCOK|IMAX|ION10|SMURF|TEPES|GalaxyRG|NOGRP|LAMA|JFF|APEX|MIXED)[\s\]\)\.,]|[-\s](FLUX|YIFY|RARBG|NTG|EVO|SPARKS|CMRG|FGT|AMZN|NF|ATVP|DSNP|HMAX|PCOK|IMAX|ION10|SMURF|TEPES|GalaxyRG|NOGRP|LAMA|JFF|APEX|MIXED)$/i);
 if (groupMatch) {
 return (groupMatch[1] || groupMatch[2]).toUpperCase();
 }
 
 // Fallback: try to extract from -GROUP pattern at end
 const fallbackMatch = text.match(/-([A-Za-z0-9]{2,12})(?:\.[a-z]{2,4})?$/i);
 if (fallbackMatch && !/^(mkv|mp4|avi|mov|wmv|flv|webm|m4v|1080p|720p|480p|2160p)$/i.test(fallbackMatch[1])) {
 return fallbackMatch[1].toUpperCase();
 }
 
 return '';
}

/**
 * Build bingeGroup for Stremio auto-play functionality
 * Uses "matching file" method - same resolution/codec/source/group will auto-play together
 * @param {Object} stream - Stream object with metadata
 * @returns {string} bingeGroup string like "autostream|1080p|HEVC|WEB-DL|FLUX"
 */
function buildBingeGroup(stream) {
 const parts = ['autostream'];
 
 // Create a virtual stream with all original metadata for accurate extraction
 // This ensures we capture resolution/codec from original torrent names before beautification
 const originalMeta = stream._originalMetadata || {};
 const virtualStream = {
 title: originalMeta.originalTitle || stream.title || '',
 name: originalMeta.originalName || stream.name || '',
 description: originalMeta.originalDescription || stream.description || '',
 behaviorHints: {
 filename: originalMeta.filename || stream.behaviorHints?.filename || ''
 },
 infoHash: stream.infoHash
 };
 
 // Resolution (most important for matching)
 const resolution = extractResolution(virtualStream);
 if (resolution) parts.push(resolution);
 
 // Codec (HEVC vs x264 matters for device compatibility)
 const codec = extractCodec(virtualStream);
 if (codec) parts.push(codec);
 
 // Source quality (WEB-DL, BluRay, etc.)
 const sourceQuality = extractSourceQuality(virtualStream);
 if (sourceQuality) parts.push(sourceQuality);
 
 // Release group (same group = consistent quality/encoding)
 const releaseGroup = extractReleaseGroup(virtualStream);
 if (releaseGroup) parts.push(releaseGroup);
 
 // If we only have "autostream" (no attributes found), use infoHash as fallback
 // This still allows auto-play if the same torrent is used across episodes
 if (parts.length === 1 && stream.infoHash) {
 parts.push(stream.infoHash.substring(0, 16)); // Use more chars for uniqueness
 }
 
 return parts.join('|');
}

function detectContentInfo(type, id) {
 // For series, try to extract season/episode info from ID
 if (type === 'series') {
 const match = id.match(/:(\d+):(\d+)$/);
 if (match) {
 return `S${match[1]}E${match[2]}`;
 }
 }
 
 return null;
}

function beautifyStreamName(stream, { type, id, includeOriginTag = false, debridProvider = null } = {}) {
 // For user-facing stream names, show debrid provider first, then fallback to source
 // A stream is considered debrid if it has infoHash OR explicit debrid flags
 const isDebridStream = stream._isDebrid || stream._debrid || stream.infoHash;
 
 if (isDebridStream && debridProvider) {
 // Show debrid provider ONLY if provider is actually configured
 switch (debridProvider.toLowerCase()) {
 case 'alldebrid':
 case 'ad':
 return 'AutoStream (AD)';
 case 'real-debrid':
 case 'realdebrid':
 case 'rd':
 return 'AutoStream (RD)';
 case 'premiumize':
 case 'pm':
 return 'AutoStream (PM)';
 case 'torbox':
 case 'tb':
 return 'AutoStream (TB)';
 case 'offcloud':
 case 'oc':
 return 'AutoStream (OC)';
 case 'easy-debrid':
 case 'easydebrid':
 case 'ed':
 return 'AutoStream (ED)';
 case 'debridlink':
 case 'debrid-link':
 case 'dl':
 return 'AutoStream (DL)';
 case 'putio':
 case 'put.io':
 case 'pi':
 return 'AutoStream (PI)';
 default:
 return 'AutoStream'; // Don't default to AD if provider is unknown
 }
 } else if (stream.autostreamOrigin === 'nuvio') {
 // For direct streams, show Nuvio variants
 return stream.behaviorHints?.proxyHeaders?.Cookie ? 'AutoStream (Nuvio+)' : 'AutoStream (Nuvio)';
 }
 
 // For non-debrid streams or when no debrid provider is configured, just show AutoStream
 return 'AutoStream';
}

function buildContentTitle(metaName, stream, { type, id } = {}) {
 // Build clean content title like "Gen V S1E1 - 4K"
 const resolution = extractResolution(stream);
 const contentInfo = detectContentInfo(type, id);
 
 let title = metaName;
 
 // FALLBACK 1: If metaName is missing or looks like raw ID, try to extract from stream
 if (!title || title === 'undefined' || title.startsWith('Title tt') || title === 'Unknown' || /^tt\d+$/.test(title)) {
 const extracted = extractContentTitleFromStream(stream, id);
 if (extracted && extracted !== title) {
 title = extracted;
 } else {
 // FALLBACK 2: Use descriptive title based on ID format
 title = buildDescriptiveTitle(id) || title || 'Content';
 }
 }
 
 // Add season/episode info for series
 if (type === 'series' && contentInfo) {
 title += ` ${contentInfo}`;
 }
 
 // Add resolution only if detected
 if (resolution) {
 title += ` - ${resolution}`;
 }
 
 return title;
}

function extractContentTitleFromStream(stream, id) {
 // Try to extract show name from stream title/name
 const text = stream.title || stream.name || '';
 
 // Clean up the text first - replace dots/underscores with spaces
 const cleanText = text.replace(/[\._]/g, ' ').replace(/\s+/g, ' ').trim();
 
 // Look for patterns like "Show Name S01E03" or "Show Name 2023"
 const patterns = [
 // Pattern 1: Text before S##E## (most common for series)
 /^(.+?)\s+s(\d+)e(\d+)/i,
 // Pattern 2: Text before year in parentheses
 /^([^\(\[]+?)\s*(?:\(\d{4}\)|\[\d{4}\])/i,
 // Pattern 3: Text before year (4 digits)
 /^([^\(\[]+?)\s*\d{4}/i,
 // Pattern 4: Text before dash
 /^([^-]+?)\s*-\s*/i,
 // Pattern 5: Everything before quality markers
 /^(.+?)\s*(?:1080p|720p|4k|2160p|hdr|hevc|x264|x265|bluray|web|hdtv)/i,
 // Pattern 6: First line only
 /^([^\n]+)(?:\n|$)/i
 ];
 
 for (const pattern of patterns) {
 const match = cleanText.match(pattern);
 if (match && match[1]) {
 let extracted = match[1].trim();
 
 // Clean up common artifacts
 extracted = extracted.replace(/^the\s+/i, 'The '); // Capitalize "The"
 extracted = extracted.replace(/\b[a-z]/g, letter => letter.toUpperCase()); // Title case
 
 // Avoid extracting technical terms or numbers
 if (!/^(\d+p|4K|HD|BluRay|WEB|HDTV|\d+)$/i.test(extracted) && extracted.length > 2) {
 return extracted;
 }
 }
 }
 
 return null;
}

function buildDescriptiveTitle(id) {
 // Build descriptive titles from ID format
 if (!id) return null;
 
 const match = id.match(/^tt(\d+)(?::(\d+):(\d+))?$/);
 if (match) {
 const [, imdbNum, season, episode] = match;
 
 // For series, just use generic Content ID format
 let title = `Content ${imdbNum}`;
 
 if (season && episode) {
 title += ` S${season}E${episode}`;
 }
 
 return title;
 }
 
 return null;
}

function shouldShowOriginTags(labelOrigin) {
 // Show origin tags if explicitly requested, useful for debugging
 return labelOrigin === true || labelOrigin === '1';
}

function buildStreamTitle(metaName, season, episode, qualityLabel) {
 let title = metaName;
 if (season != null && episode != null) {
 const seasonStr = String(season).padStart(2, '0');
 const episodeStr = String(episode).padStart(2, '0');
 title += ' - S' + seasonStr + 'E' + episodeStr;
 }
 if (qualityLabel) title += ' – ' + qualityLabel;
 return title;
}

function formatStreams(metaInfo, selectedStreams, providerTag = null) {
 return selectedStreams.map((orig) => {
 let qualityLabel;
 if (orig.tag) qualityLabel = orig.tag;
 else if (orig.name) {
 const detail = orig.name.split('\n')[1] || '';
 qualityLabel = detail.split(/\s+/)[0];
 }
 const normalised = normaliseQuality(qualityLabel);
 const copy = Object.assign({}, orig);
 copy.name = providerTag ? ('AutoStream (' + providerTag + ')') : 'AutoStream';
 copy.title = buildStreamTitle(metaInfo.name, metaInfo.season, metaInfo.episode, normalised);
 return copy;
 });
}

module.exports = {
 buildStreamTitle,
 formatStreams,
 beautifyStreamName,
 buildContentTitle,
 shouldShowOriginTags,
 extractResolution,
 extractQualityTags,
 detectContentInfo,
 extractCodec,
 extractSourceQuality,
 extractReleaseGroup,
 buildBingeGroup
};
