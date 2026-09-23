/**
 * Client-side prediction controller for the net-platformer.
 *
 * Maintains a local simulation loop with pending-command buffering and
 * state history, enabling server reconciliation via rewind-and-replay.
 */
import type { MoverState } from "../../mover-host";
import { clonePlainObject } from "../../clone-plain-object";
import type { InputsHelpers } from "@oncyberio/engine/input";
import { captureMoverState, cloneMoverState, restoreMoverState } from "../../mover-host";
import type { CommandSource } from "../shared/command-source";
import type { NetPlatformerCommandFrame } from "../shared/command-frame";
import type {
  NetCommandAcknowledgement,
  NetPlatformerSimState,
} from "../shared/sim-state";
import {
  createInitialNetPlatformerSimState,
  primeNetPlatformerSimHost,
  stepNetPlatformerSim,
  type NetPlatformerSimConfig,
  type NetPlatformerSimHost,
  type NetPlatformerSimStateOverrides,
} from "../shared/sim-step";

export interface NetPlatformerPredictedControllerOptions {
  host: NetPlatformerSimHost;
  commandSource: CommandSource<NetPlatformerCommandFrame>;
  config: NetPlatformerSimConfig;
  initialState?: NetPlatformerSimStateOverrides;
  maxPendingCommands?: number;
}

export interface NetPlatformerPredictedController {
  readonly commandSource: CommandSource<NetPlatformerCommandFrame>;
  readonly inputs?: InputsHelpers;
  update(dt: number): NetPlatformerSimState;
  reset(partial?: NetPlatformerSimStateOverrides): NetPlatformerSimState;
  rewindTo(sequence: number): NetPlatformerSimState | null;
  applyAuthoritativeSnapshot(
    authoritativeSnapshot: NetPlatformerSimState,
    authoritativeHostState: MoverState,
  ): NetPlatformerSimState;
  replayPendingCommands(dt: number): NetPlatformerSimState;
  acknowledge(
    acknowledgement: NetCommandAcknowledgement,
    authoritativeSnapshot?: NetPlatformerSimState,
  ): void;
  getPredictedState(): NetPlatformerSimState;
  getPendingCommands(): readonly NetPlatformerCommandFrame[];
  getLastAcknowledgement(): NetCommandAcknowledgement | null;
  getLastAcknowledgedState(): NetPlatformerSimState | null;
  getLastAuthoritativeSnapshot(): NetPlatformerSimState | null;
  dispose(): void;
}

interface PredictedCheckpoint {
  simState: NetPlatformerSimState;
  moverState: MoverState;
}

interface LastAcknowledged {
  acknowledgement: NetCommandAcknowledgement;
  checkpoint: PredictedCheckpoint | null;
  authoritativeSnapshot: NetPlatformerSimState | null;
}

function trimPendingBuffers(
  pendingCommands: Map<number, NetPlatformerCommandFrame>,
  stateHistory: Map<number, PredictedCheckpoint>,
  maxPendingCommands: number,
): void {
  while (pendingCommands.size > maxPendingCommands) {
    const oldestSequence = pendingCommands.keys().next().value;
    if (oldestSequence == null) {
      break;
    }

    pendingCommands.delete(oldestSequence);
    stateHistory.delete(oldestSequence);
  }
}

function prunePendingCommandsUpToSequence(
  pendingCommands: Map<number, NetPlatformerCommandFrame>,
  sequence: number,
): void {
  for (const pendingSequence of pendingCommands.keys()) {
    if (pendingSequence > sequence) {
      continue;
    }

    pendingCommands.delete(pendingSequence);
  }
}

function pruneStateHistoryUpToSequence(
  stateHistory: Map<number, PredictedCheckpoint>,
  sequence: number,
): void {
  for (const pendingSequence of stateHistory.keys()) {
    if (pendingSequence > sequence) {
      continue;
    }

    stateHistory.delete(pendingSequence);
  }
}

function createCheckpoint(
  host: NetPlatformerSimHost,
  simState: NetPlatformerSimState,
): PredictedCheckpoint {
  return {
    simState: clonePlainObject(simState),
    moverState: cloneMoverState(captureMoverState(host)),
  };
}

/**
 * Hosts the owning player's locally predicted simulation.
 */
