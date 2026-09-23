import { PlayerState } from "./PlayerState";
import { GameTimer } from "./GameTimer";
import { State, P } from "./types";

export class RoomSettings extends State {
  reconnectTimeout = P.Number(0);
  patchRate = P.Number(20);
  tickRate = P.Number(20);
}

export class RoomState extends State {
  //
  snapshotId = P.String("");
  timestamp = P.Number(0);
  players = P.Map(PlayerState);
  timer = P.Object(GameTimer);
  settings = P.Object(RoomSettings);

  addPlayer(data: any) {
    //
    if ((this.players as any).$$entityType == null) {
      //
      throw new Error("Invalid players property");
    }

    const psClass = (this.players as any).$$entityType;

    console.log("psClass", psClass);

    if (
      !PlayerState.prototype.isPrototypeOf(psClass.prototype) &&
      psClass !== PlayerState
    ) {
      //
      throw new Error("Invalid PlayerState class");
    }

    const player = new psClass();
    player.sessionId = data.sessionId;
    player.userId = data.userId ?? "anon";
    player.name = data.name ?? "Anonymous";
    player.role = data.role ?? "player";
    player.position.assign(data.position ?? { x: 0, y: 0, z: 0 });
    player.rotation.assign(data.rotation ?? { x: 0, y: 0, z: 0 });
    player.animation = data.animation ?? "idle";
    player.text = data.text ?? "";

    player.connected = true;

    this.players.set(data.sessionId, player);
    // console.log("added player", player.toJSON());

    return player;
  }

  removePlayer(id: string) {
    const player = this.players.get(id);
    player.connected = false;
    this.players.delete(id);
  }
}
