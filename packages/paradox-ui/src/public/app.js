// ============================================================================
// PARADOX UI — Time-Travel Debugger Application Logic
// ============================================================================

let sessions = [];
let currentSession = null;
let currentEvents = [];
let currentCursor = 0;
let currentFilter = 'all';
let playInterval = null;

// ── API Calls ────────────────────────────────────────────────────

async function api(path) {
  try {
    const res = await fetch(`/api/v1${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    return null;
  }
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
    const time = new Date(s.startedAt).toLocaleTimeString();
    const duration = s.endedAt ? `${s.endedAt - s.startedAt}ms` : 'ongoing';
    const active = currentSession?.id === s.id ? 'active' : '';
    const errorDot = s.hasError ? '<span class="error-dot">&#9679;</span>' : '';

    return `
      <div class="session-item ${active}" onclick="selectSession('${s.id}')">
        <div class="session-item-title">${s.serviceName}</div>
        <div class="session-item-meta">
          <span>${time}</span>
          <span>${s.eventCount} events</span>
          <span>${duration}</span>
          ${errorDot}
        </div>
      </div>`;
  }).join('');
}

function filterSessions() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const filtered = sessions.filter(s =>
    s.serviceName.toLowerCase().includes(query) ||
    s.traceId?.toLowerCase().includes(query) ||
    s.id.toLowerCase().includes(query)
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

  // Header
  const firstEvent = currentEvents[0];
  const lastEvent = currentEvents[currentEvents.length - 1];
  const method = firstEvent?.data?.method || '';
  const path = firstEvent?.data?.path || firstEvent?.data?.url || '';

  document.getElementById('session-title').textContent = `${method} ${path}`;
  document.getElementById('session-service').textContent = data.serviceName;
  document.getElementById('session-trace').textContent = `trace: ${data.traceId?.slice(0, 8)}...`;
  document.getElementById('session-duration').textContent = `${data.metadata?.totalDurationMs || 0}ms`;
  document.getElementById('session-event-count').textContent = `${currentEvents.length} events`;

  // Timeline
  renderTimeline();

  // Flow graph
  renderFlowGraph();

  // Events
  renderEventList();
  updateCursor();

  // Highlight in session list
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.session-item');
  items.forEach(el => {
    if (el.onclick.toString().includes(sessionId)) el.classList.add('active');
  });

  renderSessionList(sessions); // Re-render to update active state
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
    marker.className = `timeline-marker type-${getMarkerType(event.type)}`;
    marker.style.left = `${pct}%`;
    marker.title = `#${event.sequence} ${event.type}: ${event.operationName}`;
    marker.onclick = (e) => { e.stopPropagation(); seekTo(idx); };
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

// ── Flow Graph ───────────────────────────────────────────────────

function renderFlowGraph() {
  const container = document.getElementById('flow-graph');

  // Extract unique services from events
  const services = new Set();
  services.add(currentSession.serviceName);

  // Find cross-service calls
  const crossCalls = [];
  currentEvents.forEach(event => {
    if (event.type === 'http_request_out') {
      const url = event.data?.url || '';
      crossCalls.push({ from: currentSession.serviceName, url });
    }
  });

  // Build flow
  let html = `<div class="flow-node active">${currentSession.serviceName}</div>`;

  crossCalls.forEach(call => {
    const target = extractServiceFromUrl(call.url);
    html += `<span class="flow-arrow">&#8594;</span>`;
    html += `<div class="flow-node">${target}</div>`;
  });

  container.innerHTML = html;
}

function extractServiceFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + ':' + u.port;
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
    const typeShort = event.type.replace('http_', '').replace('_in', '↓').replace('_out', '↑');

    return `
      <div class="event-item ${originalIdx === currentCursor ? 'current' : ''}"
           onclick="seekTo(${originalIdx})">
        <span class="event-seq">#${event.sequence}</span>
        <span class="event-type-badge type-${event.type}">${typeShort}</span>
        <span class="event-op">${event.operationName}</span>
        ${durStr ? `<span class="event-dur">${durStr}</span>` : ''}
      </div>`;
  }).join('');
}

function filterEventList(events, filter) {
  if (filter === 'all') return events;
  if (filter === 'http') return events.filter(e => e.type.startsWith('http'));
  if (filter === 'db') return events.filter(e => e.type.startsWith('db') || e.type.startsWith('cache'));
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

// ── Event Detail ─────────────────────────────────────────────────

function showEventDetail(event) {
  if (!event) return;

  document.getElementById('event-detail-empty').style.display = 'none';
  document.getElementById('event-detail').style.display = 'block';

  document.getElementById('detail-type').textContent = event.type;
  document.getElementById('detail-type').className = `event-type-badge type-${event.type}`;
  document.getElementById('detail-operation').textContent = event.operationName;

  document.getElementById('detail-sequence').textContent = `seq: #${event.sequence}`;
  document.getElementById('detail-wallclock').textContent = `time: ${new Date(event.wallClock).toISOString().slice(11, 23)}`;
  document.getElementById('detail-duration').textContent = event.durationMs > 0 ? `duration: ${event.durationMs}ms` : '';

  document.getElementById('detail-data').innerHTML = syntaxHighlight(event.data);

  // Error section
  const errorSection = document.getElementById('detail-error-section');
  if (event.error) {
    errorSection.style.display = 'block';
    document.getElementById('detail-error').innerHTML = syntaxHighlight(event.error);
  } else {
    errorSection.style.display = 'none';
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

// ── JSON Syntax Highlighting ─────────────────────────────────────

function syntaxHighlight(obj) {
  const json = JSON.stringify(obj, null, 2);
  if (!json) return '';

  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
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

// ── Status ───────────────────────────────────────────────────────

function setStatus(state) {
  const dot = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  dot.className = `status-dot status-${state}`;
  text.textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected';
}

// ── Keyboard Shortcuts ───────────────────────────────────────────

document.addEventListener('keydown', (e) => {
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
// Auto-refresh every 5 seconds
setInterval(loadSessions, 5000);
