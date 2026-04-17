// ============================================================================
// ERGENEKON UI — Time-Travel Debugger Application Logic
// Premium Dashboard — Supports both Demo Mode + Live Collector Connection
// ============================================================================

let sessions = [];
let currentSession = null;
let currentEvents = [];
let currentCursor = 0;
let currentFilter = 'all';
let playInterval = null;
let currentTier = 'community';
let currentEventRef = null; // for copy

// ── Collector Connection ─────────────────────────────────────────
let collectorUrl = ''; // empty = demo mode
let isLiveMode = false;
let pollInterval = null;

function initCollectorUrl() {
  // Priority: URL param > localStorage > demo mode
  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get('collector');
  const savedUrl = localStorage.getItem('ergenekon_collector_url');

  if (paramUrl) {
    collectorUrl = paramUrl.replace(/\/+$/, '');
    localStorage.setItem('ergenekon_collector_url', collectorUrl);
  } else if (savedUrl) {
    collectorUrl = savedUrl;
  }

  // Update UI
  const input = document.getElementById('collector-url-input');
  if (input && collectorUrl) input.value = collectorUrl;
}

async function connectToCollector(url) {
  if (!url) {
    disconnectCollector();
    return;
  }
  url = url.replace(/\/+$/, '');
  const statusEl = document.getElementById('connect-status');
  statusEl.textContent = 'Connecting...';
  statusEl.className = 'connect-status connecting';

  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Invalid collector');

    // Success!
    collectorUrl = url;
    isLiveMode = true;
    localStorage.setItem('ergenekon_collector_url', url);
    statusEl.textContent = `✅ Connected to collector`;
    statusEl.className = 'connect-status connected';

    // Update banner
    updateModeBanner(true);

    // Load real data
    await loadSessions();
    await loadMetrics();
    await loadLicenseFromCollector();

    // Start polling for new sessions
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => { loadSessions(); loadMetrics(); }, 5000);

  } catch (err) {
    statusEl.textContent = `❌ Cannot reach ${url} — ${err.message}`;
    statusEl.className = 'connect-status error';
    collectorUrl = '';
    isLiveMode = false;
  }
}

function disconnectCollector() {
  collectorUrl = '';
  isLiveMode = false;
  localStorage.removeItem('ergenekon_collector_url');
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  document.getElementById('collector-url-input').value = '';
  document.getElementById('connect-status').textContent = '';
  updateModeBanner(false);
  // Reload demo data
  loadSessions();
  loadMetrics();
}

function updateModeBanner(live) {
  const banner = document.querySelector('.upgrade-banner');
  if (!banner) return;
  if (live) {
    banner.style.background = 'linear-gradient(135deg,rgba(16,185,129,0.08),rgba(52,211,153,0.08))';
    banner.style.borderColor = 'rgba(16,185,129,0.3)';
    banner.innerHTML = `
      <span>🐺</span>
      <span style="flex:1"><strong>Live Mode</strong> — Connected to <code style="background:rgba(16,185,129,0.15);padding:2px 6px;border-radius:4px;font-size:12px">${collectorUrl}</code>. Data refreshes every 5s.</span>
      <button onclick="disconnectCollector()" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px">Disconnect</button>
    `;
  } else {
    banner.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(16,185,129,0.08))';
    banner.style.borderColor = 'rgba(99,102,241,0.2)';
    banner.innerHTML = `
      <span>🐺</span>
      <span style="flex:1"><strong>Demo Mode</strong> — Showing sample data. Connect your collector below to see real recordings.</span>
      <a href="https://ergenekon.dev" target="_blank" style="background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a78bfa;padding:6px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:12px">ergenekon.dev →</a>
    `;
  }
}

