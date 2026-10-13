# Tiny renderer fixtures

These are synthetic data, not a scientific reference dataset.

`small_viewer.json` has two rows and one spacecraft for offline browser smoke
checks. `legacy_ensemble_viewer.json` was produced with the existing core
`SceneVisualization.build_ensemble_frames` from two two-row DataFrames, one
starting two seconds later. It preserves the legacy absent `viewer_schema`,
repeated spacecraft geometry, ensemble metadata, Float64 blocks and encoded NaN
gap before the second sample begins. `empty_viewer.json` was produced by
`build_viewer_frames` from the same single-spacecraft scene and a zero-row table
with its required columns. Neither fixture requires a simulation to regenerate.

The corresponding conversion implementations originate in SpaceAGORA commit
`265c9c6bd002d31aba77f4bb7cc46b48b48b98ed`; they stay in core. The companion tests
only read these saved plain-data fixtures and never import core. Empty payload
acceptance preserves the file contract; it does not assert a playable trajectory.

`mission_viewer.json` extends the small synthetic trajectory with a three-frame
coast/maneuver history. It tests optional segment controls and the plain-data
contract; it is not a scientific validation trajectory.
