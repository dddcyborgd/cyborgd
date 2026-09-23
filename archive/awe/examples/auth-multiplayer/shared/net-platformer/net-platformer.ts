import type { Camera } from "three";
import type { Component3D } from "@oncyberio/engine";
import type { Space } from "@oncyberio/engine";
import { sharedControlState, type InputsHelpers } from "@oncyberio/engine/input";
import { Mover } from "@oncyberio/engine/controls";
import type { AnyCameraRig, AnimationStateMachine } from "@oncyberio/engine/controls";
import type { CommandSource } from "./shared/command-source";
import type { NetCommandAcknowledgement } from "./shared/sim-state";
import { createLocalNetPlatformerCommandSource } from "./client/local-command-source";
import {
  createNetPlatformerPredictedController,
  type NetPlatformerPredictedController,
} from "./client/predicted-controller";
import { createNetPlatformerPresentationController } from "./client/presentation-controller";
import {
  reconcileNetPlatformerPrediction,
  type NetPlatformerReconciliationOptions,
  type NetPlatformerReconciliationResult,
} from "./client/reconciliation";
import {
  resolveNetPlatformerOptions,
  type NetPlatformerOptions,
} from "./net-platformer-options";
import type { NetPlatformerCommandFrame } from "./shared/command-frame";
import type {
  NetPlatformerRollbackCheckpoint,
  NetPlatformerSimState,
} from "./shared/sim-state";
import { createInitialNetPlatformerSimState } from "./shared/sim-step";

const NOOP_INPUTS: InputsHelpers = {
  controlState: sharedControlState,
  sample(): void {},
  update(): void {},
  readSnapshot() {
    return {} as never;
  },
  enable(): void {},
  disable(): void {},
  dispose(): void {},
  get enabled(): boolean {
    return false;
  },
};

function setCommandSourceEnabled(
  commandSource: CommandSource<NetPlatformerCommandFrame>,
  inputs: InputsHelpers,
  enabled: boolean,
): void {
  if (commandSource.setEnabled) {
    commandSource.setEnabled(enabled);
    return;
  }

  if (enabled) {
    inputs.enable();
  } else {
    inputs.disable();
  }
}

/** Common interface for control system presets. */
interface ControlSystem {
    inputs: InputsHelpers;
    mover: Mover;
    cameraRig: AnyCameraRig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    animStateMachine?: AnimationStateMachine<any>;
    update(dt: number): void;
    lateUpdate(): void;
    dispose(): void;
    active: boolean;
}

export interface NetPlatformerControlSystem extends ControlSystem {
  readonly commandSource: CommandSource<NetPlatformerCommandFrame>;
  readonly predictedController: NetPlatformerPredictedController;
  readCommandFrame(): NetPlatformerCommandFrame;
  reconcile(
    acknowledgement: NetCommandAcknowledgement,
    authoritativeCheckpoint: NetPlatformerRollbackCheckpoint,
    dt: number,
    options?: NetPlatformerReconciliationOptions,
  ): NetPlatformerReconciliationResult;
  getSimState(): NetPlatformerSimState;
}

/**
 * High-level factory that wires the three layers together for local play:
 *
 *   hardware input → CommandSource → PredictedController → PresentationController
 *
 * On each fixed update:
 *   1. The command source samples input into a CommandFrame.
 *   2. The predicted controller runs one deterministic sim step.
 *   3. The presentation controller updates camera + animation from the new state.
 *
 * A custom `commandSource` can be injected via options for replay, bots, or tests.
 */
export function createNetPlatformer(
  space: Space,
  avatar: Component3D,
  camera: Camera,
  options: NetPlatformerOptions = {},
): NetPlatformerControlSystem {
  const opts = resolveNetPlatformerOptions(options);
  const movementBody = opts.movementBody ?? avatar;

  const mover = new Mover({
    body: movementBody,
    movement: opts,
    jump: opts,
  });

  const initialSimState = createInitialNetPlatformerSimState(
    { mover },
    { tick: opts.initialTick, sequence: opts.initialTick },
    { speed: opts.speed, sprintBoost: opts.sprintBoost },
  );

  const syncPresentationTarget = () => {
    if (movementBody === avatar) {
      return;
    }

    avatar.position.copy(movementBody.position);
    avatar.quaternion.copy(movementBody.quaternion);
    avatar.updateMatrixWorld?.(true);
  };

  const presentationController = createNetPlatformerPresentationController(
    avatar,
    camera,
    initialSimState,
    opts,
  );

  const commandSource =
    opts.commandSource ??
    createLocalNetPlatformerCommandSource({
      getYaw: () => presentationController.getYaw(),
      onLookInput: (deltaX, deltaY) =>
        presentationController.applyLookInput(deltaX, deltaY),
      onZoomInput: (delta) => presentationController.applyZoomInput(delta),
      initialTick: opts.initialTick,
    });

  const predictedController = createNetPlatformerPredictedController({
    host: { mover },
    commandSource,
    config: {
      speed: opts.speed,
      sprintBoost: opts.sprintBoost,
    },
    initialState: {
      command: {
        yaw: presentationController.getYaw(),
      },
      tick: initialSimState.tick,
      sequence: initialSimState.sequence,
    },
  });

  const inputs = commandSource.inputs ?? NOOP_INPUTS;
  let active = true;
  let disposed = false;

  const update = (dt: number) => {
    if (!active || disposed) {
      return;
    }

    const nextState = predictedController.update(dt);
    presentationController.update(dt, nextState);
  };

  const lateUpdate = () => {
    if (!active || disposed) {
      return;
    }

    syncPresentationTarget();
  };

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    active = false;
    unsubscribe();
    predictedController.dispose();
    presentationController.dispose();
    mover.dispose();
  };

  const unsubscribe = space.use({
    onUpdate: lateUpdate,
    onFixedUpdate: update,
    onDispose: () => dispose(),
  });

  return {
    inputs,
    mover,
    cameraRig: presentationController.cameraRig,
    animStateMachine: presentationController.animStateMachine,
    commandSource,
    predictedController,

    update,
    lateUpdate,
    dispose,

    readCommandFrame(): NetPlatformerCommandFrame {
      return commandSource.read();
    },

    reconcile(
      acknowledgement: NetCommandAcknowledgement,
      authoritativeCheckpoint: NetPlatformerRollbackCheckpoint,
      dt: number,
      reconciliationOptions?: NetPlatformerReconciliationOptions,
    ): NetPlatformerReconciliationResult {
      return reconcileNetPlatformerPrediction(
        predictedController,
        acknowledgement,
        authoritativeCheckpoint,
        dt,
        reconciliationOptions,
      );
    },

    getSimState(): NetPlatformerSimState {
      return predictedController.getPredictedState();
    },

    get active() {
      return active;
    },

    set active(value: boolean) {
      active = value;
      setCommandSourceEnabled(commandSource, inputs, value);
      presentationController.active = value;

      if (value) {
        const currentSimState = predictedController.getPredictedState();
        mover.reset();
        predictedController.reset({
          tick: currentSimState.tick,
          sequence: currentSimState.sequence,
          command: {
            yaw: presentationController.getYaw(),
          },
          derived: {
            jumpSpeedCategory: currentSimState.derived.jumpSpeedCategory,
          },
        });
        syncPresentationTarget();
      }
    },
  };
}
