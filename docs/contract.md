# Viewer contract 1

The Julia service contract is `CONTRACT_VERSION = 1` and can be checked with
`require_version(1)`. `CompatibilityError` reports an unsupported service,
viewer-payload or scene version before rendering starts.

New portable payloads declare `viewer_schema: 1`. They contain `scene`, `frames`
and optional `textures`, `models`, `paths`, `references`, `terrain`, `ensemble`
and `options` objects. An optional `mission` object carries recorded execution
history, and an optional `interlinks` object a run's link schedule. Historical payloads without `viewer_schema` are accepted
as version 1 only if `scene.schema` is 1. Unknown explicit versions are refused.
The current renderer and scene contract remain version 1; package version
`0.1.0` is a separate release identifier.

`scene` describes the central body, epoch, spacecraft geometry and sampled body
rotation. `frames.count` is the retained row count and `frames.sats` the
spacecraft count. `frames.t_s` holds elapsed seconds. `frames.pos_km` holds
inertial positions in kilometres, frame-major, then spacecraft, then xyz.
The `t_dtype` and `pos_dtype` fields select `f32` or `f64` (default `f32`). Blocks
are base64-encoded little-endian floats; the browser also accepts numeric arrays.
Time and position dimensions are checked before assembling the HTML. In an
ensemble, the count includes each displayed spacecraft in every sample, with
matching repeated scene geometry. Encoded NaN gaps for unavailable sample times
are preserved. Zero-row payloads remain accepted; they contain no trajectory to
play back.

Optional velocities are kilometres per second. Attitude quaternions use
scalar-last order `[qx, qy, qz, qw]`. In SpaceAGORA, the coordinate conversion is
`v_body = rot(q) * v_inertial`. Three.js applies the same stored quaternion to a
model in the opposite direction: `v_inertial = R_three(q) * v_body`, where
`R_three(q) = transpose(rot(q))` for a unit quaternion. No conjugation is needed
when assigning that saved quaternion to a Three.js spacecraft object. Conjugate
it when transforming an inertial vector into body coordinates in the browser.
For example, `[0, 0, sin(π/4), cos(π/4)]` places body +x along inertial +y.
Link poses use the existing seven-value position/quaternion layout; the scene
carries their frame and column metadata.
The renderer preserves these conventions and all supplied values. It does not
regenerate ephemerides, reinterpret units or certify the underlying physics.
Missing data and display-only overlays keep the inherited renderer behavior.

Core owns simulation configuration, scene production and dataframe-to-payload
conversion. This companion owns renderer assets and HTML assembly. The boundary
uses plain data, so another renderer can consume the same saved information.
No SpaceAGORA types, internal modules or solver dependencies are required here.

`render_viewer_html(payload; title, viewer_dir)` validates and renders in memory.
`viewer_directory()` returns the renderer asset directory.
`viewer_import_map(viewer_dir)` embeds the renderer and pinned vendor modules.
`visualize(path; out, title, viewer_dir)` reads a JSON payload and atomically
writes an HTML page. It never overwrites its own input and rejects ambiguous
run directories. Invalid input or missing renderer assets raise an error before
the output is replaced. The browser is opened by the caller.

Default exported pages embed their code and data. Explicit CDN conversion uses
pinned external libraries, and user-supplied model URLs may fetch resources.
These are distinct workflows and are not represented as offline guarantees.

## Recorded mission history

`mission.schema` is 1. `mission.name` identifies the run. Its `segments` array
contains the actual executed intervals, each with a unique nonempty `name` and
finite, nonnegative `start_s` and `end_s`. Times are elapsed seconds from the
same epoch as `frames.t_s`. Intervals are ordered and contiguous, and a zero
length interval is valid.

`mission.transitions` records each change between adjacent segments. Each
entry has `time_s`, `from`, `to`, and a nonempty `reason`. The time must equal
the outgoing interval's end and the incoming interval's start. An optional
last transition uses `to: null` to record the final exit, which may be an early
stop rather than completed mission objectives; otherwise the last
interval has no asserted exit event. An empty history has empty arrays.
Configured but unentered segments and unfired event factories are not occurrence
records and do not belong in these arrays.

The renderer validates this structure without editing it. Mission fields are
optional additions to viewer schema 1 and service contract 1. Historical
payloads remain valid, and older renderers can ignore this extra object.

Core retains exact boundary rows when they exist in the saved results, within
the requested frame and data budget. If required boundary rows alone exceed
that budget, export asks the caller to increase it. No sample is fabricated for
a transition without a saved row. Within the saved playback range, such a
transition remains selectable by its
recorded time, and the viewer uses its usual interpolation between saved frames.
Transitions and segment starts outside that range remain listed with disabled
jump controls and a visible coverage notice.
For boundary-aware sampling, `frames.stride_rows` is null when the retained
rows differ from regular stride sampling. This is display metadata; `frames.t_s` remains the
source of playback times.

Mission names and transition reasons are rendered as text. They cannot insert
markup into the toolbar. The companion has no dependency on mission builders,
callbacks, controllers, or the SpaceAGORA package.

Historical payloads may encode frame times as Float32. Mission timestamps retain
their original numbers. For playback only, a mission timestamp is reconciled to
its Float32 value when that value occurs exactly in the saved, finite,
nondecreasing time grid. Bounds checks, jumps and active-segment labels use the
same comparison. This handles encoding roundoff at a saved boundary without
adding a general tolerance or extending trajectory coverage. Float64 times,
unsaved boundary times and invalid grids retain strict comparisons. If several
mission boundaries encode to one saved instant, the incoming segment is shown,
with the last segment taking precedence at the terminal instant.

## Interlinks

`interlinks.schema` is 1. `interlinks.links` lists the links that appear in a
run's link schedule: each has `link` (its number in the run), `kind` (the link
kind's type name, for example `LaserMomentumLink` or `DataLink{ShannonBudget}`),
`directed`, and endpoints `a` and `b` with their terminals. Positive endpoints
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
