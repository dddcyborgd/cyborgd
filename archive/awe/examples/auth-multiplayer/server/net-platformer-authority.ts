import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "colyseus";
import type { Space } from "@oncyberio/engine";
import { EngineHeadless } from "@oncyberio/engine/headless";
import { Mover } from "@oncyberio/engine/controls";
import {
  createNetPlatformerAuthoritativeController,
  type NetPlatformerAuthoritativeController,
  type NetPlatformerCommandFrame,
  type NetPlatformerRollbackCheckpoint,
} from "../shared/net-platformer";
import { clonePlainObject } from "../shared/clone-plain-object";
import type { PlayerState } from "../shared/game-state";
import {
  PLAYER_SNAPSHOT_MESSAGE,
  type PlayerSnapshotMessage,
} from "../shared/messages";
import { SIMULATION_TICK_INTERVAL } from "../shared/network-constants";
import {
  multiplayerNetPlatformerOptions,
  serverPlayerColliderOffset,
  serverPlayerBodyDimensions,
} from "../shared/net-platformer-options";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticScenePath = resolve(__dirname, "../public/data/static-scene.json");
const HEADLESS_TICK_DT = SIMULATION_TICK_INTERVAL / 1000;

interface SceneGameData {
  id: string;
  creatorId?: string;
  editors?: string[];
  components: Record<string, any>;
}

interface SpawnTransform {
  position: {
    x: number;
    y: number;
    z: number;
  };
}

interface PlayerAuthority {
  client: Client;
  playerState: PlayerState;
  body: any;
  mover: Mover;
  controller: NetPlatformerAuthoritativeController;
}

function getQuaternionYaw(quaternion: {
  x: number;
  y: number;
  z: number;
  w: number;
}): number {
  return Math.atan2(
    2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
    1 - 2 * (quaternion.y ** 2 + quaternion.x ** 2),
  );
}

function applyCheckpointToPlayerState(
  playerState: PlayerState,
  checkpoint: NetPlatformerRollbackCheckpoint,
  updatedAt: number,
): void {
  const { snapshot } = checkpoint;
  playerState.x = snapshot.mover.position.x;
  playerState.y = snapshot.mover.position.y;
  playerState.z = snapshot.mover.position.z;
  playerState.rotY = getQuaternionYaw(snapshot.mover.quaternion);
  playerState.tick = snapshot.tick;
  playerState.sequence = snapshot.sequence;
  playerState.updatedAt = updatedAt;
}

function createPlayerBodyData(
  sessionId: string,
  spawn: SpawnTransform,
): Record<string, unknown> {
  return {
    id: `server-player-${sessionId}`,
    name: `Server Player ${sessionId}`,
    type: "mesh",
    display: false,
    displayInEditor: false,
    position: { ...spawn.position },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    geometry: {
      type: "box",
      boxParams: { ...serverPlayerBodyDimensions },
      sphereParams: {
        radius: 1,
        widthSegments: 8,
        heightSegments: 8,
      },
      cylinderParams: {
        radiusTop: 1,
        radiusBottom: 1,
        height: 1,
        radialSegments: 8,
        heightSegments: 1,
        openEnded: false,
      },
    },
    collider: {
      enabled: true,
      rigidbodyType: "PLAYER",
      colliderType: "CAPSULE",
      position: { ...serverPlayerColliderOffset },
    },
    script: {
      identifier: `server-player-${sessionId}`,
      _isPlayer: true,
    },
    _IS_PLAYER: true,
  };
}

async function loadServerScene(): Promise<{
  game: SceneGameData;
  spawn: SpawnTransform;
}> {
  const raw = JSON.parse(
    await readFile(staticScenePath, "utf8"),
  ) as SceneGameData;
  const components = { ...raw.components };
  const playerEntry = Object.entries(components).find(([, component]) => {
    return component?.script?.identifier === "player";
  });

  if (!playerEntry) {
    throw new Error("[Server] Player template component not found");
  }

  const [, playerTemplate] = playerEntry;
  delete components[playerEntry[0]];

  return {
    game: {
      id: raw.id,
      creatorId: raw.creatorId,
      editors: raw.editors,
      components,
    },
    spawn: {
      position: {
        x: playerTemplate.position?.x ?? 0,
        y: playerTemplate.position?.y ?? 0,
        z: playerTemplate.position?.z ?? 0,
      },
    },
  };
}

