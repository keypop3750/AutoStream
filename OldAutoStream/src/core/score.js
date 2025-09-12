'use strict';
const { NO_DEBRID_WEIGHTS, DEBRID_WEIGHTS } = require('../constants');
const { extractSeedersAndSize, normaliseQuality, qualityToRank } = require('./quality');

// unchanged: your original speed/quality weighting
function computeScore(qualityRank, seeders, sizeBytes, weights) {
  const sizeGB = sizeBytes > 0 ? sizeBytes / (1024 ** 3) : 0.1;
  const speedScore = seeders / sizeGB;
  return (qualityRank * weights.quality) + (speedScore * weights.speed);
}

/**
 * streams: array of Stremio stream objects (already formatted)
 * useDebrid: boolean (influences weights)
 * include1080Fallback: boolean (existing flag in your code path)
 * log: function (...args) => void
 */
function pickStreams(streams, useDebrid, include1080Fallback, log = () => {}) {
  if (!Array.isArray(streams) || streams.length === 0) {
    log('No streams to pick from');
    return [];
  }

  const weights = useDebrid ? DEBRID_WEIGHTS : NO_DEBRID_WEIGHTS;

  // Annotate streams with parsed quality, seeders, size, and computed score.
  const annotated = streams.map((stream) => {
    const { seeders, size } = extractSeedersAndSize(stream.title || '');
    let qualityLabel;

    if (stream.tag) {
      qualityLabel = stream.tag;
    } else if (stream.name) {
      const nameLines = (stream.name || '').split('\n');
      const detail = nameLines[1] || '';
      qualityLabel = (detail.split(/\s+/)[0] || '').trim();
    }

    const normalised = normaliseQuality(qualityLabel);
    const qRank = qualityToRank(normalised);
    const score = computeScore(qRank, seeders, size, weights);

    return { stream, qualityLabel: normalised, qualityRank: qRank, seeders, size, score };
  });

  // Best per quality rank (so we can add quality fallbacks afterwards).
  // Rank convention (from your helpers): 1=720p, 2=1080p, >2 is higher than 1080p.
  const groups = {};
  for (const item of annotated) {
    const r = item.qualityRank || 0;
    const cur = groups[r];
    if (!cur || item.score > cur.score) groups[r] = item;
  }

  // Overall winner (highest score).
  let candidate = annotated[0];
  for (let i = 1; i < annotated.length; i++) {
    if (annotated[i].score > candidate.score) candidate = annotated[i];
  }

  const result = [];
  if (candidate) result.push(candidate.stream);

  // Existing behavior: if the winner is >1080p, also include the best 1080p (rank 2).
  if (include1080Fallback && candidate && candidate.qualityRank > 2) {
    const fallback1080 = groups[2];
    if (fallback1080) result.push(fallback1080.stream);
  }

  // NEW behavior: if the winner is exactly 1080p, also include the best 720p (rank 1).
  if (candidate && candidate.qualityRank === 2) {
    const fallback720 = groups[1];
    if (fallback720) result.push(fallback720.stream);
  }

  log('Selected count:', result.length);
  return result;
}

module.exports = { computeScore, pickStreams };
