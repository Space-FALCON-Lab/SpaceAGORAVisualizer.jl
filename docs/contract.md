# Viewer contract 1

The Julia service contract is `CONTRACT_VERSION = 1` and can be checked with
`require_version(1)`. `CompatibilityError` reports an unsupported service,
viewer-payload or scene version before rendering starts.

New portable payloads declare `viewer_schema: 1`. They contain `scene`, `frames`
and optional `textures`, `models`, `paths`, `references`, `terrain`, `ensemble`
and `options` objects. An optional `mission` object carries recorded execution
history. Historical payloads without `viewer_schema` are accepted
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
