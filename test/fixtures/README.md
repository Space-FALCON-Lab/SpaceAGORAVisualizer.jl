# Tiny renderer fixtures

These are synthetic data, not a scientific reference dataset.

`small_viewer.json` has two rows and one spacecraft, for offline browser smoke
checks. `legacy_ensemble_viewer.json` was produced with SpaceAGORA's
`SceneVisualization.build_ensemble_frames` from two DataFrames of two rows each,
the second starting two seconds later. It keeps the older layout without
`viewer_schema`, the repeated spacecraft geometry, the ensemble metadata, Float64
blocks and the encoded NaN gap before the second sample begins.
`empty_viewer.json` was produced by `build_viewer_frames` from a one-spacecraft
scene and a zero-row table with the required columns. Neither fixture needs a
simulation to regenerate.

The conversion functions come from SpaceAGORA commit
`265c9c6bd002d31aba77f4bb7cc46b48b48b98ed` and stay in SpaceAGORA. This package's
tests only read these saved plain-data fixtures and never load SpaceAGORA.
Accepting the empty payload checks the file contract; there is no trajectory to
play back.

`mission_viewer.json` adds a coast and maneuver history to a three-frame
synthetic trajectory. It tests the optional segment controls and the plain-data
contract; it is not a validation trajectory.

`mission_precision_viewer.json` uses default Float32 playback times and exact
mission timestamps at 0.1, 0.7 and 0.9 seconds. It checks both rounding directions
and an internal segment boundary without changing the recorded history.

`interlinks_viewer.json` extends the small synthetic trajectory to three
spacecraft and adds an `interlinks` block in the form SpaceAGORA's
`interlink_payload` wrote before it added `history_start_s` and `history_end_s`
(the renderer accepts the block without them): a laser momentum link between
spacecraft 1 and 2,
active over the first five seconds, and a directed data link from spacecraft 1 to
3, active over the last five and in contact throughout. The active windows are
base64 Float64 blocks and the contact window plain arrays, so both encodings are
read. It tests the optional block and its drawing; it is not a simulation result.
