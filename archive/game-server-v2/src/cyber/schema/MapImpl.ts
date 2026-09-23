import { MapSchema } from "@colyseus/schema";
import { cinst } from "./types";

class MapImpl<T> extends Map<string, T> {
  //
  $$cInst: MapSchema<T>;
  $$entityType: any;

  constructor() {
    //
    super();

    this.$$cInst = new MapSchema<T>();
  }

  set(key: string, value: T) {
    this.$$cInst.set(key, cinst(value));
    return super.set(key, value);
  }

  delete(key: string) {
    this.$$cInst.delete(key);
    return super.delete(key);
  }

  clear(): void {
    this.$$cInst.clear();
    super.clear();
  }
}

export function createMap(entityType: any) {
  const map = new MapImpl();
  map.$$entityType = entityType;
  return map;
}
