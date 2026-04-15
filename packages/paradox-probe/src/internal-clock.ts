// ============================================================================
// ERGENEKON PROBE — Internal Clock
//
// Captures the ORIGINAL Date.now and Math.random references before
// any monkey-patching occurs. Used internally by the probe to avoid
// infinite recursion when recording events.
// ============================================================================

/** Original Date.now — captured at module load time, before patching */
export const originalDateNow: () => number = Date.now.bind(Date);

/** Original Math.random — captured at module load time, before patching */
export const originalMathRandom: () => number = Math.random.bind(Math);
