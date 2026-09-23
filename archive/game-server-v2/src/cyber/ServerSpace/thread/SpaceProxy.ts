import { GameSession } from "../../abstract/GameSession";
import { PlayerData } from "../../abstract/types";
import { ServerSpace } from "./ServerSpace";
import { ServerHandler } from "./ServerApi";

export class SpaceProxy {
  //
  private session: GameSession;

  private serverSpace = new ServerSpace();

  private _disposers = [];

  constructor() {}

  _nbLogs = 0;

  log(...args: any[]) {
    //
    this._nbLogs++;
    if (this._nbLogs > 50) return;
    console.log(...args);
  }

  _versionedEntities: Record<string, boolean> = {};

  async init(opts: {
    session: GameSession;
    debugPhysics?: boolean;
    isDraft?: boolean;
  }) {
    //
    this.session = opts.session;

    const serverHandler: ServerHandler = {
      broadcast: (type, message, exclude) => {
        this.session.ctx.broadcastMsg(type, message, { except: exclude });
      },
      disconnectPlayer: (playerId) => {
        this.session.ctx.disconnectPlayer(playerId);
      },
      send: (type, message, playerId) => {
        this.session.ctx.sendMsg(type, message, playerId);
      },
    };

    const res = await this.serverSpace.init({
      gameData: this.session.gameData,
      debugPhysics: opts.debugPhysics,
      isDraft: opts.isDraft,
      serverHandler,
    });

    // console.log("ServerSpace init", this.session.ctx._uroomid);

    this._registerEntities(res.entities);

    this._initRpc();
  }

  private _initRpc() {
    //
    this.session.onRpc("@@engine", (request, sessionId) => {
      //
      // console.log("RPC Remote", request.data.method, this.session.ctx._uroomid);

      this.serverSpace.handleRpcRequest({
        request,
        sessionId,
      });
    });

    const engine = this.serverSpace.engine;

    const handleRpc = (req) => {
      //
      // console.log("RPC", req);

      if (req.sessionId == "*" || Array.isArray(req.sessionId?.except)) {
        // broadcast
        let opts = req.sessionId?.except
          ? { except: req.sessionId.except }
          : {};
        this.session.broadcastRpcMsg(
          {
            rpcId: "@@engine",
            ...req,
          },
          opts
        );
      } else {
        this.session.sendRpcMsg(
          {
            rpcId: "@@engine",
            ...req,
          },
          req.sessionId
        );
      }
    };

    this._disposers.push(
      engine.on(engine.Events.RPC_RESPONSE, handleRpc),
      engine.on(engine.Events.RPC_REQUEST, handleRpc)
    );
  }

  private _registerEntities(entities) {
    //
    Object.keys(entities).forEach((key) => {
      let schema = entities[key];
      this.session.Schema.$$registerEntity(key, schema);
      if (typeof schema === "object" && schema.type === "object") {
        this._versionedEntities[key] = true;
      }
    });
  }

  async sync({ state, params }) {
    //
    this.serverSpace.serverApi._roomSync({ state, params });
  }

  startGame() {
    //
    this.serverSpace.startGame();
  }

  stopGame() {
    //
    this.serverSpace.stopGame();
  }

  onJoin(player: PlayerData) {
    //
    this.serverSpace.onJoin(player);
  }

  onLeave(player: PlayerData) {
    //
    this.serverSpace.onLeave(player);
  }

  onBeforePatch() {
    //
    const res = this.serverSpace.onBeforePatch();
    this.session.state.stats.maxFrame = +this.serverSpace.maxFrame.toFixed(4);
    this.session.state.stats.avgFrame = +this.serverSpace.avgFrame.toFixed(4);
    this._patchEntities(res.entities);
    this._patchPlayers(res.players);
  }

  private _patchPlayers(players) {
    //
    const state = this.session.state;
    Object.keys(players).forEach((sessionId) => {
      let player = state.players[sessionId];
      if (player == null) return;
      player.update(players[sessionId]);
    });
  }

  private _patchEntities(entities) {
    //
    const state = this.session.state;

    Object.keys(entities).forEach((entity) => {
      const isVersioned = this._versionedEntities[entity];
      const es = entities[entity];
      es.forEach((e) => {
        if (isVersioned) {
          e.state._netVersion = e.version;
        }
        state.$$setEntityData(entity, e.rpcId, e.state);
      });
    });
  }

  onPlayerState(data: PlayerData) {
    //
    this.serverSpace.onPlayerState(data);
  }

  onMessage(type, message, playerId) {
    //
    this.serverSpace.serverApi._roomMsg({ type, message, playerId });
  }

  dispose() {
    //
    this._disposers.forEach((d) => d());

    this.serverSpace.dispose();
  }
}
