// ============================================================================
// ERGENEKON Dashboard — Demo Mode Data
// Realistic mock data for the live demo at dashboard.ergenekon.dev
// ============================================================================

const DEMO_SESSIONS = [
  {
    id: 'sess_demo_order_001',
    method: 'POST',
    path: '/api/orders',
    statusCode: 201,
    serviceName: 'order-service',
    duration: 23,
    eventCount: 13,
    hasError: false,
    startedAt: new Date(Date.now() - 120000).toISOString(),
    recordedAt: new Date(Date.now() - 120000).toISOString(),
    traceId: 'abc123def456789012345678',
    metadata: { totalDurationMs: 23 },
  },
  {
    id: 'sess_demo_user_002',
    method: 'GET',
    path: '/api/users/42',
    statusCode: 200,
    serviceName: 'user-service',
    duration: 8,
    eventCount: 7,
    hasError: false,
    startedAt: new Date(Date.now() - 180000).toISOString(),
    recordedAt: new Date(Date.now() - 180000).toISOString(),
    traceId: 'abc123def456789012345678',
    metadata: { totalDurationMs: 8 },
  },
  {
    id: 'sess_demo_payment_003',
    method: 'POST',
    path: '/api/payments/charge',
    statusCode: 500,
    serviceName: 'payment-service',
    duration: 145,
    eventCount: 9,
    hasError: true,
    startedAt: new Date(Date.now() - 300000).toISOString(),
    recordedAt: new Date(Date.now() - 300000).toISOString(),
    traceId: 'xyz789abc123456789012345',
    metadata: { totalDurationMs: 145 },
  },
  {
    id: 'sess_demo_auth_004',
    method: 'POST',
    path: '/api/auth/login',
    statusCode: 200,
    serviceName: 'auth-service',
    duration: 34,
    eventCount: 6,
    hasError: false,
    startedAt: new Date(Date.now() - 600000).toISOString(),
    recordedAt: new Date(Date.now() - 600000).toISOString(),
    traceId: 'auth00001234567890123456',
    metadata: { totalDurationMs: 34 },
  },
  {
    id: 'sess_demo_search_005',
    method: 'GET',
    path: '/api/products/search?q=ergenekon',
    statusCode: 200,
    serviceName: 'search-service',
    duration: 67,
    eventCount: 8,
    hasError: false,
    startedAt: new Date(Date.now() - 900000).toISOString(),
    recordedAt: new Date(Date.now() - 900000).toISOString(),
    traceId: 'search001234567890123456',
    metadata: { totalDurationMs: 67 },
  },
];

function generateDemoEvents(session) {
  const base = Date.now() - 60000;
  const events = [
    { type: 'http_request_in', operationName: `${session.method} ${session.path}`, data: { method: session.method, url: session.path, headers: { 'content-type': 'application/json', 'x-trace-id': session.traceId } }, durationMs: 0 },
    { type: 'date_now', operationName: 'Date.now()', data: { result: base }, durationMs: 0 },
    { type: 'math_random', operationName: 'Math.random()', data: { result: 0.73421847 }, durationMs: 0 },
    { type: 'db_query', operationName: 'SELECT * FROM users WHERE id = $1', data: { driver: 'pg', query: 'SELECT * FROM users WHERE id = $1', params: ['42'], rows: 1, duration: 3 }, durationMs: 3 },
    { type: 'date_now', operationName: 'Date.now()', data: { result: base + 5 }, durationMs: 0 },
    { type: 'db_query', operationName: 'INSERT INTO orders', data: { driver: 'pg', query: 'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id', params: ['42', '129.99'], rows: 1, duration: 5 }, durationMs: 5 },
    { type: 'http_request_out', operationName: 'GET user-service:3002', data: { method: 'GET', url: 'http://user-service:3002/api/users/42', statusCode: 200, duration: 8 }, durationMs: 8 },
    { type: 'uuid_generate', operationName: 'crypto.randomUUID()', data: { result: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }, durationMs: 0 },
    { type: 'date_now', operationName: 'Date.now()', data: { result: base + 15 }, durationMs: 0 },
    { type: 'math_random', operationName: 'Math.random()', data: { result: 0.29183746 }, durationMs: 0 },
    { type: 'db_query', operationName: 'SET session cache', data: { driver: 'redis', query: 'SET session:abc 1 EX 3600', duration: 1 }, durationMs: 1 },
    { type: 'timer_set', operationName: 'setTimeout(0)', data: { kind: 'setTimeout', delay: 0, id: 1 }, durationMs: 0 },
    { type: 'http_response_out', operationName: `${session.statusCode} Response`, data: { statusCode: session.statusCode, headers: { 'content-type': 'application/json' }, body: '{"success":true,"orderId":"ord_demo_001"}' }, durationMs: 0 },
  ];

  return events.slice(0, session.eventCount).map((e, i) => ({
    ...e,
    id: `evt_${session.id}_${String(i).padStart(3, '0')}`,
    sessionId: session.id,
    sequence: i,
    wallClock: base + (i * (session.duration / session.eventCount)),
    traceId: session.traceId,
    spanId: `span_${i}`,
    hlc: { wallTime: base + i * 2, logical: i, nodeId: session.serviceName },
  }));
}

// Override the api() function for demo mode (only when not connected to live collector)
const _originalApi = api;

async function api(path) {
  // If connected to live collector, use the real API
  if (isLiveMode && collectorUrl) {
    return _originalApi(path);
  }

  // Demo mode: simulate with mock data
  await new Promise(r => setTimeout(r, 100 + Math.random() * 150));

  if (path === '/sessions') {
    return { sessions: DEMO_SESSIONS };
  }

  if (path === '/stats') {
    return {
      sessionsStored: 1247,
      eventsReceived: 34892,
      uptime: 86400,
      license: { tier: 'pro' },
    };
  }

  // Single session with events
  if (path.startsWith('/sessions/')) {
    const id = path.replace('/sessions/', '').replace('/events', '');
    const session = DEMO_SESSIONS.find(s => s.id === id);
    if (session) {
      return {
        ...session,
        events: generateDemoEvents(session),
      };
    }
  }

  return null;
}

// Override loadLicenseInfo for demo
async function loadLicenseInfo() {
  currentTier = 'pro';
  const badge = document.getElementById('tier-badge');
  badge.textContent = '⚡ Pro';
  badge.className = 'tier-badge tier-pro';
  badge.style.background = 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15))';
  badge.style.borderColor = 'rgba(99,102,241,0.3)';
  badge.style.color = '#a78bfa';
}
