import { RoomState, P, State, PlayerState } from "../cyber";

export class CoinState extends State {
  id = P.String("");
  position = P.XYZ();
  rotation = P.XYZ();

  owner = P.String("");
}

export class MPlayerState extends PlayerState {
  serverPos = P.XYZ();
  serverRot = P.XYZ();
}

export class GameState extends RoomState {
  coins = P.Map(CoinState);
  scores = P.Map(P.Number());
  players = P.Map(MPlayerState);

  addPlayer(data: any): void {
    const player = super.addPlayer(data);
    this.scores.set(player.sessionId, 0);
    return player;
  }
}
