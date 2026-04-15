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

const CREDIT_CARD_RE = /^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/;
const JWT_RE = /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
const BEARER_RE = /^Bearer\s+.{20,}$/;
const AWS_KEY_RE = /^AKIA[0-9A-Z]{16}$/;
const PRIVATE_KEY_RE = /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/;

function looksLikeSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length < 8) return false;

  return (
    CREDIT_CARD_RE.test(value) ||
    JWT_RE.test(value) ||
    BEARER_RE.test(value) ||
    AWS_KEY_RE.test(value) ||
    PRIVATE_KEY_RE.test(value)
  );
}

// ── Path matching ─────────────────────────────────────────────────

function pathMatchesPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex: "user.*.password" → /^user\.[^.]+\.password$/
  const regexStr = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^.]+')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  + '$';
  return new RegExp(regexStr, 'i').test(path);
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
  const cfg: RedactionConfig = { ...DEFAULT_REDACTION_CONFIG, ...config };
  const fieldNamesLower = new Set(cfg.fieldNames.map(f => f.toLowerCase()));

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
  const result: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (redactSet.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string' && BEARER_RE.test(value)) {
      // Auto-detect Bearer tokens in any header
      result[key] = 'Bearer [REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}
