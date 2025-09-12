(function(){
  'use strict';
  const BYTES_IN_GB = 1024 ** 3;
  const originHost = window.location.origin;
  const hostNoScheme = window.location.host;

  const LANG_OPTIONS = [
    ['EN','English'], ['ES','Spanish'], ['LT','Lithuanian'], ['RU','Russian'],
    ['DE','German'], ['IT','Italian'], ['FR','French'], ['PL','Polish'],
    ['TR','Turkish'], ['PT-PT','Portuguese (PT)'], ['PT-BR','Portuguese (BR)'],
    ['AR','Arabic'], ['JA','Japanese'], ['KO','Korean'], ['ZH','Chinese']
  ];
  const NAME_BY_CODE = Object.fromEntries(LANG_OPTIONS);

  const SIZE_PRESETS = [
    ['0', 'Unlimited'],
    [String((1.5 * BYTES_IN_GB)|0), '1.5 GB'],
    [String(2 * BYTES_IN_GB), '2 GB'],
    [String(4 * BYTES_IN_GB), '4 GB'],
    [String(8 * BYTES_IN_GB), '8 GB'],
    [String(10 * BYTES_IN_GB), '10 GB'],
    [String(12 * BYTES_IN_GB), '12 GB'],
    [String(15 * BYTES_IN_GB), '15 GB'],
    [String(20 * BYTES_IN_GB), '20 GB']
  ];

  const MAX_LANGS = 6;
  const MAX_BLACKLIST = 10;

  const state = {
    provider: '',
    apiKey: '',
    fallback: false,
    langs: [],
    blacklist: [],
    maxSizeBytes: 0,
    nuvioEnabled: false,
    nuvioCookie: '',
    conserveCookie: true
  };
  
  // Load from localStorage first
  try { Object.assign(state, JSON.parse(localStorage.getItem('autostream_config')||'{}')); } catch {}
  
  // Then override with URL parameters if present (for existing installations)
  function loadFromURL() {
    const params = new URLSearchParams(window.location.search);
    
    // Load debrid provider and API key - updated to match new provider system
    if (params.get('alldebrid')) { state.provider = 'alldebrid'; state.apiKey = params.get('alldebrid'); }
    else if (params.get('realdebrid')) { state.provider = 'realdebrid'; state.apiKey = params.get('realdebrid'); }
    else if (params.get('premiumize')) { state.provider = 'premiumize'; state.apiKey = params.get('premiumize'); }
    else if (params.get('torbox')) { state.provider = 'torbox'; state.apiKey = params.get('torbox'); }
    else if (params.get('offcloud')) { state.provider = 'offcloud'; state.apiKey = params.get('offcloud'); }
    else if (params.get('easydebrid')) { state.provider = 'easydebrid'; state.apiKey = params.get('easydebrid'); }
    else if (params.get('debridlink')) { state.provider = 'debridlink'; state.apiKey = params.get('debridlink'); }
    else if (params.get('putio')) { state.provider = 'putio'; state.apiKey = params.get('putio'); }
    // Legacy support for old parameter names
    else if (params.get('ad')) { state.provider = 'alldebrid'; state.apiKey = params.get('ad'); }
    else if (params.get('rd')) { state.provider = 'realdebrid'; state.apiKey = params.get('rd'); }
    else if (params.get('pm')) { state.provider = 'premiumize'; state.apiKey = params.get('pm'); }
    else if (params.get('tb')) { state.provider = 'torbox'; state.apiKey = params.get('tb'); }
    else if (params.get('oc')) { state.provider = 'offcloud'; state.apiKey = params.get('oc'); }
    
    // Load size limit (convert from GB to bytes)
    if (params.get('max_size')) {
      const sizeGB = parseFloat(params.get('max_size'));
      if (sizeGB > 0) {
        state.maxSizeBytes = Math.round(sizeGB * BYTES_IN_GB);
      }
    }
    
    // Load language priorities
    if (params.get('lang_prio')) {
      const langs = params.get('lang_prio').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (langs.length > 0) state.langs = langs.slice(0, MAX_LANGS);
    }
    
    // Load blacklist
    if (params.get('blacklist')) {
      const blacklist = params.get('blacklist').split(',').map(s => s.trim()).filter(Boolean);
      if (blacklist.length > 0) state.blacklist = blacklist.slice(0, MAX_BLACKLIST);
    }
    
    // Load fallback setting
    if (params.get('fallback')) {
      state.fallback = params.get('fallback') === '1' || params.get('fallback') === 'true';
    }
    
    // Load Nuvio settings
    if (params.get('include_nuvio') || params.get('nuvio')) {
      state.nuvioEnabled = true;
      if (params.get('nuvio_cookie')) {
        state.nuvioCookie = params.get('nuvio_cookie');
      }
      if (params.get('conserve_cookie') === '0') {
        state.conserveCookie = false;
      }
    }
  }
  
  // Load URL parameters on page load
  loadFromURL();
  
  // Load URL parameters on page load
  loadFromURL();

  const $ = sel => document.querySelector(sel);
  const providerEl = $('#provider');
  const apikeyEl = $('#apikey');
  const fallbackEl = $('#fallback1080');
  const langPickerEl = $('#langPicker');
  const langAddEl = $('#langAdd');
  const langClearEl = $('#langClear');
  const langPillsEl = $('#langPills');
  const blacklistPickerEl = $('#blacklistPicker');
  const blacklistAddEl = $('#blacklistAdd');
  const blacklistClearEl = $('#blacklistClear');
  const blacklistPillsEl = $('#blacklistPills');
  const nuvioEnabledEl = $('#nuvioEnabled');
  const nuvioCookieEl = $('#nuvioCookie');
  const conserveCookieEl = $('#conserveCookie');
  const sizePresetEl = $('#sizePreset');
  const sizeCustomEl = $('#sizeCustom');
  const manifestEl = $('#manifestUrl');
  const appBtn = $('#installApp');
  const webBtn = $('#installWeb');
  const cookieSection = document.getElementById('cookieSection');

  // Init selects
  sizePresetEl.innerHTML = SIZE_PRESETS.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');
  langPickerEl.innerHTML = LANG_OPTIONS.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');

  // Hydrate fields from state (after URL loading)
  providerEl.value = state.provider || '';
  apikeyEl.value = state.apiKey || '';
  fallbackEl.checked = !!state.fallback;
  nuvioEnabledEl.checked = !!state.nuvioEnabled;
  nuvioCookieEl.value = state.nuvioCookie || '';
  conserveCookieEl.checked = state.conserveCookie !== false; // Default true
  
  // Hydrate size preset from state
  if (state.maxSizeBytes > 0) {
    const bytesStr = String(state.maxSizeBytes);
    const found = SIZE_PRESETS.find(([v]) => v === bytesStr);
    if (found) {
      sizePresetEl.value = bytesStr;
      sizeCustomEl.value = '';
    } else {
      // Custom size - convert bytes to GB
      sizePresetEl.value = '0';
      sizeCustomEl.value = String(state.maxSizeBytes / BYTES_IN_GB);
    }
  } else {
    sizePresetEl.value = '0'; // Unlimited
    sizeCustomEl.value = '';
  }

  function persist(){ localStorage.setItem('autostream_config', JSON.stringify(state)); }

  function renderLangPills(){
    langPillsEl.innerHTML = '';
    const count = state.langs.length;
    langPillsEl.classList.toggle('one', count <= 2);
    langPillsEl.classList.toggle('two', count >= 3);

    const atCap = count >= MAX_LANGS;
    if (atCap) { langAddEl.classList.add('disabled'); langAddEl.setAttribute('disabled','disabled'); }
    else { langAddEl.classList.remove('disabled'); langAddEl.removeAttribute('disabled'); }

    state.langs.forEach((code, idx) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.draggable = true;
      pill.dataset.index = String(idx);
      const label = NAME_BY_CODE[code] || code;
      pill.innerHTML = `<div class="num">${idx+1}</div><div class="txt">${label}</div><div class="handle">≡</div>`;
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

  function renderBlacklistPills(){
    blacklistPillsEl.innerHTML = '';
    const count = state.blacklist.length;
    blacklistPillsEl.classList.toggle('one', count <= 2);
    blacklistPillsEl.classList.toggle('two', count >= 3);

    const atCap = count >= MAX_BLACKLIST;
    if (atCap) { blacklistAddEl.classList.add('disabled'); blacklistAddEl.setAttribute('disabled','disabled'); }
    else { blacklistAddEl.classList.remove('disabled'); blacklistAddEl.removeAttribute('disabled'); }

    state.blacklist.forEach((term, idx) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.dataset.index = String(idx);
      pill.innerHTML = `<div class="num">🚫</div><div class="txt">${term}</div><div class="handle remove" onclick="removeBlacklistItem(${idx})" title="Remove ${term}">✕</div>`;
      blacklistPillsEl.appendChild(pill);
    });
  }

  // Helper function to remove blacklist item
  window.removeBlacklistItem = function(idx) {
    state.blacklist.splice(idx, 1);
    persist();
    renderBlacklistPills();
    rerender();
  };

  function syncSize(){
    const preset = sizePresetEl.value;
    const custom = sizeCustomEl.value;
    if (Number(preset) > 0 && !custom) {
      state.maxSizeBytes = Number(preset);
    } else if (custom) {
      const gb = Number(custom);
      state.maxSizeBytes = isFinite(gb) && gb>0 ? Math.round(gb * BYTES_IN_GB) : 0;
      sizePresetEl.value = '0';
    } else {
      state.maxSizeBytes = 0;
    }
  }

  // events
  providerEl.onchange = ()=>{ state.provider = providerEl.value; persist(); rerender(); };
  apikeyEl.oninput   = ()=>{ state.apiKey  = apikeyEl.value;   persist(); rerender(); };
  fallbackEl.onchange= ()=>{ state.fallback= !!fallbackEl.checked; persist(); rerender(); };

  langAddEl.onclick = ()=>{
    if (state.langs.length >= MAX_LANGS) return;
    const code = String(langPickerEl.value || '').trim();
    if (code && !state.langs.includes(code)) state.langs.push(code);
    persist(); renderLangPills(); rerender();
  };
  langClearEl.onclick = ()=>{ state.langs = []; persist(); renderLangPills(); rerender(); };

  blacklistAddEl.onclick = ()=>{
    if (state.blacklist.length >= MAX_BLACKLIST) return;
    const term = String(blacklistPickerEl.value || '').trim();
    if (term && !state.blacklist.includes(term)) {
      state.blacklist.push(term);
      blacklistPickerEl.value = ''; // Reset selector
    }
    persist(); renderBlacklistPills(); rerender();
  };
  blacklistClearEl.onclick = ()=>{ state.blacklist = []; persist(); renderBlacklistPills(); rerender(); };

  sizePresetEl.onchange = ()=>{ sizeCustomEl.value=''; syncSize(); persist(); rerender(); };
  sizeCustomEl.oninput  = ()=>{ syncSize(); persist(); rerender(); };

  nuvioEnabledEl.onchange = ()=>{
    state.nuvioEnabled = !!nuvioEnabledEl.checked; 
    persist(); 
    rerender();
    refreshCookieVisibility();
  };
  nuvioCookieEl.oninput = ()=>{ state.nuvioCookie = (nuvioCookieEl.value||'').trim(); persist(); rerender(); };
  conserveCookieEl.onchange = ()=>{ state.conserveCookie = !!conserveCookieEl.checked; persist(); rerender(); };

  // Clickable toggle boxes
  function wireToggle(boxId, inputEl){
    const box = document.getElementById(boxId);
    if (!box) return;
    const updateAria = ()=> box.setAttribute('aria-pressed', inputEl.checked ? 'true' : 'false');
    box.addEventListener('click', (e)=>{
      if (e.target === inputEl) return;
      inputEl.checked = !inputEl.checked;
      inputEl.dispatchEvent(new Event('change'));
      updateAria();
    });
    box.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        inputEl.checked = !inputEl.checked;
        inputEl.dispatchEvent(new Event('change'));
        updateAria();
      }
    });
    updateAria();
  }
  wireToggle('toggleFallback', fallbackEl);
  wireToggle('toggleNuvio', nuvioEnabledEl);
  wireToggle('toggleConserveCookie', conserveCookieEl);

  function refreshCookieVisibility(){
    if (!cookieSection) return;
    if (nuvioEnabledEl.checked) cookieSection.classList.remove('hidden');
    else cookieSection.classList.add('hidden');
  }

  
  
  function buildUrl(){
    const params = new URLSearchParams();

    // Fallback only if enabled
    if (state.fallback) params.set('fallback', '1');

    // Debrid: include exactly one provider param ONLY when provider + key are provided
    const key = (state.apiKey || '').trim();
    const prov = (state.provider || '').trim(); // alldebrid, realdebrid, etc.
    if (prov && key) {
      // Map provider names to parameter keys - this was the missing piece!
      const map = { 
        'alldebrid': 'alldebrid',
        'realdebrid': 'realdebrid', 
        'premiumize': 'premiumize',
        'torbox': 'torbox',
        'offcloud': 'offcloud',
        'easydebrid': 'easydebrid',
        'debridlink': 'debridlink',
        'putio': 'putio',
        // Legacy support for old short codes
        'AD': 'alldebrid', 'RD': 'realdebrid', 'PM': 'premiumize', 'TB': 'torbox', 'OC': 'offcloud'
      };
      const pk = map[prov];
      if (pk) params.set(pk, key);
    }

    // Size only if > 0 (send as GB, not bytes)
    if (state.maxSizeBytes && Number(state.maxSizeBytes) > 0) {
      const sizeGB = state.maxSizeBytes / BYTES_IN_GB;
      params.set('max_size', String(sizeGB));
    }

    // Priority languages only when set
    if (state.langs && state.langs.length) {
      params.set('lang_prio', state.langs.join(','));
    }

    // Blacklist terms only when set
    if (state.blacklist && state.blacklist.length) {
      params.set('blacklist', state.blacklist.join(','));
    }

    // Nuvio only if enabled
    if (state.nuvioEnabled) {
      params.set('include_nuvio', '1');
      params.set('nuvio', '1'); // explicit enable flag; omit entirely when disabled
      const ck = (state.nuvioCookie || '').trim();
      if (ck) params.set('nuvio_cookie', ck);
      
      // Cookie conservation setting (default true, only set if false)
      if (!state.conserveCookie) {
        params.set('conserve_cookie', '0');
      }
    }

    const qs = params.toString();
    return originHost + '/manifest.json' + (qs ? ('?' + qs) : '');
  }

