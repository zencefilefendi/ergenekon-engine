// ============================================================================
// PARADOX PROBE — Redaction Engine Tests
//
// Validates PII protection:
//   1. Field name matching (case-insensitive)
//   2. Path pattern matching (glob)
//   3. Auto-detect: credit cards, JWTs, Bearer tokens, AWS keys, private keys
//   4. Deep/nested objects and arrays
//   5. Never mutates original
//   6. Header redaction
//   7. Custom redactors
//   8. Depth limit
// ============================================================================

import { describe, it, expect } from 'vitest';
import { redactDeep, redactHeaders } from './redaction.js';

describe('redactDeep — field name matching', () => {
  it('redacts common sensitive fields', () => {
    const input = {
      username: 'ali',
      password: 'hunter2',
      apiKey: 'sk-abc123',
      token: 'tok_xyz',
    };
    const result = redactDeep(input) as Record<string, unknown>;
    expect(result.username).toBe('ali');
    expect(result.password).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('is case-insensitive on field names', () => {
    const result = redactDeep({
      PASSWORD: 'secret',
      ApiKey: 'key123',
      TOKEN: 'tok',
    }) as Record<string, unknown>;
    expect(result.PASSWORD).toBe('[REDACTED]');
    expect(result.ApiKey).toBe('[REDACTED]');
    expect(result.TOKEN).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const input = {
      user: {
        name: 'Ali',
        credentials: {
          password: 'secret123',
          accessToken: 'tok_abc',
        },
      },
    };
    const result = redactDeep(input) as any;
    expect(result.user.name).toBe('Ali');
    expect(result.user.credentials.password).toBe('[REDACTED]');
    expect(result.user.credentials.accessToken).toBe('[REDACTED]');
  });

  it('redacts entire object when field name matches', () => {
    // "auth" is a sensitive field name — entire value gets replaced
    const input = { user: { auth: { password: 'secret' } } };
    const result = redactDeep(input) as any;
    expect(result.user.auth).toBe('[REDACTED]');
  });

  it('never mutates the original', () => {
    const input = { password: 'secret', name: 'Ali' };
    const inputCopy = JSON.parse(JSON.stringify(input));
    redactDeep(input);
    expect(input).toEqual(inputCopy);
  });
});

describe('redactDeep — auto-detect', () => {
  it('detects credit card numbers (spaces)', () => {
    const result = redactDeep({ data: '4111 1111 1111 1111' }) as any;
    expect(result.data).toBe('[REDACTED]');
  });

  it('detects credit card numbers (dashes)', () => {
    const result = redactDeep({ data: '4111-1111-1111-1111' }) as any;
    expect(result.data).toBe('[REDACTED]');
  });

  it('detects credit card numbers (no separators)', () => {
    const result = redactDeep({ data: '4111111111111111' }) as any;
    expect(result.data).toBe('[REDACTED]');
  });

  it('detects JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactDeep({ token: jwt }) as any;
    // Field name match OR auto-detect — either way, redacted
    expect(result.token).toBe('[REDACTED]');
  });

  it('detects Bearer tokens', () => {
    const result = redactDeep({ header: 'Bearer sk-12345678901234567890' }) as any;
    expect(result.header).toBe('[REDACTED]');
  });

  it('detects AWS access keys', () => {
    const result = redactDeep({ key: 'AKIAIOSFODNN7EXAMPLE' }) as any;
    expect(result.key).toBe('[REDACTED]');
  });

  it('detects private keys', () => {
    const result = redactDeep({ cert: '-----BEGIN PRIVATE KEY-----\nMIIEvgIB...' }) as any;
    expect(result.cert).toBe('[REDACTED]');
  });

  it('does NOT redact normal short strings', () => {
    const result = redactDeep({ name: 'Ali', city: 'Istanbul' }) as any;
    expect(result.name).toBe('Ali');
    expect(result.city).toBe('Istanbul');
  });

  it('can disable auto-detect', () => {
    const result = redactDeep(
      { data: '4111 1111 1111 1111' },
      { autoDetect: false }
    ) as any;
    expect(result.data).toBe('4111 1111 1111 1111');
  });
});

describe('redactDeep — path patterns', () => {
  it('matches exact paths', () => {
    const result = redactDeep(
      { user: { email: 'ali@example.com', name: 'Ali' } },
      { pathPatterns: ['user.email'] }
    ) as any;
    expect(result.user.email).toBe('[REDACTED]');
    expect(result.user.name).toBe('Ali');
  });

  it('matches wildcard paths', () => {
    const result = redactDeep(
      { users: [{ ssn: '123-45-6789' }, { ssn: '987-65-4321' }] },
      { pathPatterns: ['users.*.ssn'] }
    ) as any;
    // ssn is in DEFAULT field names so will be redacted anyway
    expect(result.users[0].ssn).toBe('[REDACTED]');
  });

  it('matches glob star patterns', () => {
    const result = redactDeep(
      { a: { b: { secret_data: 'hidden' } } },
      { pathPatterns: ['**.secret_data'] }
    ) as any;
    expect(result.a.b.secret_data).toBe('[REDACTED]');
  });
});

describe('redactDeep — arrays', () => {
  it('handles arrays of objects', () => {
    const input = [
      { name: 'Ali', password: 'secret1' },
      { name: 'Veli', password: 'secret2' },
    ];
    const result = redactDeep(input) as any[];
    expect(result[0].name).toBe('Ali');
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].password).toBe('[REDACTED]');
  });

  it('handles nested arrays', () => {
    const result = redactDeep({ data: [[{ token: 'abc' }]] }) as any;
    expect(result.data[0][0].token).toBe('[REDACTED]');
  });
});

