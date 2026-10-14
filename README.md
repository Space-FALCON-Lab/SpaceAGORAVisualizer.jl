# SpaceAGORAVisualizer.jl

SpaceAGORAVisualizer lets you explore a saved mission in an interactive 3D page.
Play or scrub through a trajectory, inspect a spacecraft, compare runs and
follow recorded mission segments. The page can be shared with someone who does
not have Julia or SpaceAGORA installed.

The package reads completed results. SpaceAGORA owns the simulation and creates
the viewer data; this companion assembles the HTML and provides browser
playback. It does not propagate a trajectory or change a controller.

Start with [installation](#installation) and the [first example](#first-example),
then see [the SpaceAGORA connection](#connection-to-spaceagora),
[compatibility](#compatibility), [validation and limitations](#validation-and-limitations)
and [credits](#credits).

## Installation

Use Julia 1.12 and a separate environment to install the public development
version:

```julia
using Pkg
Pkg.activate("viewer-env")
Pkg.add(url="https://github.com/Space-FALCON-Lab/SpaceAGORAVisualizer.jl.git")
```

This installs the repository's default branch. The package is an unregistered
0.1.0 development version, with no tagged release yet. For a local checkout,
replace `Pkg.add` with `Pkg.develop(path="/absolute/path/to/SpaceAGORAVisualizer.jl")`.

If you are running missions from a SpaceAGORA checkout, use its
[optional-viewer installer](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/visualization.md#install-the-optional-viewer).
That helper selects the companion commit recorded in the parent checkout's
`packages/VisualizerSource.toml`. It gives you the reviewed pair of packages;
installing this repository's default branch follows its ongoing development.

## First example

This small example renders a bundled synthetic trajectory with mission segment
labels. It checks the viewing workflow without running a simulation or
downloading a dataset; the trajectory is not a scientific reference case.

```julia
using SpaceAGORAVisualizer

payload = joinpath(pkgdir(SpaceAGORAVisualizer), "test", "fixtures", "mission_viewer.json")
page = visualize(payload; out=joinpath(pwd(), "viewer-demo.html"))
println(page)
```

Open the printed HTML path in a browser. Drag to orbit, scroll to zoom, and
use the timeline to play or scrub. Select a spacecraft to inspect it, or choose
a mission segment to jump to its start. The [controls reference](viewer/README.md#controls)
explains camera frames, saved plots, model views and video export.

For your own completed run, pass its exported JSON, results prefix or directory:

```julia
page = visualize("output/my-run/simulation_results_viewer.json")
page = visualize("output/my-run/simulation_results")
page = visualize("output/my-run")
```

The input is an exported viewer payload. An Arrow results file or a
`*_scene.json` sidecar must first be converted by SpaceAGORA. A directory selects
`simulation_results_viewer.json` if present; otherwise it must contain exactly
one `*_viewer.json`. Pass an explicit file when there are several. The default
output replaces `.json` with `.html` beside the payload. Use `out` and `title`
to choose another destination and page title.

## Connection to SpaceAGORA

The parent [mission workflow guide](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/mission_workflows.md)
contains a complete Earth-coast recipe: define a configuration inside a function,
create a `MissionPlan`, run it in a fresh output directory, then open its saved
viewer payload. It uses analytic gravity and requires no atmosphere or SPICE
dataset. The same guide extends that example with operational segments and
explains which transitions the simulator supports.

After running that recipe with both packages loaded, its `run` value can be
viewed directly:

```julia
using SpaceAGORAVisualizer
page = SpaceAGORAVisualizer.visualize(run)
```

A mission run normally saves `simulation_results_viewer.json`. For older runs
with a saved scene and results bundle, SpaceAGORA's
[`export_viewer_payload`](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/visualization.md)
creates that JSON without propagating again. The companion can then display it
in an environment of its own. Choosing saved fields, units, frame sampling and
export options belongs to SpaceAGORA; the companion preserves the supplied data.

You can move the JSON or share its HTML page. The receiver does not need the
mission builder or simulation packages. To rebuild the JSON later, keep the
complete original run folder, including its scene, result bundle and manifest.

### Follow mission segments

When the exported run includes operational segments, the playback toolbar shows
its current segment and the time spent in it. Choose a segment to jump to its
start, or choose a recorded transition to inspect the change. The transition
list gives the elapsed mission time, the outgoing and incoming segments, and
why the transition occurred. The final entry can record the end of the run,
including an early stop.

The labels come from saved execution history. A segment that the simulation
never entered does not appear. At a shared boundary, the incoming segment is
shown; the final recorded time remains part of the last segment. Both jump lists
return to their prompt after a selection, so you can revisit the same event.
A segment with zero duration remains in the list, while playback selects the
segment that follows it at that time. Jumps outside the saved trajectory range
are marked and disabled, with a notice explaining the missing coverage.

The mission record travels inside the JSON. Older payloads without that record
retain the usual playback controls. Between saved samples, the viewer
interpolates the displayed trajectory; it does not rerun segment transitions.

## Compatibility

| Item | Supported or checked |
| --- | --- |
| Julia | 1.12; the package declares `julia = "1.12"` |
| Package version | 0.1.0 development version; no tagged release yet |
| Renderer service, viewer payload and scene | Version 1; unknown explicit versions are rejected |
| Historical payloads | Accepted without `viewer_schema` when `scene.schema` is 1 |
| Recorded mission history | Optional schema 1; older payloads remain usable |
| Parent used for the linked mission recipe | [SpaceAGORA `388b8801`](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/commit/388b8801b3e912c264b04a462b019acbaf1c0d1a) |
| Companion selected by that parent's installer | [`6c008074`](https://github.com/Space-FALCON-Lab/SpaceAGORAVisualizer.jl/commit/6c0080743c124e321d538f3780fa30868612da21) |

The revision pair records a checked integration, not a requirement to install
SpaceAGORA when viewing an exported file. The [payload contract](docs/contract.md)
describes fields, units, quaternion conventions and version handling.
`render_viewer_html(payload)` also accepts a constructed payload and returns the
HTML as a string.

## Other trajectory files

From a checkout of this repository, you can build a browser form that accepts
CSV or JSON trajectory tables without Julia:

```sh
python3 viewer/build_standalone.py --textures none --out viewer.html
```

Open the page and choose the trajectory file, body, epoch and units. This import
uses approximate body rotation rather than SpaceAGORA's saved rotation samples.
Planetary textures are not bundled. To use an existing texture catalog, pass
`--textures 4k --textures-dir=/path/to/textures`.
See the parent's [standalone data-file guide](https://github.com/Space-FALCON-Lab/SpaceAGORA.jl/blob/main/docs/src/user/visualization.md#standalone-files).

## Validation and limitations

Default pages embed the renderer and data, so they can open from disk without
a server or network when their input assets are embedded. Models with external
textures or buffers can still request those URLs. Explicit CDN builds also use
the network. The package does not download planetary textures or simulation
datasets.

Playback is a view of saved samples, not a new dynamics calculation. Missing
samples and boundaries limit what can be inspected. Viewer-derived heating and
dynamic-pressure overlays are illustrative; use the simulation's verified
outputs for scientific conclusions. The browser needs WebGL, and video export
also depends on the codecs available in that browser.

From the repository root, the existing checks are:

```sh
julia --project=. -e 'using Pkg; Pkg.test()'
node test/unit/visualization/viewer_channels_models_tests.mjs
python3 -m unittest discover -s test/scripts -p 'test_*.py' -v
```

The Node suite checks renderer modules without WebGL. An optional browser smoke
check uses an already installed Playwright and Chrome or Chromium:

```sh
julia --project=. -e 'using SpaceAGORAVisualizer; visualize("test/fixtures/small_viewer.json"; out="/tmp/spaceagora-viewer-test.html")'
SPACEAGORA_BROWSER_EXECUTABLE=/path/to/chrome node test/browser_smoke.cjs /tmp/spaceagora-viewer-test.html
```

These checks exercise rendering and the saved-data contract. They do not certify
the physical model or the accuracy of a supplied trajectory.

## Credits

The browser renderer was extracted from SpaceAGORA and includes interactive
viewer work adapted from Evan Yu's PR121. [NOTICE](NOTICE) records that origin;
[the extraction inventory](provenance/extraction.json) retains the original
commits and file identities. Later reviewed changes have their own records in
[provenance/](provenance/).

The package uses the [MIT license](LICENSE). Three.js and mp4-muxer retain their
licenses and notices under [viewer/vendor/](viewer/vendor/). Assets supplied in a
payload retain their own licenses and provenance.
