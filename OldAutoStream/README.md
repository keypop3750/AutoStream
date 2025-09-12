# AutoStream Addon for Stremio

AutoStream is a **Stremio addon** that automatically picks the best available stream for movies and TV shows.  
Instead of showing you a long list of duplicate or low-quality streams, AutoStream **filters, prioritises, and selects** the best option based on quality, reliability, and speed.

---

## Features

- Automatically selects the best stream available  
- Works for both **movies and TV shows**  
- Prefers high-quality streams (BluRay, WEB, Remux) with good speed/seed counts  
- Provides fallback options (e.g., best 1080p stream if the top option is 2K/4K)  
- Clean, simplified output — no cluttered lists

---

## Installation (End Users)

1. Open Stremio.  
2. Go to **Add-ons → Community Add-ons**.  
3. Paste the following URL into the **addon install** box:

   ```
   https://stremio-addons.net/addons/autostream
   ```

4. Click **Install**.

That’s it! AutoStream will now automatically enhance your Stremio experience.

---

## Usage

- Simply browse movies or TV shows in Stremio as usual.  
- When you click “Watch,” AutoStream will fetch the best stream and play it automatically.  
- You don’t need to configure anything — it works out of the box.  

---

## FAQ

**Q: Do I need a Real-Debrid/AllDebrid account?**  
A: No. AutoStream works without debrid accounts, but adding one improves reliability and access to higher quality streams.  

**Q: Can I still see multiple stream options?**  
A: AutoStream is designed to simplify your experience by picking the best stream automatically.  

---

## Developer Setup

If you’d like to run AutoStream locally or contribute to development:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/AutoStreamAddon.git
cd AutoStreamAddon

# Install dependencies
npm install

# Start the addon server
npm start
```

The addon will run on:

```
http://localhost:7000/manifest.json
```

You can then install it in Stremio by pasting that local URL.

---


## Disclaimer

- This addon does not host or store any content. It simply provides links that are already available on the internet. Use at your own risk.
- This addon fetches Torrentio streams, curates them and then produces the streams (which causes your debrid to start caching, before you've even clicked the link to watch). This produces a slight delay in loading, and could also produce debrid bloat in the future. I recommend periodically clearing your debrid cache

---

## License

MIT License. Feel free to fork, improve, and share.

