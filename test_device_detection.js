// Test device detection
const userAgent = "Dalvik/2.1.0 (Linux; U; Android 16; AOSP TV on x86 Build/BT2A.250323.001.A4)";

console.log('Testing User-Agent:', userAgent);

// Test the current pattern
const tvPattern = /\b(smart[-\s]?tv|tizen|webos|vidaa|roku|fire[-\s]?tv|android[-\s]?tv|chromecast|shield\s*android\s*tv|lg\s*browser|samsung.*tizen)\b/i;
console.log('TV pattern matches:', tvPattern.test(userAgent));

// Test individual parts
console.log('Contains "android":', /android/i.test(userAgent));
console.log('Contains "tv":', /tv/i.test(userAgent));
console.log('Contains "android tv":', /android.*tv/i.test(userAgent));
console.log('Contains "android-tv":', /android[-\s]?tv/i.test(userAgent));

// Better pattern specifically for this case
const betterTvPattern = /\b(smart[-\s]?tv|tizen|webos|vidaa|roku|fire[-\s]?tv|android[-\s]?tv|chromecast|shield\s*android\s*tv|lg\s*browser|samsung.*tizen|aosp\s*tv)\b/i;
console.log('Better TV pattern matches:', betterTvPattern.test(userAgent));
