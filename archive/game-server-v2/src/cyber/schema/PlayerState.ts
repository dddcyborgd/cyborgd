import { type, Schema, ArraySchema } from "@colyseus/schema";
import { PlayerRole, PlayerStatePayload } from "../abstract/types";
import { XYZState } from "./XYZ";

export class PlayerState extends Schema {
  //
  // synchronized
  @type("string") sessionId: string = "";
  @type("string") userId: string = "";
  @type("string") name: string = "";
  @type("string") role: PlayerRole = "player";
  @type("number") latency: number = 0;
  @type("number") jitter: number = 0;
  @type(XYZState) position: XYZState = new XYZState();
  @type(XYZState) rotation: XYZState = new XYZState();
  @type("string") animation: string = "idle";
  @type("string") vrmUrl: string = "";
  @type("number") scale: number = 1;
  @type("string") text: string = "";
  @type("string") plugins = "";
  @type("string") state: string = "";

  // transient
  connected: boolean = false;
  address: string = "";

  update(
    payload: PlayerStatePayload,
    exclude: {
      position?: boolean;
      rotation?: boolean;
      animation?: boolean;
      scale?: boolean;
      vrmUrl?: boolean;
      text?: boolean;
    } = {}
  ) {
    //
    if (!exclude.position) this.position.assign(payload.position);
    if (!exclude.rotation) this.rotation.assign(payload.rotation);
    if (!exclude.animation) this.animation = payload.animation;
    if (!exclude.scale) this.scale = payload.scale;
    if (!exclude.vrmUrl) this.vrmUrl = payload.vrmUrl;
    if (!exclude.text) this.text = payload.text;
  }
}
