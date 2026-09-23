/**
 * Net-platformer preset — a network-ready third-person platformer controller.
 *
 * Architecture (three decoupled layers):
 *
 *   CommandSource  →  PredictedController  →  PresentationController
 *   (input)           (simulation)             (camera + animation)
 *
 * 1. **Command layer** (`shared/command-source`, `client/local-command-source`)
 *    Converts raw input (keyboard/gamepad/touch, replay tape, bot AI, or
 *    server network queue) into a canonical `NetPlatformerCommandFrame` per tick.
 *    The command source is pluggable via the `commandSource` option.
 *
 * 2. **Simulation layer** (`shared/sim-step`, `client/predicted-controller`,
 *    `client/reconciliation`)
 *    Runs deterministic physics via `stepNetPlatformerSim()`, which takes
 *    (previous state + command frame + dt) and returns the next
 *    `NetPlatformerSimState`. The predicted controller wraps this in a
 *    client-side prediction loop with pending-command buffering, while the
 *    authoritative controller consumes server-queued commands and publishes
 *    owner rollback checkpoints. Reconciliation compares the authoritative
 *    transport snapshot against the predicted checkpoint and replays any
 *    still-pending commands after correction.
 *
 * 3. **Presentation layer** (`client/presentation-controller`)
 *    Drives camera (ThirdPersonCameraRig) and animation (AnimationStateMachine)
 *    from the latest sim state. This is client-only — the server never runs it.
 *
 * Runtime contract:
 * - transport payload in: `NetPlatformerCommandFrame`
 * - transport payload out (owner): rollback checkpoint + acknowledgement
 * - transport payload out (remote, optional): plain remote snapshot or any
 *   thinner game-specific replica projection
 * - prediction and authority must advance on the same fixed simulation tick
 * - the authoritative host needs a physics-backed mover host (for example a
 *   headless engine space), not a renderer
 * - animation can remain presentation-only unless the game makes it
 *   gameplay-relevant
 *
 * Shared types live in `shared/` and are usable on both client and server
 * (plain-object state, no Three.js dependencies except in sim-step).
 */
export { createNetPlatformer } from "./net-platformer";
export type { NetPlatformerControlSystem } from "./net-platformer";

export {
  resolveNetPlatformerOptions,
  type NetPlatformerOptions,
  type NetPlatformerMovementOptions,
  type NetPlatformerCameraOptions,
  type NetPlatformerAnimationOptions,
  type ResolvedNetPlatformerOptions,
} from "./net-platformer-options";

export {
  createEmptyNetPlatformerCommandFrame,
  type NetPlatformerCommandFrame,
} from "./shared/command-frame";
export type { CommandSource } from "./shared/command-source";
export {
  createNetPlatformerRollbackCheckpoint,
  type NetCommandAcknowledgement,
  type NetPlatformerCommandState,
  type NetPlatformerDerivedState,
  type NetPlatformerSimState,
  type NetPlatformerRollbackCheckpoint,
} from "./shared/sim-state";
export {
  createInitialNetPlatformerSimState,
  restoreNetPlatformerRollbackCheckpoint,
  stepNetPlatformerSim,
  type NetPlatformerSimConfig,
  type NetPlatformerSimHost,
  type NetPlatformerSimStateOverrides,
} from "./shared/sim-step";
export {
  DEFAULT_NET_PLATFORMER_ANIMATIONS,
  createNetPlatformerAnimationStateMachine,
  type NetPlatformerAnimations,
  type NetPlatformerAnimationContext,
} from "./shared/animation-state";
export {
  createLocalNetPlatformerCommandSource,
  type LocalNetPlatformerCommandSourceOptions,
  type LocalNetPlatformerInputs,
} from "./client/local-command-source";
export {
  createNetPlatformerPredictedController,
  type NetPlatformerPredictedController,
  type NetPlatformerPredictedControllerOptions,
} from "./client/predicted-controller";
export {
  DEFAULT_NET_PLATFORMER_RECONCILIATION_OPTIONS,
  measureNetPlatformerPredictionDivergence,
  reconcileNetPlatformerPrediction,
  type NetPlatformerPredictionDivergence,
  type NetPlatformerReconciliationOptions,
  type NetPlatformerReconciliationResult,
} from "./client/reconciliation";
export {
  createNetPlatformerAuthoritativeController,
  type NetPlatformerAuthoritativeController,
  type NetPlatformerAuthoritativeControllerOptions,
} from "./server/authoritative-controller";
export {
  createNetInputQueue,
  type NetInputQueue,
  type NetInputQueueOptions,
} from "./server/input-queue";
export {
  createNetPlatformerPresentationController,
  type NetPlatformerPresentationController,
  type NetPlatformerPresentationControllerOptions,
} from "./client/presentation-controller";