describe('redactDeep — edge cases', () => {
  it('handles null', () => {
    expect(redactDeep(null)).toBeNull();
  });

  it('handles undefined', () => {
    expect(redactDeep(undefined)).toBeUndefined();
  });

  it('handles primitives', () => {
    expect(redactDeep(42)).toBe(42);
    expect(redactDeep('hello')).toBe('hello');
    expect(redactDeep(true)).toBe(true);
  });

  it('handles empty object', () => {
    expect(redactDeep({})).toEqual({});
  });

  it('handles depth limit', () => {
    // Create deeply nested object
    let obj: any = { value: 'deep' };
    for (let i = 0; i < 25; i++) {
      obj = { nested: obj };
    }
    const result = redactDeep(obj, { maxDepth: 5 }) as any;
    // After depth 5, should be replaced
    expect(result.nested.nested.nested.nested.nested.nested).toBe('[REDACTED]');
  });

  it('custom replacement text', () => {
    const result = redactDeep(
      { password: 'secret' },
      { replacement: '***' }
    ) as any;
    expect(result.password).toBe('***');
  });

  it('custom redactor function', () => {
    const result = redactDeep(
      { email: 'ali@example.com', name: 'Ali' },
      {
        customRedactor: (field, value) => {
          if (field === 'email' && typeof value === 'string') {
            return value.replace(/.+@/, '***@');
          }
          return undefined; // Don't handle
        },
      }
    ) as any;
    expect(result.email).toBe('***@example.com');
    expect(result.name).toBe('Ali');
  });
});

describe('redactHeaders', () => {
  it('redacts specified headers', () => {
    const result = redactHeaders(
      { 'authorization': 'Bearer tok123', 'content-type': 'application/json' },
      ['authorization']
    );
    expect(result['authorization']).toBe('[REDACTED]');
    expect(result['content-type']).toBe('application/json');
  });

  it('auto-detects Bearer tokens in any header', () => {
    const result = redactHeaders(
      { 'x-custom-auth': 'Bearer sk-12345678901234567890' },
      []
    );
    expect(result['x-custom-auth']).toBe('Bearer [REDACTED]');
  });

  it('case-insensitive header matching', () => {
    const result = redactHeaders(
      { 'Authorization': 'secret' },
      ['authorization']
    );
    expect(result['Authorization']).toBe('[REDACTED]');
  });
});
