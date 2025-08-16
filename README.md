# AutoStream – Proxy Stremio Add‑on

AutoStream is a proxy‑style [Stremio](https://www.strem.io/) add‑on that merges streams from **Torrentio** and **ThePirateBay+** and returns at most two curated streams for each title.  The goal is to present a single, high‑quality stream rather than dozens of options.  When a debrid API key is provided, AutoStream prioritises video quality more heavily; otherwise speed and swarm health (seeders) are more important.  If the best pick is above 1080p, AutoStream can optionally include a 1080p fallback.

## Features

* **Proxy aggregator** combining Torrentio and TPB+ without maintaining a database.
* **Quality vs. seeds weighting** that shifts depending on whether you supply a debrid API key.
* **Cinemeta title beautifier** (e.g. “Show — S02E05 – 4K” or “Movie – 1080p”).
* **Optional 1080p fallback** when the best stream is 2K, 4K or 8K.
* **Debrid provider support** for Real‑Debrid (rd), All‑Debrid (ad), Premiumize (pm), Debrid‑Link (dl), Easy‑Debrid (easy), Offcloud (oc) and Put.io (put).
* **Configuration page** accessible at `/configure` to generate a custom manifest URL with your API keys and fallback preferences.

## Getting Started

### Running locally

AutoStream requires [Node.js](https://nodejs.org/) (v18 or later recommended for built‑in `fetch`).  Clone the repository and run:

```bash
node autostream_addon.js
```

The service starts on port `7010` by default.  You can override the port by setting the `PORT` environment variable:

```bash
PORT=7020 node autostream_addon.js
```

### Installing in Stremio

To install AutoStream in the Stremio desktop client:

1. Open **Stremio** (desktop version).  
2. Go to **Add‑ons** → **Community Add‑ons**.  
3. Paste the manifest URL into the **Add‑on URL** field (it's the search box on the Add‑ons page) and press **Enter**:

   ```
   http://127.0.0.1:7010/manifest.json
   ```

   Stremio will display “AutoStream” as an installable add‑on.  Note: local HTTP add‑ons only install on the desktop app using `127.0.0.1`; the web app requires HTTPS or a tunnel.

4. To customise your settings, visit the configuration page at:

   ```
   http://127.0.0.1:7010/configure
   ```

   Enter any debrid API keys you wish to use and choose whether to include a 1080p fallback.  The page will generate a unique `manifest.json` URL with your parameters.  Copy that URL and paste it into Stremio’s Add‑on URL field to install your personalised version of AutoStream.

### Deploying on a remote server

AutoStream is designed to be hosted like any other Node.js service.  Deploy it on a server or platform (e.g. Render, Heroku) with outbound internet access.  When hosting for public use, serve over **HTTPS** to allow installation from the Stremio web app.

Example using [localtunnel](https://github.com/localtunnel/localtunnel) for temporary HTTPS access:

```bash
npx localtunnel --port 7010
```

This prints a URL like `https://<random>.loca.lt`.  Use `https://<random>.loca.lt/manifest.json` in Stremio to install AutoStream remotely.  You can append query parameters for debrid keys and `fallback=0` as needed.

## License

This project is licensed under the MIT License.  See the `LICENSE` file for more information.