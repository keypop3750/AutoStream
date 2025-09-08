@ -1,180 +0,0 @@
# AutoStream V3 - AI Coding Instructions

AutoStream is a **Stremio addon** that aggregates and intelligently selects the best streaming sources with click-time debrid resolution. The system follows a **layered service architecture** with **comprehensive memory management**.

## 🏗️ Architecture Overview

- **Server Layer** (`server.js`): Main HTTP server with defensive coding, memory monitoring, and click-time debrid resolution
- **Services Layer** (`services/`): Stream aggregation (`sources.js`), debrid integration (`debrid.js`), reliability tracking (`penaltyReliability.js`), enhanced metadata (`enhanced_meta.js`)
- **Core Layer** (`core/`): Scoring algorithms (`scoring_v6.js`), content formatting (`format.js`), series caching (`series-cache.js`)
- **UI Layer** (`ui/`): Configuration interface with client-side state management
- **Utils Layer** (`utils/`): TTL caches (`cache.js`), HTTP utilities (`http.js`), ID correction systems (`id-correction.js`)

## 🔑 Critical Architectural Patterns

### 1. Graceful Module Loading with Fallbacks
**Always provide fallback functions** to prevent crashes when optional modules are missing:
```js
const scoringMod = (() => {
  try { return require('./core/scoring_v6'); }
  catch (e1) { return { filterAndScoreStreams: (streams) => streams.slice(0,2) }; }
})();
```

### 2. Memory Management with Size Limits
All Map/Cache structures MUST have size limits to prevent memory leaks:
```js
// TTL Cache with size limit
const cache = new TTLCache({ max: 1000, ttlMs: 60 * 60 * 1000 });

// Map with manual cleanup
class RateLimiter {
  constructor(maxRequests = 50, maxCacheSize = 200) {
    this.requests = new Map();
    this.maxCacheSize = maxCacheSize;
    setInterval(() => this.cleanup(), 60000); // Periodic cleanup
  }
  cleanup() {
    if (this.requests.size > this.maxCacheSize) {
      // LRU cleanup logic
    }
  }
}
```

### 3. Episode Metadata with Base ID Resolution
**Critical**: Series metadata must use base IMDB ID, not episode-specific ID:
```js
// WRONG: Fetch metadata for tt14452776:2:1
// RIGHT: Extract base ID first
const baseId = id.split(':')[0]; // tt14452776:2:1 → tt14452776
const metaUrl = `https://v3-cinemeta.strem.io/meta/series/${baseId}.json`;
```

### 4. Multi-Source Stream Aggregation
The system fetches from multiple providers **in parallel**:
```js
const [fromTorrentio, fromTPB, fromNuvio] = await Promise.all([
  fetchTorrentioStreams(type, id, options, log),
  fetchTPBStreams(type, id, options, log), 
  fetchNuvioStreams(type, id, options, log)
]);
```
Each source is **tagged** with origin (`torrentio`, `tpb`, `nuvio`) for scoring and filtering.

### 5. Click-Time Debrid Resolution
**Critical**: Torrents are NOT pre-resolved during `/stream` requests. Instead, they're wrapped with `/play?ih=...` URLs that resolve to debrid services only when clicked:
```js
// Step 3: Convert selected torrents to debrid URLs ONLY
if (adParam && selectedStreams.length > 0) {
  for (const s of selectedStreams) {
    if (isMagnet && !isHttp) {
      s.url = `${originBase}/play?ih=${infoHash}&...`;
    }
  }
}
```

### 6. Episode Processing with Smart Filtering
Episodes require season/episode extraction and validation:
```js
// Extract season/episode from ID: tt14452776:2:1 → S2E1
const [season, episode] = id.split(':').slice(1).map(n => parseInt(n));

