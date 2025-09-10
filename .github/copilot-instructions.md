# AutoStream V3 - AI Coding Instructions

AutoStream is a **high-performance Stremio addon** that intelligently aggregates and selects the best streaming sources with **universal debrid provider support** and **click-time resolution**. The system follows a **layered service architecture** with **comprehensive security protections** and **platform-specific optimization**.

## 🏗️ Architecture Overview

- **Server Layer** (`server.js`): Main HTTP server with defensive coding, memory monitoring, universal debrid resolution, and device-aware request handling
- **Services Layer** (`services/`): Stream aggregation (`sources.js`), universal debrid integration (`debrid.js`), reliability tracking (`penaltyReliability.js`), enhanced metadata with ID validation (`enhanced_meta.js`)
- **Core Layer** (`core/`): Universal debrid providers (`debridProviders.js`), platform-specific scoring (`scoring_v6.js`), content formatting (`format.js`), series caching (`series-cache.js`)
- **UI Layer** (`ui/`): Configuration interface with client-side state management for all 8 debrid providers
- **Utils Layer** (`utils/`): TTL caches (`cache.js`), HTTP utilities (`http.js`), ID correction systems (`id-correction.js`)

## 🔑 Critical Security Architecture

### 1. Universal Debrid Provider System
**NEW CRITICAL PATTERN**: Support 8 debrid providers equally, not AllDebrid-centric:
```js
// core/debridProviders.js - Universal provider configuration
const DEBRID_PROVIDERS = {
  realdebrid: { key: 'realdebrid', name: 'RealDebrid', shortName: 'RD' },
  alldebrid: { key: 'alldebrid', name: 'AllDebrid', shortName: 'AD' },
  premiumize: { key: 'premiumize', name: 'Premiumize', shortName: 'PM' },
  torbox: { key: 'torbox', name: 'TorBox', shortName: 'TB' },
  // ... 8 total providers
};

// Server detects and validates ANY provider
const workingProviders = [];
for (const [key, token] of Object.entries(providerConfig)) {
  const isWorking = await validateDebridKey(key, token);
  if (isWorking) workingProviders.push({ key, token, provider: getProvider(key) });
}
```

### 2. Security-First Torrent Handling
**CRITICAL SECURITY**: No magnet URLs served when debrid is configured:
```js
// Step 3: Convert ALL torrents to debrid URLs when ANY provider configured
if (hasDebridConfigured && selectedStreams.length > 0) {
  for (const s of selectedStreams) {
    if ((s.autostreamOrigin === 'torrentio' || s.autostreamOrigin === 'tpb') && s.infoHash) {
      s.url = buildPlayUrl({...}, { provider: effectiveDebridProvider, token: effectiveDebridToken });
      
      // SECURITY: Remove streams that fail conversion rather than serve raw magnets
      if (!s.url || /^magnet:/i.test(s.url)) {
        s._invalid = true; // Filtered out entirely
      }
    }
  }
}
```
**Result**: Zero P2P activity when debrid configured - ISPs only see HTTPS requests to debrid services.

### 3. Environment Variable Security Protection
**CRITICAL**: Prevent credential leakage across all providers:
```js
// services/debrid.js - Security check on startup
const dangerousEnvVars = [
  'AD_KEY', 'ALLDEBRID_KEY', 'RD_KEY', 'REALDEBRID_KEY', 
  'PM_KEY', 'PREMIUMIZE_KEY', 'TB_KEY', 'TORBOX_KEY',
  // ... all 8 providers protected
];
foundVars.forEach(varName => {
  delete process.env[varName];
  console.error(`🚨 Removed dangerous environment variable: ${varName}`);
});
```

## 🔧 Essential Development Patterns

### 1. Graceful Module Loading with Fallbacks
**Always provide fallback functions** to prevent crashes when optional modules are missing:
```js
const scoringMod = (() => {
  try { return require('./core/scoring_v6'); }
  catch (e1) { return { filterAndScoreStreams: (streams) => streams.slice(0,2) }; }
})();
```

### 2. Universal Debrid Rate Limiting
**ALL debrid providers use unified rate limiting**:
```js
// services/debrid.js - Universal rate limiter for all providers
class DebridRateLimiter {
  constructor() {
    this.maxRequestsPerMinute = 30; // Conservative limit for debrid APIs
    this.maxCacheSize = 200; // Memory leak prevention
  }
  async checkRateLimit(apiKey) { /* Universal rate limiting logic */ }
}

// services/debrid.js - Universal circuit breaker
class DebridCircuitBreaker {
  async checkCircuit(apiKey) {
    if (failures.count >= this.maxFailures) {
      throw new Error('Debrid API circuit breaker is open. Service temporarily unavailable.');
    }
  }
}
```

### 3. Platform-Specific Scoring System (V6)
**CRITICAL PATTERN**: Device-aware scoring for optimal compatibility:
```js
// core/scoring_v6.js - Device detection and optimization
function detectDeviceType(req) {
  const userAgent = req.headers['user-agent'] || '';
  if (/\b(smart[-\s]?tv|tizen|webos|roku)\b/i.test(userAgent)) return 'tv';
  if (/\b(android|iphone|mobile)\b/i.test(userAgent)) return 'mobile';
  return 'web';
}

// TV scoring prioritizes compatibility over quality
function getTVQualityScore(title, factors) {
  if (/\b(x265|hevc)\b/.test(title)) score -= 60; // Heavy codec penalty for TV
  if (/\b(x264|h\.?264)\b/.test(title)) score += 40; // Compatibility bonus
}
```

