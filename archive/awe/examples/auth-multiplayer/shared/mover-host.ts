import type {
  MoverState,
  MoverAnimSpeedCategory,
} from "@oncyberio/engine/controls";
import { getMoverAnimSpeedCategory } from "@oncyberio/engine/controls";
import type { XYZ, XYZW } from "@oncyberio/engine";

export interface MoverSimState {
  position: XYZ;
  quaternion: XYZW;
  velocity: XYZ;
  grounded: boolean;
  isMoving: boolean;
  speed: number;
  speedCategory: MoverAnimSpeedCategory;
  jumpCount: number;
  isJumping: boolean;
  reachedPeak: boolean;
  coyoteTimeRemaining: number;
}

export interface MoverSpeedThresholds {
  walk: number;
  sprint: number;
}
import { clonePlainObject } from "./clone-plain-object";

export interface MoverHost {
  mover: {
    body: {
      position: { x: number; y: number; z: number };
      quaternion: { x: number; y: number; z: number; w: number };
    };
    velocity: { x: number; y: number; z: number };
    grounded: boolean;
    isMoving: boolean;
    speed: number;
    jumpCount: number;
    isJumping: boolean;
    reachedPeak: boolean;
    coyoteTimeRemaining: number;
    saveState(): MoverState;
    restoreState(state: MoverState): void;
    update(dt: number): void;
    reset?(): void;
  };
}

export function cloneMoverState(state: MoverState): MoverState {
  return clonePlainObject(state);
}

export function captureMoverState(host: MoverHost): MoverState {
  return cloneMoverState(host.mover.saveState());
}

export function restoreMoverState(host: MoverHost, state: MoverState): void {
  host.mover.restoreState(cloneMoverState(state));
}

export function captureMoverSimState(
  host: MoverHost,
  thresholds: MoverSpeedThresholds,
): MoverSimState {
  const { mover } = host;

  return {
    position: {
      x: mover.body.position.x,
      y: mover.body.position.y,
      z: mover.body.position.z,
    },
    quaternion: {
      x: mover.body.quaternion.x,
      y: mover.body.quaternion.y,
      z: mover.body.quaternion.z,
      w: mover.body.quaternion.w,
    },
    velocity: {
      x: mover.velocity.x,
      y: mover.velocity.y,
      z: mover.velocity.z,
    },
    grounded: mover.grounded,
    isMoving: mover.isMoving,
    speed: mover.speed,
    speedCategory: getMoverAnimSpeedCategory(mover.speed, thresholds),
    jumpCount: mover.jumpCount,
    isJumping: mover.isJumping,
    reachedPeak: mover.reachedPeak,
    coyoteTimeRemaining: mover.coyoteTimeRemaining,
  };
}

export function primeMoverHost(host: MoverHost): void {
  host.mover.reset?.();
  host.mover.update(0);
}

export type { MoverState } from "@oncyberio/engine/controls";
export type { MoverAnimSpeedCategory } from "@oncyberio/engine/controls";
export type { XYZ, XYZW } from "@oncyberio/engine";
