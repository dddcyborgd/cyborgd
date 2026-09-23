/**
 * Presentation-only adapter for rendering simulation state.
 *
 * Examples: camera rigs, animation, remote interpolation, cosmetic smoothing.
 */
export interface PresentationDriver<TState> {
  active: boolean;
  update(dt: number, state: TState): void;
  dispose(): void;
}