// Pre-filter streams for correct episode before scoring
const episodeStreams = allStreams.filter(stream => {
  const name = (stream.title || stream.name || '').toLowerCase();
  // Match S02E01, s2e1, 2x01, etc.
  const patterns = [
    new RegExp(`s0?${season}e0?${episode}\\b`, 'i'),
    new RegExp(`season\\s*0?${season}.*episode\\s*0?${episode}\\b`, 'i')
  ];
  return patterns.some(p => p.test(name));
});
```

### 7. Resolution Detection from Multiple Fields
**UPDATED PATTERN**: Resolution is extracted from multiple stream fields, including both filename locations:
```js
function extractResolution(stream) {
  // Check multiple places for resolution info
  const title = stream.title || '';
  const name = stream.name || '';
  const description = stream.description || '';
  const filename = stream.behaviorHints?.filename || stream.filename || '';
  const tag = stream.tag || '';
  
  const text = `${title} ${name} ${description} ${filename} ${tag}`.toLowerCase();
  if (/\b(2160p|2160|4k|uhd)\b/i.test(text)) return '4K';
  // ... other resolutions
}
```

## Advanced Features

### Episode Detection System
The system implements sophisticated episode filtering with multiple regex patterns:
```js
// Episode patterns (server.js)
const patterns = [
  new RegExp(`s0*${seasonNum}\\s*e0*${episodeNum}(?:\\s|\\.|$)`, 'i'), // S01E04, s1e4
  new RegExp(`season\\s*0*${seasonNum}\\s*episode\\s*0*${episodeNum}`, 'i'), // Season 1 Episode 4
  new RegExp(`${seasonNum}x0*${episodeNum}(?:\\s|\\.|$)`, 'i'), // 1x04
  new RegExp(`s0*${seasonNum}\\s.*(complete|pack|collection)`, 'i'), // Season packs
  new RegExp(`s0*${seasonNum}.*e0*${episodeNum}`, 'i') // Flexible S##E## matching
];
```
**Testing**: Use `node test_episode_fix.js` to validate episode filtering across multiple series.

### IMDB ID Validation & Correction
Critical system for fixing common ID mapping issues:
```js
// utils/id-correction.js
const ID_CORRECTIONS = {
  'tt13623136': 'tt13159924', // Gen V fix: Marvel Guardians -> Gen V
};

// Enhanced metadata service validates IDs before fetching
const validationResult = await validateAndCorrectIMDBID(originalId);
if (validationResult.meta) {
  // Use already-fetched metadata to avoid duplicate requests
  return validationResult.meta;
}
```
**Key Point**: Series metadata always uses base IMDB ID (`tt14452776:2:1` → fetch `tt14452776`).

### Additional Stream System
Provides secondary stream option with smart resolution targeting:
```js
// Always process both streams, control visibility at the end
if (allScoredStreams.length > 1) {
  const primary = streams[0];
  const pRes = resOf(primary); // Get resolution
  
  // Target resolution logic: 4K → 1080p, 1080p → 720p
  let targetRes = pRes >= 2160 ? 1080 : (pRes >= 1080 ? 720 : 480);
  
  // Find different resolution stream
  const additional = findStreamWithResolution(targetRes, allScoredStreams);
}
```
**Configuration**: Controlled by `?additionalstream=1` parameter and UI toggle.

### Blacklist Host System
User-configurable host filtering with persistence:
```js
// UI: Max 500 hosts to prevent memory issues
const MAX_BLACKLIST = 500;

// Server: Apply blacklist during stream filtering
combined = combined.filter(stream => {
  const streamText = [stream.name, stream.title, stream.url].join(' ').toLowerCase();
  return !blacklistTerms.some(term => streamText.includes(term.toLowerCase()));
});
```
**Storage**: Persisted in localStorage as comma-separated list.

### Penalty-Based Reliability System
Robust failure tracking with permanent learning:
```js
// services/penaltyReliability.js
class PenaltyReliability {
  markFail(url) {
    const host = this.hostFromUrl(url);
    const newPenalty = Math.min(currentPenalty + 50, 500); // Max 500 points
    hostPenalties.set(host, newPenalty);
  }
  
