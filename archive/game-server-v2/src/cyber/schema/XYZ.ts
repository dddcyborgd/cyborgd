import { Schema, type } from "@colyseus/schema";

export type XYZ = { x: number; y: number; z: number };

export class XYZState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  copy(other: XYZ) {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
  }
}
