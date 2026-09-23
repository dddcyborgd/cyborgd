export interface NetInputQueueOptions<TCommand extends { tick: number; sequence: number }> {
  cloneCommand: (command: TCommand) => TCommand;
  maxQueuedCommands?: number;
}

export interface NetInputQueue<TCommand extends { tick: number; sequence: number }> {
  enqueue(command: TCommand): boolean;
  dequeue(expectedTick: number): TCommand | null;
  clear(): void;
  getPendingCommands(): readonly TCommand[];
}

function compareCommands<TCommand extends { tick: number; sequence: number }>(
  left: TCommand,
  right: TCommand,
): number {
  return left.tick - right.tick || left.sequence - right.sequence;
}

export function createNetInputQueue<TCommand extends { tick: number; sequence: number }>(
  options: NetInputQueueOptions<TCommand>,
): NetInputQueue<TCommand> {
  const maxQueuedCommands = Math.max(1, options.maxQueuedCommands ?? 128);
  const pendingCommands: TCommand[] = [];

  let lastDequeuedTick = -1;
  let lastDequeuedSequence = -1;

  return {
    enqueue(command: TCommand): boolean {
      if (
        command.tick <= lastDequeuedTick ||
        command.sequence <= lastDequeuedSequence
      ) {
        return false;
      }

      const nextCommand = options.cloneCommand(command);
      const duplicateSequenceIndex = pendingCommands.findIndex(
        ({ sequence }) => sequence === nextCommand.sequence,
      );

      if (duplicateSequenceIndex >= 0) {
        return false;
      }

      const sameTickIndex = pendingCommands.findIndex(
        ({ tick }) => tick === nextCommand.tick,
      );

      if (sameTickIndex >= 0) {
        return false;
      }

      const insertIndex = pendingCommands.findIndex(
        (queuedCommand) => compareCommands(nextCommand, queuedCommand) < 0,
      );
      const resolvedInsertIndex =
        insertIndex >= 0 ? insertIndex : pendingCommands.length;
      const previousCommand = pendingCommands[resolvedInsertIndex - 1];
      const followingCommand = pendingCommands[resolvedInsertIndex];

      if (
        (previousCommand != null &&
          nextCommand.sequence <= previousCommand.sequence) ||
        (followingCommand != null &&
          nextCommand.sequence >= followingCommand.sequence)
      ) {
        return false;
      }

      if (insertIndex >= 0) {
        pendingCommands.splice(insertIndex, 0, nextCommand);
      } else {
        pendingCommands.push(nextCommand);
      }

      if (pendingCommands.length > maxQueuedCommands) {
        pendingCommands.splice(maxQueuedCommands);
      }

      return true;
    },

    dequeue(expectedTick: number): TCommand | null {
      while (pendingCommands[0] && pendingCommands[0].tick < expectedTick) {
        pendingCommands.shift();
      }

      const nextCommand = pendingCommands[0];
      if (!nextCommand || nextCommand.tick !== expectedTick) {
        return null;
      }

      pendingCommands.shift();
      lastDequeuedTick = nextCommand.tick;
      lastDequeuedSequence = nextCommand.sequence;

      return options.cloneCommand(nextCommand);
    },

    clear(): void {
      pendingCommands.length = 0;
      lastDequeuedTick = -1;
      lastDequeuedSequence = -1;
    },

    getPendingCommands(): readonly TCommand[] {
      return pendingCommands.map(options.cloneCommand);
    },
  };
}
