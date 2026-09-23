import type {
  NetCommandAcknowledgement,
  NetPlatformerCommandFrame,
  NetPlatformerRollbackCheckpoint,
} from "./net-platformer";

export const PLAYER_COMMAND_MESSAGE = "player:command";
export const PLAYER_ANIMATION_MESSAGE = "player:animation";
export const PLAYER_SNAPSHOT_MESSAGE = "player:snapshot";

export interface PlayerCommandMessage extends NetPlatformerCommandFrame {}

export interface PlayerAnimationMessage {
  animation: string;
}

export interface PlayerSnapshotMessage {
  sessionId: string;
  acknowledgement: NetCommandAcknowledgement;
  authoritativeCheckpoint: NetPlatformerRollbackCheckpoint;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isAnimationName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export function isPlayerCommandMessage(
  value: unknown,
): value is PlayerCommandMessage {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<PlayerCommandMessage>;

  return (
    isFiniteNumber(message.tick) &&
    isFiniteNumber(message.sequence) &&
    isFiniteNumber(message.moveX) &&
    isFiniteNumber(message.moveY) &&
    isBoolean(message.sprint) &&
    isBoolean(message.jumpPressed) &&
    isBoolean(message.jumpReleased) &&
    isBoolean(message.jumpHeld) &&
    isFiniteNumber(message.yaw)
  );
}

export function isPlayerAnimationMessage(
  value: unknown,
): value is PlayerAnimationMessage {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<PlayerAnimationMessage>;
  return isAnimationName(message.animation);
}

export function isPlayerSnapshotMessage(
  value: unknown,
): value is PlayerSnapshotMessage {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<PlayerSnapshotMessage>;
  const checkpoint = message.authoritativeCheckpoint;
  const acknowledgement = message.acknowledgement;

  if (
    typeof message.sessionId !== "string" ||
    acknowledgement == null ||
    typeof acknowledgement !== "object" ||
    !isFiniteNumber(acknowledgement.tick) ||
    !isFiniteNumber(acknowledgement.sequence) ||
    checkpoint == null ||
    typeof checkpoint !== "object"
  ) {
    return false;
  }

  const snapshot = (checkpoint as NetPlatformerRollbackCheckpoint).snapshot;

  return (
    snapshot != null &&
    typeof snapshot === "object" &&
    isFiniteNumber(snapshot.tick) &&
    isFiniteNumber(snapshot.sequence) &&
    isFiniteNumber(snapshot.mover?.position?.x) &&
    isFiniteNumber(snapshot.mover?.position?.y) &&
    isFiniteNumber(snapshot.mover?.position?.z) &&
    isFiniteNumber(snapshot.mover?.quaternion?.x) &&
    isFiniteNumber(snapshot.mover?.quaternion?.y) &&
    isFiniteNumber(snapshot.mover?.quaternion?.z) &&
    isFiniteNumber(snapshot.mover?.quaternion?.w)
  );
}
