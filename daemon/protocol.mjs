/*! cyborgd — protocol (re-export) · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The protocol is pure and lives in core/protocol.mjs (it runs unchanged in the browser host). This
// file keeps the daemon import path stable: `import { parseClient, enc } from './protocol.mjs'`.
export * from '../core/protocol.mjs';