async function loadLicenseFromCollector() {
  if (!collectorUrl) return;
  try {
    const res = await fetch(`${collectorUrl}/api/v1/license`);
    if (!res.ok) return;
    const data = await res.json();
    currentTier = data.tier || 'community';
    const badge = document.getElementById('tier-badge');
    const tierName = currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
    badge.textContent = currentTier === 'pro' ? '⚡ Pro' : currentTier === 'enterprise' ? '👑 Enterprise' : '🌐 Community';
    badge.className = `tier-badge tier-${currentTier}`;
    if (currentTier === 'pro') {
      badge.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15))';
      badge.style.borderColor = 'rgba(99,102,241,0.3)';
      badge.style.color = '#a78bfa';
    } else if (currentTier === 'enterprise') {
      badge.style.background = 'linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.15))';
      badge.style.borderColor = 'rgba(245,158,11,0.3)';
      badge.style.color = '#fbbf24';
    }
  } catch {}
}

// ── API Calls ────────────────────────────────────────────────────

async function api(path) {
  // If connected to a live collector, use it
  const baseUrl = collectorUrl || '';
  try {
    const res = await fetch(`${baseUrl}/api/v1${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    return null;
  }
}

// ── HTML Escape (XSS Protection) ─────────────────────────────────
// All collector-supplied data MUST be escaped before innerHTML insertion
function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Session List ─────────────────────────────────────────────────

async function loadSessions() {
  setStatus('connecting');
  const data = await api('/sessions');

  if (!data) {
    setStatus('disconnected');
    document.getElementById('session-list').innerHTML = `
      <div class="empty-state">
        Cannot connect to collector.<br>
        Run: <code>npx tsx demo/app.ts</code>
      </div>`;
    return;
  }

  setStatus('connected');
  sessions = data.sessions || [];
  document.getElementById('session-count').textContent = sessions.length;
  renderSessionList(sessions);
}

function renderSessionList(list) {
  const container = document.getElementById('session-list');

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        No recordings yet.<br>
        Make some requests to your app!
      </div>`;
    return;
  }

  container.innerHTML = list.map(s => {
    const active = currentSession?.id === s.id ? 'active' : '';
    const errorDot = s.hasError ? '<span class="error-dot">&#9679;</span>' : '';

    // Extract method and path from first event or session metadata
    const method = escapeHtml(s.method || s.httpMethod || 'GET');
    const path = escapeHtml(s.path || s.url || s.id.slice(0, 12));
    const statusCode = s.statusCode || s.httpStatus || null;
    const methodLower = (s.method || 'get').toLowerCase().replace(/[^a-z]/g, '');
    const statusClass = getStatusClass(statusCode);
    const safeId = escapeHtml(s.id);

    return `
      <div class="session-item ${active}" onclick="selectSession('${safeId}')">
        <div class="session-item-top">
          <span class="session-method m-${methodLower}">${method}</span>
          <span class="session-path">${path}</span>
          ${statusCode ? `<span class="session-status-code ${statusClass}">${statusCode}</span>` : ''}
        </div>
        <div class="session-item-meta">
          <span class="session-service-name">${escapeHtml(s.serviceName)}</span>
          <span>${relativeTime(s.startedAt)}</span>
          <span>${s.eventCount} events</span>
          ${errorDot}
        </div>
      </div>`;
  }).join('');
}

function getStatusClass(code) {
  if (!code) return '';
  if (code >= 500) return 'sc-5xx';
  if (code >= 400) return 'sc-4xx';
  if (code >= 300) return 'sc-3xx';
  return 'sc-2xx';
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function filterSessions() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const filtered = sessions.filter(s =>
    s.serviceName.toLowerCase().includes(query) ||
    s.traceId?.toLowerCase().includes(query) ||
    s.id.toLowerCase().includes(query) ||
    (s.path || '').toLowerCase().includes(query) ||
    (s.method || '').toLowerCase().includes(query)
  );
  renderSessionList(filtered);
}

// ── Session Detail ───────────────────────────────────────────────

async function selectSession(sessionId) {
  const data = await api(`/sessions/${sessionId}`);
  if (!data) return;

  currentSession = data;
  currentEvents = data.events || [];
  currentCursor = 0;

  // Show detail, hide empty
  document.getElementById('empty-main').style.display = 'none';
  document.getElementById('session-detail').style.display = 'flex';

  // Header — extract method/path from first event
  const firstEvent = currentEvents[0];
  const lastEvent = currentEvents[currentEvents.length - 1];
  const method = firstEvent?.data?.method || data.method || 'GET';
  const path = firstEvent?.data?.path || firstEvent?.data?.url || data.path || '/';

  // Status code from last response event
  let statusCode = null;
  for (let i = currentEvents.length - 1; i >= 0; i--) {
    if (currentEvents[i].type === 'http_response_out' && currentEvents[i].data?.statusCode) {
      statusCode = currentEvents[i].data.statusCode;
      break;
    }
  }

  document.getElementById('session-title').textContent = path;
  const methodBadge = document.getElementById('session-method');
  methodBadge.textContent = method;
  methodBadge.className = `method-badge method-${method.toLowerCase()}`;

  document.getElementById('session-service').textContent = data.serviceName;

  // Status tag
  const statusTag = document.getElementById('session-status');
  if (statusCode) {
    statusTag.textContent = `${statusCode}`;
    statusTag.className = `tag tag-status s-${statusCode >= 500 ? '5xx' : statusCode >= 400 ? '4xx' : '2xx'}`;
    statusTag.style.display = '';
  } else {
    statusTag.style.display = 'none';
  }

  document.getElementById('session-trace').textContent = `trace: ${data.traceId?.slice(0, 8)}…`;
  document.getElementById('session-duration').textContent = `${data.metadata?.totalDurationMs || 0}ms`;
  document.getElementById('session-event-count').textContent = `${currentEvents.length} events`;

  // Timeline
  renderTimeline();

  // Flow graph
  renderFlowGraph();

  // Events
  renderEventList();
  updateCursor();

  // Event type breakdown
  renderEventBreakdown();

  // Highlight in session list
  renderSessionList(sessions);
}

// ── Timeline ─────────────────────────────────────────────────────

function renderTimeline() {
  const track = document.getElementById('timeline-track');
  const startTime = currentEvents[0]?.wallClock || 0;
  const endTime = currentEvents[currentEvents.length - 1]?.wallClock || 0;
  const totalDuration = Math.max(endTime - startTime, 1);

  // Clear old markers
  track.querySelectorAll('.timeline-marker').forEach(m => m.remove());

  // Add markers
  currentEvents.forEach((event, idx) => {
    const marker = document.createElement('div');
    const pct = ((event.wallClock - startTime) / totalDuration) * 100;
    const mType = getMarkerType(event.type);
    marker.className = `timeline-marker type-${mType}`;
    marker.style.left = `${pct}%`;
    marker.title = `#${event.sequence} ${event.type}: ${event.operationName}`;
    marker.onclick = (e) => { e.stopPropagation(); seekTo(idx); };

    // Tooltip on hover
    marker.onmouseenter = (e) => showTooltip(e, `#${event.sequence} ${event.type}\n${event.operationName}`);
    marker.onmouseleave = hideTooltip;

    track.appendChild(marker);
  });

  // Labels
  document.getElementById('timeline-start').textContent = '0ms';
  document.getElementById('timeline-end').textContent = `${totalDuration}ms`;
}

function getMarkerType(type) {
  if (type.startsWith('http')) return 'http';
  if (type.startsWith('db') || type.startsWith('cache')) return 'db';
  if (type === 'error') return 'error';
  if (type === 'random' || type === 'timestamp' || type === 'uuid') return 'random';
  if (type.startsWith('timer')) return 'timer';
  if (type.startsWith('fs')) return 'fs';
  if (type.startsWith('dns')) return 'dns';
  return 'other';
}

function onTimelineClick(e) {
  const track = document.getElementById('timeline-track');
  const rect = track.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const idx = Math.round(pct * (currentEvents.length - 1));
  seekTo(Math.max(0, Math.min(idx, currentEvents.length - 1)));
}

function updateCursor() {
  if (currentEvents.length === 0) return;

  const pct = currentEvents.length > 1
    ? (currentCursor / (currentEvents.length - 1)) * 100
    : 0;

  document.getElementById('timeline-progress').style.width = `${pct}%`;
  document.getElementById('timeline-cursor').style.left = `${pct}%`;
  document.getElementById('timeline-position').textContent =
    `${currentCursor + 1} / ${currentEvents.length}`;

  // Highlight current event in list
  document.querySelectorAll('.event-item').forEach((el, idx) => {
    el.classList.toggle('current', idx === currentCursor);
  });

  // Auto-select current event
  showEventDetail(currentEvents[currentCursor]);

  // Scroll current event into view
  const currentEl = document.querySelector('.event-item.current');
  if (currentEl) currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Timeline Controls ────────────────────────────────────────────

function seekTo(idx) { currentCursor = idx; updateCursor(); }
function seekFirst() { seekTo(0); }
function seekLast() { seekTo(currentEvents.length - 1); }
function seekPrev() { seekTo(Math.max(0, currentCursor - 1)); }
function seekNext() { seekTo(Math.min(currentEvents.length - 1, currentCursor + 1)); }

function togglePlay() {
  const btn = document.getElementById('btn-play');
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
    btn.innerHTML = '&#9654;';
    return;
  }

  btn.innerHTML = '&#9646;&#9646;';
  playInterval = setInterval(() => {
    if (currentCursor >= currentEvents.length - 1) {
      togglePlay(); // Stop at end
      return;
    }
    seekNext();
  }, 200);
}

// ── Flow Graph (SVG Upgrade) ─────────────────────────────────────

function renderFlowGraph() {
  const container = document.getElementById('flow-graph');

  // Count events from this service
  const thisServiceCount = currentEvents.length;

  // Find cross-service calls and their event counts
  const targets = new Map();
  currentEvents.forEach(event => {
    if (event.type === 'http_request_out') {
      const url = event.data?.url || '';
      const target = extractServiceFromUrl(url);
      targets.set(target, (targets.get(target) || 0) + 1);
    }
  });

  // Build flow with SVG connectors
  let html = `<div class="flow-node active">
    ${currentSession.serviceName}
    <span class="flow-node-count">${thisServiceCount} events</span>
  </div>`;

  targets.forEach((count, target) => {
    html += `
      <div class="flow-connector">
        <svg viewBox="0 0 40 20">
          <line x1="0" y1="10" x2="32" y2="10" stroke="#505872" stroke-width="1.5" class="flow-dash"/>
          <polygon points="32,6 40,10 32,14" fill="#505872"/>
        </svg>
      </div>
      <div class="flow-node">
        ${target}
        <span class="flow-node-count">${count} calls</span>
      </div>`;
  });

  if (targets.size === 0) {
    html += `
      <div class="flow-connector">
        <svg viewBox="0 0 40 20">
          <line x1="0" y1="10" x2="32" y2="10" stroke="#505872" stroke-width="1.5" stroke-dasharray="2 3"/>
          <polygon points="32,6 40,10 32,14" fill="#2a2e3e"/>
        </svg>
      </div>
      <div class="flow-node" style="opacity:0.4;border-style:dashed">
        No outbound calls
      </div>`;
  }

  container.innerHTML = html;
}

function extractServiceFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? ':' + u.port : '');
  } catch {
    return url.split('/')[2] || 'external';
  }
}

