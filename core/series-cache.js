/**
 * Series Episode Caching System
 * Preloads the next episode for 60 minutes to improve binge-watching experience
 */

const { TTLCache } = require('../utils/cache');

// Cache next episodes for 60 minutes
const seriesCache = new TTLCache({ max: 1000, ttlMs: 60 * 60 * 1000 });

function parseSeriesId(id) {
  // Parse IDs like "tt1234567:1:5" (imdb:season:episode)
  const match = id.match(/^(.+?):(\d+):(\d+)$/);
  if (match) {
    return {
      baseId: match[1],
      season: parseInt(match[2]),
      episode: parseInt(match[3])
    };
  }
  return null;
}

function buildNextEpisodeId(baseId, season, episode) {
  return `${baseId}:${season}:${episode + 1}`;
}

function getCacheKey(type, id) {
  return `${type}:${id}`;
}

async function preloadNextEpisode(type, currentId, fetchFunction) {
  if (type !== 'series') return;
  
  const parsed = parseSeriesId(currentId);
  if (!parsed) return;
  
  const nextId = buildNextEpisodeId(parsed.baseId, parsed.season, parsed.episode);
  const cacheKey = getCacheKey(type, nextId);
  
  // Don't preload if already cached
  if (seriesCache.get(cacheKey)) return;
  
  try {
    console.log(`Preloading next episode: ${nextId}`);
    
    // Fetch streams for next episode in background
    const streams = await fetchFunction(type, nextId);
    
    if (streams && streams.length > 0) {
      seriesCache.set(cacheKey, streams);
      console.log(`Cached ${streams.length} streams for episode ${nextId}`);
    }
  } catch (error) {
    console.warn(`Failed to preload episode ${nextId}:`, error.message);
  }
}

function getCachedEpisode(type, id) {
  const cacheKey = getCacheKey(type, id);
  return seriesCache.get(cacheKey);
}

function shouldPreloadNext(type, id) {
  return type === 'series' && parseSeriesId(id) !== null;
}

function getPreloadStats() {
  return {
    cachedEpisodes: seriesCache.size,
    maxCapacity: seriesCache.max,
    ttlMinutes: Math.round(seriesCache.ttlMs / (1000 * 60))
  };
}

module.exports = {
  preloadNextEpisode,
  getCachedEpisode, 
  shouldPreloadNext,
  getPreloadStats,
  parseSeriesId
};
