export default function handler(req, res) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  // Only respond to GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(200).json({
    status: 'ok',
    service: 'ergenekon-license-api',
    version: '0.4.1',
    // Don't reveal internal config details — just boolean
    ready: !!process.env.ERGENEKON_SIGNING_KEY,
    timestamp: new Date().toISOString(),
  });
}
