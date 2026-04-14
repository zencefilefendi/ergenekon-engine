export type {
  EventType,
  HLCTimestamp,
  ParadoxEvent,
  ErrorInfo,
  RecordingSession,
  SessionMetadata,
  ProbeConfig,
  ReplayConfig,
} from './types.js';

export { DEFAULT_PROBE_CONFIG } from './types.js';
export { HybridLogicalClock, compareHLC } from './hlc.js';
export { ulid } from './ulid.js';
export {
  exportSessionJSON,
  exportSessionsJSON,
  importSessionsJSON,
  exportSessionBinary,
  importSessionBinary,
  type ExportOptions,
} from './session-io.js';

// ── License System ─────────────────────────────────────────────────
export type {
  LicenseTier,
  LicenseFeature,
  LicenseToken,
  SignedLicense,
  LicenseValidation,
  TierLimits,
} from './license-types.js';

export {
  TIER_FEATURES,
  TIER_LIMITS,
  LICENSE_FILE_SEARCH_PATHS,
  LICENSE_ENV_VAR,
  LICENSE_INLINE_ENV_VAR,
} from './license-types.js';

export {
  validateLicense,
  loadLicense,
  hasFeature,
  isAtLeastTier,
  getTierDisplay,
} from './license-validator.js';
