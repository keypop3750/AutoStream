# AutoStream V3 - Stremio Addons Submission Blurb

## Addon Name
AutoStream

## Description
AutoStream picks a **single best link** for every movie or episode, prioritizing quality with speed (seeders). Advanced reliability tracking learns from failures to improve recommendations over time.

### Key Features:
- **90% faster performance** - 18ms average response times
- **Intelligent stream selection** with penalty-based reliability system
- **Multi-source aggregation** - combines Torrentio, TPB+, and Nuvio streams
- **Quality assurance** - seeder validation and host reliability tracking
- **Debrid integration** - supports AllDebrid, Real-Debrid, Premiumize, TorBox
- **ShowBox/FedBox support** - with cookie validation for direct streams
- **Episode preloading** - automatically caches next episodes for binge-watching
- **Clean output** - "Movie Name (2025) - 4K" format with service indicators

### How it works:
- Lower resolution (1080p/720p) preferred if clearly faster than 4K/2K for smoother playback
- Every movie and show title is cleaned up - "Title - 1080p" format
- Optional setting to always have a 1080p option appear
- Language and file size filtering supported
- Click-time debrid resolution prevents cache bloat

### Notes:
- AutoStream only provides streams; it doesn't autoplay (Stremio's UI decides)
- For best results, disable other **stream** add-ons so only AutoStream supplies links
- Supports multiple debrid services and direct streaming sources
- Advanced reliability system learns and improves over time

**GitHub:** https://github.com/keypop3750/AutoStream
