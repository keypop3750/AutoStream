// src/ui/configure.js
'use strict';

function configureHtml(origin) {
  const css = `
  :root { color-scheme: dark; }
  /* palette (close to your earlier UI) */
  :root {
    --bg: #0f1116;
    --panel: #12141b;
    --text: #e6e9ef;
    --muted: #b6bcc6;
    --hint: #98a2b3;
    --input-bg: #0d0f14;
    --input-bd: #2a2f3a;
    --primary: #6c63ff;   /* purple focus / buttons */
    --primary-2: #1e2230; /* secondary button */
    --check: #29c36a;     /* checkbox tick */
  }

  html,body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,Helvetica Neue,Arial; font-weight:400; }

  /* compact “boxy” card (reduced to a bit over half the old width) */
  .wrap { max-width: 560px; margin:40px auto; padding:24px; border-radius:16px;
          background:var(--panel); box-shadow:0 10px 28px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.03); }

  .title { font-size:34px; font-weight:700; margin:0 0 6px; letter-spacing:.2px; }
  .lead  { margin:0 0 22px; color:var(--muted); font-weight:400; }

  .field label { display:block; margin:0 0 8px; color:#c7ced9; font-weight:600; }
  select,input,textarea { width:100%; box-sizing:border-box; border-radius:10px; border:1px solid var(--input-bd);
                          background:var(--input-bg); color:var(--text); padding:14px 12px; outline:0; font-weight:400; }
  select:focus,input:focus,textarea:focus { border-color:var(--primary); box-shadow:0 0 0 3px rgba(108,99,255,.22); }

  /* fade API key without layout jump */
  .apikey-wrap { min-height:72px; margin-top:18px; opacity:0; pointer-events:none; transition:opacity .35s ease; }
  .apikey-wrap.visible { opacity:1; pointer-events:auto; }

  .checkbox { display:flex; align-items:center; gap:10px; margin:10px 0 10px; }
  .checkbox input { width:18px; height:28px; accent-color: var(--check); }

  .btns { display:flex; gap:12px; flex-wrap:wrap; margin:8px 0 12px; }
  .btn  { appearance:none; border:0; border-radius:12px; padding:12px 18px; background:var(--primary);
          color:#fff; text-decoration:none; display:inline-flex; align-items:center; font-weight:600; }
  .btn.secondary { background:var(--primary-2); color:#e7e7ee; }

  .urlbox textarea { height:48px; resize: none; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New'; }

  .hint { color:var(--hint); font-size:12px; margin-top:8px; }
  `;

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>AutoStream — Configure</title>
  <style>${css}</style>
</head>
<body>
  <div class="wrap">
    <h1 class="title">AutoStream — Configure</h1>
    <p class="lead">Curated auto-streaming add-on that merges high-quality sources, supports optional debrid, and can always include a 1080p fallback. Configure below and click <b>Install</b>.</p>

    <div class="field">
      <label for="provider">Debrid provider</label>
      <select id="provider">
        <option value="">None</option>
        <option value="ad">AllDebrid</option>
        <option value="rd">Real-Debrid</option>
        <option value="pm">Premiumize</option>
        <option value="tb">TorBox</option>
        <option value="oc">Offcloud</option>
      </select>
    </div>

    <div id="apikeyWrap" class="field apikey-wrap">
      <label for="apikey">Debrid API key</label>
      <input id="apikey" placeholder="paste your API key" />
    </div>

    <div class="checkbox">
      <input type="checkbox" id="fallback">
      <label for="fallback" style="margin:0;font-weight:600">Always have a 1080p Option</label>
    </div>

    <div class="btns">
      <a id="installApp" class="btn">Install (App)</a>
      <a id="installWeb" class="btn secondary" target="_blank" rel="noopener">Install (Web)</a>
    </div>

    <div class="urlbox">
      <textarea id="urlBox" readonly></textarea>
      <div class="hint">If the App button doesn't open Stremio, use “Install (Web)” or copy the URL above.</div>
    </div>
  </div>

  <script>
  (function() {
    var providerEl = document.getElementById('provider');
    var keyWrap    = document.getElementById('apikeyWrap');
    var keyEl      = document.getElementById('apikey');
    var fallbackEl = document.getElementById('fallback');
    var urlBox     = document.getElementById('urlBox');
    var installApp = document.getElementById('installApp');
    var installWeb = document.getElementById('installWeb');

    var PARAM_MAP = { ad:'ad', rd:'rd', pm:'pm', tb:'tb', oc:'oc' };
    var LS_KEY = 'autostream_config';

    function save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ p:providerEl.value, k:keyEl.value, f:!!fallbackEl.checked })); } catch (e) {}
    }
    function load() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
    }

    function buildUrl() {
      var base = '${origin.replace(/'/g, "\\'")}/manifest.json';
      var sp = new URLSearchParams();
      var prov = providerEl.value;
      if (prov && PARAM_MAP[prov] && keyEl.value.trim()) sp.set(PARAM_MAP[prov], keyEl.value.trim());
      if (fallbackEl.checked) sp.set('fallback', '1');
      var qs = sp.toString();
      var url = qs ? (base + '?' + qs) : base;
      urlBox.value = url;
      var hostPath = url.replace(/^https?:\/\//, '');
       installApp.setAttribute('href', 'stremio://' + hostPath);
       installWeb.setAttribute('href', 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(url));
    }

    function toggleKey() {
      if (providerEl.value) {
        keyWrap.classList.add('visible');
        keyEl.disabled = false;
      } else {
        keyWrap.classList.remove('visible');
        keyEl.disabled = true;
        keyEl.value = '';
      }
      buildUrl(); save();
    }

    providerEl.addEventListener('change', toggleKey);
    keyEl.addEventListener('input', function(){ buildUrl(); save(); });
    fallbackEl.addEventListener('change', function(){ buildUrl(); save(); });

    // init (default fallback ON unless previously saved)
    var st = load();
    if (st.p) providerEl.value = st.p;
    if (st.k) keyEl.value = st.k;
    fallbackEl.checked = st.hasOwnProperty('f') ? !!st.f : true;

    toggleKey();
  })();
  </script>
</body>
</html>
`;
}

module.exports = { configureHtml };
