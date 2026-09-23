import type { InputsHelpers } from "@oncyberio/engine/input";

export interface CommandSource<TCommand extends { tick: number; sequence: number }> {
  readonly inputs?: InputsHelpers;
  update(dt: number): void;
  read(): TCommand;
  setEnabled?(enabled: boolean): void;
  dispose(): void;
}
