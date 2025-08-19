'use strict';

function configureHtml(originHost) {
  // originHost will be like "http://localhost:7010" from server.js
  const hostNoScheme = originHost.replace(/^https?:\/\//, '');

  // Build a manifest URL with current form state
  function buildManifestUrl(state) {
    const params = new URLSearchParams();
    if (state.fallback) params.set('fallback', '1');

    // only include debrid param when a provider + key are present
    const key = (state.apiKey || '').trim();
    if (state.provider && key) {
      const map = { AD: 'ad', RD: 'rd', PM: 'pm', TB: 'tb', OC: 'oc' };
      const q = map[state.provider];
      if (q) params.set(q, key);
    }

    const qs = params.toString();
    return `http://${hostNoScheme}/manifest.json${qs ? `?${qs}` : ''}`;
  }

  // Build deep link for Stremio app
  function buildDeepLink(manifestUrl) {
    // transform http://<host>/manifest.json?... -> stremio://<host>/manifest.json?...
    const pathPart = manifestUrl.replace(/^https?:\/\//, '');
    return `stremio://${pathPart}`;
  }

  // Initial state
  const state = {
    provider: 'AD',   // AD | RD | PM | TB | OC | null
    apiKey: '',
    fallback: true
  };

  // Precompute initial URLs
  const initManifest = buildManifestUrl(state);
  const initDeep = buildDeepLink(initManifest);
  const initWeb = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(initManifest);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AutoStream — Configure</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root {
      --bg: #0e0f13;
      --card: #171821;
      --muted: #9aa0aa;
      --text: #e9ecf1;
      --primary: #6c5ce7;
      --primary-hover: #5a4cd0;
      --border: #25283a;
      --input: #1d1f2b;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 40px 20px; color: var(--text); background: var(--bg);
      font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    }
    .wrap { max-width: 980px; margin: 0 auto; }
    h1 {
      font-size: 28px; margin: 0 0 18px; letter-spacing: .2px;
    }
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 24px;
      box-shadow: 0 6px 24px rgba(0,0,0,.35);
    }
    .subtle { color: var(--muted); margin: 0 0 18px; }
    .grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
    }
    label { display: block; font-weight: 600; margin-bottom: 8px; }
    .select, .input, .mono {
      width: 100%; border-radius: 10px; border: 1px solid var(--border); background: var(--input);
      color: var(--text); padding: 12px 14px; outline: none;
    }
    .row { margin-top: 18px; }
    .check {
      display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;
    }
    .check input { width: 18px; height: 18px; }
    .btn {
      display: inline-block; padding: 12px 18px; border-radius: 10px; font-weight: 700;
      background: var(--primary); color: #fff; text-decoration: none;
      border: 1px solid transparent; margin-right: 12px;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn.secondary {
      background: transparent; border-color: var(--border);
    }
    .help { color: var(--muted); font-size: 12px; margin-top: 8px; }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    @media (max-width: 720px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>AutoStream — Configure</h1>
      <p class="subtle">Curated auto-streaming add-on that merges high-quality sources, supports optional debrid,
      and can always include a 1080p fallback. Configure below and click Install.</p>

      <div class="grid">
        <div>
          <label for="provider">Debrid provider</label>
          <select id="provider" class="select">
            <option value="AD">AllDebrid</option>
            <option value="RD">Real-Debrid</option>
            <option value="PM">Premiumize</option>
            <option value="TB">TorBox</option>
            <option value="OC">Offcloud</option>
            <option value="">None</option>
          </select>
        </div>
        <div>
          <label for="apikey">Debrid API key</label>
          <input id="apikey" class="input" placeholder="paste your API key" />
        </div>
      </div>

      <div class="row">
        <label class="check">
          <input id="fallback" type="checkbox" checked />
          <span>Always have a 1080p Option</span>
        </label>
      </div>

      <div class="row">
        <a id="installApp" class="btn" href="${initDeep}">Install (App)</a>
        <a id="installWeb" class="btn secondary" target="_blank" rel="noopener" href="${initWeb}">Install (Web)</a>
        <div class="help">If the App button doesn't open Stremio, use “Install (Web)” or copy the URL below.</div>
      </div>

      <div class="row">
        <input id="manifestUrl" class="mono" readonly value="${initManifest}" />
      </div>
    </div>
  </div>

  <script>
    (function(){
      const providerEl = document.getElementById('provider');
      const keyEl = document.getElementById('apikey');
      const fallbackEl = document.getElementById('fallback');
      const urlEl = document.getElementById('manifestUrl');
      const appBtn = document.getElementById('installApp');
      const webBtn = document.getElementById('installWeb');

      const map = { AD: 'ad', RD: 'rd', PM: 'pm', TB: 'tb', OC: 'oc' };

      function buildUrls() {
        const provider = providerEl.value || '';
        const apiKey = (keyEl.value || '').trim();
        const fallback = !!fallbackEl.checked;

        const params = new URLSearchParams();
        if (fallback) params.set('fallback', '1');
        if (provider && apiKey && map[provider]) {
          params.set(map[provider], apiKey);
        }

        const qs = params.toString();
        const httpUrl = 'http://${hostNoScheme}/manifest.json' + (qs ? ('?' + qs) : '');
        const deep = 'stremio://' + httpUrl.replace(/^https?:\\/\\//, '');
        const web = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(httpUrl);

        urlEl.value = httpUrl;
        appBtn.href = deep;
        webBtn.href = web;
      }

      // update button URLs as the user types/changes
      providerEl.addEventListener('change', buildUrls);
      keyEl.addEventListener('input', buildUrls);
      fallbackEl.addEventListener('change', buildUrls);

      // select-on-focus for easy copy
      urlEl.addEventListener('focus', function(){ this.select(); });

      // app fallback to Web after ~600ms if protocol blocked
      appBtn.addEventListener('click', function(){
        const currentWeb = webBtn.href;
        setTimeout(function(){
          window.open(currentWeb, '_blank', 'noopener');
        }, 600);
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = { configureHtml };
