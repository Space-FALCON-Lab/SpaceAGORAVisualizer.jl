// Interlinks between spacecraft, from the payload's optional `interlinks` block:
// each link is a segment between its two spacecraft's interpolated positions,
// drawn while the link is active and, dimmed, while it is only in contact (could
// close). A directed link fades from its transmitter to its receiver. Without
// the block nothing is drawn.
import * as THREE from 'three';
import { decodeFloatBlock } from 'viewer/data.js';

const KIND_COLORS = [['LaserMomentumLink', '#ff5c8a'], ['PowerBeamLink', '#ffb347'], ['DataLink', '#5cc8ff']];
const OTHER_COLOR = '#c7a6ff';
const CONTACT_OPACITY = 0.25;

// A link kind's colour: the built-in kinds by name (with or without type
// parameters), any other kind one shared colour.
export function linkColor(kind) {
  for (const [name, color] of KIND_COLORS) if (kind === name || String(kind).startsWith(name + '{')) return color;
  return OTHER_COLOR;
}

// One block's windows, per link: sorted [start, end] pairs.
export function linkWindows(block, linkCount) {
  const out = Array.from({ length: linkCount }, () => []);
  if (!block || !block.count) return out;
  const start = decodeFloatBlock(block.start_s, 'f64'), end = decodeFloatBlock(block.end_s, 'f64');
  for (let i = 0; i < block.count; i++) out[block.index[i]].push([start[i], end[i]]);
  for (const list of out) list.sort((a, b) => a[0] - b[0]);
  return out;
}

// Whether time `t` is inside one of a link's sorted windows: start <= t < end,
// or t == end when that end is the schedule's last time.
export function inWindow(list, t, lastTime) {
  let lo = 0, hi = list.length - 1, k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (k < 0) return false;
  const [, end] = list[k];
  return t < end || (t === end && end === lastTime);
}

function segments(count, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
  const line = new THREE.LineSegments(geometry, material);
  line.frustumCulled = false;
  return line;
}

export function createLinks(spec, frames, options = {}) {
  const group = new THREE.Group();
  group.name = 'interlinks';
  const links = (spec && spec.links) || [];
  const count = links.length;
  const active = linkWindows(spec && spec.active, count);
  const contact = linkWindows(spec && spec.contact, count);
  let lastTime = -Infinity;
  for (const lists of [active, contact]) for (const list of lists) for (const [, end] of list) lastTime = Math.max(lastTime, end);
  const activeLine = segments(count, options.opacity ?? 0.95);
  const contactLine = segments(count, options.contactOpacity ?? CONTACT_OPACITY);
  group.add(contactLine, activeLine);
  // Colours: the transmitter's end at the kind's colour, the receiver's end of a
  // directed link lightened toward white.
  const white = new THREE.Color('#ffffff');
  for (const line of [activeLine, contactLine]) {
    const colors = line.geometry.getAttribute('color').array;
    links.forEach((link, i) => {
      const from = new THREE.Color(linkColor(link.kind));
      const to = link.directed ? from.clone().lerp(white, 0.6) : from;
      colors.set([from.r, from.g, from.b, to.r, to.g, to.b], 6 * i);
    });
    line.geometry.getAttribute('color').needsUpdate = true;
  }
  const ra = new Float64Array(3), rb = new Float64Array(3);
  let shown = 0;
  return {
    group,
    links,
    count,
    lastTime,
    // Whether link `i` is active, or only in contact, at time `t`.
    activeAt: (i, t) => inWindow(active[i], t, lastTime),
    contactAt: (i, t) => !inWindow(active[i], t, lastTime) && inWindow(contact[i], t, lastTime),
    // anchorKm: the floating origin the group sits at (as the markers' group).
    update(t, anchorKm) {
      group.position.set(anchorKm[0], anchorKm[1], anchorKm[2]);
      const activePos = activeLine.geometry.getAttribute('position').array;
      const contactPos = contactLine.geometry.getAttribute('position').array;
      shown = 0;
      links.forEach((link, i) => {
        frames.positionAt(t, link.a - 1, ra);
        frames.positionAt(t, link.b - 1, rb);
        const present = Number.isFinite(ra[0]) && Number.isFinite(rb[0]);
        const isActive = present && inWindow(active[i], t, lastTime);
        const isContact = present && !isActive && inWindow(contact[i], t, lastTime);
        for (const [array, on] of [[activePos, isActive], [contactPos, isContact]]) {
          if (on) {
            array.set([ra[0] - anchorKm[0], ra[1] - anchorKm[1], ra[2] - anchorKm[2],
                       rb[0] - anchorKm[0], rb[1] - anchorKm[1], rb[2] - anchorKm[2]], 6 * i);
          } else {
            array.fill(0, 6 * i, 6 * i + 6);   // a collapsed segment draws nothing
          }
        }
        if (isActive) shown += 1;
      });
      activeLine.geometry.getAttribute('position').needsUpdate = true;
      contactLine.geometry.getAttribute('position').needsUpdate = true;
      return shown;
    },
    activeCount: () => shown,
    setVisible(v) { group.visible = v; },
  };
}
