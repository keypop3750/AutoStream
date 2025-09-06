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
  const text = `${stream.title || ''} ${stream.name || ''}`.toLowerCase();
  
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return '4K';
  if (/\b(1080p|full\s*hd|fhd)\b/i.test(text)) return '1080p';
  if (/\b(720p|hd)\b/i.test(text)) return '720p';  
  if (/\b(480p|sd)\b/i.test(text)) return '480p';
  
  // Default fallback
  return '1080p';
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
  
  if (isDebridStream) {
    // Show debrid provider if available
    if (debridProvider) {
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
        default:
          return 'AutoStream (AD)'; // Default to AD if unknown provider
      }
    }
    // Fallback to generic debrid indicator
    return 'AutoStream (AD)';
  } else if (stream.autostreamOrigin === 'nuvio') {
    // For direct streams, show Nuvio variants
    return stream.behaviorHints?.proxyHeaders?.Cookie ? 'AutoStream (Nuvio+)' : 'AutoStream (Nuvio)';
  }
  
  // For non-debrid torrents, just show AutoStream
  return 'AutoStream';
}

function buildContentTitle(metaName, stream, { type, id } = {}) {
  // Build clean content title like "KPop Demon Hunters (2025) - 4K"
  const resolution = extractResolution(stream);
  const contentInfo = detectContentInfo(type, id);
  
  let title = metaName;
  
  // FALLBACK 1: If metaName is missing or looks like raw ID, try to extract from stream
  if (!title || title.startsWith('Title tt') || title === 'Unknown' || /^tt\d+$/.test(title)) {
    title = extractContentTitleFromStream(stream, id) || title || 'Content';
  }
  
  // FALLBACK 2: If still looks like ID, use descriptive title based on ID format
  if (/^tt\d+/.test(title)) {
    title = buildDescriptiveTitle(id) || title;
  }
  
  // Add season/episode info for series
  if (type === 'series' && contentInfo) {
    title += ` ${contentInfo}`;
  }
  
  // Add resolution
  title += ` - ${resolution}`;
  
  return title;
}

function extractContentTitleFromStream(stream, id) {
  // Try to extract show name from stream title/name
  const text = stream.title || stream.name || '';
  
  // Look for patterns like "Show Name S01E03" or "Show Name 2023"
  const patterns = [
    /^([^\(\[]+?)\s*(?:S\d+E\d+|\d{4}|\(\d{4}\))/i,
    /^([^-]+?)\s*-\s*/i,
    /^([^\n]+)(?:\n|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      // Avoid extracting technical terms
      if (!/^(\d+p|4K|HD|BluRay|WEB|HDTV)$/i.test(extracted)) {
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
    
    // For known problematic IDs, provide better defaults
    const knownTitles = {
      '13159924': 'Gen V',      // Correct Gen V ID
      '13623136': 'Gen V',      // Wrong ID that should map to Gen V
      '1190634': 'The Boys',
      '6741278': 'Invincible'
    };
    
    let title = knownTitles[imdbNum] || `Content ${imdbNum}`;
    
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
    title += ' — S' + seasonStr + 'E' + episodeStr;
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
