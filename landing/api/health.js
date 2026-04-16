export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'ergenekon-license-api',
    version: '0.4.0',
    signingKey: !!process.env.ERGENEKON_SIGNING_KEY,
    timestamp: new Date().toISOString(),
  });
}
