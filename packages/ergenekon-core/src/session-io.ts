// ============================================================================
// ERGENEKON CORE — Session Import/Export
//
// Supports two formats:
//
// 1. JSON (.ergenekon.json) — Human-readable, great for sharing & debugging
// 2. Binary (.ergenekon.bin) — Compact, ~60% smaller, fast to parse
//
// Binary format (ERGENEKON Binary Session v1):
//   [4 bytes: magic "PRDX"]
//   [2 bytes: version (1)]
//   [4 bytes: metadata JSON length]
//   [N bytes: metadata JSON (gzip)]
//   [4 bytes: events count]
//   [4 bytes: events payload length]
//   [N bytes: events JSON (gzip)]
//   [4 bytes: CRC32 checksum]
//
// The binary format uses gzip compression on the JSON payloads,
// giving us the best of both worlds: structured data + small size.
// ============================================================================

import { gzipSync, gunzipSync } from 'node:zlib';
import type { RecordingSession, ErgenekonEvent, SessionMetadata } from './types.js';

// ── Constants ─────────────────────────────────────────────────────

const MAGIC = Buffer.from('PRDX');
const VERSION = 1;

// ── JSON Export/Import ────────────────────────────────────────────

export interface ExportOptions {
  /** Pretty print JSON (default: false) */
  pretty?: boolean;
  /** Include metadata (default: true) */
  includeMetadata?: boolean;
}

/**
 * Export a recording session to JSON string.
 */
export function exportSessionJSON(
  session: RecordingSession,
  opts: ExportOptions = {}
): string {
  const payload = {
    _format: 'ergenekon-session-v1',
    _exportedAt: Date.now(),
    session,
  };
  return JSON.stringify(payload, null, opts.pretty ? 2 : undefined);
}

/**
 * Export multiple sessions to JSON string.
 */
export function exportSessionsJSON(
  sessions: RecordingSession[],
  opts: ExportOptions = {}
): string {
  const payload = {
    _format: 'ergenekon-sessions-v1',
    _exportedAt: Date.now(),
    _count: sessions.length,
    sessions,
  };
  return JSON.stringify(payload, null, opts.pretty ? 2 : undefined);
}

/**
 * Import sessions from JSON string.
 * Handles both single-session and multi-session formats.
 */
export function importSessionsJSON(json: string): RecordingSession[] {
  // SECURITY (HIGH-15): Strip __proto__ / constructor to prevent prototype pollution
  const parsed = JSON.parse(json, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });

  if (parsed._format === 'ergenekon-session-v1') {
    return [parsed.session as RecordingSession];
  }

  if (parsed._format === 'ergenekon-sessions-v1') {
    return parsed.sessions as RecordingSession[];
  }

  // Try to detect raw session object
  if (parsed.id && parsed.traceId && parsed.events) {
    return [parsed as RecordingSession];
  }

  // Try array of sessions
  if (Array.isArray(parsed)) {
    return parsed as RecordingSession[];
  }

  throw new Error('Unknown ERGENEKON session format');
}

// ── Binary Export/Import ──────────────────────────────────────────

/**
 * Export a recording session to compact binary format.
 * ~60% smaller than JSON, fast to parse.
 */
export function exportSessionBinary(session: RecordingSession): Buffer {
  const metadataJson = JSON.stringify({
    id: session.id,
    traceId: session.traceId,
    serviceName: session.serviceName,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    metadata: session.metadata,
  });

  const eventsJson = JSON.stringify(session.events);

  const metadataGzip = gzipSync(metadataJson);
  const eventsGzip = gzipSync(eventsJson);

  // Calculate total size
  const totalSize =
    4 +  // magic
    2 +  // version
    4 +  // metadata length
    metadataGzip.length +
    4 +  // events count
    4 +  // events payload length
    eventsGzip.length +
    4;   // CRC32

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Magic
  MAGIC.copy(buf, offset); offset += 4;

  // Version
  buf.writeUInt16BE(VERSION, offset); offset += 2;

  // Metadata
  buf.writeUInt32BE(metadataGzip.length, offset); offset += 4;
  metadataGzip.copy(buf, offset); offset += metadataGzip.length;

  // Events count
  buf.writeUInt32BE(session.events.length, offset); offset += 4;

  // Events payload
  buf.writeUInt32BE(eventsGzip.length, offset); offset += 4;
  eventsGzip.copy(buf, offset); offset += eventsGzip.length;

  // CRC32 checksum (simple)
  const checksum = crc32(buf.subarray(0, offset));
  buf.writeUInt32BE(checksum, offset);

  return buf;
}

