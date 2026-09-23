export const SpaceEvents = {
  DISCONNECT: "DISCONNECT",
  SEND: "SEND",
  BROADCAST: "BROADCAST",
  RPC_REPLY: "RPC_REPLY",
  //
  LOADED: "LOADED",
  ENTITY_STATE: "ENTITY_STATE",
  READY: "READY",
  ERROR: "ERROR",
} as const;

export const RoomEvents = {
  LOAD_SPACE: "LOAD_SPACE",
  SYNC: "SYNC",
  JOIN: "JOIN",
  LEAVE: "LEAVE",
  PLAYER_STATE: "PLAYER_STATE",
  MESSAGE: "MESSAGE",
  RPC_REQUEST: "RPC_REQUEST",
  //
  START_GAME: "START_GAME",
  STOP_GAME: "STOP_GAME",
  BEFORE_PATCH: "BEFORE_PATCH",

  DISPOSE: "DISPOSE",
} as const;

export type RoomEvent = keyof typeof RoomEvents;

export type SpaceEvent = keyof typeof SpaceEvents;
