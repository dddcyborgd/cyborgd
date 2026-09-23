/**
 * Deterministic simulation step for the net-platformer.
 *
 * `stepNetPlatformerSim(host, prevState, commandFrame, dt, config)` is the
 * core physics tick. Given the previous state and a command frame it applies
 * movement, jump edges, and gravity via the Mover, then snapshots the result
 * into a new `NetPlatformerSimState`.
 *
 * Because the same function runs on both client (prediction) and server
 * (authority), replaying the same command sequence always produces identical
 * state — this is the foundation for client-side prediction and reconciliation.
 */
import { Vector3 } from "three";
import type { Quaternion } from "three";
import type {
  MoverSimState,
  MoverState,
  MoverAnimSpeedCategory,
} from "../../mover-host";
import { clonePlainObject } from "../../clone-plain-object";
import {
  captureMoverSimState,
  primeMoverHost,
  restoreMoverState,
} from "../../mover-host";
import type { XYZ, XYZW } from "@oncyberio/engine";
import { getMoverAnimSpeedCategory } from "@oncyberio/engine/controls";
import type { NetPlatformerCommandFrame } from "./command-frame";
import type {
  NetPlatformerCommandState,
  NetPlatformerDerivedState,
  NetPlatformerSimState,
  NetPlatformerRollbackCheckpoint,
} from "./sim-state";

const YAW_FORWARD = new Vector3();
const YAW_RIGHT = new Vector3();

export interface NetPlatformerMover {
  body: {
    position: Vector3;
    quaternion: Quaternion;
    rigidBody?: {
      teleport(position: Vector3, quaternion: Quaternion): void;
    };
    updateMatrixWorld?(force?: boolean): void;
  };
  velocity: Vector3;
  grounded: boolean;
  isMoving: boolean;
  speed: number;
  jumpCount: number;
  isJumping: boolean;
  reachedPeak: boolean;
  coyoteTimeRemaining: number;
  move(
    moveX: number,
    moveY: number,
    options?: {
      forward?: Vector3;
      right?: Vector3;
      speed?: number;
    },
  ): void;
  startJump(): boolean;
  releaseJump(): void;
  saveState(): MoverState;
  restoreState(state: MoverState): void;
  update(dt: number): void;
  reset?(): void;
}

export interface NetPlatformerSimHost {
  mover: NetPlatformerMover;
}

export interface NetPlatformerSimConfig {
  speed: number;
  sprintBoost: number;
}

function getNetPlatformerSpeedThresholds(config: NetPlatformerSimConfig) {
  return {
    walk: 10,
    sprint: config.speed * config.sprintBoost,
  };
}

function getNetPlatformerSpeedCategory(
  speed: number,
  config: NetPlatformerSimConfig,
): MoverAnimSpeedCategory {
  return getMoverAnimSpeedCategory(speed, getNetPlatformerSpeedThresholds(config));
}

/**
 * Concrete override type for partial sim state initialization / reset.
 */
export interface NetPlatformerSimStateOverrides {
  tick?: number;
  sequence?: number;
  command?: Partial<NetPlatformerCommandState>;
  mover?: Partial<MoverSimState> & {
    position?: Partial<XYZ>;
    quaternion?: Partial<XYZW>;
    velocity?: Partial<XYZ>;
  };
  derived?: Partial<NetPlatformerDerivedState>;
}

export function restoreNetPlatformerRollbackCheckpoint(
  host: NetPlatformerSimHost,
  checkpoint: NetPlatformerRollbackCheckpoint,
): NetPlatformerSimState {
  restoreMoverState(host, checkpoint.moverState);
  return clonePlainObject(checkpoint.snapshot);
}

function createNetPlatformerMoverSnapshotState(
  host: NetPlatformerSimHost,
  partial: NetPlatformerSimStateOverrides["mover"],
  config: NetPlatformerSimConfig,
): MoverSimState {
  const baseState = captureMoverSimState(
    host,
    getNetPlatformerSpeedThresholds(config),
  );

  return {
    ...baseState,
    ...partial,
    position: partial?.position
      ? { ...baseState.position, ...partial.position }
      : baseState.position,
    quaternion: partial?.quaternion
      ? { ...baseState.quaternion, ...partial.quaternion }
      : baseState.quaternion,
    velocity: partial?.velocity
      ? { ...baseState.velocity, ...partial.velocity }
      : baseState.velocity,
  };
}

