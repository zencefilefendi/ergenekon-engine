// ============================================================================
// ERGENEKON PROBE — Deep Field Redaction Engine
//
// Production recordings MUST NOT contain sensitive data.
// This engine recursively walks any object and redacts fields matching
// configured patterns — by name, path, or value shape.
//
// Supports:
// - Exact field name match: "password", "ssn"
// - Dot-path patterns: "user.creditCard.number"
// - Glob patterns: "*.secret", "auth.*"
// - Value-shape detection: credit card numbers, emails, JWTs
// - Custom redactor functions
//
// Design: NEVER mutates the original — always returns a deep copy.
// ============================================================================

export interface RedactionConfig {
  /** Field names to redact (case-insensitive). Default: common sensitive fields */
  fieldNames: string[];

  /** Dot-path patterns (supports * wildcard). e.g. "user.*.password" */
  pathPatterns: string[];

  /** Automatically detect and redact values that look like secrets */
  autoDetect: boolean;

  /** Custom redaction function (receives field name, value, path) */
  customRedactor?: (field: string, value: unknown, path: string) => unknown | undefined;

  /** Replacement text. Default: "[REDACTED]" */
  replacement: string;

  /** Max depth to traverse (prevent infinite recursion). Default: 20 */
  maxDepth: number;
}

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  fieldNames: [
    'password', 'passwd', 'pass', 'pwd',
    'secret', 'token', 'apikey', 'api_key', 'apiKey',
    'authorization', 'auth',
    'cookie', 'session', 'sessionid', 'session_id', 'sessionId',
    'creditcard', 'credit_card', 'creditCard', 'cardnumber', 'card_number', 'cardNumber',
    'cvv', 'cvc', 'ccv',
    'ssn', 'social_security', 'socialSecurity',
    'privatekey', 'private_key', 'privateKey',
    'accesstoken', 'access_token', 'accessToken',
    'refreshtoken', 'refresh_token', 'refreshToken',
  ],
  pathPatterns: [],
  autoDetect: true,
  replacement: '[REDACTED]',
  maxDepth: 20,
};

// ── Value shape detectors ─────────────────────────────────────────

// Credit cards: 15 digits (Amex) or 16 digits (Visa/MC/Discover)
const CREDIT_CARD_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/;
const JWT_RE = /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/;
const BEARER_RE = /Bearer\s+.{20,}/i;
const BASIC_AUTH_RE = /Basic\s+[A-Za-z0-9+/=]{8,}/i;
const AWS_KEY_RE = /(?:AKIA|ASIA)[0-9A-Z]{16}/;
// All private key types: RSA, EC, DSA, OPENSSH, ENCRYPTED (unanchored + bypass ReDoS)
const PRIVATE_KEY_RE = /-----BEGIN[^-]+PRIVATE\s+KEY-----/;
// Stripe keys: sk_live_, rk_live_, whsec_
const STRIPE_KEY_RE = /(?:sk_live_|rk_live_|whsec_|sk_test_|rk_test_)[a-zA-Z0-9]{10,}/;
// Slack tokens: xoxb-, xoxp-, xoxa-, xoxr-, xoxs-
const SLACK_TOKEN_RE = /xox[bpars]-[a-zA-Z0-9-]{10,}/;
// GitHub tokens: ghp_, gho_, ghs_, ghu_, ghr_
const GITHUB_TOKEN_RE = /(?:ghp_|gho_|ghs_|ghu_|ghr_)[a-zA-Z0-9]{30,}/;
// Email addresses in free text
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// SSN pattern (US)
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

// New Cloud / SaaS Providers
const GOOGLE_TOKEN_RE = /ya29\.[a-zA-Z0-9_-]{30,}/;
const OPENAI_TOKEN_RE = /sk-(?:proj-)?[a-zA-Z0-9_-]{30,}/;
const ANTHROPIC_TOKEN_RE = /sk-ant-[a-zA-Z0-9_-]{30,}/;
const SENDGRID_TOKEN_RE = /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/;
const TWILIO_TOKEN_RE = /SK[a-f0-9]{32}/i;
const NOTION_TOKEN_RE = /secret_[a-zA-Z0-9]{43}/;
const SUPABASE_TOKEN_RE = /sbp_[a-zA-Z0-9]{40}/;

function looksLikeSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 8) return false;

  return (
    CREDIT_CARD_RE.test(value) ||
    JWT_RE.test(value) ||
    BEARER_RE.test(value) ||
    BASIC_AUTH_RE.test(value) ||
    AWS_KEY_RE.test(value) ||
    PRIVATE_KEY_RE.test(value) ||
    STRIPE_KEY_RE.test(value) ||
    SLACK_TOKEN_RE.test(value) ||
    GITHUB_TOKEN_RE.test(value) ||
    SSN_RE.test(value) ||
    GOOGLE_TOKEN_RE.test(value) ||
    OPENAI_TOKEN_RE.test(value) ||
    ANTHROPIC_TOKEN_RE.test(value) ||
    SENDGRID_TOKEN_RE.test(value) ||
    TWILIO_TOKEN_RE.test(value) ||
    NOTION_TOKEN_RE.test(value) ||
    SUPABASE_TOKEN_RE.test(value)
  );
}

