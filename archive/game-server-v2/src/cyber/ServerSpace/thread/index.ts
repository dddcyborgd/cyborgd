import {
  // @ts-ignore
  Worker,
  isMainThread,
} from "worker_threads";

import { SpaceProxy } from "./SpaceProxy";
import { ServerSpace } from "./ServerSpace";

export type { SpaceProxy } from "./SpaceProxy";

export function createServerSpace() {
  //
  const worker = new Worker(__filename);

  return new SpaceProxy();
}

if (!isMainThread) {
  //
  const space = ServerSpace.create();
}
