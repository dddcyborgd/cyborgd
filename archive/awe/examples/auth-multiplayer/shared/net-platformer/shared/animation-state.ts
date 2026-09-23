import type { Component3D } from "@oncyberio/engine";
import { AnimationStateMachine } from "@oncyberio/engine/controls";
import type { NetPlatformerSimState } from "./sim-state";

/**
 * Animation clip names for net-platformer states.
 */
export interface NetPlatformerAnimations {
  idle: string;
  walk: string;
  run: string;
  sprint: string;
  jump_idle: string;
  jump_walking: string;
  jump_running: string;
  jump_sprinting: string;
  jump_double: string;
  falling: string;
  drop_idle: string;
  drop_walking: string;
  drop_walking_roll: string;
  drop_running: string;
  drop_running_roll: string;
  drop_sprinting: string;
  drop_sprinting_roll: string;
}

export interface NetPlatformerAnimationContext {
  simState: NetPlatformerSimState;
}

export const DEFAULT_NET_PLATFORMER_ANIMATIONS: NetPlatformerAnimations = {
  idle: "idle",
  walk: "walk",
  run: "run",
  sprint: "sprint",
  jump_idle: "jump_idle",
  jump_walking: "jump_walking",
  jump_running: "jump_running",
  jump_sprinting: "jump_sprinting",
  jump_double: "jump_double",
  falling: "falling",
  drop_idle: "drop_idle",
  drop_walking: "drop_walking",
  drop_walking_roll: "drop_walking_roll",
  drop_running: "drop_running",
  drop_running_roll: "drop_running_roll",
  drop_sprinting: "drop_sprinting",
  drop_sprinting_roll: "drop_sprinting_roll",
};

const GROUND_STATES: string[] = ["idle", "walk", "run", "sprint"];

const AIRBORNE_STATES: string[] = [
  "jump_idle",
  "jump_walking",
  "jump_running",
  "jump_sprinting",
  "jump_double",
  "falling",
];

const DROP_STATES: string[] = [
  "drop_idle",
  "drop_walking",
  "drop_walking_roll",
  "drop_running",
  "drop_running_roll",
  "drop_sprinting",
  "drop_sprinting_roll",
];

/**
 * Create the presentation-only animation controller for net-platformer.
 */
export function createNetPlatformerAnimationStateMachine(
  body: Component3D,
  simState: NetPlatformerSimState,
  animations: Partial<NetPlatformerAnimations> = {},
): AnimationStateMachine<NetPlatformerAnimationContext> {
  const anims: NetPlatformerAnimations = {
    ...DEFAULT_NET_PLATFORMER_ANIMATIONS,
    ...animations,
  };

  return new AnimationStateMachine<NetPlatformerAnimationContext>({
    body,
    initial: "idle",
    context: { simState },
    defaultBlendTime: 0.1,

    states: {
      idle: { clip: anims.idle },
      walk: { clip: anims.walk },
      run: { clip: anims.run },
      sprint: { clip: anims.sprint },
      jump_idle: { clip: anims.jump_idle, loop: "once" },
      jump_walking: { clip: anims.jump_walking, loop: "once" },
      jump_running: { clip: anims.jump_running, loop: "once" },
      jump_sprinting: { clip: anims.jump_sprinting, loop: "once" },
      jump_double: { clip: anims.jump_double, loop: "once" },
      falling: { clip: anims.falling },
      drop_idle: { clip: anims.drop_idle, loop: "once" },
      drop_walking: { clip: anims.drop_walking, loop: "once" },
      drop_walking_roll: { clip: anims.drop_walking_roll, loop: "once" },
      drop_running: { clip: anims.drop_running, loop: "once" },
      drop_running_roll: { clip: anims.drop_running_roll, loop: "once" },
      drop_sprinting: { clip: anims.drop_sprinting, loop: "once" },
      drop_sprinting_roll: { clip: anims.drop_sprinting_roll, loop: "once" },
    },

    transitions: [
      // Ground → jump (by speed category at takeoff)
      {
        from: GROUND_STATES,
        to: "jump_idle",
        on: "jump",
        guard: (ctx) => ctx.simState.derived.jumpSpeedCategory === "idle",
        priority: 100,
      },
      {
        from: GROUND_STATES,
        to: "jump_walking",
        on: "jump",
        guard: (ctx) => ctx.simState.derived.jumpSpeedCategory === "walking",
        priority: 100,
      },
      {
        from: GROUND_STATES,
        to: "jump_running",
        on: "jump",
        guard: (ctx) => ctx.simState.derived.jumpSpeedCategory === "running",
        priority: 100,
      },
      {
        from: GROUND_STATES,
        to: "jump_sprinting",
        on: "jump",
        guard: (ctx) => ctx.simState.derived.jumpSpeedCategory === "sprinting",
        priority: 100,
      },
      // Airborne → double jump
      {
        from: AIRBORNE_STATES.filter((s) => s !== "jump_double"),
        to: "jump_double",
        on: "jump",
        priority: 100,
      },
      // Airborne → landing (roll variants have higher priority)
      {
        from: AIRBORNE_STATES,
        to: "drop_idle",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "idle",
        priority: 50,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_walking_roll",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "walking" &&
          ctx.simState.derived.landingVelocityY < -0.6,
        priority: 51,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_walking",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "walking",
        priority: 50,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_running_roll",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "running" &&
          ctx.simState.derived.landingVelocityY < -0.6,
        priority: 51,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_running",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "running",
        priority: 50,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_sprinting_roll",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "sprinting" &&
          ctx.simState.derived.landingVelocityY < -0.6,
        priority: 51,
      },
      {
        from: AIRBORNE_STATES,
        to: "drop_sprinting",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.derived.jumpSpeedCategory === "sprinting",
        priority: 50,
      },
      // Jump clip finished → falling
      {
        from: AIRBORNE_STATES.filter((s) => s !== "falling"),
        to: "falling",
        when: (ctx) => ctx.finished && !ctx.simState.mover.grounded,
        priority: 40,
      },
      // Ground → falling (walked off edge)
      {
        from: GROUND_STATES,
        to: "falling",
        when: (ctx) => !ctx.simState.mover.grounded,
        priority: 30,
      },
      // Ground locomotion (from ground + drop states, excluding self)
      {
        from: [...GROUND_STATES.filter((s) => s !== "sprint"), ...DROP_STATES],
        to: "sprint",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.mover.speedCategory === "sprinting",
        priority: 20,
      },
      {
        from: [...GROUND_STATES.filter((s) => s !== "run"), ...DROP_STATES],
        to: "run",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.mover.speedCategory === "running",
        priority: 20,
      },
      {
        from: [...GROUND_STATES.filter((s) => s !== "walk"), ...DROP_STATES],
        to: "walk",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.mover.speedCategory === "walking",
        priority: 20,
      },
      {
        from: [...GROUND_STATES.filter((s) => s !== "idle"), ...DROP_STATES],
        to: "idle",
        when: (ctx) =>
          ctx.simState.mover.grounded &&
          ctx.simState.mover.speedCategory === "idle",
        priority: 20,
      },
    ],
  });
}
