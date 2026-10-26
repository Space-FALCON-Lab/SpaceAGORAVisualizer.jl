# Viewer contract 1

This reference is for people who write viewer payloads or maintain the renderer.
For installation and a first rendered page, start with the
[package guide](../README.md); the [browser reference](../viewer/README.md)
describes the playback controls.

## Versions and payload structure

The Julia service contract is `CONTRACT_VERSION = 1`; check it with
`require_version(1)`. Before rendering starts, a `CompatibilityError` reports an
unsupported service, viewer-payload, scene or `interlinks` version. An unsupported
`mission` schema, and any other malformed input, raises an `ArgumentError`.

New portable payloads declare `viewer_schema: 1`. They contain `scene` and
`frames`, and optionally `textures`, `models`, `terrain`, `ensemble` and `options`
objects and `paths` and `references` arrays. An optional `mission` object carries
the recorded execution history, and an optional `interlinks` object the run's link
schedule. A payload without `viewer_schema` is accepted as version 1 only if
`scene.schema` is 1. Unknown explicit versions are refused. The renderer and scene
contract are version 1; the package version, `0.2.0`, is a separate number.

`scene` describes the central body, the epoch, the spacecraft geometry and the
sampled body rotation. `frames.count` is the number of retained rows and
`frames.sats` the number of spacecraft. `frames.t_s` holds elapsed seconds, and
`frames.pos_km` inertial positions in kilometres, ordered by frame, then
spacecraft, then x, y, z. `t_dtype` and `pos_dtype` select `f32` or `f64` (default
`f32`). Blocks are base64-encoded little-endian floats; the browser also accepts
numeric arrays. The time and position dimensions are checked before the HTML is
assembled. In an ensemble, the spacecraft count includes each displayed spacecraft
in every sample, with the scene geometry repeated to match. Encoded NaN gaps for
times a sample does not cover are kept. A payload with zero rows is accepted; it
has no trajectory to play back.

SpaceAGORA may add optional `frames` blocks, in the same frame-major order:
`vel_kms` (km/s), `q` (attitude quaternion), `mass_kg`, `density_kg_m3`,
`heat_rate_w_m2`, `drag_n`, `wind_ms`, `sun_dir`, the ragged `link_pose`,
`arm_pose` and `thruster_direction` blocks (`stride`, `counts`, `offsets`, `total`
and `data`), `plume`, `thruster_level` with `thruster_counts`, and `channels` for
extra plotted columns. Note the heat-rate unit: SpaceAGORA saves heat rate in
W/cm², but `heat_rate_w_m2` is in W/m², and the browser converts it back to W/cm²
for display. The [browser reference](../viewer/README.md) describes how each block
is drawn.

## Units and coordinate conventions

Velocities are in kilometres per second. Attitude quaternions use scalar-last
order `[qx, qy, qz, qw]`. In SpaceAGORA, the coordinate conversion is
`v_body = rot(q) * v_inertial`. Three.js applies the same stored quaternion to a
model in the opposite direction: `v_inertial = R_three(q) * v_body`, where
`R_three(q) = transpose(rot(q))` for a unit quaternion. No conjugation is needed
when assigning that saved quaternion to a Three.js spacecraft object. Conjugate
it when transforming an inertial vector into body coordinates in the browser.
For example, `[0, 0, sin(π/4), cos(π/4)]` places body +x along inertial +y.
Link poses use seven values per link, a position followed by a quaternion; the
scene's `results.link_pose` entry gives the layout and the source columns.
The renderer keeps these conventions and every supplied value. It does not
regenerate ephemerides, reinterpret units or certify the underlying physics.

## Package boundary and rendering API

SpaceAGORA owns the simulation configuration, the scene and the conversion of
results to a payload. This package owns the renderer assets and the HTML
assembly. The two exchange plain data, so another renderer could read the same
saved information, and no SpaceAGORA types, modules or solver dependencies are
needed here.

`render_viewer_html(payload; title, viewer_dir)` validates and renders in memory.
`viewer_directory()` returns the renderer asset directory.
`viewer_import_map(viewer_dir)` embeds the renderer and pinned vendor modules.
`visualize(path; out, title, viewer_dir)` reads a JSON payload, writes the HTML
page atomically and returns its path. It never overwrites its own input and
rejects ambiguous run directories. Invalid input or missing renderer assets raise
an error before the output is replaced. It does not open a browser.

Default exported pages embed their code and data. A page converted for a CDN
loads pinned external libraries, and model URLs supplied by the user may fetch
resources; neither of those pages works offline.

## Recorded mission history

`mission.schema` is 1 and `mission.name` identifies the run. The `segments`
array lists the intervals that actually ran, each with a unique nonempty `name`
and finite, nonnegative `start_s` and `end_s`, in elapsed seconds from the same
epoch as `frames.t_s`. Intervals are ordered and contiguous; an interval of zero
length is valid.

