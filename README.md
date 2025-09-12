# AutoStream V3 - Intelligent Stream Selection for Stremio

AutoStream is a **high-performance Stremio addon** that intelligently selects the best streaming sources using advanced reliability tracking, quality analysis, and multi-source aggregation. Get instant access to the highest quality streams without the clutter.

---

## ✨ Features

### 🎯 **Intelligent Stream Selection**
- **Single best link** for every movie or episode, prioritizing quality with speed (seeders)
- **Advanced scoring system** with penalty-based reliability tracking
- **Quality-first approach** - prefers high-quality streams (4K, 1080p, BluRay, WEB, Remux) with good seed counts
- **Smart fallback system** - provides best 1080p option if 4K is too slow

### 🚀 **Performance Optimized**
- **90% faster response times** - 18ms average (vs 177ms in previous versions)
- **Multi-source aggregation** - combines Torrentio, TPB+, and Nuvio streams
- **Episode preloading** - automatically caches next episodes for seamless binge-watching
- **Request isolation** - clean logging with unique request IDs

### 🔒 **Quality Assurance**
- **Seeder validation** - prevents low-quality torrents (1-seeder = instant penalty)
- **Host reliability tracking** - learns from failures and successes
- **Cookie validation** - ensures ShowBox/FedBox streams actually work
- **Stream probing** - validates links before presenting them

### 🎨 **Enhanced User Experience**
- **Beautified titles** - "Movie Name (2025) - 4K" format
- **Service indicators** - "AutoStream (AD)" for debrid, "AutoStream (TPB+)" for sources
- **Quality badges** - Clear resolution and format indicators
- **Language filtering** - Supports multiple language preferences

---

## 🔧 Installation & Setup

### Method 1: Community Addon (Recommended)
1. Open Stremio
2. Go to **Add-ons → Community Add-ons**
3. Search for "AutoStream" or use the direct link:
   ```
   https://stremio-addons.net/addons/autostream
   ```
4. Click **Install**

### Method 2: Direct Installation
Paste this URL into Stremio's addon install box:
```
https://autostream-addon.example.com/manifest.json
```

---

## ⚙️ Configuration

### Basic Setup
- AutoStream works **out of the box** with no configuration required
- Access configuration at: `https://your-addon-url/configure`

### Debrid Integration (Optional but Recommended)
AutoStream supports multiple debrid services for premium streaming:

1. **AllDebrid** (Recommended)
   - Go to [AllDebrid API](https://alldebrid.com/apikeys/)
   - Generate an API key
   - Enter it in AutoStream configuration

2. **Real-Debrid**
   - Visit [Real-Debrid API](https://real-debrid.com/apitoken)
   - Generate your API token
   - Add to AutoStream settings

3. **Premiumize, TorBox, OffCloud**
   - Similar process - get API key from your provider
   - Configure in AutoStream settings

### Nuvio+ / ShowBox Integration
For access to ShowBox/FedBox direct streams:

1. **Get a FedBox Cookie:**
   - Visit any ShowBox/FedBox site (e.g., `hdtoday.tv`, `myflixer.to`)
   - Open browser DevTools (F12)
   - Go to **Application/Storage → Cookies**
   - Find cookie named `ui` or similar
   - Copy the **value** (long string of letters/numbers)

2. **Configure in AutoStream:**
   - Go to AutoStream configuration
   - Find "Nuvio+ Cookie" or "ShowBox Cookie" field
   - Paste the cookie value
   - Save settings

**Note:** Cookies may expire and need periodic renewal.

### Advanced Options
- **Language Priority:** Set preferred audio/subtitle languages
- **Quality Limits:** Set maximum file sizes or quality levels
- **Source Selection:** Enable/disable specific providers
- **Debug Mode:** Enable detailed logging for troubleshooting

---

## 🎭 Usage

### For Movies & TV Shows
1. Browse content in Stremio normally
2. Click any movie or episode
3. AutoStream automatically provides the best available stream
4. No need to choose from multiple options - just click and watch!

### Debrid Workflow
- **Without Debrid:** AutoStream provides best direct streams and torrents
- **With Debrid:** Torrents are automatically converted to premium direct links when clicked
- **Click-time Resolution:** No pre-caching bloat - debrid activation only happens when you actually watch

---

## 📊 How It Works

### Stream Selection Algorithm
1. **Multi-source Fetch:** Aggregates streams from Torrentio, TPB+, and Nuvio
2. **Quality Analysis:** Analyzes resolution, format, audio quality, HDR support
3. **Reliability Check:** Applies penalty scores based on historical success/failure
4. **Seeder Validation:** Prioritizes torrents with healthy seed counts
5. **Final Selection:** Presents the single best option based on combined scoring

### Reliability System
- **Penalty Tracking:** Hosts get -50 points per failure (permanent until success)
- **Recovery System:** +50 points per success (up to natural score)
- **No Permanent Bans:** Streams are penalized, not excluded entirely
- **Learning System:** Improves recommendations over time

---

## 🛠️ Developer Setup

### Local Development
```bash
# Clone the repository
git clone https://github.com/keypop3750/AutoStream.git
cd AutoStream

# Install dependencies
npm install

# Start the development server
npm start
```

The addon runs on: `http://localhost:7010`
- **Manifest:** `http://localhost:7010/manifest.json`
- **Configuration:** `http://localhost:7010/configure`

### Environment Variables
```bash
PORT=7010                    # Server port
AD_KEY=your_alldebrid_key   # Default AllDebrid key
BLACKLIST_KEY=secret        # Blacklist management key
```

### API Endpoints
- `GET /manifest.json` - Stremio addon manifest
- `GET /stream/{type}/{id}` - Stream selection endpoint
- `GET /configure` - Configuration interface
- `GET /play?ih={hash}` - Debrid resolution endpoint

---

## 📋 Notes

### Performance
- **Optimized for Speed:** 18ms average response times
- **Memory Efficient:** Uses TTL caches with automatic cleanup
- **Production Ready:** Single dependency (axios), clean architecture

### Content Sourcing
- AutoStream **aggregates existing streams** from multiple sources
- **No content hosting** - all streams are external links
- **Respects provider APIs** with appropriate rate limiting and caching

### Debrid Behavior
- **Click-time Resolution:** Torrents converted to direct links only when watched
- **No Pre-caching:** Prevents unnecessary debrid cache bloat
- **Smart Caching:** Temporary caching for recently accessed content

---

## ❓ FAQ

**Q: Do I need a debrid account?**
A: No, but highly recommended. AutoStream works with direct streams but debrid significantly improves quality and reliability.

**Q: Why only one stream option?**
A: AutoStream's philosophy is **quality over quantity**. Our algorithm selects the best option so you don't have to.

**Q: Can I see multiple streams?**
A: AutoStream is designed for simplicity. For multiple options, use traditional stream addons alongside AutoStream.

**Q: Does it work with VPN?**
A: Yes, AutoStream works with VPNs. Some providers may require VPN for access.

**Q: How often should I clear debrid cache?**
A: With V3's click-time resolution, cache bloat is minimal. Monthly clearing is sufficient.

**Q: What if a stream doesn't work?**
A: AutoStream's reliability system learns from failures and will avoid that host in future selections.

---

## 🤝 Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request with clear description

For bugs or feature requests, [create an issue](https://github.com/keypop3750/AutoStream/issues).

---

## ⚠️ Disclaimer

- AutoStream **aggregates publicly available streams** and does not host content
- **Use responsibly** and in accordance with your local laws
- **No warranties** provided - use at your own risk
- Some streams may require VPN access depending on your location

---

## 📜 License

MIT License - feel free to fork, improve, and share.

---

## 🙏 Acknowledgments

- **Torrentio** for torrent stream aggregation
- **TPB+** for additional torrent sources  
- **Nuvio** for direct streaming integration
- **Stremio community** for feedback and testing
