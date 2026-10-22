# SpaceAGORA viewer

Browser viewer for a finished run: the central body with its surface texture,
every spacecraft as a marker with a trail, a playback timeline, and an
inertial or planet-fixed camera. It never runs inside the integrator; it reads
scene and frame data exported from a completed run. The core integration prepares
that payload from the result bundle and saved scene sidecar.

This integration provides trajectory playback and display geometry. The browser
can recognize optional terrain and plume payload blocks, but this version does
not add terrain export, lunar landing dynamics or plume-surface physics.

This renderer now belongs to SpaceAGORAVisualizer.jl. See the package
[README](../README.md) and [payload contract](../docs/contract.md) for standalone
installation and file inputs. The original design record is retained in
[SpaceAGORA](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/265c9c6bd002d31aba77f4bb7cc46b48b48b98ed/docs/architecture/interactive_visualization_plan.md).

## Producing a page

```julia
using SpaceAGORAVisualizer
page = visualize("output/simulation_results_viewer.json")
```

The file is an exported viewer payload containing the scene and retained frame
data. An Arrow results file or a scene sidecar alone is not accepted by this
standalone package; core's integration prepares the payload from those inputs.
The returned HTML embeds three.js, these modules and the supplied data. It opens
from disk without a server or network when all input assets are embedded.
Explicit CDN builds and models with external buffer or texture URLs can still
request those resources.

The renderer preserves options already saved in the payload, including the
camera frame, trails, paths and models. Choosing saved fields, decimation and
scientific frame metadata belongs to core's export step.

## Layout