  markOk(url) {
    const newPenalty = Math.max(0, currentPenalty - 50); // Recovery
    if (newPenalty === 0) hostPenalties.delete(host);
  }
}
```
**Key Features**: 
- Persistent penalties (-50 per failure, +50 per success)
- No time-based expiry, no permanent bans
- Management UI with clear individual/all penalties
- API endpoints: `/reliability/stats`, `/reliability/clear`

### Cache Clearing on Install
Automatic cache management when addon is installed/restarted:
```js
// server.js startup
function clearEpisodeCaches() {
  // Clear metadata cache (6h TTL)
  enhancedMeta.clearMetadataCache();
  
  // Clear series episode cache (60min TTL) 
  seriesCache.clearSeriesCache();
  
  // Clear AllDebrid API validation cache
  adKeyValidationCache.clear();
  
  // Preserve penalty data for reliability system
}
```
**Critical**: Penalty data is preserved across restarts to maintain reliability learning.

## Stream Scoring System (V6)

### Penalty-Based Reliability System
- **Persistent penalties**: -50 points per failure (no time-based expiry)
- **Recovery system**: +50 points per success (only up to natural score)
- **No exclusion**: Streams are never completely blocked, just penalized
- **Quality bonuses**: 4K(+30), 1080p(+20), 720p(+10)
- **Connection bonuses**: Premium hosts(+25), CDN(+15)
- **Type bonuses**: Direct files(+10), HLS/DASH(+15)

```js
// Example penalty progression
// Natural score: 800, 3 failures: 650, 1 success: 700, 2 more successes: 800 (capped)
{
  score: 750, // 800 base - 50 penalty
  penalties: ['reliability_penalty(-50)'],
  bonuses: ['quality_bonus(+30)', 'connection_bonus(+15)']
}
```

### Simple Storage Strategy
The penalty system uses **in-memory storage only**:
- Host penalties tracked as `Map<hostname, penaltyPoints>`
- No encryption, no user-specific data, no persistence
- Automatic cleanup of zero-penalty hosts

## Configuration System

### State Persistence Pattern
```js
const state = { provider: '', apiKey: '', langs: [], ... };
try { Object.assign(state, JSON.parse(localStorage.getItem('autostream_config')||'{}')); } catch {}

