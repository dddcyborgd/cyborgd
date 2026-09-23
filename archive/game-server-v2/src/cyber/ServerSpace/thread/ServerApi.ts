import { EventEmitter } from "events";
import type { PlayerData } from "../../abstract/types";
import type { RoomParams } from "../../abstract/GameSession";
import { RoomEvents, SpaceEvent, SpaceEvents } from "./types";
import { Ai } from "./ai";

export interface ServerHandler {
  disconnectPlayer(playerId: string): void;
  send(type: string | number, message: any, playerId: string): void;
  broadcast(type: string | number, message: any, exclude?: string[]): void;
}

export class ServerApi {
  //
  _entitiesSchema: Record<string, any> = {};

  private _emitter = new EventEmitter();

  private _state: any;

  private _roomParams: RoomParams;

  constructor(public serverHandler: ServerHandler) {
    //
    // temporary hack to allow registering entities from server-side
    globalThis.$$registerEntity = (entity: string, schema: any) => {
      //
      this._entitiesSchema[entity] = schema;
    };
  }

  _roomSync(config: { params: RoomParams; state: any }) {
    //
    this._state = config.state;
    this._state.players = {};
    this._roomParams = config.params;
  }

  _roomMsg(payload: any) {
    //
    this._emitter.emit(payload.type, payload.message, payload.playerId);
  }

  _roomJoin(player: PlayerData) {
    //
    this._state.players[player.sessionId] = player;

    this._emitter.emit(RoomEvents.JOIN, player);
  }

  _roomLeave(player: PlayerData) {
    //
    delete this._state.players[player.sessionId];

    this._emitter.emit(RoomEvents.LEAVE, player);
  }

  _roomPlayerState(player: PlayerData) {
    //
    // console.log("PLAYER_STATE", player);

    if (this._roomParams.authoritativePosition) {
      //
      delete player.position;
      delete player.rotation;
    }

    Object.assign(this._state.players[player.sessionId], player);
  }

  disconnectPlayer(playerId: string) {
    //
    this.serverHandler.disconnectPlayer(playerId);
  }

  onJoin(cb: (player: PlayerData) => void) {
    //
    return this._emitter.on(RoomEvents.JOIN, cb);
  }

  onLeave(cb: (player: PlayerData) => void) {
    //
    return this._emitter.on(RoomEvents.LEAVE, cb);
  }

  get state() {
    return this._state;
  }

  send(type: string | number, message: any, playerId: string) {
    this.serverHandler.send(type, message, playerId);
  }

  broadcast(type: string | number, message: any, exclude?: string[]) {
    this.serverHandler.broadcast(type, message, exclude);
  }

  onMessage(
    type: string,
    cb: (message: any, playerId: string) => void
  ): () => void {
    //
    this._emitter.on(type, cb);

    return () => {
      this._emitter.off(type, cb);
    };
  }

  get ai() {
    return Ai;
  }
}
