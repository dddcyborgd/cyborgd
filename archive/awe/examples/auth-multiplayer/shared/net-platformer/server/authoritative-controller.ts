/**
 * Server-authoritative simulation host for one net-platformer player.
 *
 * Consumes queued command frames one tick at a time, runs the deterministic
 * sim step, and publishes rollback checkpoints that clients use for
 * reconciliation.
 */
import type { MoverState } from "../../mover-host";
import { clonePlainObject } from "../../clone-plain-object";
import { captureMoverState, cloneMoverState } from "../../mover-host";
import type { NetPlatformerCommandFrame } from "../shared/command-frame";
import type {
  NetCommandAcknowledgement,
  NetPlatformerRollbackCheckpoint,
  NetPlatformerSimState,
} from "../shared/sim-state";
import {
  createNetPlatformerRollbackCheckpoint,
} from "../shared/sim-state";
import {
  createInitialNetPlatformerSimState,
  primeNetPlatformerSimHost,
  stepNetPlatformerSim,
  type NetPlatformerSimConfig,
  type NetPlatformerSimHost,
  type NetPlatformerSimStateOverrides,
} from "../shared/sim-step";
import { createNetInputQueue, type NetInputQueue } from "./input-queue";

export interface NetPlatformerAuthoritativeControllerOptions {
  host: NetPlatformerSimHost;
  config: NetPlatformerSimConfig;
  inputQueue?: NetInputQueue<NetPlatformerCommandFrame>;
  initialState?: NetPlatformerSimStateOverrides;
  maxQueuedCommands?: number;
}

export interface NetPlatformerAuthoritativeController {
  readonly inputQueue: NetInputQueue<NetPlatformerCommandFrame>;
  enqueue(command: NetPlatformerCommandFrame): boolean;
  update(dt: number): NetPlatformerRollbackCheckpoint | null;
  reset(partial?: NetPlatformerSimStateOverrides): NetPlatformerSimState;
  getAuthoritativeState(): NetPlatformerSimState;
  getPendingCommands(): readonly NetPlatformerCommandFrame[];
  getLastProcessedCommand(): NetPlatformerCommandFrame | null;
  getLastAcknowledgement(): NetCommandAcknowledgement | null;
  getLastSnapshot(): NetPlatformerSimState | null;
  getLastCheckpoint(): NetPlatformerRollbackCheckpoint | null;
  dispose(): void;
}

export function createNetPlatformerAuthoritativeController(
  options: NetPlatformerAuthoritativeControllerOptions,
): NetPlatformerAuthoritativeController {
  const inputQueue =
    options.inputQueue ??
    createNetInputQueue({
      cloneCommand: clonePlainObject,
      maxQueuedCommands: options.maxQueuedCommands,
    });

  primeNetPlatformerSimHost(options.host);
  let authoritativeState = createInitialNetPlatformerSimState(
    options.host,
    options.initialState,
    options.config,
  );
  let lastProcessedCommand: NetPlatformerCommandFrame | null = null;
  let lastSnapshot: NetPlatformerSimState | null = null;
  let lastMoverState: MoverState | null = null;

  return {
    inputQueue,

    enqueue(command: NetPlatformerCommandFrame): boolean {
      return inputQueue.enqueue(command);
    },

    update(dt: number): NetPlatformerRollbackCheckpoint | null {
      const command = inputQueue.dequeue(authoritativeState.tick + 1);
      if (!command) {
        return null;
      }

      authoritativeState = stepNetPlatformerSim(
        options.host,
        authoritativeState,
        command,
        dt,
        options.config,
      );
      lastProcessedCommand = clonePlainObject(command);
      lastMoverState = cloneMoverState(captureMoverState(options.host));
      lastSnapshot = clonePlainObject(authoritativeState);

      return createNetPlatformerRollbackCheckpoint(
        authoritativeState,
        lastMoverState,
      );
    },

    reset(
      partial: NetPlatformerSimStateOverrides = {},
    ): NetPlatformerSimState {
      inputQueue.clear();
      lastProcessedCommand = null;
      lastSnapshot = null;
      lastMoverState = null;
      primeNetPlatformerSimHost(options.host);
      authoritativeState = createInitialNetPlatformerSimState(
        options.host,
        partial,
        options.config,
      );
      return authoritativeState;
    },

    getAuthoritativeState(): NetPlatformerSimState {
      return authoritativeState;
    },

    getPendingCommands(): readonly NetPlatformerCommandFrame[] {
      return inputQueue.getPendingCommands();
    },

    getLastProcessedCommand(): NetPlatformerCommandFrame | null {
      return lastProcessedCommand
        ? clonePlainObject(lastProcessedCommand)
        : null;
    },

    getLastAcknowledgement(): NetCommandAcknowledgement | null {
      return lastSnapshot
        ? { tick: lastSnapshot.tick, sequence: lastSnapshot.sequence }
        : null;
    },

    getLastSnapshot(): NetPlatformerSimState | null {
      return lastSnapshot
        ? clonePlainObject(lastSnapshot)
        : null;
    },

    getLastCheckpoint(): NetPlatformerRollbackCheckpoint | null {
      if (!lastSnapshot || !lastMoverState) {
        return null;
      }

      return createNetPlatformerRollbackCheckpoint(lastSnapshot, lastMoverState);
    },

    dispose(): void {
      inputQueue.clear();
      lastProcessedCommand = null;
      lastSnapshot = null;
      lastMoverState = null;
    },
  };
}