// ── Event List ───────────────────────────────────────────────────

function renderEventList() {
  const container = document.getElementById('event-list');
  const filtered = filterEventList(currentEvents, currentFilter);

  document.getElementById('event-filter-count').textContent = `(${filtered.length})`;

  container.innerHTML = filtered.map((event, idx) => {
    const originalIdx = currentEvents.indexOf(event);
    const durStr = event.durationMs > 0 ? `${event.durationMs}ms` : '';
    const typeShort = escapeHtml(event.type.replace('http_', '').replace('_in', '↓').replace('_out', '↑'));

    return `
      <div class="event-item ${originalIdx === currentCursor ? 'current' : ''}"
           onclick="seekTo(${originalIdx})">
        <span class="event-seq">#${event.sequence}</span>
        <span class="event-type-badge type-${escapeHtml(event.type)}">${typeShort}</span>
        <span class="event-op">${escapeHtml(event.operationName)}</span>
        ${durStr ? `<span class="event-dur">${durStr}</span>` : ''}
      </div>`;
  }).join('');
}

function filterEventList(events, filter) {
  if (filter === 'all') return events;
  if (filter === 'http') return events.filter(e => e.type.startsWith('http'));
  if (filter === 'db') return events.filter(e => e.type.startsWith('db') || e.type.startsWith('cache'));
  if (filter === 'fs') return events.filter(e => e.type.startsWith('fs'));
  if (filter === 'dns') return events.filter(e => e.type.startsWith('dns'));
  if (filter === 'random') return events.filter(e => ['random', 'timestamp', 'uuid'].includes(e.type));
  if (filter === 'error') return events.filter(e => e.type === 'error' || e.error);
  return events;
}

