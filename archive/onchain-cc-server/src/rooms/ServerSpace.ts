import { PlayerState } from "../cyber";
import { CoinState, GameState } from "./GameState";
import { loadGame } from "./loadGame";

export class ServerSpace {
  engine = null;
  space = null;
  avatar = null;
  coins = null;
  coinModel = null;
  state: GameState = null;
  avatars: Record<string, any> = {};
  controls: Record<string, any> = {};

  async init(gameId, state) {
    //
    this.state = state;

    this.engine = await loadGame(gameId, {
      debugPhysics: true,
      filter: (component: any) => {
        return (
          component.collider?.enabled ||
          component.script?.identifier === "coin" ||
          component.name == "PlayerControls"
        );
      },
    });
    this.space = this.engine.getCurrentSpace();
    this.coinModel = this.space.components.byId("coin");
    const playerModel = this.space.components.byId("playerModel");

    console.log("Coin model", this.coinModel.getDimensions());
    console.log(
      "Player model",
      playerModel.getDimensions(),
      playerModel.behaviors.map((b) => b.name)
    );
    const coins = await this.spawnCoins(10);
    this.space = this.engine.getCurrentSpace();
    this.avatar = playerModel;
    this.coins = coins;
    this.space.physics.active = true;
    this.space.physics.update(1 / 60);
  }

  spawnCoins(nb: number) {
    let promises = [];
    for (let i = 0; i < nb; i++) {
      const coin = new CoinState();
      coin.id = Math.random().toString();
      coin.position.x = Math.random() * 100 - 5;
      coin.position.y = 0.5;
      coin.position.z = Math.random() * 100 - 5;
      this.state.coins.set(coin.id, coin);
      //
      promises.push(this._addCoin(coin.id, coin));
    }

    return Promise.all(promises);
  }

  async _addCoin(id, val) {
    const inst = await this.coinModel.duplicate();
    inst.position.copy(val.position);
    inst.rotation.y = val.rotation.y;
    inst.visible = true;
    inst.userData.coinId = id;
    return inst;
  }

  _startPos = { x: -98, y: 0, z: 226 };
  _startRot = { x: 0, y: -3.09, z: 0 };

  async onJoin(player: PlayerState) {
    //
    if (this.space == null) {
      console.error("Space not loaded!");
      return;
    }

    player.position.copy(this._startPos);
    player.rotation.copy(this._startRot);

    const data = {
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
      rotation: {
        x: player.rotation.x,
        y: player.rotation.y,
        z: player.rotation.z,
      },
    };

    const avatar = await this.avatar.duplicate({
      overrideOpts: data,
    });
    console.log(
      "Avatar created",
      avatar.behaviors.map((b) => b.name)
    );

    if (player.connected === false) {
      console.log(
        "Player left before avatar creattion, disposing...",
        player.sessionId
      );
      avatar.destroy();
      return;
    }

    const control = avatar.behaviors.find((b) => b.name === "PlayerControls");
    this.controls[player.sessionId] = control;
    control.initControls();

    console.log(
      "controls added",
      player.sessionId,
      avatar.rigidBody.position,
      avatar.rigidBody.raw.translation()
    );

    this.avatars[player.sessionId] = avatar;
  }

  onLeave(player: PlayerState) {
    //
    const avatar = this.avatars[player.sessionId];

    if (avatar) {
      avatar.destroy();
      delete this.avatars[player.sessionId];
      delete this.controls[player.sessionId];
    }
  }

  onPlayerInput(player, inputs) {
    //
    // console.log("validatePosition", player.sessionId, inputs);
    const playerControl = this.controls[player.sessionId];
    const avatar = this.avatars[player.sessionId];

    if (playerControl == null) {
      // console.error("Player control not found", player.sessionId);
      return;
    }

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      playerControl.controls.setInput(input);
      this.space.physics.update(1 / 60);
    }

    player.serverPos.copy(avatar.position);
    player.serverRot.copy(avatar.rotation);
  }

  getLogs(sessionId) {
    //
    const control = this.controls[sessionId];
    if (control == null) {
      return [];
    }

    return control.controls.characterController._logs;
  }

  getPhysicsDebug() {
    this.space.physics.updateDebug();
    const data = this.space.physics.debugLines.toJSON();
    return data;
  }
}