`mission.transitions` records each change between adjacent segments, with
`time_s`, `from`, `to` and a nonempty `reason`. The time must equal the end of the
outgoing interval and the start of the incoming one. An optional last transition
with `to: null` records the final exit, which may be an early stop rather than a
completed mission; without it, the last interval has no recorded exit. An empty
history has empty arrays. Segments that were configured but never entered, and
events that never fired, do not belong in these arrays.

The renderer validates this structure without changing it. The mission object is
an optional addition to viewer schema 1 and service contract 1: older payloads
remain valid, and older renderers ignore it.

When SpaceAGORA exports a payload, it keeps the exact rows at segment boundaries
when the saved results contain them, within the requested frame and data budget.
If the boundary rows alone exceed the budget, the export asks you to raise it. No
sample is invented for a transition without a saved row: inside the saved
playback range such a transition can still be selected by its recorded time, and
the viewer interpolates between saved frames as usual. Transitions and segment
starts outside that range stay in the lists with their jump controls disabled and
a notice about the missing coverage. When the retained rows differ from regular
stride sampling, `frames.stride_rows` is null; this is display metadata, and
`frames.t_s` remains the source of playback times.

Mission names and transition reasons are rendered as text, so they cannot insert
markup into the toolbar. This package does not depend on SpaceAGORA's mission
builders, callbacks or controllers, or on SpaceAGORA itself.

Older payloads may encode frame times as Float32, while mission timestamps keep
their original values. For playback only, a mission timestamp is matched to its
Float32 value when that value occurs exactly in the saved, finite, nondecreasing
time grid; bounds checks, jumps and the active-segment label use the same rule.
This absorbs the rounding of a saved boundary without adding a general tolerance
or extending the trajectory's coverage. Float64 times, boundary times that were
not saved, and invalid grids are compared exactly. If several mission boundaries
round to one saved instant, the incoming segment is shown, and at the final
instant the last segment.

## Interlinks

`interlinks.schema` is 1. `interlinks.links` lists the links that appear in a
run's link schedule: each has `link` (its number in the run), `kind` (the link
kind's type name, for example `LaserMomentumLink` or `DataLink{ShannonBudget}`),
`directed`, and endpoints `a` and `b` with their terminals (`a_terminal` and
`b_terminal`, which the renderer does not use). Positive endpoints
are spacecraft numbers starting at 1, as `paths[].target`; negative endpoints
refer to ground stations. For a directed link `a` is the transmitter.

The optional `interlinks.stations` array supplies each station's unique negative
`node`, nonempty `name`, and three finite `position_m` coordinates in the
planet-fixed frame. The viewer turns these fixed sites using the same rotation
as the globe, draws a green marker and name, and connects station links to them.
Station names follow the labels toggle; the interlinks toggle hides both the
stations and their links. Unknown station references are refused. An absent
stations array retains the spacecraft-only contract.

`interlinks.active` holds the spans over which each link was selected:
`count`, `index` (0-based positions in `links`), and `start_s` and `end_s`
(Float64 blocks or numeric arrays, elapsed seconds on the clock of
`frames.t_s`). `interlinks.contact` has the same form for the spans over which a
link was available, possibly none, or is null when the run did not record them.

`interlinks.history_start_s` and `interlinks.history_end_s` (numbers, or null or
absent when unknown) give the span the schedule covers. No link is known before
the start, which is later than the frames' start only after a resume that could
not keep the earlier schedule. The renderer says so beside the toggle.

A link is drawn at playback time `t` when `start_s <= t < end_s`, and at
`t == end_s` when that is `history_end_s` (for a payload without it, the latest
window end); contact-only spans are drawn dimmed. Each link joins its two endpoints: interpolated spacecraft positions or rotating
station positions; terminal mounting points are not drawn.
Beside the toggle, a coloured square per link kind and the number of links active
at the playback time form the legend.

The renderer checks the block's structure (version, spacecraft numbers within
`frames.sats`, declared negative station nodes, positions within `links`, equal-length blocks, finite times with
`start_s <= end_s`, a finite span with its start not after its end) without
changing it. The block is an optional addition to
viewer schema 1 and service contract 1: historical payloads remain valid, and
older renderers ignore it. SpaceAGORA writes it from the run's link schedule and
counts it in the exporter's data budget.

## Shared mission-history validation

SpaceAGORA and this package validate mission histories with the same code.
`src/mission_history.jl` is generated from SpaceAGORA's
`scripts/companion_support/mission_history.jl`, and the same step generates the
versioned JSON examples and their test runner in `test/support/`. The viewer
still needs no SpaceAGORA installation, either to run or for its payload tests;
only the Shared companion support workflow fetches SpaceAGORA's support tooling,
from the commit recorded in `SharedSupport.toml`, to check that the copies match.

To change the validation, edit the source in SpaceAGORA, regenerate the copies in
both repositories with `scripts/sync_companion_support.jl --write`, and update
the commit in `SharedSupport.toml`. Do not edit a generated copy by hand. The
shared tests cover valid, absent, empty, malformed, discontinuous and
unsupported histories, exact boundary times, and checking that validation leaves
the history unchanged. The viewer's own rendering and file-preservation tests
are separate.
