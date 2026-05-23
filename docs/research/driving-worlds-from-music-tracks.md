# Driving Worlds from Music Tracks

**Status:** design proposal · 2026-05-23
**Depends on:** `libs/contracts` (`AudioFeatures`, `WorldSpec`), `libs/world-gen` (`generateWfcWorld`, `generateLlmWorld`)

## TL;DR

- We do **not** need to compute features from scratch. The published Musicologia app already returns a rich, server-computed **track descriptor** per song, and the maquette should consume that directly.
- The descriptor far exceeds plain audio features: estimated `tempo/energy/valence/key/mode/timeSignature`, **plus** an already-derived `palette`, `motionProfile`, `sceneGrammar`, song `sections` (timed), time-synced `lyrics`, and a narrative `story`.
- It confirms the Spotify caveat and its fix: `audioFeaturesEstimated: true`, `audioFeaturesSource: "musicbrainz-tags"` — features are estimated from MusicBrainz tags, not Spotify.
- Plan: define a `MusicologiaTrack` input contract, map it onto our generation inputs, and keep **live FFT analysis** (reusing the WASAPI analyzer PoC in `.local/analyzer`) and metadata-LLM only as **fallbacks** for tracks not in the catalog. Seed = the track's stable id (`spotifyTrackId` / `_id`).

---

## The real source: the Musicologia track descriptor

The published app (`musicologia.de`) is a React Router v7 app whose server loader returns a populated `track` object. Observed live on `/{artistSlug}/{trackSlug}` (e.g. `/the-b-52-s/rock-lobster`), the descriptor includes:

```jsonc
{
  "_id": "69fd3246b092dc6725bbda69",       // Mongo id
  "title": "Rock Lobster",
  "artist": "The B-52's",
  "album": "...",
  "artistSlug": "the-b-52-s",
  "trackSlug": "rock-lobster",
  "coverUrl": "https://.../hero.webp",
  "durationMs": 409400,
  "source": "spotify",
  "spotifyTrackId": "2Q5wSOwq6BDSu7sSVMNrtT",
  "mbRecordingId": "af6703f8-...",          // MusicBrainz recording
  "mbReleaseId": "75cdc0f7-...",
  "previewUrl": "",
  "isInstrumental": false,

  // estimated audio features (NOT from Spotify — see below)
  "tempo": 125, "timeSignature": 4, "key": 9, "mode": "...",
  "energy": 0.728, "valence": 0.512,
  "audioFeaturesEstimated": true,
  "audioFeaturesSource": "musicbrainz-tags",

  // already-derived aesthetic direction
  "palette": { "primary": "#fdef04", "secondary": "#0484bd", "accent": "#ebebed",
               "background": "#01354b", "text": "...", "grain": 0.37,
               "contrast": "high", "mood": "neutral", "materialLanguage": "glass" },
  "motionProfile": { "speed": 0.977, "cameraAggression": 0.582,
                     "particleDensity": 0.663, "jitter": 0.213, "bloomIntensity": 1.382 },
  "sceneGrammar": { "primaryMotif": "waveform", "transitionStyle": "warp" },
  "lyricChoreography": { "layoutStyle": "karaoke", "emphasisRule": "color-shift",
                         "syncStrategy": "line", "fontFamily": "...", "fontWeight": 400 },

  // structure & content
  "sections": [ { "startMs": 0, "endMs": ..., "type": "intro", "label": "Intro" }, ... ],
  "lyrics":   [ { "startMs": 11290, "endMs": 13620, "text": "We were at a party" }, ... ],
  "story":    "On a fateful night in 1976 ...",  // long narrative

  "createdAt": "2026-05-08T...", "updatedAt": "2026-05-08T..."
}
```

**Spotify is gone, and they already solved it.** `audioFeaturesSource: "musicbrainz-tags"` confirms the features are *estimated from MusicBrainz tags* (Spotify removed audio-features access for new apps in late 2024). The maquette should not try to re-derive what the app already produces.

## Three levels of signal (and what each unlocks)

