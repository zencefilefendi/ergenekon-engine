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
| XSS / injection in UI or API | UI cosmetic issues |
| CORS misconfiguration | |
| Collector auth bypass | |
| Session data exfiltration | |
| Prototype pollution | |

### Cryptographic Details

- **Signing Algorithm:** Ed25519 (RFC 8032)
- **Key Size:** 256-bit (128-bit security level)
- **License Format:** Canonical JSON + base64 Ed25519 signature
- **Key Rotation:** Production keys are rotated when any exposure is detected
- **Random Generation:** All IDs and sampling use `crypto.randomBytes` (CSPRNG)

### Safe Harbor

We support responsible disclosure. Security researchers acting in good faith will not face legal action. We ask that you:

- Make a good-faith effort to avoid data destruction and privacy violations
- Give us reasonable time to address the issue before public disclosure
- Do not access or modify data belonging to other users

## Security Measures

### Authentication & Authorization
- Collector requires `ERGENEKON_COLLECTOR_TOKEN` bearer auth for write ops (CRIT-01)
- Admin API uses timing-safe comparison with fixed-size buffers (HIGH-03)
- Host header validation on all servers (HIGH-13)

### Data Protection
- Deep field redaction: 20+ secret patterns (JWT, Bearer, API keys, CC, SSN, etc.)
- Outgoing HTTP and database interceptors apply `redactDeep` (CRIT-03)
- No PII in server logs — customer emails masked before logging
- Spill buffer sessions redacted before disk write

### Input Validation
- Streaming body size limits (CRIT-04) — OOM impossible
- Recursive prototype pollution guard via JSON.parse reviver (HIGH-01)
- Customer name sanitization via regex (HIGH-04)
- Disposable email blocklist with exact domain match (HIGH-16)
- Session overwrite prevention (HIGH-09)

### UI Security
- All innerHTML uses escaped via `escapeHtml()` (CRIT-09)
- Content-Security-Policy on all HTML responses (HIGH-14)
- API proxy validates paths against strict allowlist (HIGH-22)
- SPA fallback only for navigation, not assets (HIGH-32)

### Cryptographic Integrity
- Canonical JSON signing with sorted keys (CRIT-06)
- Gzip bomb protection with `maxOutputLength` (CRIT-07)
- HLC overflow guard + remote drift cap (CRIT-08)
- Checksum legacy bypass emits security warning (CRIT-10)
- License feature override validated against tier allowlist (HIGH-27)

### Infrastructure
- Docker containers run as non-root user (MED-01)
- `npm ci --ignore-scripts` in Dockerfiles (MED-17)
- `.dockerignore` excludes `.env`, `*.pem`, `*.key` (HIGH-30)
- Rate limiter: negative token fix + 100k bucket cap (HIGH-24/25)
- Dependabot for npm, Actions, and Docker updates (MED-16)
- HSTS with preload, CORS restricted to ergenekon.dev
- Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)

### Network Security
- CORS restricted to explicit origin allowlist — no wildcard
- CORS fallback does not leak allowed origins (HIGH-21)
- Backend Docker network is internal-only
- All containers: `no-new-privileges`, `read_only`, `cap_drop: ALL`
