import type { MovementConfig, JumpConfig } from "@oncyberio/engine/controls";
import type { CommandSource } from "./shared/command-source";
import type { NetPlatformerAnimations } from "./shared/animation-state";
import type { Component3D } from "@oncyberio/engine";
import type { NetPlatformerCommandFrame } from "./shared/command-frame";

const DEFAULT_GRAVITY = -1.81;

const DEFAULT_JUMP: Required<JumpConfig> = {
  height: 5,
  duration: 1,
  maxJumps: 2,
  coyoteTime: Infinity,
  maxFallSpeed: 20,
  hold: false,
  delay: 0,
  peakSpeed: 1,
};

export interface NetPlatformerMovementOptions
  extends MovementConfig,
    JumpConfig {
  /** Speed boost multiplier when sprinting */
  sprintBoost?: number;
}

export interface NetPlatformerCameraOptions {
  /** Camera mode (default: "orbit") */
  cameraMode?: "orbit" | "follow";
  /** Camera distance from target */
  cameraDistance?: number;
  /** Camera height offset */
  cameraHeight?: number;
  /** Camera collision checking */
  cameraCollision?: boolean;
  /** Camera smoothing factor */
  cameraSmoothing?: number;
}

export interface NetPlatformerAnimationOptions {
  /** Whether animation remains a local presentation concern */
  animationMode?: "presentation" | "disabled";
  /** Optional animation clip overrides */
  animations?: Partial<NetPlatformerAnimations>;
}

/**
 * Options for the local first-slice net-platformer preset.
 */
export interface NetPlatformerOptions
  extends NetPlatformerMovementOptions,
    NetPlatformerCameraOptions,
    NetPlatformerAnimationOptions {
  /** Optional injected command source for replay, bots, or tests */
  commandSource?: CommandSource<NetPlatformerCommandFrame>;
  /** Optional separate physics body when presentation should stay on another component */
  movementBody?: Component3D;
  /** Initial tick/sequence id */
  initialTick?: number;
}

export interface ResolvedNetPlatformerOptions {
  speed: number;
  gravity: number;
  acceleration: number;
  deceleration: number;
  airControl: number;
  facingMode?: MovementConfig["facingMode"];
  height: number;
  duration: number;
  maxJumps: number;
  hold: boolean;
  delay: number;
  peakSpeed: number;
  coyoteTime: number;
  maxFallSpeed: number;
  sprintBoost: number;
  cameraMode: "orbit" | "follow";
  cameraDistance: number;
  cameraHeight: number;
  cameraCollision: boolean;
  cameraSmoothing: number;
  animationMode: "presentation" | "disabled";
  animations: Partial<NetPlatformerAnimations>;
  commandSource?: CommandSource<NetPlatformerCommandFrame>;
  movementBody?: Component3D;
  initialTick: number;
}

/**
 * Resolve user options with stable preset defaults.
 */
export function resolveNetPlatformerOptions(
  options: NetPlatformerOptions = {},
): ResolvedNetPlatformerOptions {
  return {
    speed: options.speed ?? 15,
    gravity: options.gravity ?? DEFAULT_GRAVITY,
    acceleration: options.acceleration ?? 100,
    deceleration: options.deceleration ?? 50,
    airControl: options.airControl ?? 1,
    facingMode:
      options.facingMode ??
      (options.autoRotate === undefined
        ? undefined
        : options.autoRotate
          ? "movement"
          : "none"),
    height: options.height ?? DEFAULT_JUMP.height,
    duration: options.duration ?? DEFAULT_JUMP.duration,
    maxJumps: options.maxJumps ?? DEFAULT_JUMP.maxJumps,
    hold: options.hold ?? DEFAULT_JUMP.hold,
    delay: options.delay ?? DEFAULT_JUMP.delay,
    peakSpeed: options.peakSpeed ?? DEFAULT_JUMP.peakSpeed,
    coyoteTime: options.coyoteTime ?? DEFAULT_JUMP.coyoteTime,
    maxFallSpeed: options.maxFallSpeed ?? DEFAULT_JUMP.maxFallSpeed,
    sprintBoost: options.sprintBoost ?? 1.5,
    cameraMode: options.cameraMode ?? "orbit",
    cameraDistance: options.cameraDistance ?? 5,
    cameraHeight: options.cameraHeight ?? 0,
    cameraCollision: options.cameraCollision ?? true,
    cameraSmoothing: options.cameraSmoothing ?? 0.15,
    animationMode: options.animationMode ?? "presentation",
    animations: options.animations ?? {},
    commandSource: options.commandSource,
    movementBody: options.movementBody,
    initialTick: options.initialTick ?? 0,
  };
}