function createNetPlatformerCommandState(
  partial: Partial<NetPlatformerCommandState> | undefined,
): NetPlatformerCommandState {
  return {
    yaw: partial?.yaw ?? 0,
    moveX: partial?.moveX ?? 0,
    moveY: partial?.moveY ?? 0,
    sprinting: partial?.sprinting ?? false,
  };
}

function createNetPlatformerDerivedState(
  moverState: MoverSimState,
  partial: Partial<NetPlatformerDerivedState> | undefined,
): NetPlatformerDerivedState {
  return {
    justLanded: partial?.justLanded ?? false,
    justBecameAirborne: partial?.justBecameAirborne ?? false,
    jumpSpeedCategory: partial?.jumpSpeedCategory ?? moverState.speedCategory,
    jumpedThisTick: partial?.jumpedThisTick ?? false,
    landingVelocityY: partial?.landingVelocityY ?? moverState.velocity.y,
  };
}

/**
 * Resolve flat forward/right vectors from a yaw angle.
 */
function getNetPlatformerYawDirections(yaw: number): {
  forward: Vector3;
  right: Vector3;
} {
  YAW_FORWARD.set(Math.sin(yaw), 0, -Math.cos(yaw));
  YAW_RIGHT.set(Math.cos(yaw), 0, Math.sin(yaw));

  return {
    forward: YAW_FORWARD.clone(),
    right: YAW_RIGHT.clone(),
  };
}

/**
 * Capture the current mover state into the canonical net-platformer sim shape.
 */
export function createInitialNetPlatformerSimState(
  host: NetPlatformerSimHost,
  partial: NetPlatformerSimStateOverrides = {},
  config: NetPlatformerSimConfig = { speed: 15, sprintBoost: 1.5 },
): NetPlatformerSimState {
  const moverState = createNetPlatformerMoverSnapshotState(
    host,
    partial.mover,
    config,
  );
  const commandState = createNetPlatformerCommandState(partial.command);
  const derivedState = createNetPlatformerDerivedState(
    moverState,
    partial.derived,
  );

  return {
    tick: partial.tick ?? 0,
    sequence: partial.sequence ?? partial.tick ?? 0,
    command: commandState,
    mover: moverState,
    derived: derivedState,
  };
}

/**
 * Prime the mover so grounded/coyote state is valid before the first command.
 *
 * Without this zero-velocity probe, a freshly created mover starts from
 * `grounded = false` and the first real tick can apply gravity before contact
 * has ever been evaluated.
 */
export function primeNetPlatformerSimHost(
  host: NetPlatformerSimHost,
): void {
  primeMoverHost(host);
}

/**
 * Advance the platformer sim by one command frame.
 */
export function stepNetPlatformerSim(
  host: NetPlatformerSimHost,
  previousState: NetPlatformerSimState,
  commandFrame: NetPlatformerCommandFrame,
  dt: number,
  config: NetPlatformerSimConfig,
): NetPlatformerSimState {
  const { mover } = host;
  const wasGrounded = previousState.mover.grounded;
  const jumpSpeedCategory = getNetPlatformerSpeedCategory(mover.speed, config);
  const { forward, right } = getNetPlatformerYawDirections(commandFrame.yaw);

  mover.move(commandFrame.moveX, commandFrame.moveY, {
    forward,
    right,
    speed: config.speed * (commandFrame.sprint ? config.sprintBoost : 1),
  });

  const jumpedThisTick = commandFrame.jumpPressed ? mover.startJump() : false;

  if (commandFrame.jumpReleased) {
    mover.releaseJump();
  }

  mover.update(dt);

  const nextGrounded = mover.grounded;
  const landingVelocityY = nextGrounded
    ? previousState.derived.landingVelocityY
    : mover.velocity.y;

  return createInitialNetPlatformerSimState(host, {
    tick: commandFrame.tick,
    sequence: commandFrame.sequence,
    command: {
      yaw: commandFrame.yaw,
      moveX: commandFrame.moveX,
      moveY: commandFrame.moveY,
      sprinting: commandFrame.sprint,
    },
    derived: {
      justLanded: nextGrounded && !wasGrounded,
      justBecameAirborne: !nextGrounded && wasGrounded,
      jumpSpeedCategory: jumpedThisTick
        ? jumpSpeedCategory
        : previousState.derived.jumpSpeedCategory,
      jumpedThisTick,
      landingVelocityY,
    },
  }, config);
}
