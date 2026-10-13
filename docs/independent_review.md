# Independent extraction review

This review covers the standalone SpaceAGORAVisualizer 0.1.0 preparation. It
accepts the local rendering boundary and its bounded validation; it does not
claim hosted CI, a clean remote installation, a published release, or new
scientific validation.

The renderer originates in SpaceAGORA commit
`265c9c6bd002d31aba77f4bb7cc46b48b48b98ed`. The extraction inventory records all
39 original file identities. Independent review verified that the 33 protected
JavaScript, vendor and HTML template files remain byte-identical and that the
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