**Level 1 — raw features.** `tempo, energy, valence, key, mode, timeSignature, isInstrumental`. These map straight onto our existing `AudioFeatures` and `deriveKnobs` (which already consumes `energy/valence/tempo`).

**Level 2 — already-derived aesthetic.** `palette`, `motionProfile`, `sceneGrammar` are *higher-level than features* — the app has already made the taste decisions our `PALETTES`/`deriveKnobs` were guessing at. We should prefer these directly:

- `palette.{primary,secondary,accent,background,text}` → the world palette (expand 5 → our 8 slots; see Open questions).
- `palette.mood` / `contrast` → time of day + lighting; `grain` → dither amount; `materialLanguage` (`glass`/`matte`/…) → post-fx + material choice.
- `motionProfile.particleDensity` → prop density; `speed` → ambient animation/orbit speed; `cameraAggression` → camera motion; `bloomIntensity`/`jitter` → post-fx intensity.
- `sceneGrammar.primaryMotif` (`waveform`/…) → bias the WFC layout / macro shape.

**Level 3 — structure & content.** These feed the *other* two design docs:

- `sections` (timed song structure) → multi-district worlds, one region per section (see `modular-wfc-expanding-worlds.md`).
- `lyrics` (time-synced) → landmarks / a "walk the song timeline" mechanic (see `walkable-rpg-navigation.md`), and LLM asset hints.
- `story` → rich theming input for the LLM path (`generateLlmWorld`).

## Field → generation input mapping

| Descriptor | Our input | Notes |
| --- | --- | --- |
| `spotifyTrackId` / `_id` | `seed` | stable id → `createRng` |
| `energy` | `AudioFeatures.energy` | direct |
| `valence` | `AudioFeatures.valence` | direct |
| `tempo` | `AudioFeatures.tempo` | direct |
| `isInstrumental` | `AudioFeatures.instrumentalness` | bool → 0/1 |
| `key` + `mode` | palette warmth / layout bias | new signal we don't have yet |
| `palette.*` | `WorldSpec.palette` (override) | replaces `PALETTES` guesswork |
| `palette.mood`/`contrast` | `timeOfDay` + lighting | map moods → dawn/day/dusk/night |
| `palette.grain` | `postFx.dither` strength | |
| `palette.materialLanguage` | `postFx` (toon/quantize) + materials | |
| `motionProfile.particleDensity` | prop density | overrides tempo-derived density |
| `sceneGrammar.primaryMotif` | WFC layout/macro bias | |
| `sections` | districts / chunks | doc 2 |
| `lyrics` | landmarks / timeline | doc 3 |
| `story` | LLM theming | doc 1's LLM fallback + LLM path |

`danceability` and `acousticness` are **not** in the descriptor — derive them (e.g. from `energy` + `mode`/`key`) or drop them from the contract.

## Palette & motion mapping (elaboration)

> **Superseded.** The descriptor's `palette`/`motionProfile`/`sceneGrammar` were an experiment in the 2D app that underwhelmed in practice. The real aesthetic lever is the **biome system** (`biomes-and-world-composition.md`): a track's vibe + origin select biomes, and each biome owns its own palette/appearance. The mapping below is kept only as reference in case we ever want to *tint* a biome with a song's colors. Raw `AudioFeatures` (energy/valence/tempo) still drive in-biome density/time/weather.

### The core tension

The descriptor's palette is **role-based** — `primary`, `secondary`, `accent`, `background`, `text` — an abstract scheme with no fixed semantics. Our renderer's palette is **content-based**: 8 positional slots with fixed meaning (`0` whitewash · `1` accent · `2` terracotta · `3` olive · `4` dust/rock · `5` sand · `6` sea · `7` sky), bound to tile types in `build-scene.mts`. They don't line up one-to-one.

Bigger than color: the descriptor's whole aesthetic — `materialLanguage: "glass"`, `bloomIntensity: 1.38`, `sceneGrammar.primaryMotif: "waveform"`, high `motionProfile` — describes a **sleek, glassy, neon, motion-heavy visualizer**. The maquette's stated identity is a **matte, sun-bleached, painterly Mykonos diorama** (flat-shaded voxels + Kuwahara/dither/toon). So this isn't only color-fitting; it's an *identity* decision.

