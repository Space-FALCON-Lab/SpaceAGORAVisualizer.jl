# SpaceAGORAVisualizer.jl

SpaceAGORAVisualizer turns an exported viewer payload into an interactive HTML
page. It reads completed results and does not import SpaceAGORA, propagate a
trajectory, or change a controller. The browser renderer, playback controls,
models and saved display channels come from the existing SpaceAGORA viewer.

## View a run

Install this source checkout in a Julia 1.12 environment:

```julia
using Pkg
Pkg.develop(path="/absolute/path/to/SpaceAGORAVisualizer.jl")
```

Then open an exported viewer payload:

```julia
using SpaceAGORAVisualizer
page = visualize("output/my-run/simulation_results_viewer.json")
# The results prefix or run directory works too:
page = visualize("output/my-run/simulation_results")
page = visualize("output/my-run")
```

Open the returned HTML file in a browser. It embeds the renderer and the data,
so a page whose assets are embedded can be viewed without a server or network.
Models that reference external textures or buffers can still request those URLs.
The package does not download planetary textures or simulation datasets.

The input is an exported viewer payload, **not** an Arrow results file or the
`*_scene.json` sidecar. SpaceAGORA's integration prepares the payload from those
files. A directory selects `simulation_results_viewer.json` if present; otherwise
there must be exactly one `*_viewer.json`. Pass an explicit file when there are
several. The default output replaces `.json` with `.html` beside the payload;
`out` and `title` can select another destination and page title.

For an already constructed payload, `render_viewer_html(payload)` returns the
HTML as a string. [The contract](docs/contract.md) describes versions and frame
conventions. Installation into core's environment is optional; the package can
render a payload in an environment containing only this package and its small
JSON dependency.

## Other trajectory files

The inherited browser form accepts CSV or JSON trajectory tables without Julia:

```sh
python3 viewer/build_standalone.py --textures none --out viewer.html
```

Open that page and choose the trajectory file, body, epoch and units. This
standalone import uses approximate body rotation; it does not replace the
rotation samples exported by SpaceAGORA. Planetary textures are not included in
this package, so `--textures none` is the default. To use your own texture catalog, pass
`--textures 4k --textures-dir=/path/to/textures`.
See [renderer development and controls](viewer/README.md).

## Validation and provenance

```sh
julia --project=. -e 'using Pkg; Pkg.test()'
node test/unit/visualization/viewer_channels_models_tests.mjs
python3 -m unittest discover -s test/scripts -p 'test_*.py' -v
```

An optional real-browser check uses an already installed Playwright and Chrome
(or Chromium), without installing them as package dependencies:

```sh
julia --project=. -e 'using SpaceAGORAVisualizer; visualize("test/fixtures/small_viewer.json"; out="/tmp/spaceagora-viewer-test.html")'
SPACEAGORA_BROWSER_EXECUTABLE=/path/to/chrome node test/browser_smoke.cjs /tmp/spaceagora-viewer-test.html
```

The Node suite exercises the real renderer modules and model loaders without
WebGL. It does not replace a browser rendering check. The original source
commit and file identities are recorded in [provenance/extraction.json](provenance/extraction.json).
See [NOTICE](NOTICE), [LICENSE](LICENSE), and the third-party notices under
`viewer/vendor/`. This is an unregistered 0.1.0 preparation; no package release
or remote installation URL is implied by these local instructions.
