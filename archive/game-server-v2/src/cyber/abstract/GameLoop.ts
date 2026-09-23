export type GameLoopCallback = (delta: number) => void;

const noop = () => {};

export class GameLoop {
  public status: "idle" | "running" | "paused" = "idle";

  public deltaTime: number = 0;
  public deltaSecs: number = 0;
  public currentTime: number = 0;
  public elapsedTime: number = 0;

  private iv: any = null;

  private _tickRate: number = 1000 / 30; // 30fps, 33.33ms

  public onTick: GameLoopCallback = noop;

  constructor(
    public opts: {
      tickRate?: number;
      callback?: GameLoopCallback;
    } = {}
  ) {
    this._tickRate = opts.tickRate ?? this._tickRate;
    this.onTick = opts.callback ?? noop;
  }

  get isRunning() {
    return this.status === "running";
  }

  get tickRate() {
    return this._tickRate;
  }

  set tickRate(rate: number) {
    this._tickRate = rate ?? this._tickRate;
    if (this.status === "running") {
      this.stop();
      this.start();
    }
  }

  start() {
    if (this.status !== "idle") return;
    this.status = "running";
    this.deltaTime = 0;
    this.elapsedTime = 0;
    if (this.tickRate === 0) return;
    this.startInterval();
  }

  stop() {
    if (this.status !== "running") return;
    this.status = "idle";
    this.stopInterval();
  }

  private startInterval() {
    this.currentTime = Date.now();
    this.iv = setInterval(this.tick, 1000 / this._tickRate);
  }

  private stopInterval() {
    clearInterval(this.iv);
  }

  pause() {
    if (this.status !== "running") return;
    this.status = "paused";
    clearInterval(this.iv);
  }

  resume() {
    if (this.status !== "paused") return;
    this.status = "running";
    this.startInterval();
  }

  private tick = () => {
    const now = Date.now();
    this.deltaTime = now - this.currentTime;
    this.deltaSecs = this.deltaTime / 1000;
    this.currentTime = now;
    this.elapsedTime += this.deltaTime;
    this.onTick(this.deltaSecs);
  };
}
