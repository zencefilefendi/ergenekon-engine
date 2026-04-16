# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | ✅ Active support |
| < 0.4   | ❌ Not supported  |

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability in ERGENEKON Engine, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities.
2. **Email** security concerns to: **security@ergenekon.dev**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Action | Timeframe |
|--------|-----------|
| Acknowledgment | 24 hours |
| Initial assessment | 48 hours |
| Patch release | 7 days (critical), 30 days (moderate) |
| Public disclosure | After patch + 90 days |

### Scope

| In Scope | Out of Scope |
|----------|-------------|
| License validation bypass | Social engineering |
| API authentication bypass | Denial of service (rate limited) |
| Private key exposure | Issues in dependencies |
| XSS / injection in API | UI cosmetic issues |
| CORS misconfiguration | |

### Cryptographic Details

- **Signing Algorithm:** Ed25519 (RFC 8032)
- **Key Size:** 256-bit (128-bit security level)
- **License Format:** JSON + base64 Ed25519 signature
- **Key Rotation:** Production keys are rotated when any exposure is detected

### Safe Harbor

We support responsible disclosure. Security researchers acting in good faith will not face legal action. We ask that you:

- Make a good-faith effort to avoid data destruction and privacy violations
- Give us reasonable time to address the issue before public disclosure
- Do not access or modify data belonging to other users

## Security Measures

- HSTS with preload (63M seconds)
- CORS restricted to ergenekon.dev
- Ed25519 license signatures (not HMAC)
- Input sanitization on all API endpoints
- Rate limiting (global + per-email)
- No PII in server logs
- Disposable email blocking
- Security headers on all responses
