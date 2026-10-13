# Independent extraction review

This review covers the standalone SpaceAGORAVisualizer 0.1.0 preparation. It
accepts the local rendering boundary and its bounded validation; it does not
claim hosted CI, a clean remote installation, a published release, or new
scientific validation.

The renderer originates in SpaceAGORA commit
`265c9c6bd002d31aba77f4bb7cc46b48b48b98ed`. The extraction inventory records all
39 original file identities. At extraction commit `5cee95eda03621ee36e5251227ec10ae1026de9b`, independent
review verified that the 33 protected JavaScript, vendor and HTML template
files were byte-identical and that the
Julia import-map and HTML assembly bodies are unchanged apart from the private
render function name. Original license and third-party notices are retained.
This repository starts with a small review base; source history is referenced
by the extraction inventory rather than rewritten as new authorship.

Core retains numerical conversion and scene production. The companion imports
no SpaceAGORA modules. Its version-1 contract accepts exported viewer payloads,
including historical payloads without `viewer_schema` when `scene.schema` is 1.
Independent source review accepted version checks, input selection, rendering
and preserved payload contents. Actual core-generated fixtures cover a delayed
ensemble sample with an encoded NaN gap and a zero-row result table. Empty input
acceptance does not assert that there is a trajectory to play back.

One review finding was fixed before acceptance: an existing directory supplied
as the HTML destination could have been replaced by the file move. The public
entry point now rejects directories and symlinks to directories before rendering
or writing. It also refuses the input path and its symbolic-link or hard-link
aliases. Regression tests preserve the input payload, existing directory,
sentinel file and aliases. Explicit replacement of an existing HTML file remains
supported.

Completed local validation:

- Julia 1.12.1 offline `Pkg.test`: 124 assertions passed.
- Existing renderer and model-loader Node suite: 13 tests passed.
- Python page-builder tests: 17 tests passed, including the texture-free default,
  an explicit external texture catalog, and failure before output replacement.
- Real Chrome/WebGL checks: single-run and legacy ensemble pages rendered,
  scrubbed and changed coordinate display frame with no console errors or
  external network requests. The single-run screenshot was visually inspected.
- Relative documentation links passed; standalone page assembly succeeded without
  a texture catalog.

These checks used cached dependencies and existing browser tools. No simulation,
new dataset, browser installation or planetary texture download was required.
Pages with user-supplied external model URLs may still request those resources;
explicit CDN builds are a separate network-enabled workflow.

## Standalone importer follow-up

Review of the extracted browser importer found two inherited defects: JSON
reference trajectories reached the CSV parser, and ensemble attitudes were
interpolated as four unrelated scalars. JSON references now use the same
table/CSV/JSON selection as the primary trajectory. Ensemble quaternions use
normalized, hemisphere-aware shortest-arc SLERP. Invalid attitudes and times
outside a sample's span remain gaps; exact valid samples remain available.
Position and velocity interpolation, core-exported payload conversion, vendor
files and the remaining renderer files are unchanged.

This is an intentional post-extraction change to `viewer/src/standalone.js`;
[the repair record](../provenance/standalone-repair.json) preserves its original
identity and the new hash. The historical extraction inventory is unchanged.
Six new regression tests failed against the extraction commit. With the repair,
all 19 Node tests and all 17 Python tests pass. The new cases exercise both JSON
forms, the real browser form handler, Python CLI presets, antipodal attitudes,
nonuniform time grids, unit normalization and missing attitudes. They also check
that position and velocity interpolation is unchanged.

These are local bounded checks. The earlier 124 Julia assertions and real-browser
rendering check were not rerun for this JavaScript-only correction; no new
scientific validation or hosted-CI result is implied.

The subsequent hosted asset-integrity check still expected the original
`standalone.js` hash. The test now checks that the reviewed repair record names
that one file and matches its original SHA-256 and Git blob in the extraction
inventory, then verifies the repaired hash. All other protected assets retain
their original hashes; neither provenance record nor renderer source changed in
this follow-up. Full local validation passed 128 Julia assertions (the original
124 plus four provenance checks), 19 Node tests and 17 Python tests. This is a
fresh local run, not a claim about the pending hosted checks.