export class NetPlatformerAuthority {
  private readonly engine = EngineHeadless.getInstance();
  private readonly options = {
    speed: multiplayerNetPlatformerOptions.speed ?? 15,
    sprintBoost: multiplayerNetPlatformerOptions.sprintBoost ?? 1.5,
  };
  private readonly players = new Map<string, PlayerAuthority>();
  private space: Space | null = null;
  private spawn: SpawnTransform = {
    position: { x: 0, y: 0, z: 0 },
  };

  static async create(): Promise<NetPlatformerAuthority> {
    const authority = new NetPlatformerAuthority();
    await authority.init();
    return authority;
  }

  private async init(): Promise<void> {
    const { game, spawn } = await loadServerScene();
    const { space, reveal } = await this.engine.createSpace({
      runtime: "headless",
      mode: "game",
      game,
      user: { id: "server", name: "Server" },
    });

    await reveal();

    this.space = space;
    this.spawn = spawn;
    this.space.start();
    this.engine.tick(HEADLESS_TICK_DT);
  }

  async addPlayer(client: Client, playerState: PlayerState): Promise<void> {
    if (!this.space) {
      throw new Error("[Server] Headless space is not ready");
    }

    const body = await this.space.components.create(
      createPlayerBodyData(client.sessionId, this.spawn) as any,
    );
    this.engine.tick(HEADLESS_TICK_DT);
    const mover = new Mover({
      body,
      movement: multiplayerNetPlatformerOptions,
      jump: multiplayerNetPlatformerOptions,
    });
    const controller = createNetPlatformerAuthoritativeController({
      host: { mover },
      config: {
        speed: this.options.speed,
        sprintBoost: this.options.sprintBoost,
      },
    });
    const authority: PlayerAuthority = {
      client,
      playerState,
      body,
      mover,
      controller,
    };
    const initialSnapshot = clonePlainObject(
      controller.getAuthoritativeState(),
    );

    playerState.x = initialSnapshot.mover.position.x;
    playerState.y = initialSnapshot.mover.position.y;
    playerState.z = initialSnapshot.mover.position.z;
    playerState.rotY = getQuaternionYaw(initialSnapshot.mover.quaternion);
    playerState.tick = initialSnapshot.tick;
    playerState.sequence = initialSnapshot.sequence;
    playerState.updatedAt = Date.now();
    this.players.set(client.sessionId, authority);
  }

  removePlayer(sessionId: string): void {
    const authority = this.players.get(sessionId);
    if (!authority) {
      return;
    }

    authority.controller.dispose();
    authority.mover.dispose();
    authority.body.destroy();
    this.players.delete(sessionId);
  }

  enqueueCommand(
    sessionId: string,
    commandFrame: NetPlatformerCommandFrame,
  ): boolean {
    return this.players.get(sessionId)?.controller.enqueue(commandFrame) ?? false;
  }

  step(dt: number): void {
    this.engine.tick(dt);
    const updatedAt = Date.now();

    for (const authority of this.players.values()) {
      const checkpoint = authority.controller.update(dt);
      if (!checkpoint) {
        continue;
      }

      applyCheckpointToPlayerState(
        authority.playerState,
        checkpoint,
        updatedAt,
      );

      const payload: PlayerSnapshotMessage = {
        sessionId: authority.client.sessionId,
        acknowledgement: {
          tick: checkpoint.snapshot.tick,
          sequence: checkpoint.snapshot.sequence,
        },
        authoritativeCheckpoint: checkpoint,
      };

      authority.client.send(PLAYER_SNAPSHOT_MESSAGE, payload);
    }

    this.engine.tick(dt);
  }

  async dispose(): Promise<void> {
    for (const sessionId of Array.from(this.players.keys())) {
      this.removePlayer(sessionId);
    }

    this.space?.destroy();
    this.space = null;
  }
}
