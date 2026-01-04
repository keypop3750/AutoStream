'use strict';

/**
 * Stream Processing Handler
 * Handles stream finalization, beautification, and URL processing
 */

const scoring = (() => {
 try { return require('../core/scoring_v6'); }
 catch (e) { 
 console.error('[streamProcessor] Failed to load scoring module:', e.message);
 return { detectDeviceType: () => 'web' }; 
 }
})();

/**
 * Helper to check if stream has Nuvio cookie
 */
function hasNuvioCookie(s) { 
 return !!(s?.behaviorHints?.proxyHeaders?.Cookie) || !!s?._usedCookie; 
}

/**
 * Check if stream is from Torrentio
 */
function isTorrentio(s) { 
 return s?.autostreamOrigin === 'torrentio'; 
}

/**
 * Check if stream is from Nuvio
 */
function isNuvio(s) { 
 return s?.autostreamOrigin === 'nuvio'; 
}

/**
 * Check if stream is from TPB
 */
function isTPB(s) { 
 return s?.autostreamOrigin === 'tpb'; 
}

/**
 * Generate badge name for stream display
 */
function badgeName(s) {
 if (!s) return '[?]';
 const add = (tag) => tag;
 
 if (isTorrentio(s)) return add('[Torrentio]');
 else if (isTPB(s)) return add('[TPB]');
 else if (isNuvio(s)) return add(hasNuvioCookie(s) ? '[Nuvio +]' : '[Nuvio]');
 else return add('[Stream]');
}

/**
 * Sort streams by origin priority
 */
function originSort(a, b) {
 // Cookie streams first (Nuvio with cookie = highest priority)
 if (isNuvio(a) && hasNuvioCookie(a)) return -1;
 if (isNuvio(b) && hasNuvioCookie(b)) return 1;
 
 // Then by score
 return (b._scoreData?.score || 0) - (a._scoreData?.score || 0);
}

/**
 * Attach Nuvio cookie to stream behavior hints
 */
