import { State, P } from "./types";

export class GameTimer extends State {
  genesisTime = P.Number(Date.now());
  gameStart = P.Number();
  elapsedSecs = P.Number(0);
  maxTimeSecs = P.Number(10);

  reset() {
    this.gameStart = Date.now();
    this.elapsedSecs = 0;
  }

  step(dt: number) {
    this.elapsedSecs += dt;
    // console.log("elapsedSecs", this.elapsedSecs);
  }
}
