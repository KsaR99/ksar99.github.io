# Engine boundary

`engine/` owns deterministic game primitives and exposes a small public API.

## Public layers

- `board/` — occupancy, collision, line operations, garbage/cascade.
- `piece/` — generic piece representation, transforms and bag.
- `events/` — domain event bus.
- `scoring/` — pure scoring/progression formulas.
- `snapshot/` — serializable board/piece state.
- `simulation/` — `GameEngine`, `GameAction`, `SimulationState`.

`games/kl0ck1s/game/*` keeps compatibility adapters for the existing game-specific API.

The intended dependency direction is:

    games/kl0ck1s  -> engine
    engine         -X-> games/kl0ck1s

The current game-specific `Piece` adapter supplies `KLOCKOMINOS` definitions to the generic engine `Piece`.