function persist() { localStorage.setItem('autostream_config', JSON.stringify(state)); }
```

### Language Pills with Drag-and-Drop
The UI implements draggable language priority pills where **order matters**. Languages are processed as `'EN,PL'` strings and affect stream scoring.

## Stream Naming Conventions

### Beautified Names
- **Addon name**: `"AutoStream (AD)"` - shows debrid provider
- **Content title**: `"Breaking Bad S1E1 - 4K"` - shows content with resolution
- **Origin badges**: `⚡` for cookie streams, source tags for debugging

### Content Title Building
Use `buildContentTitle(metaName, stream, { type, id })` in `core/format.js`:
- Automatically detects resolution from filename/title
- Adds season/episode info for series
- Handles fallback titles for missing metadata

### Cookie Stream Detection
```js
const isShowBoxish = /showbox|febbox|fbox/.test(nameTitle);
if (hasCookie && isShowBoxish) {
  headers.Cookie = `ui=${cookieToken}`;
  s.name = `⚡ ${s.name}`; // Lightning badge
}
```

## Essential Development Workflows

### Local Development
```powershell
node server.js  # Runs on http://localhost:7010
# Configure at: http://localhost:7010/configure
# Manifest at: http://localhost:7010/manifest.json
```

**Background Server (Windows)**: To run other commands while server is running:
```powershell
Start-Process powershell -ArgumentList "-NoProfile", "-Command", "node server.js" -WindowStyle Hidden
```

### API Testing
```powershell
# Test penalty reliability endpoints
Invoke-RestMethod -Uri "http://localhost:7010/reliability/stats" -Method Get
Invoke-RestMethod -Uri "http://localhost:7010/reliability/penalties" -Method Get
$body = @{} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:7010/reliability/clear" -Method Post -Body $body -ContentType "application/json"
```

### Debugging Stream Selection
Enable debug logging in scoring options:
```js
const scoringOptions = { debug: true }; // Shows detailed score breakdown
```

## Critical Integration Points

### Debrid Service Integration
- **AllDebrid**: Uses magnet upload + file selection pattern
- **Real-Debrid/Others**: Similar patterns in `services/debrid.js`
- **Error handling**: Always check for 302 redirects and proper file extraction

### Reliability System
- **Penalty-based scoring**: Persistent -50 point penalties per failure
- **Recovery mechanism**: +50 points per success (capped at natural score)
- **No time expiry**: Penalties persist until offset by successful streams

### Stremio Manifest Protocol
```js
// Required manifest structure
{
  id: 'com.stremio.autostream.addon',
  resources: [{ name: 'stream', types: ['movie','series'], idPrefixes: ['tt','tmdb'] }],
  behaviorHints: { configurable: true }
}
```

## Deployment Considerations

### Render/Cloud Compatibility
- **No persistent files**: Uses in-memory storage only
- **No databases**: Self-contained with TTL caches
- **Environment variables**: `AD_KEY`, `BLACKLIST_KEY` for configuration
- **Ephemeral filesystem**: All state must be memory-based or exported

### Memory Management
- **TTL caches**: Meta cache (6h), features cache (5min)
- **Size limits**: Blacklist max 500 hosts per client
- **Cleanup timers**: Automatic cleanup every hour

### Error Handling
**Defensive coding patterns** throughout:
- Unhandled promise rejection handlers
- Request timeouts (30s for debrid, 12s for sources)
- Memory monitoring with automatic cleanup
- Rate limiting and concurrency control

### Security Features
- **FORCE_SECURE_MODE**: Blocks environment credential fallbacks
- **EMERGENCY_DISABLE_DEBRID**: Server-wide debrid shutdown
- Input validation for IMDB IDs, API keys, and parameters

## Testing Patterns

### Memory Leak Testing
Use the built-in memory test to validate cache limits:
```powershell
node --expose-gc server.js  # Enable garbage collection
node test_memory_leak.js    # Run 100 requests, monitor heap usage
```
**Target**: Stable heap under 50MB for production use.

### Episode Matching Validation
Test episode filtering with known series:
```powershell
node test_episode_fix.js  # Tests multiple series episodes
```
**Coverage**: Tests both primary and additional streams across multiple series.

### Resolution Testing
**UPDATED**: Test resolution detection with current system:
```powershell
node test_breaking_bad_resolution.js  # Tests resolution detection
node test_office_resolution.js        # Tests additional resolution cases
```

### Additional Stream Testing
Test secondary stream targeting:
```powershell
node test_simplified_system.js  # Tests secondary stream targeting
```

### Request Testing Pattern
```js
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.setTimeout(30000, () => reject(new Error('Timeout')));
  });
}
```

### Debugging Resolution Detection
```js
// Test with simulated stream data
const stream = {
  title: "Breaking Bad S1E1",
  behaviorHints: { filename: "Breaking.Bad.S01E01.2160p.AMZN.WEB-DL.mkv" }
};
console.log(extractResolution(stream)); // Should output "4K"
```

### Penalty System Testing
API endpoints for reliability system management:
```powershell
# View penalty statistics
Invoke-RestMethod -Uri "http://localhost:7010/reliability/stats"

# View all penalized hosts
Invoke-RestMethod -Uri "http://localhost:7010/reliability/penalties"

# Clear all penalties
$body = @{} | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:7010/reliability/clear" -Method Post -Body $body -ContentType "application/json"
```

### Stream Source Mocking
When testing, services use fallback patterns:
```js
const { fetchTorrentioStreams } = (() => {
  try { return require('./services/sources'); }
  catch { return { fetchTorrentioStreams: async()=>[] }; }
})();
```

### Configuration UI Testing
The configure page serves from multiple fallback locations and injects client-side JavaScript for interactive configuration.

When editing this codebase, always check for existing fallback patterns and maintain the defensive coding approach. Test episode filtering and resolution detection with multiple content types.