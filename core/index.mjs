/*! cyborgd — core index · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The isomorphic core: PURE JS, no node-only imports, no Buffer/fs/process. Time is injected via now(),
// randomness only from seeds. Runs unchanged in a browser (dist/cyborgd-core.js → window.CyborgdCore)
// where a participant HOSTS their own space, and in the daemon where the anchor hosts as failover.
export * as protocol from './protocol.mjs';
export * as ladder from './ladder.mjs';
export * as zones from './zones.mjs';
export * as arcball from './arcball.mjs';
export * as snapshot from './snapshot.mjs';
export * as sim from './sim.mjs';
export * as seed from './seed.mjs';
export * as riddle from './riddle.mjs';
export * as aivatar from './aivatar.mjs';
export * as rooms from './rooms.mjs';
export * as triad from './triad.mjs';
export * as transport from './transport.mjs';

export { VERSION, parseClient, enc, guards, isServerMessage, INVALID_LIMIT, CLIENT_TYPES, SERVER_TYPES } from './protocol.mjs';
export { LADDER, rankOf, rungName, atLeast, rungOfClaim } from './ladder.mjs';
export { Room, createRoom, Latency, setFieldPolicy, FIELD_POLICY } from './rooms.mjs';
export { Agent, createAgents, BEHAVIOURS } from './aivatar.mjs';
export { Riddler, Matcher } from './riddle.mjs';
export { triadStep, Triad, elect, emptyTriad, ANCHOR } from './triad.mjs';
export { stepSim, InputQueue, Authority, initialState, idleCmd, CFG } from './sim.mjs';
export { delta, apply, mergeLWW, SnapshotBuffer } from './snapshot.mjs';
export { project, reach, shoulderOf, orbit } from './arcball.mjs';
export { LoopbackTransport, RecordingTransport, BaseTransport, isTransport } from './transport.mjs';
export { rng, hashSeed, choose } from './seed.mjs';

export const CORE_VERSION = '0.0.1-alpha';
export * as field from './field.mjs';
export { policyFor, defaultMode, degree as fieldDegree, atBound, visibleTo, normalise as normaliseField } from './field.mjs';
