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
 const title = stream.title || '';
 const name = stream.name || '';
 const description = stream.description || '';
 const filename = stream.behaviorHints?.filename || stream.filename || '';
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
 detectContentInfo
};
