/**
 * Client-side reconciliation for the owning player's predicted net-platformer.
 *
 * Reconciliation compares the predicted state at the acknowledged sequence with
 * the authoritative transport snapshot from the server. If the divergence
 * exceeds the configured tolerance, the local host is restored from the
 * authoritative rollback checkpoint and all still-pending commands are replayed
 * through the shared sim step.
 */
import { clonePlainObject } from "../../clone-plain-object";
import type { NetPlatformerCommandFrame } from "../shared/command-frame";
import {
  createNetPlatformerRollbackCheckpoint,
  type NetCommandAcknowledgement,
  type NetPlatformerRollbackCheckpoint,
  type NetPlatformerSimState,
} from "../shared/sim-state";
import type { NetPlatformerPredictedController } from "./predicted-controller";

export interface NetPlatformerPredictionDivergence {
  missingPredictedState: boolean;
  positionDistance: number;
  velocityDistance: number;
  quaternionDistance: number;
  yawDelta: number;
  speedDelta: number;
  groundedMismatch: boolean;
  movingMismatch: boolean;
  sprintMismatch: boolean;
  speedCategoryMismatch: boolean;
  jumpCountDelta: number;
  jumpStateMismatch: boolean;
  jumpSpeedCategoryMismatch: boolean;
}

export interface NetPlatformerReconciliationOptions {
  positionTolerance?: number;
  velocityTolerance?: number;
  quaternionTolerance?: number;
  yawTolerance?: number;
  speedTolerance?: number;
}

export interface NetPlatformerReconciliationResult {
  corrected: boolean;
  replayedCommands: number;
  state: NetPlatformerSimState;
  predictedStateAtAcknowledgement: NetPlatformerSimState | null;
  authoritativeSnapshot: NetPlatformerSimState;
  authoritativeCheckpoint: NetPlatformerRollbackCheckpoint;
  divergence: NetPlatformerPredictionDivergence;
}

export const DEFAULT_NET_PLATFORMER_RECONCILIATION_OPTIONS: Required<
  NetPlatformerReconciliationOptions
> = {
  positionTolerance: 1e-3,
  velocityTolerance: 1e-3,
  quaternionTolerance: 1e-3,
  yawTolerance: 1e-3,
  speedTolerance: 1e-3,
};

