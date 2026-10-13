# Viewer contract 1

The Julia service contract is `CONTRACT_VERSION = 1` and can be checked with
`require_version(1)`. `CompatibilityError` reports an unsupported service,
viewer-payload or scene version before rendering starts.

New portable payloads declare `viewer_schema: 1`. They contain `scene`, `frames`
and optional `textures`, `models`, `paths`, `references`, `terrain`, `ensemble`
and `options` objects. Historical payloads without `viewer_schema` are accepted
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

Optional velocities are kilometres per second. Attitude quaternions are
scalar-last, passive inertial-to-body. Link poses use the existing seven-value
position/quaternion layout; the scene carries their frame and column metadata.
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
