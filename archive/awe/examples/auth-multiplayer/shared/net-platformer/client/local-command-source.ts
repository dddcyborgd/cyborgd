/**
 * Default command source that reads local hardware input (keyboard, gamepad,
 * touch) and produces one `NetPlatformerCommandFrame` per tick.
 *
 * Look/zoom deltas are forwarded to the presentation controller via callbacks
 * rather than being embedded in the command frame, because camera input is a
 * local presentation concern — it never needs to be sent to the server or
 * replayed deterministically.
 */
import {
  createInputs,
  sharedControlState,
  Keyboard,
  Gamepad,
  Mouse,
  Touch,
  Interactions,
} from "@oncyberio/engine/input";
import type { Inputs, InputSnapshot } from "@oncyberio/engine/input";
import type { CommandSource } from "../shared/command-source";
import {
  createEmptyNetPlatformerCommandFrame,
  type NetPlatformerCommandFrame,
} from "../shared/command-frame";

const NET_PLATFORMER_INPUTS = {
  Move: {
    type: "vector2",
    bindings: [
      Keyboard.wasd(),
      Keyboard.arrows(),
      Gamepad.leftStick(),
      Gamepad.dpad(),
      Touch.joystick(),
    ],
  },
  Look: {
    type: "vector2",
    bindings: [Mouse.delta(), Gamepad.rightStick()],
  },
  Jump: {
    type: "button",
    bindings: [Keyboard.button("Space"), Gamepad.button("A"), Touch.tap()],
    interactions: [Interactions.press()],
  },
  Sprint: {
    type: "button",
    bindings: [
      Keyboard.button("ShiftLeft"),
      Keyboard.button("ShiftRight"),
      Gamepad.button("LB"),
    ],
  },
} as const;

export type LocalNetPlatformerInputs = Inputs<typeof NET_PLATFORMER_INPUTS>;

export interface LocalNetPlatformerCommandSourceOptions {
  getYaw: () => number;
  onLookInput?: (deltaX: number, deltaY: number) => void;
  onZoomInput?: (delta: number) => void;
  initialTick?: number;
}

/**
 * Convert local hardware input into canonical net-platformer command frames.
 */
export function createLocalNetPlatformerCommandSource(
  options: LocalNetPlatformerCommandSourceOptions,
): CommandSource<NetPlatformerCommandFrame> & {
  inputs: LocalNetPlatformerInputs;
} {
  const inputs = createInputs(NET_PLATFORMER_INPUTS);
  let tick = options.initialTick ?? 0;
  let currentSnapshot: InputSnapshot<typeof NET_PLATFORMER_INPUTS> =
    inputs.readSnapshot();
  let currentCommand: NetPlatformerCommandFrame =
    createEmptyNetPlatformerCommandFrame({
      tick,
      sequence: tick,
      yaw: options.getYaw(),
    });

  return {
    inputs,

    update(dt: number): void {
      inputs.update(dt);
      currentSnapshot = inputs.readSnapshot();

      options.onLookInput?.(currentSnapshot.Look.x, currentSnapshot.Look.y);
      const wheelDelta = sharedControlState.mouse.wheelDelta;
      if (wheelDelta !== 0) {
        options.onZoomInput?.(wheelDelta);
      }

      tick += 1;
      currentCommand = {
        tick,
        sequence: tick,
        moveX: currentSnapshot.Move.x,
        moveY: currentSnapshot.Move.y,
        sprint: currentSnapshot.Sprint.pressed,
        jumpPressed: currentSnapshot.Jump.justPressed,
        jumpReleased: currentSnapshot.Jump.justReleased,
        jumpHeld: currentSnapshot.Jump.pressed,
        yaw: options.getYaw(),
      };
    },

    read(): NetPlatformerCommandFrame {
      return currentCommand;
    },

    setEnabled(enabled: boolean): void {
      if (enabled) {
        inputs.enable();
        return;
      }

      inputs.disable();
      currentSnapshot = inputs.readSnapshot();
      currentCommand = createEmptyNetPlatformerCommandFrame({
        tick,
        sequence: tick,
        yaw: options.getYaw(),
      });
    },

    dispose(): void {
      inputs.dispose();
    },
  };
}