function distance3(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distance4(
  left: { x: number; y: number; z: number; w: number },
  right: { x: number; y: number; z: number; w: number },
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  const dw = left.w - right.w;

  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

function angleDelta(left: number, right: number): number {
  let delta = right - left;

  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  return Math.abs(delta);
}

export function measureNetPlatformerPredictionDivergence(
  predictedState: NetPlatformerSimState | null,
  authoritativeSnapshot: NetPlatformerSimState,
): NetPlatformerPredictionDivergence {
  if (!predictedState) {
    return {
      missingPredictedState: true,
      positionDistance: Number.POSITIVE_INFINITY,
      velocityDistance: Number.POSITIVE_INFINITY,
      quaternionDistance: Number.POSITIVE_INFINITY,
      yawDelta: Number.POSITIVE_INFINITY,
      speedDelta: Number.POSITIVE_INFINITY,
      groundedMismatch: true,
      movingMismatch: true,
      sprintMismatch: true,
      speedCategoryMismatch: true,
      jumpCountDelta: Number.POSITIVE_INFINITY,
      jumpStateMismatch: true,
      jumpSpeedCategoryMismatch: true,
    };
  }

  return {
    missingPredictedState: false,
    positionDistance: distance3(
      predictedState.mover.position,
      authoritativeSnapshot.mover.position,
    ),
    velocityDistance: distance3(
      predictedState.mover.velocity,
      authoritativeSnapshot.mover.velocity,
    ),
    quaternionDistance: distance4(
      predictedState.mover.quaternion,
      authoritativeSnapshot.mover.quaternion,
    ),
    yawDelta: angleDelta(
      predictedState.command.yaw,
      authoritativeSnapshot.command.yaw,
    ),
    speedDelta: Math.abs(
      predictedState.mover.speed - authoritativeSnapshot.mover.speed,
    ),
    groundedMismatch:
      predictedState.mover.grounded !== authoritativeSnapshot.mover.grounded,
    movingMismatch:
      predictedState.mover.isMoving !== authoritativeSnapshot.mover.isMoving,
    sprintMismatch:
      predictedState.command.sprinting !== authoritativeSnapshot.command.sprinting,
    speedCategoryMismatch:
      predictedState.mover.speedCategory !==
      authoritativeSnapshot.mover.speedCategory,
    jumpCountDelta: Math.abs(
      predictedState.mover.jumpCount - authoritativeSnapshot.mover.jumpCount,
    ),
    jumpStateMismatch:
      predictedState.mover.isJumping !== authoritativeSnapshot.mover.isJumping ||
      predictedState.mover.reachedPeak !== authoritativeSnapshot.mover.reachedPeak ||
      predictedState.derived.justLanded !==
        authoritativeSnapshot.derived.justLanded ||
      predictedState.derived.justBecameAirborne !==
        authoritativeSnapshot.derived.justBecameAirborne ||
      predictedState.derived.jumpedThisTick !==
        authoritativeSnapshot.derived.jumpedThisTick,
    jumpSpeedCategoryMismatch:
      predictedState.derived.jumpSpeedCategory !==
      authoritativeSnapshot.derived.jumpSpeedCategory,
  };
}

function shouldCorrectPrediction(
  divergence: NetPlatformerPredictionDivergence,
  options: Required<NetPlatformerReconciliationOptions>,
): boolean {
  return (
    divergence.missingPredictedState ||
    divergence.positionDistance > options.positionTolerance ||
    divergence.velocityDistance > options.velocityTolerance ||
    divergence.quaternionDistance > options.quaternionTolerance ||
    divergence.yawDelta > options.yawTolerance ||
    divergence.speedDelta > options.speedTolerance ||
    divergence.groundedMismatch ||
    divergence.movingMismatch ||
    divergence.sprintMismatch ||
    divergence.speedCategoryMismatch ||
    divergence.jumpCountDelta > 0 ||
    divergence.jumpStateMismatch ||
    divergence.jumpSpeedCategoryMismatch
  );
}

export function reconcileNetPlatformerPrediction(
  controller: NetPlatformerPredictedController,
  acknowledgement: NetCommandAcknowledgement,
  authoritativeCheckpoint: NetPlatformerRollbackCheckpoint,
  dt: number,
  options: NetPlatformerReconciliationOptions = {},
): NetPlatformerReconciliationResult {
  const resolvedOptions = {
    ...DEFAULT_NET_PLATFORMER_RECONCILIATION_OPTIONS,
    ...options,
  };

  const authoritativeSnapshot = authoritativeCheckpoint.snapshot;

  controller.acknowledge(acknowledgement, authoritativeSnapshot);

  const predictedStateAtAcknowledgement = controller.getLastAcknowledgedState();
  const divergence = measureNetPlatformerPredictionDivergence(
    predictedStateAtAcknowledgement,
    authoritativeSnapshot,
  );

  if (!shouldCorrectPrediction(divergence, resolvedOptions)) {
    return {
      corrected: false,
      replayedCommands: 0,
      state: clonePlainObject(controller.getPredictedState()),
      predictedStateAtAcknowledgement: predictedStateAtAcknowledgement
        ? clonePlainObject(predictedStateAtAcknowledgement)
        : null,
      authoritativeSnapshot: clonePlainObject(
        controller.getLastAuthoritativeSnapshot() ?? authoritativeSnapshot,
      ),
      authoritativeCheckpoint: createNetPlatformerRollbackCheckpoint(
        controller.getLastAuthoritativeSnapshot() ?? authoritativeSnapshot,
        authoritativeCheckpoint.moverState,
      ),
      divergence,
    };
  }

  const replayedCommands = controller.getPendingCommands().length;
  controller.applyAuthoritativeSnapshot(
    authoritativeSnapshot,
    authoritativeCheckpoint.moverState,
  );
  const state = controller.replayPendingCommands(dt);

  return {
    corrected: true,
    replayedCommands,
    state: clonePlainObject(state),
    predictedStateAtAcknowledgement: predictedStateAtAcknowledgement
      ? clonePlainObject(predictedStateAtAcknowledgement)
      : null,
    authoritativeSnapshot: clonePlainObject(
      controller.getLastAuthoritativeSnapshot() ?? authoritativeSnapshot,
    ),
    authoritativeCheckpoint: createNetPlatformerRollbackCheckpoint(
      controller.getLastAuthoritativeSnapshot() ?? authoritativeSnapshot,
      authoritativeCheckpoint.moverState,
    ),
    divergence,
  };
}
