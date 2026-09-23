/**
 * Plain-object state types for the net-platformer simulation.
 *
 * These are intentionally serializable (no Three.js classes) so they can be
 * sent over the network, stored for replay, or compared for reconciliation.
 * The sim step (`sim-step.ts`) produces these; the presentation layer and
 * snapshot helpers both consume them.
 */
import type {
  MoverSimState,
  MoverState,
  MoverAnimSpeedCategory,
} from "../../mover-host";
import { clonePlainObject } from "../../clone-plain-object";
import { cloneMoverState } from "../../mover-host";

export interface NetPlatformerCommandState {
  yaw: number;
  moveX: number;
  moveY: number;
  sprinting: boolean;
}

export interface NetPlatformerDerivedState {
  justLanded: boolean;
  justBecameAirborne: boolean;
  jumpSpeedCategory: MoverAnimSpeedCategory;
  jumpedThisTick: boolean;
  landingVelocityY: number;
}

export interface NetCommandAcknowledgement {
  tick: number;
  sequence: number;
}

/**
 * Canonical gameplay state captured after each simulation step.
 */
export interface NetPlatformerSimState {
  tick: number;
  sequence: number;
  command: NetPlatformerCommandState;
  mover: MoverSimState;
  derived: NetPlatformerDerivedState;
}

/**
 * Exact rollback payload used to restore mover internals before replay.
 */
export interface NetPlatformerRollbackCheckpoint {
  snapshot: NetPlatformerSimState;
  moverState: MoverState;
}

export function createNetPlatformerRollbackCheckpoint(
  simState: NetPlatformerSimState,
  moverState: MoverState,
): NetPlatformerRollbackCheckpoint {
  return {
    snapshot: clonePlainObject(simState),
    moverState: cloneMoverState(moverState),
  };
}