### Aesthetic-ownership options (needs a call)

1. **Mykonos absorbs the song's colors (recommended for now).** Keep the matte/painterly identity and tile semantics, but recolor the 8 slots from the song's scheme — every song is a differently-colored island. `motionProfile` drives only camera/animation/density. Preserves project identity; the song still clearly drives the look.
2. **Faithful 3D translation of the 2D visualizer.** Glass materials + bloom + literal neon palette + heavy motion: the 3D world becomes a 3D version of the published app. Maximum continuity with `musicologia.de`, but abandons the Mykonos brief.
3. **Hybrid.** Mykonos geometry + tile semantics, but materials/post-fx switch on `materialLanguage` (glass → glossy + bloom; matte → painterly + dither) and the palette comes from the song. Most expressive, most work.

### 5→8 palette expansion (for options 1/3)

Treat the descriptor scheme as the mood/temperature anchor; assign the obvious slots, synthesize the earth tones in a perceptual space (OKLCH/HSL):

| Slot | Source |
| --- | --- |
| `7` sky | `background`, lightened toward the horizon |
| `6` sea | the bluest of {`secondary`, `background`} |
| `0` whitewash | the lightest/most-neutral of {`accent`, `text`} (e.g. `#ebebed`) |
| `1` accent | `primary` (the song's signature color → domes/doors) |
| `5` sand | warm light blend(whitewash, `primary`) |
| `4` dust/rock | desaturated mid blend(`secondary`, `background`) |
| `2` terracotta | `primary`/`accent` nudged toward orange |
| `3` olive | scheme nudged toward khaki-green |

`contrast` scales the light↔dark spread across slots; `grain` → dither strength; `mood` → time-of-day bias; `materialLanguage` → material + post-fx family.

### motionProfile mapping

| Field | Drives |
| --- | --- |
| `speed` | camera auto-orbit speed; ambient animation rate (water shimmer, prop sway) |
| `cameraAggression` | camera move intensity (dolly/tilt amplitude; later, follow-cam snappiness) |
| `particleDensity` | prop density (overrides the tempo-derived value); ambient particles (dust/spray) |
| `jitter` | small per-prop/tile position+rotation noise; optional handheld camera shake |
| `bloomIntensity` | a **new** bloom post-fx pass (three `UnrealBloomPass`) — pairs with `materialLanguage: glass` |

Bloom and a glass material mode are **not** in the current chain (`build-scene` is flat-shaded; post-fx is Kuwahara/dither/quantize/toon). Adding them is exactly what options 2/3 require — option 1 ignores `bloomIntensity`/`materialLanguage` and uses only `speed`/`cameraAggression`/`particleDensity`/`jitter`.

## Sourcing & fallbacks

Primary source is the Musicologia track data. **Interim approach (decided):** drop exported descriptor **JSON files in the web app's `public/` folder** (e.g. `apps/web/public/tracks/<spotifyTrackId>.json` + an `index.json` catalog). This lets us both read them locally on disk and `fetch()` them from the browser with zero infrastructure; the DB/API story comes later. The descriptor's `_id` shape suggests MongoDB upstream. Source resolution:

```plain
MusicologiaTrackSource (catalog hit — pre-computed descriptor)
  → LiveAnalysisSource  (real audio playing: WASAPI loopback / Web Audio tap → features)
  → MetadataLlmSource   (only artist+title/story)
  → SeedSource          (offline floor: current featuresFromSeed)
```

- **Metadata + LLM fallback**: feed `artist/title/story` to `generateLlmWorld`; the model emits a `WorldBrief`.
- **SeedSource**: today's `featuresFromSeed` — guaranteed offline.

### Live analysis: reuse the analyzer PoC (`.local/analyzer`)

The `cbnsndwch/musicologia-analyzer-poc` repo (cloned to the gitignored `.local/analyzer`) already captures real audio and extracts features in real time — the path for tracks not in the catalog where we can hear them play:

- **Capture:** an Electron app with a Windows-only **N-API native addon** (`native/wasapi_capture.cpp`) using WASAPI loopback (`AUDCLNT_STREAMFLAGS_LOOPBACK`) to tap the system output mix (e.g. Spotify). Real wall-clock streaming, real PCM bytes.
- **DSP — directly reusable, no native/Electron dep:** `src/audio/featureExtraction.ts` is a pure-TS `FeatureExtractor` that turns FFT magnitudes (dBFS) into a per-frame `AudioFeatureFrame`: `rms/loudness/peak`, six band energies (`sub, bass, lowMid, mid, highMid, high`), `spectralCentroid`, `spectralFlux`, `brightness`, and adaptive `onset/kickOnset/snareOnset/hatOnset`. It runs on any FFT output.
- **FFT:** `src/renderer/worker/fft-worker.ts` (fft.js in a worker).
- **Bonus look reference:** `src/visualizers/mesh-terrain/*` and `raymarched-landscape/*` are audio→3D terrain shaders worth mining for the world aesthetic.

**Realtime → persistent.** The analyzer is a *per-frame* visualizer feed; the maquette wants *one world per song*. Bridge them by running `FeatureExtractor` across a playthrough (or a captured window), accumulating frames, then reducing to a single `AudioFeatures`:

- `energy` ← mean `rms`/`loudness`
- `valence` ← mean `spectralCentroid` (brightness heuristic) + `key/mode`
- `tempo` / `danceability` ← `kickOnset` rate → BPM + pulse regularity
- `acousticness` ← band-energy distribution / flux stability
- the six band energies + onsets can also drive a *richer* world directly (band → terrain layer, onset rate → prop density).

Optionally segment by the descriptor's `sections` for a per-section feature profile (feeds districts in `modular-wfc-expanding-worlds.md`).

**Runtime note.** Capture is Electron N-API + Windows WASAPI; our desktop target is **Tauri** (Rust). The C++ capture doesn't drop into Tauri directly — port it to a Rust audio plugin (e.g. the `cpal` / `wasapi` crates, same loopback flag) or run it as a sidecar. The TS `FeatureExtractor` + FFT math are reusable as-is in either runtime, and the **browser** can feed it via the Web Audio API (`AnalyserNode.getFloatFrequencyData`) — see `.local/analyzer/docs/research-mobile-and-web-audio-tap.md`.

## Contract changes

- **New:** a `MusicologiaTrack` type + Zod schema in `libs/contracts` (mirrors the loader shape above), and a `trackToWorldInputs(track)` mapper in `libs/world-gen` that returns `{ seed, features, palette, postFx, density, ... }` for `generateWfcWorld` / `generateLlmWorld`.
- **Reuse:** `AudioFeatures`, `generateWfcWorld` (already takes `palette`/`postFx`/`features` overrides), `generateLlmWorld`.
- **Possibly relax:** our `PALETTES` families become a fallback when no descriptor palette is present.

## Determinism & caching

- Same track id ⇒ same seed ⇒ same world (already guaranteed by `createRng`).
- The descriptor is already computed and stored server-side, so caching is mostly a fetch concern; cache the resolved `WorldSpec` by track id (IndexedDB / Tauri SQLite) to avoid regenerating.

## Open questions

1. **Access** — *resolved:* exported descriptor JSON in `apps/web/public/tracks/` for now; DB/API later.
2. **Palette expansion** — *elaborated above.* The remaining decision is the aesthetic-ownership option below.
3. **Aesthetic ownership** — *redirected:* the aesthetic lever is the **biome system** (`biomes-and-world-composition.md`), not the descriptor's palette/motion. Music now drives **biome selection** (vibe + origin → biome shortlist) plus raw-feature knobs.
4. **Sections & lyrics** — in scope for v1 (districts + timeline), or deferred to docs 2/3?

## Recommendation

Make the **Musicologia track descriptor the primary input** via a `trackToWorldInputs` mapper, honoring its `palette` and `motionProfile` directly (Level 2) rather than re-guessing. Keep Meyda / LLM / seed as graceful fallbacks. This is both less work *and* a much stronger signal than the placeholder features.
