# Changelog

## 0.2.0 — 2026-10-23

First tagged release of the standalone SpaceAGORA viewer.

- Render recorded mission segments and transitions, with jump controls and
  notices for history outside the saved trajectory.
- Display interlink activity and contact windows, link kinds and direction,
  active counts, and the interval covered by the saved schedule.
- Display named ground stations at rotating planet-fixed positions and connect
  uplinks and downlinks to their station endpoints.
- Preserve the standalone JSON/HTML rendering API and historical payloads.
  Renderer service, payload and scene versions remain 1; mission and interlink
  blocks are optional additions.

Julia 1.12 is required. The companion does not require SpaceAGORA to view an
exported payload. SpaceAGORA installations select their own reviewed companion
revision through `packages/VisualizerSource.toml`; use the parent installer
for that pair. The renderer displays recorded data and does not establish
scientific or mission-performance validation.

The earlier 0.1.0 development state and its extraction provenance remain
recorded in `docs/independent_review.md` and `provenance/`.
