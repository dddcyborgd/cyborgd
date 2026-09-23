import type { MapSchema, Schema } from "@colyseus/schema";

export const PLAYER_ROLES = {
  host: "host",
  player: "player",
} as const;

export type PlayerRole = keyof typeof PLAYER_ROLES;

export interface PlayerData {
  main?: boolean;
  sessionId: string;
  userId?: string;
  name: string;
  vrmUrl?: string;
  avatarUrl?: string;
  isAnonymous?: boolean;
  role?: PlayerRole;
  latency: number;
  plugins: string[];
  jitter: number;
  // Server authoritative state
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  animation: string;
}

export const CYBER_MSG = 1000;

export const GameActions = {
  START: 1,
  STOP: 2,
} as const;

export type GameAction = (typeof GameActions)[keyof typeof GameActions];

export enum Messages {
  // server -> client
  ROOM_GAME_ACTION = 1101,
  ROOM_MESSAGE = 1102,

  // client -> server
  GAME_MESSAGE = 1201,
  GAME_REQUEST = 1202,

  // client -> server (room)
  PLAYER_STATE = 1301,
  BROADCAST = 1302,
  SEND_DM = 1303,

  // ping
  PING = 1001,
  PONG = 1002,

  // rpc
  RPC = 9001,
}

export interface GameActionMessage {
  type: Messages.ROOM_GAME_ACTION;
  action: GameAction;
  data?: any;
}

export interface RoomMessage<RM> {
  type: Messages.ROOM_MESSAGE;
  data: RM;
}

export interface PingMsg {
  type: Messages.PING;
  data: number;
}

export interface RpcMsg {
  type: Messages.RPC;
  data: any;
  msgId: string;
}

export type ServerMessage<RM> =
  | GameActionMessage
  | RoomMessage<RM>
  | PingMsg
  | RpcMsg;

export interface PlayerMessage<M> {
  type: Messages.GAME_MESSAGE;
  data: M;
}

export interface GameRequest {
  type: Messages.GAME_REQUEST;
  action: GameAction;
  data?: any;
}

export interface PlayerStateMsg {
  type: Messages.PLAYER_STATE;
  data: [
    posX: number,
    posY: number,
    posZ: number,
    rotX: number,
    rotY: number,
    rotZ: number,
    animation: string,
    scale: number,
    vrmUrl: string,
    text: string,
    extra: any
  ];
}

export interface BroadcastMsg {
  type: Messages.BROADCAST;
  data: any;
  exclude?: string[];
}

export interface SendDMMsg {
  type: Messages.SEND_DM;
  playerId: string;
  data: any;
}

export interface PongMsg {
  type: Messages.PING;
  data: number;
}

export type ClientMessage<M> =
  | PlayerMessage<M>
  | GameRequest
  | PlayerStateMsg
  | BroadcastMsg
  | SendDMMsg
  | PongMsg
  | RpcMsg;

export interface BaseRoomState extends Schema {
  snapshotId: string;
  timestamp: number;
  settings: {
    tickRate: number;
    patchRate: number;
    reconnectTimeout: number;
  };
  players: MapSchema<PlayerData>;

  addPlayer(player: PlayerData): void;
  removePlayer(sessionId: string): void;
}
