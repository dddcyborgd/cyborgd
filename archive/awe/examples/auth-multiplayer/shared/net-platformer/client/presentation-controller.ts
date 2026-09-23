import { Vector3 } from "three";
import type { Camera } from "three";
import type { Component3D } from "@oncyberio/engine";
import { ThirdPersonCameraRig } from "@oncyberio/engine/controls";
import type { AnimationStateMachine } from "@oncyberio/engine/controls";
import type {
  NetPlatformerAnimationContext,
  NetPlatformerAnimations,
} from "../shared/animation-state";
import { createNetPlatformerAnimationStateMachine } from "../shared/animation-state";
import type { NetPlatformerSimState } from "../shared/sim-state";

const CAMERA_FORWARD = new Vector3();

export interface NetPlatformerPresentationControllerOptions {
  cameraMode: "orbit" | "follow";
  cameraDistance: number;
  cameraHeight: number;
  cameraCollision: boolean;
  cameraSmoothing: number;
  animationMode: "presentation" | "disabled";
  animations: Partial<NetPlatformerAnimations>;
}

export interface NetPlatformerPresentationController {
  readonly cameraRig: ThirdPersonCameraRig;
  readonly animStateMachine?: AnimationStateMachine<NetPlatformerAnimationContext>;
  active: boolean;
  getYaw(): number;
  applyLookInput(deltaX: number, deltaY: number): void;
  applyZoomInput(delta: number): void;
  update(dt: number, simState: NetPlatformerSimState): void;
  dispose(): void;
}

/**
 * Client-only presentation: camera rig + animation state machine.
 *
 * Receives the latest `NetPlatformerSimState` each tick and drives:
 *   - ThirdPersonCameraRig (orbit or follow mode)
 *   - AnimationStateMachine (idle/walk/run/sprint/jump/fall/land transitions)
 *
 * The server never instantiates this — it only exists on the owning client.
 */
export function createNetPlatformerPresentationController(
  avatar: Component3D,
  camera: Camera,
  simState: NetPlatformerSimState,
  options: NetPlatformerPresentationControllerOptions,
): NetPlatformerPresentationController {
  const cameraRig = new ThirdPersonCameraRig({
    camera,
    target: avatar,
    distance: options.cameraDistance,
    height: options.cameraHeight,
    collision: options.cameraCollision,
    smoothing: options.cameraSmoothing,
    smoothMethod: options.cameraMode === "follow" ? "position" : "orbit",
  });

  const animStateMachine =
    options.animationMode === "presentation"
      ? createNetPlatformerAnimationStateMachine(
          avatar,
          simState,
          options.animations,
        )
      : undefined;

  let active = true;

  const getYaw = () => {
    camera.getWorldDirection(CAMERA_FORWARD);
    return Math.atan2(CAMERA_FORWARD.x, -CAMERA_FORWARD.z);
  };

  return {
    cameraRig,
    animStateMachine,

    get active() {
      return active;
    },

    set active(value: boolean) {
      active = value;
      cameraRig.active = value;
      if (animStateMachine) {
        animStateMachine.enabled = value;
        if (!value) {
          animStateMachine.forceState("idle");
        }
      }
    },

    getYaw,

    applyLookInput(deltaX: number, deltaY: number): void {
      if (deltaX === 0 && deltaY === 0) return;
      if (!cameraRig.usePointerLock || cameraRig.isPointerLocked) {
        cameraRig.rotate(deltaX, deltaY);
      }
    },

    applyZoomInput(delta: number): void {
      if (delta === 0) return;
      cameraRig.zoom(delta);
    },

    update(dt: number, nextSimState: NetPlatformerSimState): void {
      if (!animStateMachine) return;

      animStateMachine.setContext({ simState: nextSimState });

      if (nextSimState.derived.jumpedThisTick) {
        animStateMachine.send("jump");
      }

      animStateMachine.update(dt);
    },

    dispose(): void {
      cameraRig.dispose();
      animStateMachine?.dispose();
    },
  };
}
