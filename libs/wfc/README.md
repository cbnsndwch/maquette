# @cbnsndwch/wfc

A small, dependency-free **2D tiled Wave Function Collapse** solver for
Musicologia's deterministic generation path.

Clean-room implementation of the classic SimpleTiled WFC algorithm
(lowest-entropy observation, arc-consistency propagation, restart-based
backtracking), in the spirit of [LingDong-/ndwfc](https://github.com/LingDong-/ndwfc)
(MIT). It is domain-agnostic — tiles are integer ids, adjacency is a callback,
and randomness is injected — so the same engine can lay out a Mykonos island or
anything else, and a given seed always yields the same grid.

## Usage

```ts
import { solveWfc, Direction } from '@cbnsndwch/wfc';

const { grid } = solveWfc({
    width: 14,
    height: 14,
    tileCount: 3,
    weights: [1, 2, 1],
    // can tile `b` sit to the `direction` of tile `a`?
    allowed: (a, b) => Math.abs(a - b) <= 1,
    rng: Math.random // inject a seeded PRNG for determinism
});
// grid[y][x] === collapsed tile id
```

Throws `WfcContradictionError` if no solution is found within `maxRestarts`
(default 12). At 14×14 with a sane ruleset this effectively never happens.

## License

MIT © [cbnsndwch LLC](https://github.com/cbnsndwch)
