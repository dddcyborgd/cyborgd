import { GameLoader } from "@oogg/server-engine";

const builtinExcludes = {
  fog: true,
  background: true,
  envmap: true,
  lighting: true,
  postpro: true,
  rain: true,
  spawn: true,
  //
};
//

export interface LoadGameOptions {
  isDraft: boolean;
  serverApi: any;
  serverLibs: any;
  debugPhysics: boolean;
  filter: (component: any) => boolean;
}

const defOptions = {
  isDraft: true,
  debugPhysics: false,
  serverApi: null,
  serverLibs: null,
  filter: (component: any) => {
    return component.collider?.enabled;
  },
};

const loader = new GameLoader();

export async function loadGame(gameData, opts: Partial<LoadGameOptions> = {}) {
  //
  opts = Object.assign({}, defOptions, opts);

  const result = await loader.loadGameData(gameData, opts);

  return result;
}

export function exitGame() {
  //
  console.log("Exiting game");

  loader.exit();
}
