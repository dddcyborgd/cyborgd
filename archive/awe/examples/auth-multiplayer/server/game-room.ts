import { Client, Room } from "colyseus";
import { GameState, PlayerState } from "../shared/game-state";
import {
  isPlayerAnimationMessage,
  isPlayerCommandMessage,
  PLAYER_ANIMATION_MESSAGE,
  PLAYER_COMMAND_MESSAGE,
} from "../shared/messages";
import {
  NETWORK_TICK_INTERVAL,
  SIMULATION_TICK_INTERVAL,
} from "../shared/network-constants";
import { NetPlatformerAuthority } from "./net-platformer-authority";

export class GameRoom extends Room<GameState> {
  state = new GameState();
  private authority: NetPlatformerAuthority | null = null;

  async onCreate() {
    this.setPatchRate(NETWORK_TICK_INTERVAL);
    this.authority = await NetPlatformerAuthority.create();
    this.setSimulationInterval(() => {
      this.authority?.step(SIMULATION_TICK_INTERVAL / 1000);
    }, SIMULATION_TICK_INTERVAL);
  }

  messages = {
    [PLAYER_COMMAND_MESSAGE]: (client: Client, payload: unknown) => {
      if (!isPlayerCommandMessage(payload)) return;
      this.authority?.enqueueCommand(client.sessionId, payload);
    },
    [PLAYER_ANIMATION_MESSAGE]: (client: Client, payload: unknown) => {
      if (!isPlayerAnimationMessage(payload)) return;

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.anim = payload.animation;
    },
  };

  async onJoin(client: Client) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.updatedAt = Date.now();
    this.state.players.set(client.sessionId, player);
    await this.authority?.addPlayer(client, player);
    console.log("[Server] Player joined:", client.sessionId);
  }

  onLeave(client: Client) {
    this.authority?.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log("[Server] Player left:", client.sessionId);
  }

  async onDispose() {
    await this.authority?.dispose();
    this.authority = null;
  }
}
