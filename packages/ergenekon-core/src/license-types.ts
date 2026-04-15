// ============================================================================
// ERGENEKON ENGINE — License Type Definitions
//
// Defines the structure of license tokens, tier configurations,
// feature flags, and limits for the commercial licensing system.
//
// The license system uses Ed25519 digital signatures for tamper-proof
// validation that works completely offline — no phone-home required.
// ============================================================================

// ── License Tiers ──────────────────────────────────────────────────

/** The three commercial tiers of ERGENEKON Engine */
export type LicenseTier = 'community' | 'pro' | 'enterprise';

/** All gatable features in the system */
export type LicenseFeature =
  | 'single_service_replay'      // Community: basic record/replay
  | 'basic_cli'                  // Community: sessions, inspect, health, help
  | 'distributed_replay'         // Pro: multi-service cross-trace replay
  | 'smart_sampling'             // Pro: head+tail hybrid sampling engine
  | 'deep_redaction'             // Pro: PII/secret auto-detection + redact
  | 'prdx_export'                // Pro: binary PRDX format export/import
  | 'time_travel_ui'             // Pro: Time-Travel visual debugger
  | 'fs_interceptor'             // Pro: filesystem operation capture
  | 'dns_interceptor'            // Pro: DNS lookup/resolve capture
  | 'database_interceptor'       // Pro: PG/Redis/Mongo capture
  | 'advanced_cli'               // Pro: trace, export, import, stats, watch
  | 'unlimited_retention'        // Enterprise: no retention limit
  | 'sso_saml'                   // Enterprise: SSO/SAML integration
  | 'rbac'                       // Enterprise: role-based access control
  | 'on_premise'                 // Enterprise: on-premise deployment support
  | 'audit_log'                  // Enterprise: full audit trail
  | 'custom_integrations'        // Enterprise: Datadog/Grafana/PagerDuty
  | 'sla_guarantee';             // Enterprise: 99.9% SLA

// ── Tier → Feature Mapping ─────────────────────────────────────────

/** Features included in each tier (cumulative — higher tiers include lower) */
export const TIER_FEATURES: Record<LicenseTier, LicenseFeature[]> = {
  community: [
    'single_service_replay',
    'basic_cli',
  ],
  pro: [
    // Includes all Community features
    'single_service_replay',
    'basic_cli',
    // Pro-exclusive features
    'distributed_replay',
    'smart_sampling',
    'deep_redaction',
    'prdx_export',
    'time_travel_ui',
    'fs_interceptor',
    'dns_interceptor',
    'database_interceptor',
    'advanced_cli',
  ],
  enterprise: [
    // Includes all Pro features
    'single_service_replay',
    'basic_cli',
    'distributed_replay',
    'smart_sampling',
    'deep_redaction',
    'prdx_export',
    'time_travel_ui',
    'fs_interceptor',
    'dns_interceptor',
    'database_interceptor',
    'advanced_cli',
    // Enterprise-exclusive features
    'unlimited_retention',
    'sso_saml',
    'rbac',
    'on_premise',
    'audit_log',
    'custom_integrations',
    'sla_guarantee',
  ],
};

// ── Tier Limits ────────────────────────────────────────────────────

/** Operational limits for each tier */
export interface TierLimits {
  /** Maximum number of services that can be instrumented (-1 = unlimited) */
  maxServices: number;
  /** Maximum events per day (-1 = unlimited) */
  maxEventsPerDay: number;
  /** Maximum retention period in hours (-1 = unlimited) */
  maxRetentionHours: number;
  /** Maximum sessions stored (-1 = unlimited) */
  maxSessions: number;
  /** API rate limit (requests per minute, -1 = unlimited) */
  rateLimitPerMinute: number;
}

export const TIER_LIMITS: Record<LicenseTier, TierLimits> = {
  community: {
    maxServices: 1,
    maxEventsPerDay: 10_000,
    maxRetentionHours: 24,
    maxSessions: 100,
    rateLimitPerMinute: 100,
  },
  pro: {
    maxServices: -1,      // unlimited
    maxEventsPerDay: 1_000_000,
    maxRetentionHours: 720, // 30 days
    maxSessions: -1,       // unlimited
    rateLimitPerMinute: 10_000,
  },
  enterprise: {
    maxServices: -1,
    maxEventsPerDay: -1,
    maxRetentionHours: -1,  // unlimited
    maxSessions: -1,
    rateLimitPerMinute: -1, // unlimited
  },
};

// ── License Token ──────────────────────────────────────────────────

/**
 * The signed license token that customers place in their project.
 *
 * Structure:
 *   1. `payload` — the license data (JSON-serializable)
 *   2. `signature` — Ed25519 signature of the JSON-stringified payload
 *
 * The signature is verified using the embedded public key in the validator.
 * The private key never leaves the license server.
 */
export interface LicenseToken {
  /** Token format version */
  version: 1;

  /** Unique license identifier */
  licenseId: string;

  /** Stripe customer ID */
  customerId: string;

  /** Customer email address */
  customerEmail: string;

  /** Customer/organization name */
  customerName: string;

  /** License tier */
  tier: LicenseTier;

  /** Maximum services allowed (-1 = tier default) */
  maxServices: number;

  /** Maximum events per day (-1 = tier default) */
  maxEventsPerDay: number;

  /** Explicit feature list (overrides tier defaults if present) */
  features: LicenseFeature[];

  /** ISO 8601 timestamp — when this license was issued */
  issuedAt: string;

  /** ISO 8601 timestamp — when this license expires */
  expiresAt: string;
}

/** The complete signed license file format (.ergenekon-license.json) */
export interface SignedLicense {
  /** The license payload */
  payload: LicenseToken;
  /** Base64-encoded Ed25519 signature of JSON.stringify(payload) */
  signature: string;
}

// ── Validation Result ──────────────────────────────────────────────

/** Result of license validation */
export interface LicenseValidation {
  /** Whether the license is valid */
  valid: boolean;

  /** The validated license (null if invalid) */
  license: LicenseToken | null;

  /** The resolved tier (falls back to 'community' if invalid) */
  tier: LicenseTier;

  /** Available features based on the tier */
  features: LicenseFeature[];

  /** Operational limits based on the tier */
  limits: TierLimits;

  /** Human-readable validation error (null if valid) */
  error: string | null;

  /** Days until expiration (-1 if no expiry / community) */
  daysUntilExpiry: number;
}

// ── License File Search Paths ──────────────────────────────────────

/** Ordered list of paths where the license file is searched */
export const LICENSE_FILE_SEARCH_PATHS = [
  '.ergenekon-license.json',                   // Current directory
  'paradox-license.json',                    // Current directory (alt)
  `${process.env.HOME || '~'}/.ergenekon-license.json`,  // Home directory
];

/** Environment variable for license file path override */
export const LICENSE_ENV_VAR = 'ERGENEKON_LICENSE';

/** Environment variable for inline license JSON */
export const LICENSE_INLINE_ENV_VAR = 'ERGENEKON_LICENSE_KEY';