function rerender(){
    const url = buildUrl();
    const redacted = url.replace(/^https?:\/\//, '');
    manifestEl.textContent = redacted;
    const q = url.split('?')[1] || '';
    
    // Back to simple working URLs with configuration parameters
    const configuredUrl = buildUrl();
    const stremioUrl = 'stremio://' + configuredUrl.replace(/^https?:\/\//, '');
    
    // Fix: Build proper Stremio Web URL for web install button
    const stremioWebUrl = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(configuredUrl)}`;
    
    appBtn.href = stremioUrl;
    webBtn.href = stremioWebUrl;
    
    appBtn.textContent = 'Install to Stremio';
    webBtn.textContent = 'Install to Web';
  }

  renderLangPills();
  renderBlacklistPills();
  syncSize();
  refreshCookieVisibility();
  rerender();

  appBtn.addEventListener('click', function(e){
    // Back to simple, working method - just update href with fresh config URL
    const freshUrl = buildUrl();
    const stremioUrl = 'stremio://' + freshUrl.replace(/^https?:\/\//, '');
    appBtn.href = stremioUrl;
    
    // Let default behavior handle the navigation
    return true;
  });

  // ==================================================
  // PENALTY RELIABILITY MANAGEMENT FUNCTIONS
  // ==================================================

  // Initialize penalty manager
  let penaltyManager = null;
  
  async function initPenaltyManager() {
    if (penaltyManager) return penaltyManager;
    
    // Simple penalty manager class
    penaltyManager = {
      serverUrl: originHost,
      
      async request(endpoint, options = {}) {
        try {
          const response = await fetch(`${this.serverUrl}${endpoint}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
          });
          return await response.json();
        } catch (e) {
          console.error('Penalty request failed:', e.message);
          return { success: false, error: e.message };
        }
      },
      
      async getStats() {
        return await this.request('/reliability/stats');
      },
      
      async getPenalties() {
        const result = await this.request('/reliability/penalties');
        return result.penalties || {};
      },
      
      async clearPenalty(url) {
        return await this.request('/reliability/clear', {
          method: 'POST',
          body: JSON.stringify({ url })
        });
      },
      
      async clearAllPenalties() {
        return await this.request('/reliability/clear', {
          method: 'POST',
          body: JSON.stringify({})
        });
      }
    };
    
    return penaltyManager;
  }

  // Penalty management functions (called from HTML)
  window.showReliabilityStats = async function() {
    const manager = await initPenaltyManager();
    const stats = await manager.getStats();
    
    if (!stats) {
      showPenaltyMessage('Failed to load statistics', 'error');
      return;
    }
    
    const display = $('#penaltyDisplay');
    if (!display) return;
    
    const penaltyStats = stats.penaltySystem?.stats || {};
    display.innerHTML = `
      <div style="background: var(--box); padding: 12px; border-radius: 8px; margin-top: 8px;">
        <strong>⚖️ Penalty System Statistics</strong><br>
        <small>
          • Penalized Hosts: ${penaltyStats.total_penalized_hosts || 0}<br>
          • Total Penalty Points: ${penaltyStats.total_penalty_points || 0}<br>
          • Max Penalty: ${penaltyStats.max_penalty || 0} (-${penaltyStats.max_penalty || 0} points)<br>
          • Average Penalty: ${penaltyStats.avg_penalty || 0} points
        </small>
      </div>
    `;
  };

  window.showPenalizedHosts = async function() {
    const manager = await initPenaltyManager();
    const penalties = await manager.getPenalties();
    
    const display = $('#penaltyDisplay');
    if (!display) return;
    
    const hosts = Object.keys(penalties);
    if (hosts.length === 0) {
      display.innerHTML = `
        <div style="background: var(--box); padding: 12px; border-radius: 8px; margin-top: 8px;">
          <strong>⚖️ Penalized Hosts</strong><br>
          <small>No hosts currently have penalties.</small>
        </div>
      `;
      return;
    }
    
    const sortedHosts = hosts.sort((a, b) => penalties[b] - penalties[a]);
    
    display.innerHTML = `
      <div style="background: var(--box); padding: 12px; border-radius: 8px; margin-top: 8px;">
        <strong>⚖️ Penalized Hosts (${hosts.length})</strong><br>
        <div style="margin-top: 8px; max-height: 120px; overflow-y: auto;">
          ${sortedHosts.map(host => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0; font-size: 13px;">
              <span style="font-family: monospace;">${host}</span>
              <span style="color: var(--muted); font-size: 11px;">-${penalties[host]} pts</span>
              <button onclick="clearHostPenalty('${host}')" 
                      style="background: #4CAF50; color: white; border: none; padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px;">
                Clear
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  window.clearHostPenalty = async function(host) {
    const manager = await initPenaltyManager();
    const url = `http://${host}/`; // Create dummy URL for host
    const result = await manager.clearPenalty(url);
    
    if (result.success) {
      showPenaltyMessage('✅ Penalty cleared for host', 'success');
      showPenalizedHosts(); // Refresh display
    } else {
      showPenaltyMessage('❌ Failed to clear penalty: ' + (result.error || 'Unknown error'), 'error');
    }
  };

  window.clearAllPenalties = async function() {
    if (!confirm('Are you sure you want to clear all host penalties? This action cannot be undone.')) {
      return;
    }
    
    const manager = await initPenaltyManager();
    const result = await manager.clearAllPenalties();
    
    if (result.success) {
      showPenaltyMessage('✅ All penalties cleared', 'success');
      
      // Clear display
      const display = $('#penaltyDisplay');
      if (display) display.innerHTML = '';
    } else {
      showPenaltyMessage('❌ Failed to clear penalties: ' + (result.error || 'Unknown error'), 'error');
    }
  };

  function showPenaltyMessage(text, type = 'info') {
    const display = $('#penaltyDisplay');
    if (!display) return;
    
    const colorMap = {
      success: '#4CAF50',
      error: '#f44336',
      info: '#2196F3'
    };
    
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      background: ${colorMap[type] || colorMap.info};
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      margin-top: 8px;
      font-size: 13px;
      font-weight: 600;
      opacity: 1;
      transition: opacity 0.3s;
    `;
    messageDiv.textContent = text;
    
    display.appendChild(messageDiv);
    
    setTimeout(() => {
      messageDiv.style.opacity = '0';
      setTimeout(() => {
        if (messageDiv.parentNode) {
          messageDiv.parentNode.removeChild(messageDiv);
        }
      }, 300);
    }, 3000);
  }

  // Initialize penalty manager on page load
  initPenaltyManager().catch(console.error);
})();
