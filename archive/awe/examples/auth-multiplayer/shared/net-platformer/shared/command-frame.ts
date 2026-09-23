/**
 * Canonical per-tick player intent for the net-platformer preset.
 *
 * The frame carries gameplay-relevant input only. Local-only presentation
 * concerns such as zoom stay outside this payload.
 */
export interface NetPlatformerCommandFrame {
  /** Simulation tick the command targets */
  tick: number;
  /** Monotonic local sequence id for reconciliation or replay */
  sequence: number;
  /** Horizontal movement axis in the [-1, 1] range */
  moveX: number;
  /** Forward movement axis in the [-1, 1] range */
  moveY: number;
  /** Whether sprint is currently held */
  sprint: boolean;
  /** Rising edge for jump */
  jumpPressed: boolean;
  /** Falling edge for jump */
  jumpReleased: boolean;
  /** Whether jump is currently held */
  jumpHeld: boolean;
  /** Facing or look yaw used to resolve camera-relative movement deterministically */
  yaw: number;
}

/**
 * Creates a neutral command frame.
 */
export function createEmptyNetPlatformerCommandFrame(
  partial: Partial<NetPlatformerCommandFrame> = {},
): NetPlatformerCommandFrame {
  return {
    tick: partial.tick ?? 0,
    sequence: partial.sequence ?? partial.tick ?? 0,
    moveX: partial.moveX ?? 0,
    moveY: partial.moveY ?? 0,
    sprint: partial.sprint ?? false,
    jumpPressed: partial.jumpPressed ?? false,
    jumpReleased: partial.jumpReleased ?? false,
    jumpHeld: partial.jumpHeld ?? false,
    yaw: partial.yaw ?? 0,
  };
}