export function createNetPlatformerPredictedController(
  options: NetPlatformerPredictedControllerOptions,
): NetPlatformerPredictedController {
  const maxPendingCommands = Math.max(1, options.maxPendingCommands ?? 128);
  const pendingCommands = new Map<number, NetPlatformerCommandFrame>();
  const stateHistory = new Map<number, PredictedCheckpoint>();

  primeNetPlatformerSimHost(options.host);
  let predictedState = createInitialNetPlatformerSimState(
    options.host,
    options.initialState,
    options.config,
  );
  let lastAcknowledged: LastAcknowledged | null = null;

  return {
    commandSource: options.commandSource,
    inputs: options.commandSource.inputs,

    update(dt: number): NetPlatformerSimState {
      options.commandSource.update(dt);

      const command = clonePlainObject(options.commandSource.read());
      pendingCommands.set(command.sequence, command);
      predictedState = stepNetPlatformerSim(
        options.host,
        predictedState,
        command,
        dt,
        options.config,
      );
      stateHistory.set(
        command.sequence,
        createCheckpoint(options.host, predictedState),
      );
      trimPendingBuffers(pendingCommands, stateHistory, maxPendingCommands);

      return predictedState;
    },

    reset(
      partial: NetPlatformerSimStateOverrides = {},
    ): NetPlatformerSimState {
      pendingCommands.clear();
      stateHistory.clear();
      lastAcknowledged = null;
      primeNetPlatformerSimHost(options.host);
      predictedState = createInitialNetPlatformerSimState(
        options.host,
        partial,
        options.config,
      );
      return predictedState;
    },

    rewindTo(sequence: number): NetPlatformerSimState | null {
      const checkpoint =
        stateHistory.get(sequence) ??
        (lastAcknowledged?.acknowledgement.sequence === sequence
          ? lastAcknowledged.checkpoint
          : null);
      if (!checkpoint) {
        return null;
      }

      restoreMoverState(options.host, checkpoint.moverState);
      predictedState = clonePlainObject(checkpoint.simState);
      return predictedState;
    },

    applyAuthoritativeSnapshot(
      authoritativeSnapshot: NetPlatformerSimState,
      authoritativeHostState: MoverState,
    ): NetPlatformerSimState {
      restoreMoverState(options.host, authoritativeHostState);
      predictedState = clonePlainObject(authoritativeSnapshot);
      lastAcknowledged = {
        acknowledgement: {
          tick: authoritativeSnapshot.tick,
          sequence: authoritativeSnapshot.sequence,
        },
        checkpoint: createCheckpoint(options.host, predictedState),
        authoritativeSnapshot: clonePlainObject(authoritativeSnapshot),
      };
      stateHistory.clear();
      prunePendingCommandsUpToSequence(
        pendingCommands,
        authoritativeSnapshot.sequence,
      );

      return predictedState;
    },

    replayPendingCommands(dt: number): NetPlatformerSimState {
      stateHistory.clear();

      const orderedPendingCommands = Array.from(
        pendingCommands.values(),
        clonePlainObject,
      ).sort((left, right) => left.sequence - right.sequence);

      for (const command of orderedPendingCommands) {
        predictedState = stepNetPlatformerSim(
          options.host,
          predictedState,
          command,
          dt,
          options.config,
        );
        stateHistory.set(
          command.sequence,
          createCheckpoint(options.host, predictedState),
        );
      }

      return predictedState;
    },

    acknowledge(
      acknowledgement: NetCommandAcknowledgement,
      authoritativeSnapshot?: NetPlatformerSimState,
    ): void {
      if (
        lastAcknowledged &&
        acknowledgement.sequence < lastAcknowledged.acknowledgement.sequence
      ) {
        return;
      }

      const checkpoint =
        stateHistory.get(acknowledgement.sequence) != null
          ? {
              simState: clonePlainObject(
                stateHistory.get(acknowledgement.sequence)!.simState,
              ),
              moverState: cloneMoverState(
                stateHistory.get(acknowledgement.sequence)!.moverState,
              ),
            }
          : null;
      lastAcknowledged = {
        acknowledgement: {
          tick: acknowledgement.tick,
          sequence: acknowledgement.sequence,
        },
        checkpoint,
        authoritativeSnapshot: authoritativeSnapshot
          ? clonePlainObject(authoritativeSnapshot)
          : null,
      };

      prunePendingCommandsUpToSequence(
        pendingCommands,
        acknowledgement.sequence,
      );
      pruneStateHistoryUpToSequence(stateHistory, acknowledgement.sequence);
    },

    getPredictedState(): NetPlatformerSimState {
      return predictedState;
    },

    getPendingCommands(): readonly NetPlatformerCommandFrame[] {
      return Array.from(pendingCommands.values(), clonePlainObject);
    },

    getLastAcknowledgement(): NetCommandAcknowledgement | null {
      return lastAcknowledged
        ? {
            tick: lastAcknowledged.acknowledgement.tick,
            sequence: lastAcknowledged.acknowledgement.sequence,
          }
        : null;
    },

    getLastAcknowledgedState(): NetPlatformerSimState | null {
      return lastAcknowledged?.checkpoint
        ? clonePlainObject(lastAcknowledged.checkpoint.simState)
        : null;
    },

    getLastAuthoritativeSnapshot(): NetPlatformerSimState | null {
      return lastAcknowledged?.authoritativeSnapshot
        ? clonePlainObject(lastAcknowledged.authoritativeSnapshot)
        : null;
    },

    dispose(): void {
      options.commandSource.dispose();
      pendingCommands.clear();
      stateHistory.clear();
      lastAcknowledged = null;
    },
  };
}
