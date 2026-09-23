import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { EventEmitter } from "events";
import type { RoomState } from "../../schema/RoomState";
import type { PlayerState } from "../../schema/PlayerState";
import * as ethers from "ethers";
import { exitGame, loadGame } from "../loadGame";
import { ServerApi, ServerHandler } from "./ServerApi";
// @ts-ignore
import { Web3Api, LocalProvider } from "@oogg/server-engine";
import { PlayerData } from "../../abstract/types";

export interface ServerSpaceParams {
  gameData: any;
  debugPhysics?: boolean;
  isDraft?: boolean;
  serverHandler: ServerHandler;
}

export class ServerSpace {
  //
  engine = null;
  playerManager = null;
  space = null;
  spawn: any = null;
  // avatar = null;
  // coins = null;
  // coinModel = null;

  state: RoomState = null;

  serverApi: ServerApi = null;

  dt = 1 / 60;
  iv = null;
  time = 0;

  maxFrame = 0;
  avgFrame = 0;

  static create() {
    //
    globalThis.$$serverSpace = new ServerSpace();
  }

  constructor() {}

  private canLoadComponent(component: any) {
    // this is a little hacky, should be moved to the engine
    // But since this still can change often, keeping it here
    // so that we can make quick changes
    return (
      component.type === "prefab" ||
      component.type === "script" ||
      component.type === "model" ||
      component.type === "mesh" ||
      component.type === "group" ||
      // This will be handled by the engine by checking
      // either (deprecate) "use server" or config.server == true
      component.type?.startsWith("script") ||
      component.collider?.enabled ||
      component.type === "spawn"
    );
  }

  async init(opts: ServerSpaceParams) {
    //
    const { gameData } = opts;

    this.spawn = gameData.components["spawn"];

    this.serverApi = new ServerApi(opts.serverHandler);

    const secrets = gameData.components.multiplayer?.secrets;

    secrets?.forEach((secret) => {
      process.env[secret.key] = secret.value;
    });

    GlobalRegistrator.register({
      url: "http://localhost:3000",
      width: 1920,
      height: 1080,
    });

    const res = await loadGame(gameData, {
      debugPhysics: opts.debugPhysics ?? true,
      serverApi: {
        GameServer: this.serverApi,
        Ai: this.serverApi.ai,
        Web3: new Web3Api({
          web3provider: new LocalProvider({
            privateKey: process.env.PRIVATE_KEY,
            alchemyKey: process.env.ALCHEMY_KEY,
          }),
        }),
      },
      serverLibs: {
        ethers,
      },
      isDraft: opts.isDraft ?? true,
      filter: (component: any) => {
        return this.canLoadComponent(component);
      },
    });

    this.engine = res.engine;

    this.playerManager = res.players;

    this.space = this.engine.getCurrentSpace();

    console.log("Space loaded");

    // this.coins = coins;
    this.space.physics.active = true;

    this.space.physics.update(1 / 60);

    this.time = Date.now() / 1000;

    this.iv = setInterval(() => {
      const now = Date.now() / 1000;
      let dt = now - this.time;
      this.time = now;
      this.update(dt);
      const dts = Date.now() / 1000 - now;
      this.maxFrame = Math.max(dts, this.maxFrame);
      this.avgFrame = dts;
    }, 1000 / 60);

    return {
      entities: this.serverApi._entitiesSchema,
    };
  }

  async handleRpcRequest({ request, sessionId }) {
    //
    const { data, msgId } = request;

    let isReq = !!data.method;

    let event = isReq
      ? this.engine.Events.RPC_REMOTE_REQ
      : this.engine.Events.RPC_REMOTE_RES;

    this.engine.notify(event, {
      data,
      msgId,
      sessionId,
    });
  }

  private _getRpcRecipient(rpcId: string) {
    //
    return this.space.components.find((c) => {
      return c._rpcId === rpcId;
    });
  }

  startGame() {
    //
    this.space.start();
  }

  stopGame() {
    //
    this.space.stop();
  }

  async onJoin(player: PlayerData) {
    //
    if (this.space == null) {
      console.error("Space not loaded!");
      return;
    }

    const p = this.playerManager.addPlayer(player, {
      collision: true,
    });

    this.serverApi._roomJoin(player);

    await p.avatarReady;
  }

  _netstateCache = new WeakMap<{ version: number; state: any }>();

  onBeforePatch() {
    //
    const entities = this.serverApi._entitiesSchema;

    let state = {
      players: {},
      entities: {},
    };

    Object.keys(entities).forEach((entity) => {
      //
      const cs = this.space.components.byType(entity);

      cs.forEach((c) => {
        //
        let current = c.data.netState;

        if (current) {
          //
          let cached = this._netstateCache.get(c);

          if (cached == null) {
            cached = {
              version: 0,
              state: undefined,
              rpcId: c._rpcId,
            };
            this._netstateCache.set(c, cached);
          }

          if (cached.state !== current) {
            cached.state = current;
            cached.version++;
          } else {
            return;
          }
          state.entities[entity] ??= [];
          state.entities[entity].push(cached);
        }
      });
    });

    Object.keys(this.playerManager.players).forEach((sessionId) => {
      //
      const player = this.playerManager.players[sessionId];

      state.players[sessionId] = player.data;
    });

    return state;
  }

  onLeave(player: PlayerData) {
    //
    this.playerManager.removePlayer(player.sessionId);

    this.serverApi._roomLeave(player);
  }

  onPlayerState(data: PlayerData) {
    //
    const player = this.playerManager.get(data.sessionId);

    if (data.scale && data.scale !== player.avatar.scale) {
      player.avatar.avatarScale = data.scale;
    }

    if (this.spawn.useUserAvatar && player.avatar) {
      if (data.vrmUrl && data.vrmUrl !== player.avatar.vrmUrl) {
        // console.log(
        //   "Update VRM",
        //   data.sessionId,
        //   data.vrmUrl,
        //   player.avatar.collider.raw.radius()
        // );
        player.avatar.updateVRM(data.vrmUrl).then(() => {
          // TODO, move to engine
          const dims = player.avatar.getDimensions();
          player.avatar.rigidBody?._updateColliders(dims);
          // console.log("VRM Updated", player.avatar.collider.raw.radius());
        });
      }
    }

    this.serverApi._roomPlayerState(data);
  }

  private _accumulatedTime = 0;

  update(dt: number) {
    //
    let now = Date.now() / 1000;

    this.engine.notify(this.engine.Events.ANIM_UPDATE, this.dt, now);

    this.engine.notify(this.engine.Events.PRE_UPDATE, this.dt, now);

    this._accumulatedTime += dt;

    while (this._accumulatedTime >= this.dt) {
      //
      this.engine.notify(this.engine.Events.FIXED_UPDATE, this.dt, now);

      this.space.physics.updateFixed(this.dt);

      this._accumulatedTime -= this.dt;

      now += this.dt;
    }

    this.engine.notify(
      this.engine.Events.JUST_AFTER_PHYSICS_UPDATE,
      this.dt,
      now
    );
  }

  dispose() {
    //
    GlobalRegistrator.unregister();

    this.stopGame();

    clearInterval(this.iv);

    exitGame();
  }
}
