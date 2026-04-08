// ============================================================================
// PARADOX ENGINE — Core Type Definitions
// The DNA of every event flowing through the system
// ============================================================================

/** All possible event types captured by probes */
export type EventType =
  | 'http_request_in'       // Incoming HTTP request to the service
  | 'http_response_out'     // Outgoing HTTP response from the service
  | 'http_request_out'      // Outgoing HTTP request (fetch/axios)
  | 'http_response_in'      // Incoming HTTP response from external call
  | 'db_query'              // Database query issued
  | 'db_result'             // Database result received
  | 'cache_get'             // Cache read
  | 'cache_set'             // Cache write
  | 'random'                // Math.random() call
  | 'timestamp'             // Date.now() call
  | 'uuid'                  // crypto.randomUUID() call
  | 'timer_set'             // setTimeout/setInterval created
  | 'timer_fire'            // Timer callback fired
  | 'error'                 // Uncaught error
  | 'custom';               // User-defined event

/**
 * Hybrid Logical Clock timestamp.
 *
 * Combines physical wall time with a logical counter to provide
 * globally-ordered timestamps WITHOUT requiring clock synchronization.
 *
 * Ordering: compare wallTime first, then logical, then nodeId for ties.
 */
export interface HLCTimestamp {
  /** Physical wall time in milliseconds */
  wallTime: number;
  /** Logical counter — disambiguates events at the same wall time */
  logical: number;
  /** Node identifier — final tiebreaker for total ordering */
  nodeId: string;
}

/**
 * A single PARADOX event — the atomic unit of recording.
 *
 * Every I/O boundary crossing produces one event.
 * Events are immutable after creation.
 */
export interface ParadoxEvent {
  /** Unique event ID (ULID — time-sortable) */
  id: string;

  /** W3C Trace ID — links events across services */
  traceId: string;

  /** Span ID for this specific operation */
  spanId: string;

  /** Parent span ID (for causal ordering within a service) */
  parentSpanId: string | null;

  /** Hybrid Logical Clock timestamp */
  hlc: HLCTimestamp;

  /** Wall clock time (ms since epoch) — for human readability */
  wallClock: number;

  /** Event type */
  type: EventType;

  /** Service that produced this event */
  serviceName: string;

  /** Human-readable operation name (e.g., "GET /api/users/:id") */
  operationName: string;

  /** Sequence number within this recording session (for replay ordering) */
  sequence: number;

  /** The captured data — shape depends on event type */
  data: Record<string, unknown>;

  /** Operation duration in milliseconds (0 for instant events like random) */
  durationMs: number;

  /** Error info if this event represents a failure */
  error: ErrorInfo | null;

  /** User-defined tags for filtering */
  tags: Record<string, string>;
}

/** Structured error information */
export interface ErrorInfo {
  name: string;
  message: string;
  stack: string | null;
}

/**
 * A recording session — a complete trace of one request
 * flowing through one or more services.
 */
export interface RecordingSession {
  /** Unique session ID */
  id: string;

  /** Trace ID (same across all services for this request) */
  traceId: string;

  /** Service that created this recording */
  serviceName: string;

  /** When recording started */
  startedAt: number;

  /** When recording ended (0 if still recording) */
  endedAt: number;

  /** All events in this session, ordered by sequence */
  events: ParadoxEvent[];

  /** Metadata about the recording */
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  /** Node.js version */
  nodeVersion: string;
  /** OS platform */
  platform: string;
  /** Probe version */
  probeVersion: string;
  /** Whether the request ended in error */
  hasError: boolean;
  /** Total duration of the recorded request */
  totalDurationMs: number;
}

/**
 * Configuration for a PARADOX probe.
 */
export interface ProbeConfig {
  /** Name of the service being instrumented */
  serviceName: string;

  /** URL of the PARADOX collector */
  collectorUrl: string;

  /** Whether to record — can be toggled at runtime */
  enabled: boolean;

  /** Sampling rate (0.0 to 1.0) — 1.0 = record everything */
  samplingRate: number;

  /** Headers to redact from recordings */
  redactHeaders: string[];

  /** Body fields to redact (dot notation: "user.password") */
  redactFields: string[];

  /** Max event buffer size before flush */
  bufferSize: number;

  /** Flush interval in milliseconds */
  flushIntervalMs: number;
}

/** Default probe configuration */
export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  serviceName: 'unknown-service',
  collectorUrl: 'http://localhost:4380',
  enabled: true,
  samplingRate: 1.0,
  redactHeaders: ['authorization', 'cookie', 'x-api-key'],
  redactFields: ['password', 'secret', 'token', 'creditCard'],
  bufferSize: 1000,
  flushIntervalMs: 5000,
};

/**
 * Configuration for the replay engine.
 */
export interface ReplayConfig {
  /** Path to the recording file */
  recordingPath: string;

  /** Session ID to replay */
  sessionId: string;

  /** Whether to execute in real-time or fast-forward */
  realTime: boolean;

  /** Breakpoints — pause at these sequence numbers */
  breakpoints: number[];
}