| Path | Owns |
|---|---|
| `vendor/three.module.js`, `vendor/OrbitControls.js`, `vendor/STLLoader.js`, `vendor/OBJLoader.js`, `vendor/GLTFLoader.js`, `vendor/BufferGeometryUtils.js` | three.js r160 (MIT, `LICENSE.three`); GLTFLoader's one relative import is rewritten to the bare `three/addons/utils/...` specifier so it resolves from a `data:` URL |
| `src/data.js` | payload decoding, frame interpolation, rotation table lookup |
| `src/globe.js` | textured oblate sphere, graticule, rotation with the body |
| `src/spacecraft.js` | marker cloud, fading trails, labels, orbit period estimate |
| `src/lod.js` | close-up box assemblies, thruster/facet glyphs, STL override, visibility by projected size |
| `src/ensemble.js` | ensemble coloring, spaghetti histories, sample selector |
| `src/paths.js` | reference polylines in inertial, RTN or body frames |
| `src/links.js` | interlinks: a segment between two spacecraft while their link is active, dimmed while it is only in contact |
| `src/references.js` | reference ghosts: translucent copies of a spacecraft driven by an external state table |
| `src/groundtrack.js` | ground tracks: the sub-satellite point of every spacecraft drawn on the body's surface, built once in the body-fixed frame and parented to the globe so it is correct in both viewer frames |
| `src/video.js` | MP4 export through WebCodecs and mp4-muxer (`vendor/mp4-muxer.mjs`, MIT), WebM fallback |
| `three-gpu-pathtracer@0.0.23`, `three-mesh-bvh@0.7.8`, `three/examples/jsm/postprocessing/Pass.js` (import-map entries, CDN pages only) | the path-traced lighting mode; absent from the offline bundle, which then offers real-time lighting only |
| `src/terrain.js` | landing-site terrain: a view-dependent quadtree of DEM-displaced patches draped with the imagery tiles (inheriting the nearest present ancestor's tile where none exists), and the hole it cuts in the globe |
| `src/dust.js` | regolith blown off the surface by a descent engine: a GPU particle sheet driven by the `frames.plume` block, a ground haze disk and a scour mark |
| `src/plumes.js` | thruster plumes: one additive, flickering cone pair per thruster, driven by the recorded firing levels, with the idle cone glyphs dimmed |
| `src/plots.js` | time-history plot panel: any quantity in the panels opens its history over the run, with the playback cursor and click-to-seek |
| `src/atmosphere.js` | limb glow, density shells, density map |
| `src/colormaps.js` | inferno and viridis |
| `src/timeline.js` | playback clock and time formatting |
| `src/lighting.js` | sun placed from `frames.sun_dir`, shadow map fitted to the followed vehicle, measured exposure, and the optional path-traced mode |
| `src/ui.js` | overlay controls and info panel |
| `src/main.js` | scene setup and the render loop |
| `template.html` | page skeleton the Julia bundler fills |
| `dev.html` | development harness (see below) |

The Julia HTML assembly is `src/render.jl` in this package. The core exporter
produces its input payload; the renderer does not import SpaceAGORA.
Modules import each other through bare specifiers (`viewer/globe.js`,
`three`) that the page's import map resolves, to `data:` URLs in the bundled
file and to local paths in `dev.html`. No build tool is involved.

## Developing the viewer

1. Produce `viewer/dev_data.js` with the core integration's
   `write_viewer_dev_payload("output/simulation_results", "viewer/dev_data.js")`,
   or build a standalone CSV/JSON form with `build_standalone.py`.
2. Serve this directory: `python3 -m http.server 8000` from `viewer/`.
3. Open `http://localhost:8000/dev.html`, edit files under `src/`, reload.

`dev_data.js` is ignored by git.

## Controls

Space plays and pauses, the arrow keys step by one speed unit, the slider
scrubs. Drag to orbit, wheel to zoom, right-drag to pan. "Planet-fixed"
counter-rotates the scene so the body stands still and orbits precess past it.

Click a spacecraft marker or visible model to select it: the selection panel
at the top right shows its
altitude, geodetic latitude and longitude, radius, speed, mass (when the run
saved it) and whether it is currently drawn as a marker or a 3D model.
"Follow" (or F) keeps the selected spacecraft at the center and moves the
camera close enough to see the assembly; Esc deselects. The trail selector
sets the history drawn behind each spacecraft in orbits (the period is
estimated from periapsis passages in the saved trajectory, so a run shorter
than one orbit shows "longer than run" and the trail covers the whole run).

Click a quantity's name or value in the selection panel to plot its history.
The **log** checkbox switches between logarithmic and linear axes; zeros are
gaps on a logarithmic axis. Additional saved columns can be added with
`channels`; see [Plot another saved value](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/visualization.md#plot-another-saved-value)
for an example and explanations of absent rows, missing samples and held states.

## Close-up models

When a spacecraft's bounding radius covers a few pixels the marker gives way
to its assembly: one box per link from `Link.dims`, placed by the saved
attitude quaternion or, for runs without orientation state, an attitude with
body +x along the velocity and body +z toward nadir. Non-root links follow
the recorded `link_pose` columns when the run had them, otherwise their
configured pose. Thrusters are orange cones with the apex at the thruster
location pointing along the thrust direction, facets are translucent squares
of the facet area with their normal drawn, and the body axes are red, green
and blue for x, y, z. Each of these has a toggle. A 3D model passed through
`export_visualization(...; models=Dict(id => path), model_scale=..., model_rotation_deg=...)`
(STL, OBJ, glTF or GLB, parsed in the browser) replaces the boxes for that
spacecraft; the glyphs stay.

Runs with at most 64 spacecraft embed positions as Float64 so the meter-scale
models do not jitter at planetary distances; follow mode also re-centers the
scene on the followed spacecraft for the same reason.

## Heating overlay

With density and velocity in the frames, `src/lod.js` can swap every heatable
mesh (link boxes, model meshes) to a shader that colors faces by
½ρV³ cos θ (inferno, log scale, three decades below the run's peak), θ from
the face normal and the airspeed (inertial velocity minus ω × r). Toggle
"heating"; the legend reads W/cm².

## Thruster plumes

`frames.thruster_level` (Float32, frame-major then spacecraft then that
spacecraft's thrusters, 0 to 1) with `frames.thruster_counts` drives
`src/plumes.js`. A plume hangs on the thruster's own link group, runs along the
thruster's `direction`, and takes its reach and color from the rated thrust:
long and orange-white for a main engine, short and blue-white for an attitude
jet. Reach and brightness follow the level through a fractional exponent so a
jet firing a fraction of a percent of its rating still reads; level 0 draws
nothing and dims the static cone glyph. Toggle "plumes"; the selection panel
lists a `thruster k level` row per thruster.

A run that turns a thruster with a gimbal also writes
`frames.thruster_direction` (`stride` 3, `counts`, `offsets`, `total` and
Float32 `data`, frame-major then spacecraft then thruster): each thruster's
exhaust direction in its link's frame. The cone glyph and the plume follow it,
linearly between frames; without it they keep the scene's `direction`.

## Ensembles

`payload.ensemble.nominal` (0-based sample index) marks the unperturbed
sample: white line, own label, never dimmed; `src/ensemble.js` computes the
per-time mean and RTN dispersion of the samples and draws a translucent
3σ tube (radial by cross-track) around the nominal, with outline rings and
a readout of the three 3σ values in the panel.

### Samples

A page built by `export_ensemble_visualization` (or
`run_monte_carlo_visualization`) carries `payload.ensemble`: the samples
become pseudo-spacecraft on one time axis, with `NaN` positions where a
sample has not started or has already ended. `src/ensemble.js` colors them
by the manifest scalar (viridis), draws every sample's full history as a
faint line, and adds a sample selector; the selected sample's marker is
ringed and the others dimmed. Assemblies are built for at most 256
spacecraft.

## Texture resolution

`data/textures/manifest.toml` may hold several tiers per body. The exporter
embeds 4k by default (`texture_resolution="4k"`) for both individual runs
and ensembles. Earth, Mars and Moon provide an opt-in 8k tier; use
`texture_resolution="8k"` or `:best` for the largest available tier. Venus
and Titan fall back to 4k. This companion does not bundle those textures. Its standalone builder defaults
to `--textures none`; pass `--textures-dir=/path/to/textures` and
`--textures 4k` or `--textures 8k` to use an existing catalog. Higher tiers increase HTML and decoded image size. The globe
downscales on load when the GPU's maximum texture size is smaller than the
image, and the info panel shows the tier and the GPU limit.

## Interlinks

`payload.interlinks` (optional) carries a run's link schedule (`src/links.js`):
its links, with kind, direction and the two spacecraft, and the windows over
which each was active and, when recorded, in contact, as elapsed seconds on the
clock of `frames.t_s`. Each link is drawn as a segment between its spacecraft's
interpolated positions while active (`start_s <= t < end_s`, and at the schedule's
last time), and dimmed while only in contact; a directed link fades from its
transmitter to its receiver. The colour follows the kind: laser momentum, power
beam, data link, or any other. The `interlinks` toggle hides them.

## Planned paths

`payload.paths` carries reference polylines (`src/paths.js`): points in km,
a frame (`inertial`, `rtn` of a target spacecraft, or that spacecraft's
`body` frame), color and dash style. RTN and body paths are rebuilt every
frame from the target's position, velocity or attitude, and the group sits
at the floating origin like the markers.

## Video export

`src/video.js` drives `viewer.renderAt(t)` (main.js exposes it along with
`setRecording` and `resizeTo`) frame by frame, encodes with `VideoEncoder`
(H.264) and muxes with mp4-muxer in memory, then triggers a download. The
render loop stands still while recording. Import map key `mp4-muxer`.

## Standalone page

`standalone.html` plus `src/standalone.js` and `build_standalone.py` make a
page that builds the payload in the browser from a CSV or JSON table, a body
name and an epoch: IAU rotation table, box spacecraft, model override,
reference ghost, and ensembles from several files. `data.js` accepts typed
arrays as well as base64 blocks for that reason. A `sc{i}_heat_rate` column
is read in W/cm², the unit SpaceAGORA saves, and stored as W/m² in
`frames.heat_rate_w_m2`. See the
[standalone data-file guide](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/visualization.md#standalone-files).

## External-host page

```text
python3 viewer/build_cdn_page.py output/simulation_results_viewer.html output/artifact.html "Title" "Heading" "Orbit note" "Span note" "Footer text"
```

The default exported page is fully self-contained. Some hosts refuse `data:`
script URLs, so `build_cdn_page.py` rewrites an exported page into a variant
that fetches the pinned three.js r160, its loaders and mp4-muxer 5.1.5 from
`cdn.jsdelivr.net` (the same pinned map as `build_standalone.py --cdn`) and
concatenates the renderer modules into one inline module script. The
trajectory, textures and models stay embedded exactly as exported; the
renderer modules are taken from the page itself, so the built page runs the
same code the export was checked with (`--modules repo` uses `viewer/src`
instead). Every metadata argument is HTML-escaped, the embedded payload is
kept verbatim and checked for script safety, a module that declares a
top-level name twice is refused with the two file names, and any vendor
specifier without a pinned CDN location is an error.

The built-in libraries use `cdn.jsdelivr.net`: three.js and its addons,
mp4-muxer and, unless `--no-pathtracer`, the optional path-traced lighting
packages, which load during viewer startup. `--fonts` adds
`fonts.googleapis.com` and `fonts.gstatic.com` for the IBM Plex faces;
without it the page uses system fonts. Imported models can also request
external buffers or textures; their resource URLs are preserved from the
source page. The footer lists the library and font hosts, the three.js and
mp4-muxer notices and the texture attributions carried in the payload.
The tool adds no Content-Security-Policy and does not work around any
host's policy; if a host blocks `cdn.jsdelivr.net`, the page reports that
it failed to start.
Tests: `python3 -m unittest discover -s test/scripts -p test_build_cdn_page.py`.

## Reference ghosts

`payload.references` carries state tables (`src/references.js`): Float64
times and positions on their own grid, optional velocities and attitude
quaternions, the index of the spacecraft whose geometry the ghost copies,
color and opacity. Each ghost is a translucent copy of that spacecraft's
model override (through `loadModelObject`, shared with `lod.js`) or of its
link boxes, with a ring marker and label, a line over the whole reference
span, and the same pixel-size switch as the assemblies. The selection panel
of the flown spacecraft shows the separation from each ghost that refers to
it. Times outside the table hide the ghost.

## Robot arm

When `payload.scene.spacecraft[i].arm` is present and the frames carry an
`arm_pose` block, `src/lod.js` builds one cylinder per arm link (along the
link's own vector, joint sphere at its origin, a red tip at the end
effector) in a sibling group of the box assembly. Arm poses are inertial and
relative to the spacecraft in meters, so the group sits at the spacecraft
without the body rotation; each frame the joint origin is recovered from the
saved center of mass and quaternion.

## Atmosphere

`src/atmosphere.js` builds, from `payload.scene.atmosphere`, a limb-glow
shell at the entry interface (a Fresnel shader, additive, double-sided so it
reads from inside during a pass), translucent density shells whose opacity
follows an available profile, and an optional supplied density map.
Automatic scene export samples the built-in exponential and piecewise
exponential models and native-free `GRAMGridAtmosphereModel` snapshots.
Fixed-grid profiles stay within the stored altitude coverage and require
equatorial coverage; global maps require all sampled latitudes. Density shells
are omitted outside the sampled altitude range. Native GRAM, hybrid
native/surrogate, empirical and user-defined models retain the shell and
saved trajectory density without additional model calls. For advanced standalone analysis only,
`atmosphere_spec(args; sample_model=true, density_params=p)` explicitly
permits live model sampling; this may mutate model/native state and is
never enabled by scene or run export.

Trails can be colored by heat rate, dynamic
pressure, density, altitude or speed through inferno (`src/colormaps.js`);
Heat rate, dynamic pressure and density use logarithmic color scales; altitude
and speed use linear scales. Heat rates and heat fluxes are shown in W/cm² in
the trail legend, the heating legend, the selection and face panels and their
plots; the payload field `heat_rate_w_m2` stays in W/m², and `src/data.js`
holds the one conversion between them. Viewer-derived
dynamic pressure and surface heating are illustrative estimates, not the
verified study pressure or a replacement thermal solution.

## Conventions

- Scene units are kilometers, J2000 axes.
- Quaternions use scalar-last order `[qx, qy, qz, qw]`. SpaceAGORA converts
  coordinates with `v_body = rot(q) * v_inertial`. Three.js applies the same
  saved `q` directly to the spacecraft object, with
  `v_inertial = R_three(q) * v_body` and `R_three(q) = transpose(rot(q))` for
  a unit quaternion. The browser uses the conjugate for the reverse coordinate
  conversion. See the [payload contract](../docs/contract.md) for an example.
- The sphere's texture seam is placed so that longitude 0 is on body +x; a
  texture whose left edge is not 180 W is shifted by its manifest
  `lon_left_deg`.

### Lab branding

The viewer displays the Space-FALCON Lab logo in the upper-right corner, above the selection panel. The approved primary logo B (1221 × 1288 PNG) is embedded unchanged in the shared UI module, so exported and standalone pages need no external image request. The source is `SpaceFALCON_Lab_Logo_Main.png` from the Space-FALCON Lab brand library; its SHA-256 is recorded beside the data URL. The badge is 150px wide on desktop and 112px on narrow screens; the lab wordmark remains visible. Existing exported pages must be regenerated to pick up viewer changes. The badge is a page overlay; the canvas-only video export does not include it.

The viewer retains its dark background (`#060a0f`), which suits the approved logo’s dark backdrop. The current PNG is a raster export with a partly transparent dark background, not a clean transparent or vector master. Embedding the unchanged 1.65 MB PNG preserves the approved artwork and adds about 2.20 MB of base64 text to the UI module; no image fetch or dependency is added.
