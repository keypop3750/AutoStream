@ -1,180 +0,0 @@
# AutoStream V3 - AI Coding Instructions

**Important:** To use the terminal for other commands while the server is running, you must start the server in a hidden window:
```powershell
Start-Process powershell -ArgumentList "-NoProfile", "-Command", "node server.js" -WindowStyle Hidden
```
This allows you to run PowerShell/cmd commands in the main terminal without interference from the server process.

## Architecture Overview

AutoStream is a **Stremio addon** that aggregates and intelligently selects the best streaming sources. The system follows a **layered service architecture**:

- **Server Layer** (`server.js`): Main HTTP server handling Stremio manifest/stream requests
- **Services Layer** (`services/`): Stream aggregation, debrid integration, reliability tracking
- **Core Layer** (`core/`): Scoring algorithms, filtering, post-processing
- **UI Layer** (`ui/`): Configuration interface with client-side state management

## Key Architectural Patterns

### 1. Graceful Module Loading with Fallbacks
```js
const scoringMod = (() => {
  try { return require('./core/scoring_v5'); }
  catch (e1) { try { return require('./core/scoring_v4'); }
  catch (e2) { return { filterAndScoreStreams: (streams) => streams.slice(0,2) }; } }
})();
```
**Critical Pattern**: Always provide fallback functions to prevent crashes when optional modules are missing.

### 2. Multi-Source Stream Aggregation
The system fetches from multiple providers **in parallel**:
```js
const [fromTorrentio, fromTPB, fromNuvio] = await Promise.all([
  fetchTorrentioStreams(type, id, options, log),
  fetchTPBStreams(type, id, options, log), 
  fetchNuvioStreams(type, id, options, log)
]);
```
Each source is **tagged** with origin (`torrentio`, `tpb`, `nuvio`) for scoring and filtering.

### 3. Click-Time Debrid Resolution
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
- **Content title**: `"Movie Name (2025) - 4K"` - shows content with quality
- **Origin badges**: `⚡` for cookie streams, source tags for debugging

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
```bash
node server.js  # Runs on http://localhost:7010
# Configure at: http://localhost:7010/configure
# Manifest at: http://localhost:7010/manifest.json
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

## Testing Patterns

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