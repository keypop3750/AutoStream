'use strict';

function configureHtml(originHost) {
  // originHost like "http://localhost:7010"
  const hostNoScheme = originHost.replace(/^https?:\/\//, '');

  // ---- helpers --------------------------------------------------------------
  const BYTES_IN_GB = 1024 ** 3;

  const LANG_OPTIONS = [
    ['EN','English'], ['ES','Spanish'], ['PT-BR','Portuguese (BR)'], ['PT-PT','Portuguese (PT)'],
    ['FR','French'], ['IT','Italian'], ['DE','German'], ['RU','Russian'],
    ['TR','Turkish'], ['PL','Polish'], ['LT','Lithuanian'], ['AR','Arabic'],
    ['HI','Hindi'], ['JA','Japanese'], ['KO','Korean'], ['ZH','Chinese']
  ];

  const SIZE_PRESETS = [
    ['0', 'Unlimited'],
    [String(1.5 * BYTES_IN_GB|0), '1.5 GB'],
    [String(2 * BYTES_IN_GB), '2 GB'],
    [String(4 * BYTES_IN_GB), '4 GB'],
    [String(8 * BYTES_IN_GB), '8 GB'],
    [String(10 * BYTES_IN_GB), '10 GB'],
    [String(12 * BYTES_IN_GB), '12 GB'],
    [String(15 * BYTES_IN_GB), '15 GB'],
    [String(20 * BYTES_IN_GB), '20 GB']
  ];

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function parseCustomGB(v) {
    const n = Number(String(v).trim().replace(',', '.'));
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n * BYTES_IN_GB);
  }

  function buildManifestUrl(state) {
    const params = new URLSearchParams();

    // existing switches
    if (state.fallback) params.set('fallback', '1');

    // debrid provider+key to single "debrid=" just like before
    const key = (state.apiKey || '').trim();
    if (state.provider && key) {
      const map = { AD: 'ad', RD: 'rd', PM: 'pm', TB: 'tb', OC: 'oc' };
      const q = map[state.provider];
      if (q) params.set('debrid', q), params.set('apikey', key);
    }

    // NEW: max_size (bytes)
    if (state.maxSizeBytes && Number(state.maxSizeBytes) > 0)
      params.set('max_size', String(state.maxSizeBytes));

    // NEW: lang_prio (csv uppercased tokens, ordered)
    const langsCsv = state.langs.join(',').replace(/\s+/g, '');
    if (langsCsv) params.set('lang_prio', langsCsv);

    return originHost + '/manifest.json?' + params.toString();
  }

  // ---- page -----------------------------------------------------------------
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AutoStream — Configure</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --bg:#0b0f18; --card:#0f1522; --muted:#9cb3c9; --border:#1f2a44;
    --fg:#e9f0f7; --accent:#6eb1ff; --radius:14px;
  }
  html,body { background:var(--bg); color:var(--fg); margin:0; font:15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans", sans-serif; }
  .wrap { max-width: 980px; margin: 30px auto; padding: 0 16px; }
  h1 { font-size: 28px; margin: 0 0 18px; letter-spacing: .2px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:24px; box-shadow:0 6px 24px rgba(0,0,0,.35); }
  .subtle { color:var(--muted); margin:0 0 18px; }
  .grid { display:grid; grid-template-columns:1fr; gap:16px; }
  label { display:block; font-weight:600; margin-bottom:8px; }
  .field { margin-bottom:16px; }
  select, input[type="text"], input[type="number"] {
    width:100%; background:#0b1220; color:var(--fg); border:1px solid var(--border); border-radius:10px; padding:10px 12px; outline:none;
  }
  .row { display:flex; gap:8px; align-items:center; }
  .pill {
    display:flex; align-items:center; gap:8px;
    background:#0b1220; border:1px solid var(--border); border-radius:10px;
    padding:8px 10px; margin-top:8px; user-select:none; width:100%;
    cursor:grab;
}
  .btn { display:inline-block; background:#1a2742; border:1px solid #2a3a63; border-radius:12px; padding:10px 14px; cursor:pointer; text-decoration:none; color:var(--fg); }
  .btn-primary { background:#184a8b; border-color:#2b66c3; }
  .btn:active { transform: translateY(1px); }
  .muted { color: var(--muted); font-size: 13px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size:12px; }
  @media (max-width: 840px) { .grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>AutoStream — Configure</h1>
      <p class="subtle">Curated auto-streaming add-on with optional Debrid. Choose preferences and click <b>Install</b>.</p>

      <div class="grid">

        <!-- LEFT -->
        <div>
          <!-- Debrid -->
          <div class="field">
            <label>Debrid Provider</label>
            <select id="provider">
              <option value="">None</option>
              <option value="RD">Real-Debrid</option>
              <option value="AD">AllDebrid</option>
              <option value="PM">Premiumize</option>
              <option value="TB">TorBox</option>
              <option value="OC">Offcloud</option>
            </select>
          </div>

          <div class="field">
            <label>Debrid API Key</label>
            <input id="apikey" type="text" placeholder="Paste API key (optional)" />
            <div class="muted">Only required when a provider is selected.</div>
          </div>

          <div class="field">
            <label><input id="fallback1080" type="checkbox" /> Always include a 1080p fallback stream</label>
          </div>
        </div>

        <!-- RIGHT -->
        <div>
          <!-- NEW: Video size limit -->
          <div class="field">
            <label>Video size limit</label>
            <div class="row">
              <select id="sizePreset">
                ${SIZE_PRESETS.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}
              </select>
              <input id="sizeCustom" type="number" min="0" step="0.1" placeholder="Custom GB" style="max-width:140px" />
            </div>
            <div class="muted">Choose a preset or enter a custom GB value. Set to <b>Unlimited</b> to disable.</div>
          </div>

          <!-- NEW: Priority foreign languages -->
          <div class="field">
            <label>Priority foreign languages</label>
            <div class="row">
              <select id="langPicker">
                ${LANG_OPTIONS.map(([v,t])=>`<option value="${v}">${t} (${v})</option>`).join('')}
              </select>
              <button class="btn" id="langAdd" type="button">Add</button>
              <button class="btn" id="langClear" type="button">Clear</button>
            </div>
            <div class="muted" id="langHint">Order matters: items on top are preferred first. Drag to reorder.</div>
            <div id="langPills" class="row" style="flex-direction:column; align-items:stretch;"></div>
          </div>
        </div>

      </div>

      <hr style="border:0;border-top:1px solid var(--border); margin:16px 0 18px" />

      <div class="row" style="justify-content:space-between; gap:8px; flex-wrap:wrap;">
        <div>
          <a id="installApp" class="btn btn-primary">Install (open in Stremio)</a>
          <a id="installWeb" class="btn">Install (web fallback)</a>
        </div>
        <div class="muted">Manifest URL: <code id="manifestUrl"></code></div>
      </div>
    </div>
  </div>

  <script>
  (function(){
    // ----- state
    const state = {
      provider: '',
      apiKey: '',
      fallback: false,
      langs: [],
      maxSizeBytes: 0
    };

    // hydrate from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('autostream_config') || '{}');
      Object.assign(state, saved);
    } catch(_) {}

    // dom
    const $ = sel => document.querySelector(sel);
    const providerEl = $('#provider');
    const apikeyEl = $('#apikey');
    const fallbackEl = $('#fallback1080');

    const langPickerEl = $('#langPicker');
    const langAddEl = $('#langAdd');
    const langClearEl = $('#langClear');
    const langPillsEl = $('#langPills');

    const sizePresetEl = $('#sizePreset');
    const sizeCustomEl = $('#sizeCustom');

    const manifestEl = $('#manifestUrl');
    const appBtn = $('#installApp');
    const webBtn = $('#installWeb');

    // init fields
    providerEl.value = state.provider || '';
    apikeyEl.value = state.apiKey || '';
    fallbackEl.checked = !!state.fallback;

    // langs pills
    function renderLangPills(){
      langPillsEl.innerHTML = '';
      state.langs.forEach((code, idx) => {
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.draggable = true;
        pill.dataset.index = String(idx);
        pill.innerHTML = '<span style="opacity:.7">☰</span><b>' + code + '</b><button class="btn" style="padding:4px 8px; margin-left:auto" data-act="rm" data-i="' + idx + '">✕</button>';
        pill.addEventListener('dragstart', (e)=>{
          e.dataTransfer.setData('text/plain', pill.dataset.index);
          pill.classList.add('dragging');
        });
        pill.addEventListener('dragend', ()=> pill.classList.remove('dragging'));
        pill.addEventListener('dragover', (e)=> e.preventDefault());
        pill.addEventListener('drop', (e)=>{
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          const to = Number(pill.dataset.index);
          if (!Number.isNaN(from) && !Number.isNaN(to) && from !== to) {
            const item = state.langs.splice(from,1)[0];
            state.langs.splice(to,0,item);
            persist(); renderLangPills(); rerender();
          }
        });
        langPillsEl.appendChild(pill);
      });
    }
    renderLangPills();

    // size preset/custom sync
    function syncSize(){
      const preset = sizePresetEl.value;
      const custom = sizeCustomEl.value;
      if (Number(preset) > 0 && !custom) {
        state.maxSizeBytes = Number(preset);
      } else if (custom) {
        const gb = Number(custom);
        state.maxSizeBytes = isFinite(gb) && gb>0 ? Math.round(gb * ${BYTES_IN_GB}) : 0;
        sizePresetEl.value = '0';
      } else {
        state.maxSizeBytes = 0;
      }
    }

    // attach events
    providerEl.onchange = ()=>{ state.provider = providerEl.value; persist(); rerender(); };
    apikeyEl.oninput = ()=>{ state.apiKey = apikeyEl.value; persist(); rerender(); };
    fallbackEl.onchange = ()=>{ state.fallback = !!fallbackEl.checked; persist(); rerender(); };

    langAddEl.onclick = ()=>{
      const code = String(langPickerEl.value || '').trim().toUpperCase();
      if (code && !state.langs.includes(code)) state.langs.push(code);
      persist(); renderLangPills(); rerender();
    };
    langClearEl.onclick = ()=>{ state.langs = []; persist(); renderLangPills(); rerender(); };
    langPillsEl.addEventListener('click', (e)=>{
      const btn = e.target.closest('button'); if (!btn) return;
      const i = Number(btn.dataset.i);
      if (btn.dataset.act === 'rm') state.langs.splice(i,1);
      if (btn.dataset.act === 'up' && i>0) { const t = state.langs[i-1]; state.langs[i-1]=state.langs[i]; state.langs[i]=t; }
      if (btn.dataset.act === 'down' && i<state.langs.length-1) { const t = state.langs[i+1]; state.langs[i+1]=state.langs[i]; state.langs[i]=t; }
      persist(); renderLangPills(); rerender();
    });

    sizePresetEl.onchange = ()=>{ sizeCustomEl.value=''; syncSize(); persist(); rerender(); };
    sizeCustomEl.oninput = ()=>{ syncSize(); persist(); rerender(); };

    function persist(){ localStorage.setItem('autostream_config', JSON.stringify(state)); }

    // build manifest url
    function buildUrl(){
      const params = new URLSearchParams();
      if (state.fallback) params.set('fallback', '1');
      const key = (state.apiKey||'').trim();
      if (state.provider && key) {
        const map = { AD:'ad', RD:'rd', PM:'pm', TB:'tb', OC:'oc' };
        const q = map[state.provider];
        if (q) params.set('debrid', q), params.set('apikey', key);
      }
      if (state.maxSizeBytes && Number(state.maxSizeBytes)>0) params.set('max_size', String(state.maxSizeBytes));
      if (state.langs.length) params.set('lang_prio', state.langs.join(','));
      return '${originHost}/manifest.json?' + params.toString();
    }

    function rerender(){
      const url = buildUrl();
      manifestEl.textContent = url.replace(/^https?:\\/\\//, '');
      appBtn.href = 'stremio://' + '${hostNoScheme}' + '/manifest.json?' + url.split('?')[1];
      webBtn.href = url;
    }
    rerender();

    // app button fallback to web after ~600ms (if protocol blocked)
    appBtn.addEventListener('click', function(){
      const currentWeb = webBtn.href;
      setTimeout(function(){ window.open(currentWeb, '_blank', 'noopener'); }, 600);
    });
  })();
  </script>
</body>
</html>`;
}

module.exports = { configureHtml };
