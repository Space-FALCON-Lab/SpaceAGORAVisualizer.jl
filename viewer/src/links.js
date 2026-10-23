// Interlinks between spacecraft and rotating ground stations, from the optional block:
// each link is a segment between its two spacecraft's interpolated positions,
// drawn while the link is active and, dimmed, while it is only in contact (could
// close). A directed link fades from its transmitter to its receiver. Without
// the block nothing is drawn. The block's `history_start_s` and `history_end_s`
// give the span its schedule covers: no link is known before the start (after
// a resume that could not keep the earlier schedule), and a window is drawn at
// its end only when that end is the history's last time.
import * as THREE from 'three';
import { decodeFloatBlock } from 'viewer/data.js';
import { makeLabelSprite } from 'viewer/spacecraft.js';

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
  for (const list of out) {
    list.sort((a, b) => a[0] - b[0]);
    let kept = 0;
    for (const window of list) {
      if (kept && window[0] <= list[kept - 1][1]) list[kept - 1][1] = Math.max(list[kept - 1][1], window[1]);
      else list[kept++] = window;
    }
    list.length = kept;
  }
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
  const stations = (spec && spec.stations) || [];
  if (stations.length && typeof options.rotationAt !== 'function') throw new Error('Ground stations need the planet rotation.');
  const stationIndex = new Map(stations.map((station, i) => [station.node, i]));
  if (stationIndex.size !== stations.length || stations.some((s) => !Number.isInteger(s.node) || s.node >= 0 ||
      typeof s.name !== 'string' || !s.name.length || !Array.isArray(s.position_m) || s.position_m.length !== 3 || !s.position_m.every(Number.isFinite))) {
    throw new Error('Ground stations need unique negative nodes, names and finite planet-fixed positions.');
  }
  for (const link of links) for (const node of [link.a, link.b]) {
    if (!Number.isInteger(node) || node === 0 || (node < 0 && !stationIndex.has(node))) throw new Error('Unknown interlink endpoint.');
  }
  const stationPositions = stations.map(() => new Float64Array(3));
  const rotation = new THREE.Quaternion(), site = new THREE.Vector3(), worldSite = new THREE.Vector3();
  const stationGeometry = new THREE.BufferGeometry();
  stationGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(stations.length * 3), 3));
  const markers = new THREE.Points(stationGeometry, new THREE.PointsMaterial({ color: '#88f0bc', size: 7, sizeAttenuation: false }));
  markers.name = 'ground-stations';
  markers.frustumCulled = false;
  const labels = typeof document === 'undefined' ? [] : stations.map((station) => {
    const label = makeLabelSprite(station.name, '#88f0bc');
    label.material.depthTest = true;
    return label;
  });
  let labelsWanted = true;
  function endpointAt(t, node, out) {
    if (node > 0) frames.positionAt(t, node - 1, out);
    else out.set(stationPositions[stationIndex.get(node)]);
  }
  const active = linkWindows(spec && spec.active, count);
  const contact = linkWindows(spec && spec.contact, count);
  // The history's span; older payloads give none, and the last time is then the
  // latest window end.
  const historyStart = Number.isFinite(spec && spec.history_start_s) ? spec.history_start_s : null;
  let lastTime = Number.isFinite(spec && spec.history_end_s) ? spec.history_end_s : -Infinity;
  if (!Number.isFinite(spec && spec.history_end_s)) {
    for (const lists of [active, contact]) for (const list of lists) for (const [, end] of list) lastTime = Math.max(lastTime, end);
  }
  const recordedAt = (t) => (historyStart === null || t >= historyStart) && t <= lastTime;
  const activeAt = (i, t) => recordedAt(t) && inWindow(active[i], t, lastTime);
  const contactAt = (i, t) => recordedAt(t) && !activeAt(i, t) && inWindow(contact[i], t, lastTime);
  // Each kind present, once, with its colour, for the legend.
  const kinds = [...new Set(links.map((link) => String(link.kind)))].map((kind) => [kind, linkColor(kind)]);
  const activeLine = segments(count, options.opacity ?? 0.95);
  const contactLine = segments(count, options.contactOpacity ?? CONTACT_OPACITY);
  group.add(contactLine, activeLine);
  if (stations.length) group.add(markers, ...labels);
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
    stationCount: stations.length,
    lastTime,
    historyStart,
    kinds,
    // The legend's text at time `t`: the active count, or, before the history's
    // start, that no link is known yet.
    statusAt(t) {
      if (historyStart !== null && t < historyStart) return `not recorded before ${historyStart} s`;
      let n = 0;
      for (let i = 0; i < count; i++) if (activeAt(i, t)) n++;
      return `${n} of ${count} active`;
    },
    // Whether link `i` is active, or only in contact, at time `t`.
    activeAt,
    contactAt,
    // anchorKm: the floating origin the group sits at (as the markers' group).
    update(t, anchorKm, camera) {
      group.position.set(anchorKm[0], anchorKm[1], anchorKm[2]);
      if (stations.length) {
        options.rotationAt(t, rotation);
        group.updateWorldMatrix(true, false);
        const positions = stationGeometry.getAttribute('position').array;
        stations.forEach((station, i) => {
          site.fromArray(station.position_m).multiplyScalar(0.001).applyQuaternion(rotation);
          site.toArray(stationPositions[i]);
          site.set(site.x - anchorKm[0], site.y - anchorKm[1], site.z - anchorKm[2]);
          site.toArray(positions, i * 3);
          const label = labels[i];
          if (label) {
            label.position.copy(site);
            label.visible = labelsWanted;
            if (camera) {
              worldSite.copy(site).applyMatrix4(group.matrixWorld);
              const height = 0.028 * camera.position.distanceTo(worldSite);
              label.scale.set(height * label.userData.aspect, height, 1);
            }
          }
        });
        stationGeometry.getAttribute('position').needsUpdate = true;
      }
      const activePos = activeLine.geometry.getAttribute('position').array;
      const contactPos = contactLine.geometry.getAttribute('position').array;
      shown = 0;
      links.forEach((link, i) => {
        endpointAt(t, link.a, ra);
        endpointAt(t, link.b, rb);
        const present = Number.isFinite(ra[0]) && Number.isFinite(rb[0]);
        const isActive = present && activeAt(i, t);
        const isContact = present && contactAt(i, t);
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
    setLabelsVisible(v) { labelsWanted = v; },
  };
}