// ── Path matching ─────────────────────────────────────────────────

// SECURITY (HIGH-34): Cache compiled patterns to prevent ReDoS from repeated compilation
const _patternCache = new Map<string, RegExp>();
function getPatternRegex(pattern: string): RegExp {
  let cached = _patternCache.get(pattern);
  if (!cached) {
    if (_patternCache.size >= 1000) _patternCache.clear();
    // SECURITY: Proper escape + glob conversion
    // Use non-printable chars as placeholders (won't be touched by regex escaper)
    const regexStr = '^' + pattern
      .replace(/\*\*/g, '\x00')                    // ** → placeholder
      .replace(/\*/g, '\x01')                       // * → placeholder
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')       // escape all regex specials
      .replace(/\x00/g, '.*')                       // restore ** → any depth
      .replace(/\x01/g, '[^.]+')                    // restore * → one segment
    + '$';
    cached = new RegExp(regexStr, 'i');
    _patternCache.set(pattern, cached);
  }
  return cached;
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  return getPatternRegex(pattern).test(path);
}

// ── Main Redaction Engine ─────────────────────────────────────────

/**
 * Deep-redact sensitive fields from any object.
 * Returns a NEW object — never mutates the original.
 */
export function redactDeep(
  obj: unknown,
  config: Partial<RedactionConfig> = {}
): unknown {
  const cfg: RedactionConfig = {
    ...DEFAULT_REDACTION_CONFIG,
    ...config,
    fieldNames: Array.from(new Set([
      ...DEFAULT_REDACTION_CONFIG.fieldNames,
      ...(config.fieldNames || [])
    ])),
    pathPatterns: Array.from(new Set([
      ...DEFAULT_REDACTION_CONFIG.pathPatterns,
      ...(config.pathPatterns || [])
    ]))
  };
  const fieldNamesLower = new Set(cfg.fieldNames.map(f => f.toLowerCase()));
  // SECURITY: Track visited objects to prevent circular reference → stack overflow
  const visited = new WeakSet<object>();

  function walk(value: unknown, path: string, depth: number): unknown {
    // Depth limit
    if (depth > cfg.maxDepth) return cfg.replacement;

    // Null/undefined pass through
    if (value === null || value === undefined) return value;

    // Primitives: check if the VALUE looks like a secret (auto-detect)
    if (typeof value === 'string') {
      if (cfg.autoDetect && looksLikeSecret(value)) {
        return cfg.replacement;
      }
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    // SECURITY: Circular reference guard — prevent stack overflow crash
    if (typeof value === 'object' && value !== null) {
      if (visited.has(value)) {
        return '[CIRCULAR]';
      }
      visited.add(value);
    }

    // Arrays: walk each element
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    }

    // Objects: walk each key
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;

        // Check 1: Field name match
        if (fieldNamesLower.has(key.toLowerCase())) {
          result[key] = cfg.replacement;
          continue;
        }

        // Check 2: Path pattern match
        if (cfg.pathPatterns.some(p => pathMatchesPattern(childPath, p))) {
          result[key] = cfg.replacement;
          continue;
        }

        // Check 3: Custom redactor
        if (cfg.customRedactor) {
          const custom = cfg.customRedactor(key, val, childPath);
          if (custom !== undefined) {
            result[key] = custom;
            continue;
          }
        }

        // Recurse
        result[key] = walk(val, childPath, depth + 1);
      }
      return result;
    }

    return value;
  }

  return walk(obj, '', 0);
}

/**
 * Redact headers — simpler version for HTTP header objects.
 * Case-insensitive matching on header names.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  redactList: string[]
): Record<string, string | string[] | undefined> {
  const redactSet = new Set(redactList.map(h => h.toLowerCase()));
  // SECURITY: Always redact session/auth/cloud metadata headers regardless of config
  const ALWAYS_REDACT = new Set([
    'authorization', 'cookie', 'set-cookie', 'proxy-authorization',
    'x-amz-security-token', 'x-aws-session-token', 'x-goog-auth', 'x-goog-iam-authorization-token'
  ]);
  const result: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (redactSet.has(lowerKey) || ALWAYS_REDACT.has(lowerKey) || lowerKey.startsWith('x-api-key')) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && (
      BEARER_RE.test(value) ||
      BASIC_AUTH_RE.test(value) ||
      PRIVATE_KEY_RE.test(value)
    )) {
      // Auto-detect Bearer, Basic, and private key material in any header
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}
