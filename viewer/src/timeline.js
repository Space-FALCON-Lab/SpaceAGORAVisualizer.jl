// Playback clock: elapsed mission time, play/pause, speed, scrubbing.
export class Timeline {
  constructor(tStart, tEnd, options = {}) {
    this.tStart = tStart;
    this.tEnd = tEnd;
    this.t = tStart;
    this.missionTime = missionTimeMapper(options.sampleTimes);
    this.playing = options.autoplay ?? true;
    this.speed = options.speed ?? 60; // simulated seconds per wall second
    this.loop = options.loop ?? false;   // playback stops at the end; Play from the end starts over
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit() { for (const fn of this.listeners) fn(this); }

  tick(dtWall) {
    if (!this.playing) return;
    let t = this.t + this.speed * dtWall;
    if (t > this.tEnd) {
      if (this.loop) t = this.tStart + ((t - this.tStart) % Math.max(1e-9, this.tEnd - this.tStart));
      else { t = this.tEnd; this.playing = false; }
    }
    this.t = t;
    this.emit();
  }

  seek(t) { this.t = Math.min(this.tEnd, Math.max(this.tStart, t)); this.emit(); }
  seekFraction(f) { this.seek(this.tStart + f * (this.tEnd - this.tStart)); }
  fraction() { const d = this.tEnd - this.tStart; return d > 0 ? (this.t - this.tStart) / d : 0; }
  togglePlay() {
    if (!this.playing && this.t >= this.tEnd) this.t = this.tStart;
    this.playing = !this.playing;
    this.emit();
  }
  setSpeed(s) { this.speed = s; this.emit(); }
}

// Wall-clock string for an elapsed time given the sidecar epoch (ISO 8601 UTC).
export function utcString(epochUtc, elapsedSeconds) {
  const base = Date.parse(epochUtc);
  if (Number.isNaN(base)) return '';
  return new Date(base + 1000 * elapsedSeconds).toISOString().replace('.000Z', 'Z');
}

export function elapsedString(seconds) {
  const s = Math.max(0, seconds);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  parts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`);
  return parts.join(' ');
}

// Optional execution history, in the same elapsed seconds as the saved frames.
// It describes actual transitions; it does not drive or reconstruct simulation.
export function missionHistory(mission) {
  if (mission == null) return null;
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const name = x => typeof x === 'string' && x.trim().length > 0;
  const time = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  if (!object(mission) || mission.schema !== 1) throw new Error('Unsupported mission history schema; expected 1');
  if (!name(mission.name)) throw new Error('mission.name must be a nonempty string');
  if (!Array.isArray(mission.segments) || !Array.isArray(mission.transitions)) throw new Error('Mission segments and transitions must be arrays');
  const segments = mission.segments, transitions = mission.transitions, names = new Set();
  segments.forEach((segment, i) => {
    if (!object(segment) || !name(segment.name) || names.has(segment.name)) throw new Error('Mission segment names must be nonempty and unique');
    names.add(segment.name);
    if (!time(segment.start_s) || !time(segment.end_s) || segment.start_s > segment.end_s) throw new Error('Invalid mission segment times');
    if (i > 0 && segments[i - 1].end_s !== segment.start_s) throw new Error('Mission segment intervals must be contiguous and ordered');
  });
  const n = segments.length;
  if (n === 0 ? transitions.length !== 0 : ![n - 1, n].includes(transitions.length)) throw new Error('Mission history needs adjacent transitions and an optional final exit');
  transitions.forEach((transition, i) => {
    if (!object(transition) || !time(transition.time_s) || transition.time_s !== segments[i].end_s) throw new Error('Mission transition time must match its segment boundary');
    if (transition.from !== segments[i].name || transition.to !== (i < n - 1 ? segments[i + 1].name : null)) throw new Error('Invalid mission transition segment reference');
    if (!name(transition.reason)) throw new Error('Mission transition reason must be a nonempty string');
  });
  return mission;
}

// Reconcile metadata only when its Float32 encoding is an actual saved sample.
// This is an encoding comparison, not an epsilon applied to simulation time.
const unchangedTime = time => time;
export function missionTimeMapper(sampleTimes) {
  if (!(sampleTimes instanceof Float32Array) || sampleTimes.length === 0) return unchangedTime;
  // FrameData accepts legacy grids without an order check. Decline this optional
  // reconciliation for invalid grids, preserving their existing strict behavior.
  for (let i = 0; i < sampleTimes.length; i++) {
    if (!Number.isFinite(sampleTimes[i]) || (i > 0 && sampleTimes[i] < sampleTimes[i - 1])) return unchangedTime;
  }
  return time => {
    if (!Number.isFinite(time)) return time;
    const rounded = Math.fround(time);
    if (!Number.isFinite(rounded)) return time;
    let lo = 0, hi = sampleTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sampleTimes[mid] < rounded) lo = mid + 1; else hi = mid;
    }
    return lo < sampleTimes.length && sampleTimes[lo] === rounded ? sampleTimes[lo] : time;
  };
}

// Adjacent boundaries belong to the incoming segment. Zero-length intervals
// remain visible in the jump list; the final interval includes its terminal time.
export function missionSegmentAt(mission, t, mapTime = unchangedTime) {
  if (!mission || !Number.isFinite(t)) return -1;
  for (let i = mission.segments.length - 1; i >= 0; i--) {
    const segment = mission.segments[i];
    const start = mapTime(segment.start_s), end = mapTime(segment.end_s);
    if (t >= start && (t < end || (i === mission.segments.length - 1 && t === end))) return i;
  }
  return -1;
}
