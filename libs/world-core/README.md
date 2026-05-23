# @cbnsndwch/world-core

Renderer-agnostic builder that turns a [`WorldSpec`](../contracts) into a
`THREE.Scene`.

It constructs only the scene graph — geometry, materials, and lights — and never
creates a renderer or camera. That keeps the same scene usable across every
render target (browser/Tauri WebGL today; a terminal target later).

```ts
import { createSampleWorldSpec } from '@cbnsndwch/contracts';
import { buildScene, disposeScene, suggestCameraPosition } from '@cbnsndwch/world-core';

const spec = createSampleWorldSpec('spotify:track:abc');
const scene = buildScene(spec, { tileSize: 1, heightScale: 3 });

// ...attach your own renderer + camera (see suggestCameraPosition())...

// when swapping worlds:
disposeScene(scene);
```

`three` is a peer dependency — the host app provides it.

## Aesthetic pass (research Stage 4)

`createPostFx(renderer, scene, camera, spec)` builds a three `EffectComposer`
chain from the world's `postFx` toggles — a Kuwahara painterly filter, palette
quantization, a Bayer ordered-dither, and a toon outline, in that order.

```ts
import { buildScene, createPostFx, hasPostFx } from '@cbnsndwch/world-core';

const scene = buildScene(spec);
const chain = hasPostFx(spec.postFx)
    ? createPostFx(renderer, scene, camera, spec, { pixelRatio })
    : null;

// in your loop:
chain ? chain.render() : renderer.render(scene, camera);
```

The shader definitions (`KUWAHARA_SHADER`, `POSTERIZE_SHADER`, `DITHER_SHADER`,
`TOON_OUTLINE_SHADER`) and the GPU-free `selectPostFxPasses(postFx)` selector are
exported for tuning and testing.

## License

MIT © [cbnsndwch LLC](https://github.com/cbnsndwch)