function filterEvents(type) {
  currentFilter = type;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  renderEventList();
}

// ── Event Detail (Tabbed) ────────────────────────────────────────

function showEventDetail(event) {
  if (!event) return;
  currentEventRef = event;

  document.getElementById('event-detail-empty').style.display = 'none';
  document.getElementById('event-detail').style.display = 'block';

  document.getElementById('detail-type').textContent = event.type;
  document.getElementById('detail-type').className = `event-type-badge type-${event.type}`;
  document.getElementById('detail-operation').textContent = event.operationName;

  document.getElementById('detail-sequence').textContent = `seq: #${event.sequence}`;
  document.getElementById('detail-wallclock').textContent = `time: ${new Date(event.wallClock).toISOString().slice(11, 23)}`;
  document.getElementById('detail-duration').textContent = event.durationMs > 0 ? `duration: ${event.durationMs}ms` : '';

  document.getElementById('detail-data').innerHTML = syntaxHighlight(event.data);

  // Error tab
  const errorBtn = document.getElementById('tab-error-btn');
  if (event.error) {
    errorBtn.style.display = '';
    document.getElementById('detail-error').innerHTML = syntaxHighlight(event.error);
  } else {
    errorBtn.style.display = 'none';
    // If error tab was active, switch to data
    if (document.getElementById('tab-error').style.display !== 'none') {
      switchTab('data');
    }
  }

  // Metadata
  document.getElementById('detail-meta').innerHTML = syntaxHighlight({
    id: event.id,
    traceId: event.traceId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId,
    hlc: event.hlc,
    tags: event.tags,
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.detail-tab-content').forEach(el => el.style.display = 'none');

  document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).style.display = '';
}

function copyEventJSON() {
  if (!currentEventRef) return;
  const json = JSON.stringify(currentEventRef, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = document.querySelector('.btn-copy');
    const original = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });
}