function attachNuvioCookie(list, cookie) {
 if (!cookie) return list;
 return (list || []).map((s) => {
 try {
 if (!(s && s.autostreamOrigin === 'nuvio' && s.url && /^https?:\/\//i.test(s.url))) return s;
 const bh = Object.assign({}, s.behaviorHints || {});
 const headers = Object.assign({}, bh.proxyHeaders || {});
 headers.Cookie = `ui=${cookie}`;
 s.behaviorHints = Object.assign({}, bh, { proxyHeaders: headers });
 s._usedCookie = true;
 } catch (e) { 
 console.error('[attachNuvioCookie] Failed to attach cookie:', e.message); 
 }
 return s;
 });
}

/**
 * PHASE 1: Technical Enhancement Layer
 * Restores critical metadata and adds device-specific properties
 */
function enhanceStreamTechnical(streams, deviceType, requestId) {
 return streams.map((s, index) => {
 if (!s) return s;
 
 // Preserve original metadata before any modifications
 const originalMetadata = {
 name: s.name,
 title: s.title,
 filename: s.behaviorHints?.filename || extractFilenameFromTitle(s.name || s.title),
 behaviorHints: { ...s.behaviorHints },
 infoHash: s.infoHash,
 fileIdx: s.fileIdx,
 sources: s.sources,
 bingeGroup: s.bingeGroup,
 videoSize: s.videoSize,
 videoHash: s.videoHash
 };
 
 // Store for later phases
 s._originalMetadata = originalMetadata;
 
 // Ensure behaviorHints object exists
 s.behaviorHints = s.behaviorHints || {};
 
 // Build comprehensive behavior hints
 s.behaviorHints = buildComprehensiveBehaviorHints(originalMetadata, deviceType, s);
 
 // TV-specific enhancements
 if (deviceType === 'tv') {
 enhanceForTV(s, originalMetadata, requestId);
 }
 
 return s;
 });
}

/**
 * Extract filename from stream title
 */
function extractFilenameFromTitle(title) {
 if (!title) return '';
 // Try to extract filename pattern
 const match = title.match(/[^\s\[\]]+\.(mkv|mp4|avi|mov|webm)/i);
 return match ? match[0] : '';
}

/**
 * Build comprehensive behaviorHints like Torrentio
 */
function buildComprehensiveBehaviorHints(originalMetadata, deviceType, stream) {
 const behaviorHints = { ...originalMetadata.behaviorHints };
 
 if (originalMetadata.filename) {
 behaviorHints.filename = originalMetadata.filename;
 }
 
 if (originalMetadata.bingeGroup) {
 behaviorHints.bingeGroup = originalMetadata.bingeGroup;
 }
 
 if (originalMetadata.videoSize) {
 behaviorHints.videoSize = originalMetadata.videoSize;
 }
 
 if (originalMetadata.videoHash) {
 behaviorHints.videoHash = originalMetadata.videoHash;
 }
 
 return behaviorHints;
}

/**
 * TV-specific enhancements
 */
function enhanceForTV(stream, originalMetadata, requestId) {
 if (stream.infoHash && !stream.url) {
 stream.behaviorHints = stream.behaviorHints || {};
 stream.behaviorHints.notWebReady = true;
 console.log(`[${requestId}] [TV] Added notWebReady flag for TV device: ${stream.infoHash.substring(0, 8)}...`);
 }
 
 if (!stream.behaviorHints.filename && originalMetadata.filename) {
 stream.behaviorHints.filename = originalMetadata.filename;
 console.log(`[${requestId}] [TV] Restored filename for TV codec detection: ${originalMetadata.filename}`);
 }
}

/**
 * PHASE 2: Stream URL Processing
 */
function processStreamUrls(streams, requestId, nuvioCookie) {
 streams.forEach((s, index) => {
 if (!s) return;
 
 s.url = s.url || s.externalUrl || s.link || (s.sources && s.sources[0] && s.sources[0].url) || '';
 
 if (s.infoHash && (!s.url || /^magnet:/i.test(s.url))) {
 const isDebridStream = s._debrid || s._isDebrid;
 
 if (isDebridStream) {
 if (!s.url || /^magnet:/i.test(s.url)) {
 console.warn(`[${requestId}] [WARN] Debrid stream missing play URL: ${s.infoHash?.substring(0, 8)}...`);
 }
 } else {
 if (s.infoHash) {
 console.log(`[${requestId}] [MAGNET] Providing infoHash stream for client: ${s.infoHash.substring(0, 8)}...`);
 }
 delete s.url;
 }
 }
 
 if (s.autostreamOrigin === 'nuvio' && nuvioCookie) s._usedCookie = true;
 });
 
 return streams;
}

/**
 * PHASE 4: Beautification Layer (COSMETIC ONLY)
 */
function beautifyStreamNames(streams) {
 return streams.map(s => {
 if (!s) return s;
 const beautified = { ...s };
 beautified.name = badgeName(s);
 return beautified;
 });
}

/**
 * Full stream finalization pipeline
 */
function finalizeStreams(list, { nuvioCookie, labelOrigin }, req, actualDeviceType = null) {
 let out = Array.isArray(list) ? list.slice() : [];
 
 const deviceType = actualDeviceType || scoring.detectDeviceType(req);
 const requestId = req._requestId || 'unknown';
 
 // PHASE 1: TECHNICAL ENHANCEMENT
 out = enhanceStreamTechnical(out, deviceType, requestId);
 
 // PHASE 2: STREAM URL PROCESSING
 out = processStreamUrls(out, requestId, nuvioCookie);
 
 // PHASE 3: NUVIO COOKIE ATTACHMENT
 out = attachNuvioCookie(out, nuvioCookie);
 
 // PHASE 4: BEAUTIFICATION
 if (labelOrigin) out = beautifyStreamNames(out);
 
 return out;
}

module.exports = {
 hasNuvioCookie,
 isTorrentio,
 isNuvio,
 isTPB,
 badgeName,
 originSort,
 attachNuvioCookie,
 enhanceStreamTechnical,
 processStreamUrls,
 beautifyStreamNames,
 finalizeStreams
};
