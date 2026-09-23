import type {
  NetPlatformerOptions,
  NetPlatformerReconciliationOptions,
} from "./net-platformer";

export const multiplayerNetPlatformerOptions: NetPlatformerOptions = {
  speed: 10,
  sprintBoost: 1.5,
  gravity: -1.81,
  height: 4,
  duration: 1,
  maxJumps: 2,
  coyoteTime: Infinity,
  maxFallSpeed: 20,
  cameraDistance: 5,
  cameraHeight: 0,
  cameraSmoothing: 0.2,
  cameraMode: "orbit",
};

export const serverPlayerBodyDimensions = {
  width: 0.5,
  height: 2.7,
  depth: 0.5,
} as const;

export const serverPlayerColliderOffset = {
  x: 0,
  y: serverPlayerBodyDimensions.height * 0.5,
  z: 0,
} as const;

export const multiplayerReconciliationOptions: NetPlatformerReconciliationOptions = {
  positionTolerance: 0.05,
  velocityTolerance: 0.02,
  quaternionTolerance: 0.02,
  yawTolerance: 0.05,
  speedTolerance: 0.05,
};