// ── Event Breakdown ──────────────────────────────────────────────

function renderEventBreakdown() {
  const container = document.getElementById('event-breakdown');
  if (!currentEvents.length) {
    container.innerHTML = '<span class="breakdown-empty">No events</span>';
    return;
  }

  const counts = {};
  const colorMap = {
    http: '#6366f1', db: '#22c55e', cache: '#ec4899',
    timestamp: '#f59e0b', random: '#22d3ee', uuid: '#ec4899',
    timer: '#a78bfa', error: '#ef4444', fs: '#f59e0b', dns: '#22d3ee',
  };

  currentEvents.forEach(e => {
    const group = getMarkerType(e.type);
    counts[group] = (counts[group] || 0) + 1;
  });

  container.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `
      <div class="breakdown-row">
        <span class="breakdown-dot" style="background:${colorMap[type] || '#505872'}"></span>
        <span>${type}</span>
        <span class="breakdown-count">${count}</span>
      </div>
    `).join('');
}

// ── JSON Syntax Highlighting ─────────────────────────────────────

function syntaxHighlight(obj) {
  const json = JSON.stringify(obj, null, 2);
  if (!json) return '';

  return json.replace(/(\"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\\"])*\"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
        match = match.replace(/:$/, '') + ':';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

// ── Tooltip ──────────────────────────────────────────────────────

function showTooltip(e, text) {
  const tip = document.getElementById('tooltip');
  tip.textContent = text;
  tip.style.display = 'block';
  tip.style.left = (e.clientX + 12) + 'px';
  tip.style.top = (e.clientY - 8) + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').style.display = 'none';
}

// ── Status ───────────────────────────────────────────────────────

function setStatus(state) {
  const dot = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  const livePulse = document.getElementById('live-pulse');
  const liveLabel = document.getElementById('live-label');

  dot.className = `status-dot status-${state}`;
  text.textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected';

  // Live pulse indicator
  if (state === 'connected') {
    livePulse.style.borderColor = 'rgba(34, 197, 94, 0.15)';
    livePulse.style.background = 'rgba(34, 197, 94, 0.08)';
    liveLabel.style.color = '#22c55e';
    liveLabel.textContent = 'LIVE';
  } else {
    livePulse.style.borderColor = 'rgba(239, 68, 68, 0.15)';
    livePulse.style.background = 'rgba(239, 68, 68, 0.08)';
    liveLabel.style.color = '#ef4444';
    liveLabel.textContent = state === 'connecting' ? '...' : 'OFF';
  }
}

// ── Metrics Polling ──────────────────────────────────────────────

async function loadMetrics() {
  const data = await api('/stats');
  if (!data) return;

  document.getElementById('metric-sessions').textContent = formatNumber(data.sessionsStored || 0);
  document.getElementById('metric-events').textContent = formatNumber(data.eventsReceived || 0);
  document.getElementById('metric-uptime').textContent = formatUptime(data.uptime || 0);

  // Extract unique services
  const uniqueServices = new Set(sessions.map(s => s.serviceName));
  document.getElementById('metric-services').textContent = uniqueServices.size || '—';

  // License tier from stats
  if (data.license) {
    const tier = data.license.tier || 'community';
    document.getElementById('metric-tier').textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  // Health status
  const statusEl = document.getElementById('metric-status');
  statusEl.innerHTML = `<span class="metric-dot metric-dot-ok"></span> Healthy`;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatUptime(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// ── License Info ─────────────────────────────────────────────────

async function loadLicenseInfo() {
  try {
    const res = await fetch('/api/v1/ui-license');
    if (!res.ok) return;
    const data = await res.json();

    currentTier = data.tier || 'community';
    const badge = document.getElementById('tier-badge');
    const banner = document.getElementById('upgrade-banner');

    // Update tier badge — SECURITY: Type validation to prevent array coercion DoS
    currentTier = typeof currentTier === 'string' ? currentTier : 'community';
    badge.textContent = currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
    badge.className = `tier-badge tier-${currentTier}`;

    // Show upgrade banner for community
    if (currentTier === 'community') {
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }

    // Show expiry warning
    if (data.daysUntilExpiry > 0 && data.daysUntilExpiry <= 14) {
      console.warn(`[ERGENEKON] License expires in ${data.daysUntilExpiry} days`);
    }
  } catch {
    // Silently fall back to community display
  }
}

function dismissUpgrade() {
  document.getElementById('upgrade-banner').style.display = 'none';
}

// ── Keyboard Shortcuts ───────────────────────────────────────────

function toggleKeyboardHelp() {
  const overlay = document.getElementById('keyboard-overlay');
  overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
}

document.addEventListener('keydown', (e) => {
  // Don't intercept if typing in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') {
      e.target.blur();
    }
    return;
  }

  // Keyboard overlay
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleKeyboardHelp();
    return;
  }
  if (e.key === 'Escape') {
    document.getElementById('keyboard-overlay').style.display = 'none';
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('search-input').focus();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (!e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      loadSessions();
      return;
    }
  }

  if (!currentSession) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'k':
      e.preventDefault();
      seekPrev();
      break;
    case 'ArrowRight':
    case 'j':
      e.preventDefault();
      seekNext();
      break;
    case 'Home':
      e.preventDefault();
      seekFirst();
      break;
    case 'End':
      e.preventDefault();
      seekLast();
      break;
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
  }
});

// ── Init ─────────────────────────────────────────────────────────

loadSessions();
loadLicenseInfo();
loadMetrics();
// Auto-refresh
setInterval(loadSessions, 5000);
setInterval(loadMetrics, 10000);
