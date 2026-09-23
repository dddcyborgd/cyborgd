import { type IncomingMessage } from "http";
import { GameLoop } from "./GameLoop";
import {
  PLAYER_ROLES,
  PlayerRole,
  Messages,
  GameActions,
  ClientMessage,
  PlayerData,
  PongMsg,
} from "./types";
import { RoomState } from "../schema/RoomState";
import { calcLatencyIPDTV } from "./utils";

const defaults = {
  PATCH_RATE: 20, // fps
  TICK_RATE: 20, // fps
};

export interface GameRoomCtx {
  gameId: string;
  sendMsg: (msg: any, sessionId: string) => void;
  broadcastMsg: (msg: any, options?: { except?: string[] }) => void;
  sendRaw: (msg: any, sessionId: string) => void;
  disconnectPlayer: (sessionId: string) => void;
  nbConnected: number;
}

export abstract class GameSession<
  State extends RoomState = RoomState,
  ClientMsg = any,
  RoomMsg = any
> {
  private _gameLoop = new GameLoop();

  readonly state: State;

  readonly tickRate = defaults.TICK_RATE;

  readonly patchRate = defaults.PATCH_RATE;

  readonly simulatedLatency?: number;

  maxPlayers = Infinity;

  pingInterval = 5000;

  joinAfterStart = true;

  reconnectTimeout = 0;

  showLogs = false;

  constructor(private ctx: GameRoomCtx) {}

  get gameId() {
    return this.ctx.gameId;
  }

  get status() {
    return this._gameLoop.status;
  }

  sendRaw(msg: { type: string; data: any }, playerId: string) {
    this.ctx.sendRaw(msg, playerId);
  }

  send(msg: RoomMsg, playerId: string) {
    this.ctx.sendMsg(
      {
        type: Messages.ROOM_MESSAGE,
        data: msg,
      },
      playerId
    );
  }

  broadcast(msg: RoomMsg, except?: string[]) {
    //
    if (except && !isArrayOfStrings(except)) {
      //
      console.error("invalid exclude argument");
      return;
    }

    this.ctx.broadcastMsg(
      {
        type: Messages.ROOM_MESSAGE,
        data: msg,
      },
      { except }
    );
  }

  startGame(countdownSecs: number) {
    //
    console.log("Starting game in", countdownSecs, "seconds");

    const countdownMillis = countdownSecs * 1000;

    // notift all players after countdown, take into account player's latency
    this.state.players.forEach((player) => {
      const latency = player.latency ?? 0;

      const delay = Math.max(0, countdownMillis - latency);

      this.ctx.sendMsg(
        {
          type: Messages.ROOM_GAME_ACTION,
          action: GameActions.START,
          data: delay / 1000,
        },
        player.sessionId
      );
    });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        //
        this._gameLoop.start();
        this.state.timer.reset();
        resolve();
      }, countdownMillis);
    });
  }

  stopGame() {
    this._gameLoop.stop();

    this.ctx.broadcastMsg({
      type: Messages.ROOM_GAME_ACTION,
      action: GameActions.STOP,
    });
  }

  disconnectPlayer(sessionId: string) {
    this.ctx.disconnectPlayer(sessionId);

    this._CALLBACKS_.leave(sessionId);
  }

  private _pendingPings = {} as Record<
    string,
    { time: number; sessionId: string }
  >;

  private _autoInc = 1;

  _PING_ = {
    _timeouts: {} as Record<string, NodeJS.Timeout>,

    _LATENCY_BUFFER_SIZE: 10,

    // buffer of last pings
    _latencyBuffer: {} as Record<string, number[]>,

    _clearPingLoop: (sessionId: string) => {
      const timeout = this._PING_._timeouts[sessionId];

      if (timeout) {
        delete this._PING_._timeouts[sessionId];

        clearTimeout(timeout);
      }
    },

    _clearAllPingLoops: () => {
      Object.values(this._PING_._timeouts).forEach((timeout) => {
        this._PING_._clearPingLoop(timeout.toString());
      });
    },

    _pingLoop: (sessionId: string) => {
      //
      const playerData = this._getPlayer(sessionId);

      if (playerData == null) {
        return;
      }

      let pingInterval = this._gameLoop.isRunning ? this.pingInterval : 1000;

      this._PING_._sendPing(playerData);

      this._PING_._timeouts[sessionId] = setTimeout(() => {
        //
        this._PING_._pingLoop(sessionId);
      }, pingInterval);
    },

    _sendPing: async (playerData: PlayerData) => {
      //
      const pingId = this._autoInc++;

      this._pendingPings[pingId] = {
        time: Date.now(),
        sessionId: playerData.sessionId,
      };

      if (this.showLogs) {
        console.log("ping", pingId, playerData.sessionId);
      }

      this.ctx.sendMsg(
        { type: Messages.PING, data: pingId },
        playerData.sessionId
      );
    },

    _onPong: (msg: PongMsg, sessionId: string) => {
      //
      const pingId = msg.data;

      const pending = this._pendingPings[pingId];

      if (pending == null || pending.sessionId !== sessionId) {
        console.error("No pending ping for player", sessionId);
        return;
      }

      const playerData = this._getPlayer(sessionId);

      if (playerData == null) {
        return;
      }

      // add to latency buffer
      let buffer = this._PING_._latencyBuffer[sessionId];

      if (buffer == null) {
        buffer = this._PING_._latencyBuffer[sessionId] = [];
      }

      buffer.push((Date.now() - pending.time) / 2);

      if (buffer.length > this._PING_._LATENCY_BUFFER_SIZE) {
        buffer.shift();
      }

      const { latency, jitter } = calcLatencyIPDTV(buffer);

      playerData.latency = latency;
      playerData.jitter = jitter;

      // playerData.latency = (Date.now() - pending.time) / 2;

      delete this._pendingPings[playerData.sessionId];

      if (this.showLogs) {
        console.log("pong", pingId, playerData.sessionId, latency, jitter);
      }
    },
  };

  private _getPlayer(sessionId: string) {
    //
    const player = this.state.players.get(sessionId);

    if (player == null) {
      console.error("Player not found", sessionId);
    }

    return player;
  }

  /**
   * internal callbacks
   */
  _CALLBACKS_ = {
    start: async () => {
      //
      const tickRate = this.tickRate ?? defaults.TICK_RATE;
      const patchRate = this.patchRate ?? defaults.PATCH_RATE;
      this._gameLoop.tickRate = tickRate;
      this.state.settings.reconnectTimeout = this.reconnectTimeout;
      this.state.settings.tickRate = tickRate;
      this.state.settings.patchRate = patchRate;

      await this.onPreload();

      if (typeof this.constructor.prototype.onUpdate === "function") {
        this._gameLoop.onTick = this._CALLBACKS_.tick;
      }
    },

    join: async (params: object) => {
      //
      const playerData = this.getPlayerData(params);
      this.validateJoin(playerData);
      const player = this.state.addPlayer(playerData);
      await Promise.resolve(this.onJoin(player));
      // send ping to client to measure latency
      // this._PING_._pingLoop(playerData.sessionId);
      if (this.showLogs) {
        console.log("player joined", playerData.sessionId);
      }
    },

    disconnect: (sessionId: string) => {
      //
      const player = this._getPlayer(sessionId);

      if (player != null) {
        player.connected = false;
      }

      return this.reconnectTimeout;
    },

    reconnect: (sessionId: string) => {
      //
      const player = this._getPlayer(sessionId);

      if (player != null) {
        player.connected = true;
      }
    },

    leave: async (sessionId: string) => {
      //
      const player = this.state.players.get(sessionId);
      if (player == null) {
        console.error("Player not found", sessionId);
        return;
      }

      if (this.showLogs) {
        console.log("player left", sessionId);
      }

      // this._PING_._clearPingLoop(sessionId);

      this.state.removePlayer(sessionId);

      if (player.role === PLAYER_ROLES.host) {
        const newManager = this.state.players.values().next().value;

        if (newManager) {
          newManager.role = PLAYER_ROLES.host;
        }
      }

      this.onLeave(player);
    },

    tick: (dt: number) => {
      // safety check
      if (this.ctx.nbConnected <= 0) {
        console.warn(
          "No players connected Yet the game loop is turning, stopping game loop"
        );
        this._gameLoop.stop();

        return;
      }

      this.onUpdate(dt);
    },

    prevTimestamp: Date.now(),

    beforePatch: () => {
      //
      this.state.snapshotId = Math.random().toString(36).substring(2, 7);
      this.state.timestamp = Date.now();
      // console.log(
      //   "beforePatch",
      //   this.state.timestamp - this._CALLBACKS_.prevTimestamp
      // );
      // this._CALLBACKS_.prevTimestamp = this.state.timestamp;
    },

    message: (message: any, sessionId: string) => {
      // compat for broadcast/send messages
      // that were sent as GAME_MESSAGE type
      if (message.type === Messages.RPC) {
        const reply = (data) => {
          this.ctx.sendMsg(
            {
              type: Messages.RPC,
              data,
              msgId: message.msgId,
            },
            sessionId
          );
        };
        this.onRpc(message.data, reply);
      } else if (message.type === Messages.PING) {
        //
        // this._PING_._onPong(message, sessionId);
        //
      } else {
        //
        const msg = message as ClientMessage<ClientMsg>;

        const player = this.state.players.get(sessionId);

        if (player == null) {
          console.error(`Player ${sessionId} not found`);
          return;
        }

        // this.logInfo("message", message, msg.type, msg.type == ClientProtocol.GAME_REQUEST)
        if (msg.type == Messages.PLAYER_STATE) {
          // player state message

          const [
            posX,
            posY,
            posZ,
            rotX,
            rotY,
            rotZ,
            animation,
            scale,
            vrmUrl,
            text,
            extra,
          ] = msg.data;

          const pos = player.position;

          let same = true;

          this.state.players.forEach((p) => {
            //
            if (p.sessionId === player.sessionId) {
              return;
            }
            if (p.position !== pos) {
              same = false;
            } else {
              console.log("same position");
            }
          });

          player.position.assign({
            x: posX ?? 0,
            y: posY ?? 0,
            z: posZ ?? 0,
          });

          player.rotation.assign({
            x: rotX ?? 0,
            y: rotY ?? 0,
            z: rotZ ?? 0,
          });

          player.animation = animation ?? "idle";
          player.vrmUrl = vrmUrl ?? "";
          player.scale = scale ?? 1;
          player.text = text ?? "";

          this.onPlayerStateMsg(player, extra);
        } else if (msg.type == Messages.GAME_MESSAGE) {
          this.onMessage?.(msg.data, player);

          // this.broadcastMsg({ type: "state", state: this.room.state })
        } else if (msg.type == Messages.GAME_REQUEST) {
          //
          switch (msg.action) {
            case GameActions.START:
              this.onRequestStart(msg.data);
              break;
          }
        } else if (msg.type == Messages.BROADCAST) {
          //
          this.broadcast(msg.data, msg.exclude);
        } else if (msg.type == Messages.SEND_DM) {
          //
          if (this.state.players.has(message.playerId)) {
            this.send(message, message.playerId);
          }
        } else {
          //
          console.error("Unknown message type", msg.type);
        }
      }
    },

    shutdown: () => {
      //
      this._gameLoop.stop();

      this.onDispose();
    },
  };

  getPlayerData(params: object): PlayerData {
    //
    let id = params["id"];
    let userId = params["userId"] ?? "anon";
    let name = params["username"] ?? "Anonymous";
    let avatarUrl = params["avatarUrl"] ?? "";
    let vrmUrl = params["vrmUrl"] ?? "";
    let isAnonymous = params["isAnonymous"] ?? true;
    let role: PlayerRole = PLAYER_ROLES.player;

    if (this.state.players.size === 0) {
      role = PLAYER_ROLES.host;
    }

    return {
      sessionId: id,
      userId,
      name,
      avatarUrl,
      vrmUrl,
      isAnonymous,
      role,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      animation: "idle",
      latency: 0,
      jitter: 0,
      plugins: [],
    };
  }

  validateJoin(playerData: PlayerData) {
    try {
      if (!this.joinAfterStart && this.status != "idle") {
        throw new Error("Game already started");
      }

      const nbPlayers = this.state.players.size;

      if (nbPlayers >= this.maxPlayers) {
        throw new Error("Room is full " + nbPlayers + " >= " + this.maxPlayers);
      }
    } catch (e) {
      console.error("validateJoin", e);
      throw e;
    }
  }

  async onPreload() {}

  static async onAuth(token: string, request: IncomingMessage) {}

  onJoin(player: PlayerData) {}

  onLeave(player: PlayerData) {}

  onPlayerStateMsg(player: PlayerData, extra: any) {}

  onMessage(msg: ClientMsg, player: PlayerData) {}

  onRpc(request: any, reply: (data: any) => void) {
    //
    console.warn("onRpc not implemented", request);
  }

  onRequestStart(data: any) {
    this.startGame(data.countdown ?? 0);
  }

  onUpdate(dt: number) {}

  onDispose() {}
}

function isArrayOfStrings(exclude) {
  return (
    Array.isArray(exclude) &&
    exclude.every((element) => typeof element === "string")
  );
}
