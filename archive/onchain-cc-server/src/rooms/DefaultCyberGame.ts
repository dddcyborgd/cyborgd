import { GameSession } from "../cyber";
import { PlayerData } from "../cyber/abstract/types";
import { PlayerState } from "../cyber/schema/PlayerState";
import { RoomState } from "../cyber/schema/RoomState";
import { CoinState, GameState } from "./GameState";
import { loadGame } from "./loadGame";
import { Signature, Wallet, getBytes, solidityPackedKeccak256 } from "ethers";
import crypto from "crypto";
const wallet = new Wallet(process.env.PRIVATE_KEY!);
import { ServerSpace } from "./ServerSpace";

export class DefaultCyberGame extends GameSession<RoomState> {
  //
  maxPlayers = 500;

  // fps
  tickRate = 20;
  patchRate = 20;

  reconnectTimeout = 0;

  state = new GameState();

  // serverSpace = new ServerSpace();

  async onPreload() {
    console.log("Preloading...");
    this.spawnCoins(10);
    
    // await this.serverSpace.init(this.gameId, this.state);
  }

  static onAuth(token: any, request: any): Promise<void> {
    console.log("Authenticating...", token);
    return Promise.resolve();
  }

  async onJoin(player) {
    console.log(player.sessionId, player.userId, "joined!");
    // this.serverSpace.onJoin(player);
  }

  onLeave(player) {
    console.log(player.sessionId, player.userId, "left!");
    // this.serverSpace.onLeave(player);
  }

  onMessage(message: any, player: PlayerState): void {
    //
    // console.log("Message received from", player.sessionId, message);

    if (message.type === "collect") {
      //
      const coin = this.state.coins.get(message.coinId);

      if (coin.owner) {
        //
        console.error("Coin already collected by", coin.owner);

        return;
      }

      coin.owner = player.sessionId;
      this.sendMint(player);
    } else if (message.type == "declare-address") {
      // UNTRUSTED
      if (!message.address) return;
      player.address = message.address;
    }
  }

  async sendMint(player: PlayerState) {
    if (!player.address) return;

    const word = solidityPackedKeccak256(["string"], [crypto.randomUUID()]);

    const hashedMessage = solidityPackedKeccak256(
      ["address", "bytes32"],
      [player.address, word]
    );

    const { v, r, s } = Signature.from(
      await wallet.signMessage(getBytes(hashedMessage))
    );

    this.send(
      {
        type: "mint-opportunity",
        payload: {
          word,
          signature: { v, r, s },
        },
      },
      player.sessionId
    );
  }
  onPlayerStateMsg(player: PlayerData, extra: any): void {
    //
    // const inputs = extra;
    // if (!inputs) {
    //   return;
    // }
    // this.serverSpace.onPlayerInput(player, inputs);
  }

  spawnCoins(nb: number) {
    for (let i = 0; i < nb; i++) {
      const coin = new CoinState();
      coin.id = Math.random().toString();
      coin.position.x = Math.random() * 100 - 5;
      coin.position.y = 0.5;
      coin.position.z = Math.random() * 100 - 5;
      this.state.coins.set(coin.id, coin);
    }
  }

  onRpc(request: any, reply: (data: any) => void): void {
    //
    console.log("RPC received", request);

    if (request.type === "testRpc") {
      reply({ message: "Hello from server!" });
    } else if (request.type === "debugPhysics") {
      // reply(this.serverSpace.getPhysicsDebug());
    } else if (request.type === "ccLogs") {
      // return reply(this.serverSpace.getLogs(request.sessionId));
    } else {
      reply({ message: "Invalid request" });
    }
  }

  // onUpdate(dt: number): void {
  //   console.log("updating...");
  //   this.state.players.forEach((player) => {
  //     //
  //     player.position.x += 0.01;
  //   });
  // }

  onDispose() {
    console.log("disposing...");
  }
}