### 4. Memory Management with Size Limits
**ALL Map/Cache structures MUST have size limits**:
```js
class DebridRateLimiter {
  cleanup() {
    if (this.requests.size > this.maxCacheSize) {
      const toRemove = /* LRU cleanup logic */;
      console.log(`[MEMORY] Cleaned ${toRemove.length} entries from rate limiter cache`);
    }
  }
}
```

## 📋 Essential Development Workflows

### Local Development
```powershell
node server.js  # Runs on http://localhost:7010
# Configure at: http://localhost:7010/configure
# Manifest at: http://localhost:7010/manifest.json
```

### Multi-Provider Testing
```powershell
# Test universal debrid provider system
node test_multi_debrid_system.js  # Tests all 8 providers

# Test security fix (no magnet leaks)
node test_security_fix.js         # Validates security across providers

# Test platform-specific scoring
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: SmartTV"
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: Android"
```

### Debugging Patterns
```js
// Enable detailed scoring breakdown
const scoringOptions = { debug: true };

// Request isolation with unique IDs
const requestId = Math.random().toString(36).substr(2, 9);
req._requestId = requestId;
console.log(`[${requestId}] Processing request...`);
```

## ⚡ Performance & Reliability Patterns

### 1. Penalty-Based Reliability System
```js
// services/penaltyReliability.js - Permanent learning system
class PenaltyReliability {
  markFail(url) {
    const newPenalty = Math.min(currentPenalty + 50, 500); // Max 500 points
    hostPenalties.set(host, newPenalty);
  }
  markOk(url) {
    const newPenalty = Math.max(0, currentPenalty - 50); // Recovery
  }
}
```
**Key Features**: 
- Persistent penalties (-50 per failure, +50 per success)
- No time-based expiry, no permanent bans
- API endpoints: `/reliability/stats`, `/reliability/clear`

### 2. Episode Processing with Smart Filtering
```js
// Pre-filter streams for correct episode BEFORE scoring
const episodeStreams = combined.filter(stream => {
  const patterns = [
    new RegExp(`s0?${seasonNum}\\s*e0?${episodeNum}\\b`, 'i'), // S01E04, s1e4
    new RegExp(`season\\s*0?${seasonNum}\\s*episode\\s*0?${episodeNum}`, 'i'), // Season 1 Episode 4
    new RegExp(`${seasonNum}x0*${episodeNum}(?:\\s|\\.|$)`, 'i') // 1x04
  ];
  return patterns.some(p => p.test(streamText));
});
```

### 3. Multi-Source Stream Aggregation
```js
// Parallel execution with timeout for faster response
const [fromTorrentio, fromTPB, fromNuvio] = await Promise.allSettled([
  fetchTorrentioStreams(type, id, options, log),
  fetchTPBStreams(type, id, options, log), 
  fetchNuvioStreams(type, id, options, log)
]);
```

## 🚨 Critical Security Requirements

1. **Never serve magnet URLs when ANY debrid provider is configured**
2. **Always validate debrid conversion success** - filter out failed conversions
3. **Use universal provider system** - no AllDebrid-centric code
4. **Protect environment variables** for all 8 providers
5. **Apply rate limiting and circuit breakers** universally

## 🧪 Testing Strategy

### Comprehensive System Tests
```powershell
# Test all user scenarios
node test_comprehensive_final.js  # All user flows
node test_security_fix.js         # Security validation
node test_multi_debrid_system.js  # Provider compatibility
```

### Platform-Specific Validation
```powershell
# Validate different device scoring
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: SmartTV"    # TV optimization
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: Android"   # Mobile optimization
```

When editing this codebase:
- **Always check for existing fallback patterns** and maintain defensive coding
- **Use universal debrid provider functions** instead of AllDebrid-specific ones
- **Test security across all 8 debrid providers** - never just AllDebrid
- **Apply memory limits to all Map/Cache structures**
- **Validate platform-specific behavior** with different User-Agent headers
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

## Testing Patterns

### Memory Leak Testing
Use the built-in memory test to validate cache limits:
```powershell
node --expose-gc server.js  # Enable garbage collection
node dev-files/test_penalty_system.js  # Test penalty system behavior
```
**Target**: Stable heap under 50MB for production use.

### Comprehensive System Testing
Test all user scenarios with single command:
```powershell
node dev-files/test_comprehensive_final.js  # Tests all user flows
```
**Coverage**: Non-debrid users, debrid validation, additional streams, fallback scenarios.

### Platform-Specific Testing
Test device-aware scoring across platforms:
```powershell
# Test TV optimization (4K+40pts, x265-60pts)
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: SmartTV"

# Test mobile optimization
curl "localhost:7010/stream/series/tt13159924:1:3.json" -H "User-Agent: Android"
```
**Coverage**: Validates platform-specific scoring differences.

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

# Test penalty accumulation
node dev-files/test_penalty_system.js
```

### Real-World Testing
Test actual user scenarios in development:
```powershell
# Test different user types
node dev-files/test_comprehensive_final.js  # All scenarios
node dev-files/simple-test.js              # Quick validation
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