import { Schema, type } from "@colyseus/schema";
export class GameTimer extends Schema {
  @type("number") genesisTime: number = Date.now();
  @type("number") gameStart: number = 0;
  @type("number") elapsedSecs: number = 0;
  @type("number") maxTimeSecs: number = 10;

  reset() {
    this.gameStart = Date.now();
    this.elapsedSecs = 0;
  }

  step(dt: number) {
    this.elapsedSecs += dt;
    // console.log("elapsedSecs", this.elapsedSecs);
  }
}