/**
 * Import a recording session from binary format.
 * SECURITY (CRIT-07): Caps on compressed payload lengths + maxOutputLength to prevent gzip bombs.
 */
export function importSessionBinary(buf: Buffer): RecordingSession {
  const MAX_METADATA_COMPRESSED = 1 * 1024 * 1024;   // 1 MB compressed
  const MAX_EVENTS_COMPRESSED   = 128 * 1024 * 1024;  // 128 MB compressed
  const MAX_METADATA_DECOMPRESSED = 4 * 1024 * 1024;  // 4 MB decompressed
  const MAX_EVENTS_DECOMPRESSED   = 512 * 1024 * 1024; // 512 MB decompressed

  let offset = 0;

  // Verify magic
  const magic = buf.subarray(offset, offset + 4);
  if (!magic.equals(MAGIC)) {
    throw new Error('Not a ERGENEKON binary session file (bad magic)');
  }
  offset += 4;

  // Version
  const version = buf.readUInt16BE(offset); offset += 2;
  if (version !== VERSION) {
    throw new Error(`Unsupported ERGENEKON binary version: ${version}`);
  }

  // Metadata — SECURITY: cap compressed size
  const metadataLen = buf.readUInt32BE(offset); offset += 4;
  if (metadataLen > MAX_METADATA_COMPRESSED) {
    throw new Error(`Metadata compressed size ${metadataLen} exceeds cap of ${MAX_METADATA_COMPRESSED}`);
  }
  const metadataGzip = buf.subarray(offset, offset + metadataLen); offset += metadataLen;
  const metadataJson = gunzipSync(metadataGzip, { maxOutputLength: MAX_METADATA_DECOMPRESSED }).toString('utf-8');
  const meta = JSON.parse(metadataJson, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });

  // Events count
  const eventsCount = buf.readUInt32BE(offset); offset += 4;

  // Events payload — SECURITY: cap compressed size
  const eventsLen = buf.readUInt32BE(offset); offset += 4;
  if (eventsLen > MAX_EVENTS_COMPRESSED) {
    throw new Error(`Events compressed size ${eventsLen} exceeds cap of ${MAX_EVENTS_COMPRESSED}`);
  }
  const eventsGzip = buf.subarray(offset, offset + eventsLen); offset += eventsLen;
  const eventsJson = gunzipSync(eventsGzip, { maxOutputLength: MAX_EVENTS_DECOMPRESSED }).toString('utf-8');
  const events: ErgenekonEvent[] = JSON.parse(eventsJson, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });

  // Verify CRC32
  const storedChecksum = buf.readUInt32BE(offset);
  const computedChecksum = crc32(buf.subarray(0, offset));
  if (storedChecksum !== computedChecksum) {
    throw new Error('ERGENEKON binary session file is corrupted (CRC32 mismatch)');
  }

  if (events.length !== eventsCount) {
    throw new Error(`Event count mismatch: header says ${eventsCount}, got ${events.length}`);
  }

  return {
    id: meta.id,
    traceId: meta.traceId,
    serviceName: meta.serviceName,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    events,
    metadata: meta.metadata as SessionMetadata,
  };
}

// ── CRC32 (simple, no dependency) ─────────────────────────────────

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xFF]! ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
