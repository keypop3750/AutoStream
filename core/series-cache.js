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
 
 // First, validate that the next episode exists by checking metadata
 try {
 // For series episodes, get the full series metadata to check episode list
 const baseId = nextId.split(':')[0]; // Extract tt14016500 from tt14016500:1:2
 const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`;
 const metaResponse = await fetch(metaUrl, { timeout: 5000 });
 if (!metaResponse.ok || metaResponse.status === 404) {
 console.log(`[BLOCKED] Series ${baseId} doesn't exist, skipping preload`);
 return;
 }
 
 // Parse the series metadata to check if the specific episode exists
 const metaData = await metaResponse.json();
 const seriesMeta = metaData?.meta;
 
 if (!seriesMeta || !seriesMeta.videos) {
 console.log(`[BLOCKED] No episodes data for series ${baseId}, skipping preload`);
 return;
 }
 
 // Check if the specific next episode exists in the series
 const [, targetSeason, targetEpisode] = nextId.match(/^[^:]+:(\d+):(\d+)$/);
 const episodeExists = seriesMeta.videos.some(video => {
 const videoMatch = video.id?.match(/^[^:]+:(\d+):(\d+)$/);
 if (!videoMatch) return false;
 const [, videoSeason, videoEpisode] = videoMatch;
 return parseInt(videoSeason) === parseInt(targetSeason) && parseInt(videoEpisode) === parseInt(targetEpisode);
 });
 
 if (!episodeExists) {
 console.log(`[BLOCKED] Episode S${targetSeason}E${targetEpisode} does not exist for series ${baseId}, skipping preload`);
 return;
 }
 
 console.log(`[OK] Episode S${targetSeason}E${targetEpisode} exists for series ${baseId}, attempting preload of ${nextId}`);
 } catch (metaError) {
 console.log(`[BLOCKED] Cannot validate episode existence for ${nextId}, skipping preload:`, metaError.message);
 return;
 }
 
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

// Function to clear series cache (called on addon restart/install)
function clearSeriesCache() {
 const size = seriesCache.map.size;
 seriesCache.map.clear();
 console.log(`[CLEANUP] Cleared series cache: ${size} entries removed`);
 return size;
}

module.exports = {
 preloadNextEpisode,
 getCachedEpisode, 
 shouldPreloadNext,
 getPreloadStats,
 parseSeriesId,
 clearSeriesCache
};
