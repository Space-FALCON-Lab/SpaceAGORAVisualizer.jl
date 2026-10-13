// Run with: node test/unit/visualization/viewer_channels_models_tests.mjs
// Uses the shipped viewer and vendored Three loaders, without WebGL or downloads.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(join(tmpdir(), 'spaceagora-viewer-js-'));
after(() => rm(scratch, { recursive: true, force: true }));
await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
for (const dir of ['src', 'vendor']) {
  await mkdir(join(scratch, dir));
  for (const name of await readdir(join(repo, 'viewer', dir))) {
    if (!name.endsWith('.js')) continue;
    let source = await readFile(join(repo, 'viewer', dir, name), 'utf8');
    source = source.replace(/(['"])(three|three\/addons\/[^'"]+|viewer\/[^'"]+)\1/g, (_, quote, spec) => {
      const path = spec === 'three' ? 'vendor/three.module.js' : spec.startsWith('viewer/')
        ? `src/${spec.slice(7)}` : `vendor/${spec.split('/').at(-1)}`;
      return quote + pathToFileURL(join(scratch, path)).href + quote;
    });
    await writeFile(join(scratch, dir, name), source);
  }
}
const load = (path) => import(pathToFileURL(join(scratch, path)).href);
const { FrameData, rotateByConjugate } = await load('src/data.js');
const THREE = await load('vendor/three.module.js');
const { GLTFLoader } = await load('vendor/GLTFLoader.js');
const { loadModelObject, resolveModelUrl } = await load('src/lod.js');
if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class { constructor(type, data) { this.type = type; Object.assign(this, data); } };
const frames = (channels, count = 3, sats = 2) => new FrameData({ count, sats, t_s: [0, 10, 20].slice(0, count), pos_km: new Array(count * sats * 3).fill(0), channels });
const channel = (overrides = {}) => ({ name: 'error_deg', label: 'error', unit: 'deg', digits: 3, log: false, data: [1, 101, 3, 103, 5, 105], ...overrides });
const dataUrl = (text) => `data:application/octet-stream;base64,${Buffer.from(text).toString('base64')}`;
const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
const getModel = (model, models) => new Promise((ok, fail) => loadModelObject(model, 'test', ok, (err) => fail(new Error(err)), models));
const meshOf = (object) => { let mesh; object.traverse((o) => { if (!mesh && o.isMesh) mesh = o; }); return mesh; };

test('bounded atmosphere profiles do not invent density or shells outside grid coverage', async () => {
  const { createAtmosphere } = await load('src/atmosphere.js');
  const planet = { equatorial_radius_m: 3396190, polar_radius_m: 3376200, name: 'Mars' };
  const spec = { model: 'GRAMGridAtmosphereModel', ei_altitude_m: 100000,
    profile: { altitude_m: [60000, 90000], density_kg_m3: [1e-8, 1e-9] } };
  const atmosphere = createAtmosphere(spec, planet);
  assert.ok(Number.isNaN(atmosphere.densityAtAltitude(59999)));
  assert.ok(Number.isNaN(atmosphere.densityAtAltitude(90001)));
  assert.ok(Number.isNaN(atmosphere.densityAtAltitude(NaN)));
  assert.equal(atmosphere.densityAtAltitude(60000), 1e-8);
  assert.equal(atmosphere.densityAtAltitude(90000), 1e-9);
  assert.ok(Math.abs(atmosphere.densityAtAltitude(75000) / Math.sqrt(1e-17) - 1) < 1e-14);
  assert.ok(atmosphere.info.layers.length > 0);
  assert.ok(atmosphere.info.layers.every(layer => layer.altitude_km >= 60 && layer.altitude_km <= 90));
  assert.ok(atmosphere.info.layers.every(layer => Number.isFinite(layer.opacity)));
  assert.ok(Number.isNaN(atmosphere.info.profile.surface));
  assert.ok(Number.isNaN(atmosphere.info.profile.atEi));
  const disjoint = createAtmosphere({ ...spec, profile: {
    altitude_m: [150000, 180000], density_kg_m3: [1e-10, 1e-11] } }, planet);
  assert.equal(disjoint.layers.children.length, 0);
  const analytic = createAtmosphere({ ...spec, profile: {
    altitude_m: [0, 150000], density_kg_m3: [1e-5, 1e-12] } }, planet);
  assert.equal(analytic.layers.children.length, 6);
  assert.equal(analytic.info.profile.surface, 1e-5);
  for (const item of [atmosphere, disjoint, analytic]) item.group.traverse(node => {
    node.geometry?.dispose(); node.material?.dispose();
  });
});

test('scalar rows, interpolation, bounds and gaps', () => {
  const f = frames([channel({ log: 'auto' })]);
  assert.equal(f.channelAt(0, 5, 0), 2); assert.equal(f.channelAt(0, 5, 1), 102);
  assert.equal(f.channelAt(0, -5, 1), 101); assert.equal(f.channelAt(0, 25, 0), 5);
  for (const args of [[4, 0, 0], [0, NaN, 0], [0, 0, 2], [0, 0, -1], [0, 0, 0.5]]) assert.ok(Number.isNaN(f.channelAt(...args)));
  assert.equal(frames([channel({ data: [7, 8] })], 1).channelAt(0, 999, 1), 8);
  assert.ok(Number.isNaN(frames([channel({ data: [] })], 0).channelAt(0, 0, 0)));
  const gap = frames([channel({ data: [1, 2, NaN, 4, 5, 6] })]);
  assert.equal(gap.channelAt(0, 0, 0), 1); assert.equal(gap.channelAt(0, 20, 0), 5);
  assert.ok(Number.isNaN(gap.channelAt(0, 5, 0)));
  const encoded = Buffer.from(new Float32Array([1, 101, 3, 103, 5, 105]).buffer).toString('base64');
  assert.equal(frames([channel({ data: encoded })]).channelAt(0, 5, 1), 102);
});

test('channel metadata, duplicate names, lengths and numeric payload validation', () => {
  for (const digits of [-1, 101, 1.5, true, '3']) assert.throws(() => frames([channel({ digits })]), /digits/);
  for (const log of [1, 'false', 'yes', {}]) assert.throws(() => frames([channel({ log })]), /log/);
  for (const digits of [0, 100]) for (const log of [true, false, 'auto']) assert.equal(frames([channel({ digits, log })]).channels[0].digits, digits);
  for (const override of [{ label: {} }, { unit: 2 }, { name: '' }, { name: 3 }]) assert.throws(() => frames([channel(override)]));
  assert.throws(() => frames([channel(), channel()]), /duplicate/);
  assert.throws(() => frames({}), /array/);
  for (const data of [[1], new Float32Array(7), Buffer.alloc(25).toString('base64')]) assert.throws(() => frames([channel({ data })]), /length/);
  for (const data of [[1, 2, 3, 4, 5, Infinity], [1, 2, 3, 4, 5, 1e100], [1, 2, 3, 4, 5, '6']]) assert.throws(() => frames([channel({ data })]));
  assert.deepEqual(frames(null).channels, []);
});

test('channel panel metadata reaches existing escaped text boundary', async () => {
  const source = await readFile(join(repo, 'viewer/src/main.js'), 'utf8');
  const block = source.slice(source.indexOf('    frames.channels.forEach'), source.indexOf('    refs.items.forEach'));
  assert.ok(block.startsWith('    frames.channels.forEach'));
  const list = [], f = frames([channel({ name: 'x" onclick="bad', label: '<img src=x>', unit: '<svg onload=bad>', digits: 2 })]);
  vm.runInNewContext(block, { frames: f, s: 1, fmt: (x, d) => x.toFixed(d), add: (...args) => list.push(args) });
  assert.equal(list[0][1], '<img src=x>');
  const out = []; list[0][4](5, out); assert.equal(list[0][5](out), '102.00 <svg onload=bad>');
  const ui = await readFile(join(repo, 'viewer/src/ui.js'), 'utf8');
  const code = ui.slice(ui.indexOf('  const escapeHtml ='), ui.indexOf('  let plottedKey ='));
  const box = { dataset: {}, querySelectorAll: () => [{ textContent: '', classList: { toggle() {} } }] };
  vm.runInNewContext(`${code}\nrenderRows(box, model, '');`, { box, plottedKey: null, model: { title: 'test', rows: [{ key: list[0][0], label: list[0][1], text: list[0][5](out) }] } });
  assert.ok(box.innerHTML.includes('&lt;img src=x&gt;'));
  assert.ok(box.innerHTML.includes('&quot; onclick=&quot;bad'));
  assert.ok(!box.innerHTML.includes('<img'));
  assert.equal(box._dds[0].textContent, '102.00 <svg onload=bad>');
});

test('model ownership handles chains, formats, absent owners and cycles', () => {
  const models = { 1: { format: 'obj', url: dataUrl(obj) }, 2: { format: 'obj', url_from: '1' }, 3: { format: 'obj', url_from: '2' } };
  assert.equal(resolveModelUrl(models[3], models), models[1].url);
  models[1].url_from = '3'; delete models[1].url;
  assert.throws(() => resolveModelUrl(models[3], models), /cyclic/);
  assert.throws(() => resolveModelUrl({ format: 'obj', url_from: 'missing' }, models), /missing/);
  assert.throws(() => resolveModelUrl({ format: 'stl', url_from: '3' }, models), /format/);
  assert.throws(() => resolveModelUrl({ url_from: '__proto__' }, {}), /missing/);
  assert.throws(() => resolveModelUrl({ format: 'obj' }, {}), /embedded/);
});

test('actual OBJ loader shares geometry with independent transforms and materials', async () => {
  const models = { 1: { format: 'obj', url: dataUrl(obj), scale: 1, center: [0, 0, 0] },
    2: { format: 'obj', url_from: '1', scale: 2, center: [1, 0, 0], rotation_deg: [0, 0, 90] } };
  const a = await getModel(models[1], models), b = await getModel(models[2], models);
  assert.notEqual(a, b); assert.equal(meshOf(a).geometry, meshOf(b).geometry);
  assert.notEqual(meshOf(a).material, meshOf(b).material);
  assert.equal(a.scale.x, 1); assert.equal(b.scale.x, 2); assert.ok(Math.abs(b.position.y + 2) < 1e-12);
  assert.equal(a.position.y, 0); meshOf(b).material.opacity = 0.2; assert.equal(meshOf(a).material.opacity, 1);
  const other = await getModel(models[1], { 1: models[1] }); assert.notEqual(meshOf(a).geometry, meshOf(other).geometry);
});

function gltfFixture() {
  const bytes = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  return { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }], buffers: [{ byteLength: bytes.length, uri: dataUrl(bytes) }] };
}

test('actual glTF and GLB loaders keep cached materials independent', async () => {
  const fixture = gltfFixture(), json = Buffer.from(JSON.stringify(fixture));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const glb = Buffer.alloc(20 + padded.length); glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  for (const [format, bytes] of [['gltf', json], ['glb', glb]]) {
    const models = { 1: { format, url: dataUrl(bytes) }, 2: { format, url_from: '1' } };
    const [a, b] = await Promise.all([getModel(models[1], models), getModel(models[2], models)]);
    assert.equal(meshOf(a).geometry, meshOf(b).geometry); assert.notEqual(meshOf(a).material, meshOf(b).material);
    meshOf(b).material.color.setHex(0xff0000); assert.notEqual(meshOf(a).material.color.getHex(), meshOf(b).material.color.getHex());
    const refs = await readFile(join(repo, 'viewer/src/references.js'), 'utf8');
    const code = refs.slice(refs.indexOf('function ghostMaterials'), refs.indexOf('// Wireframe boxes'));
    vm.runInNewContext(`${code}\nghostMaterials(object, '#00ff00', 0.15);`, { THREE, object: b });
    assert.equal(meshOf(b).material.opacity, 0.15); assert.equal(meshOf(a).material.opacity, 1);
    const c = await getModel(models[1], models); assert.equal(meshOf(c).material.opacity, 1);
  }
});

test('articulations use private geometry and do not mutate a cached prototype', async () => {
  const models = { 1: { format: 'obj', url: dataUrl(obj) }, 2: { format: 'obj', url_from: '1', articulations: [{ region: { min: [null, null, null], max: [null, null, null] }, axis: [0, 0, 1], pivot: [0, 0, 0], angle_deg: 90 }] } };
  const a = await getModel(models[1], models), posed = await getModel(models[2], models), b = await getModel(models[1], models);
  assert.notEqual(meshOf(a).geometry, meshOf(posed).geometry); assert.equal(meshOf(a).geometry, meshOf(b).geometry);
  const p = meshOf(posed).geometry.getAttribute('position'); assert.ok(Math.abs(p.getX(1)) < 1e-6); assert.ok(Math.abs(p.getY(1) - 1) < 1e-6);
  assert.equal(meshOf(a).geometry.getAttribute('position').getX(1), 1);
});

test('shared pending failures notify all callers, retry reparses, format is part of cache identity', async () => {
  const original = GLTFLoader.prototype.parse, calls = [];
  GLTFLoader.prototype.parse = function (data, path, ready, fail) { calls.push({ data, ready, fail }); };
  try {
    const models = { 1: { format: 'gltf', url: dataUrl('{}') }, 2: { format: 'gltf', url_from: '1' } };
    const errors = [];
    loadModelObject(models[1], '', () => assert.fail(), (e) => errors.push(e), models);
    loadModelObject(models[2], '', () => assert.fail(), (e) => errors.push(e), models);
    assert.equal(calls.length, 1); calls[0].fail(new Error('broken')); assert.deepEqual(errors, ['broken', 'broken']);
    const retry = getModel(models[1], models); assert.equal(calls.length, 2); calls[1].ready({ scene: new THREE.Group() });
    // The real GLTFLoader calls the callback with a GLTF wrapper, as above.
    await retry;
    const different = getModel({ format: 'glb', url: models[1].url }, models); assert.equal(calls.length, 3);
    calls[2].ready({ scene: new THREE.Group() }); await different;
  } finally { GLTFLoader.prototype.parse = original; }
});

test('actual STL loader shares geometry and invalid ownership reaches failure callback', async () => {
  const stl = 'solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test';
  const models = { 1: { format: 'stl', url: dataUrl(stl) }, 2: { format: 'stl', url_from: '1' } };
  const a = await getModel(models[1], models), b = await getModel(models[2], models);
  assert.equal(meshOf(a).geometry, meshOf(b).geometry); assert.notEqual(meshOf(a).material, meshOf(b).material);
  assert.equal(meshOf(a).geometry.getAttribute('position').count, 3);
  await assert.rejects(getModel({ format: 'stl', url_from: 'missing' }, models), /missing/);
  await assert.rejects(getModel({ format: 'obj', url_from: '1' }, models), /format/);
});

test('skinned models parse afresh, and material arrays are independent on ordinary clones', async () => {
  const original = GLTFLoader.prototype.parse, calls = [];
  GLTFLoader.prototype.parse = function (data, path, ready, fail) { calls.push({ ready, fail }); };
  try {
    const models = { 1: { format: 'gltf', url: dataUrl('skinned') }, 2: { format: 'gltf', url_from: '1' } };
    const pa = getModel(models[1], models), pb = getModel(models[2], models);
    assert.equal(calls.length, 1);
    const skin = () => new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    const sa = skin(), sb = skin();
    calls[0].ready({ scene: sa }); assert.equal(calls.length, 2); calls[1].ready({ scene: sb });
    const [a, b] = await Promise.all([pa, pb]); assert.equal(a, sa); assert.equal(b, sb); assert.notEqual(a.geometry, b.geometry);
    const pc = getModel(models[1], models); assert.equal(calls.length, 3); calls[2].ready({ scene: skin() }); await pc;
    const regular = { format: 'gltf', url: dataUrl('array materials') };
    const pd = getModel(regular, models);
    const m = new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    calls[3].ready({ scene: m }); const d = await pd, e = await getModel(regular, models);
    assert.equal(d.geometry, e.geometry); assert.notEqual(d.material[0], e.material[0]); assert.notEqual(d.material[1], e.material[1]);
  } finally { GLTFLoader.prototype.parse = original; }
});

test('assemblies and reference ghosts resolve shared owners and report failed references', async () => {
  const { createAssemblies } = await load('src/lod.js');
  const { createReferences } = await load('src/references.js');
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 50 }), fillRect() {}, fillText() {}, beginPath() {}, arc() {}, stroke() {} }) }) };
  try {
    const craft = (id) => ({ id, name: `sat${id}`, bounding_radius_m: 1, links: [{ dims_m: [1, 1, 1], r_m: [0, 0, 0], q: [0, 0, 0, 1] }], thrusters: [], facets: [] });
    const scene = { spacecraft: [craft(1), craft(2)] }, f = frames([]);
    const models = { 1: { format: 'obj', url: dataUrl(obj) }, 2: { format: 'obj', url_from: '1', scale: 2 } };
    const lod = createAssemblies(scene, f, { models });
    const refs = createReferences([{ target: 2, name: 'ghost', t_s: [0], pos_km: [0, 0, 0], count: 1, opacity: 0.25 }], scene, f, models);
    const actual = lod.items[1].group.userData.model, ghost = refs.items[0].body.children[0];
    assert.match(lod.modelStatus(1), /obj/); assert.match(refs.items[0].modelStatus, /obj/);
    assert.equal(meshOf(actual).geometry, meshOf(ghost).geometry); assert.equal(ghost.scale.x, 2);
    assert.equal(meshOf(actual).material.opacity, 1); assert.equal(meshOf(ghost).material.opacity, 0.25);
    const invalid = { 1: { format: 'obj', url_from: '2' }, 2: { format: 'obj', url_from: '1' } };
    const failed = createReferences([{ target: 2, t_s: [0], pos_km: [0, 0, 0], count: 1 }], scene, f, invalid);
    assert.match(failed.items[0].modelStatus, /failed:.*cyclic/);
    assert.ok(meshOf(failed.items[0].body));
  } finally { globalThis.document = previousDocument; }
});


test('body-frame rotation preserves metre-scale clearance after Float32 quaternion storage', () => {
  const unit = new THREE.Quaternion(0.31, 0.27, 0.5, 0.75).normalize();
  const stored = new Float32Array(unit.toArray());
  // Planet-scale position and metre-scale clearance, as in the landing panel.
  const radiusKm = 1737.4, clearanceM = 3.7;
  const position = new Float64Array([radiusKm + clearanceM / 1000, 0, 0]);
  const expected = new THREE.Vector3(...position).applyQuaternion(new THREE.Quaternion(...stored).normalize().conjugate());
  for (const scale of [1, -1, 7]) {
    const q = Array.from(stored, x => x * scale), out = new Float64Array(3);
    rotateByConjugate(q, position, out);
    assert.ok(Math.abs((Math.hypot(...out) - radiusKm) * 1000 - clearanceM) < 1e-6);
    assert.ok(Math.hypot(out[0] - expected.x, out[1] - expected.y, out[2] - expected.z) < 1e-9);
  }
  const out = new Float64Array(3);
  rotateByConjugate([0, 0, Math.SQRT1_2, Math.SQRT1_2], [1, 0, 0], out);
  assert.ok(Math.abs(out[0]) < 1e-15 && Math.abs(out[1] + 1) < 1e-15 && Math.abs(out[2]) < 1e-15);
});

// Standalone browser-form and CLI inputs share these same public payload builders.
const standalone = await load('src/standalone.js');
const simpleTrajectory = { time: [0, 2], x: [7000000, 7000020], y: [0, 20], z: [1, 2] };
const referenceColumns = { time: [0, 2], x: [10, 40], y: [20, 50], z: [30, 60], vx: [1, 4], vy: [2, 5], vz: [3, 6], qx: [0, 0], qy: [0, 0], qz: [0, 1], qw: [1, 0] };
const referenceStructured = { time: [0, 2], spacecraft: [{ pos: [[10, 20, 30], [40, 50, 60]], vel: [[1, 2, 3], [4, 5, 6]], q: [[0, 0, 0, 1], [0, 0, 1, 0]] }] };
const csvOf = (doc) => Object.keys(doc).join(',') + '\n' + doc.time.map((_, i) => Object.values(doc).map(values => values[i]).join(',')).join('\n');
const referenceOptions = { name: 'planned path', lengthUnit: 'km', target: 1, color: '#123456', opacity: 0.3 };
const assertReference = (reference) => {
  assert.equal(reference.count, 2);
  assert.deepEqual(Array.from(reference.t_s), [0, 2]);
  assert.deepEqual(Array.from(reference.pos_km), [10, 20, 30, 40, 50, 60]);
  assert.deepEqual(Array.from(reference.vel_kms), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(reference.q), [0, 0, 0, 1, 0, 0, 1, 0]);
};

test('standalone references accept structured JSON, column JSON, CSV and parsed tables', async () => {
  for (const data of [{ json: referenceColumns }, { json: referenceStructured }, { csv: csvOf(referenceColumns) }, { table: standalone.tableFromJson(referenceColumns) }]) {
    const payload = await standalone.buildPayload({ json: simpleTrajectory, references: [{ ...referenceOptions, ...data }] });
    assertReference(payload.references[0]);
    for (const key of ['name', 'target', 'color', 'opacity']) assert.equal(payload.references[0][key], referenceOptions[key]);
    assert.equal(payload.frames.pos_km[0], 7000); // Primary units stay independent.
  }
});

test('the browser form JSON reference reaches the payload builder', async () => {
  const html = await readFile(join(repo, 'viewer/standalone.html'), 'utf8');
  const handler = html.slice(html.indexOf("form.addEventListener('submit'"), html.indexOf("reload.addEventListener"));
  const upload = (name, doc) => ({ name, text: async () => JSON.stringify(doc) });
  const fields = { 'sa-file': { files: [upload('run.json', simpleTrajectory)] }, 'sa-ref': { files: [upload('plan.JSON', referenceStructured)] }, 'sa-model': { files: [] } };
  for (const [key, value] of Object.entries({ planet: 'earth', epoch: '2000-01-01T12:00:00Z', units: 'km', frames: '4000', dims: '1,1,1', mass: '100', title: 'fixture', trail: '1', 'ref-name': 'planned path' })) fields[`sa-${key}`] = { value };
  let submit, received;
  vm.runInNewContext(handler, { form: { addEventListener: (_, fn) => { submit = fn; } }, $: id => fields[id], triple: text => text.split(',').map(Number), open: async spec => { received = spec; }, console, say: message => assert.fail(message) });
  await submit({ preventDefault() {} });
  assert.ok(received.references[0].json);
  const payload = await standalone.buildPayload(received);
  assertReference(payload.references[0]);
});

test('the standalone CLI JSON reference reaches the payload builder', async () => {
  const { spawnSync } = await import('node:child_process');
  const primary = join(scratch, 'run.json'), reference = join(scratch, 'plan.json'), output = join(scratch, 'embedded.html');
  await writeFile(primary, JSON.stringify(simpleTrajectory));
  await writeFile(reference, JSON.stringify(referenceStructured));
  const built = spawnSync('python3', [join(repo, 'viewer/build_standalone.py'), '--textures', 'none', '--data', primary, '--reference', reference, '--reference-name', 'planned path', '--units', 'km', '--out', output], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const html = await readFile(output, 'utf8');
  const match = html.match(/window\.SPACEAGORA_STANDALONE = (.*);/);
  assert.ok(match);
  const payload = await standalone.buildPayload(JSON.parse(match[1]));
  assertReference(payload.references[0]);
});

const zRotation = (angle, scale = 1) => [0, 0, scale * Math.sin(angle / 2), scale * Math.cos(angle / 2)];
const attitudeSample = (time, quaternions) => ({ json: { time, spacecraft: [{ pos: time.map(t => [7000000 + 10*t, 20*t, -30*t]), vel: time.map(() => [10, 20, -30]), q: quaternions }] } });
const outputQuaternion = (payload, frame, sample) => Array.from(payload.frames.q.slice((frame * payload.frames.sats + sample)*4, (frame * payload.frames.sats + sample + 1)*4));
const assertAttitude = (actual, expected) => {
  assert.ok(actual.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...actual) - 1) < 1e-7, `non-unit quaternion: ${actual}`);
  const dot = actual.reduce((sum, value, i) => sum + value * expected[i], 0);
  assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-7, `wrong attitude: ${actual}, expected ${expected}`);
};

test('ensemble attitudes use the same physical rotation across antipodal samples', async () => {
  const grid = [0, 1, 2, 3, 4], q = zRotation(1.2);
  const payload = await standalone.buildEnsemblePayload({ samples: [attitudeSample(grid, grid.map(() => zRotation(0))), attitudeSample([0, 4], [q, q.map(v => -v)])] });
  grid.forEach((_, frame) => assertAttitude(outputQuaternion(payload, frame, 1), q));
});

test('ensemble attitudes follow shortest-arc spherical interpolation on nonuniform grids', async () => {
  const grid = [0, 0.5, 2, 2.5, 3, 4, 7], times = [0, 2, 7], angles = [0, Math.PI/2, Math.PI];
  const payload = await standalone.buildEnsemblePayload({ samples: [attitudeSample(grid, grid.map(() => zRotation(0))), attitudeSample(times, angles.map((angle, i) => zRotation(angle, [2, -3, 4][i])))] });
  grid.forEach((t, frame) => {
    const angle = t <= 2 ? t * Math.PI/4 : Math.PI/2 + (t-2) * Math.PI/10;
    assertAttitude(outputQuaternion(payload, frame, 1), zRotation(angle));
    const p = (frame * 2 + 1) * 3;
    assert.ok(Math.abs(payload.frames.pos_km[p] - (7000 + t*0.01)) < 1e-10);
    assert.ok(Math.abs(payload.frames.vel_kms[p+1] - 0.02) < 1e-8);
  });
});

test('ensemble quaternion gaps and single-row samples do not invent attitudes', async () => {
  const grid = [0, 1, 2, 3, 4], q = zRotation(0.7);
  const payload = await standalone.buildEnsemblePayload({ samples: [attitudeSample(grid, grid.map(() => zRotation(0))), attitudeSample([1, 3], [q, q]), attitudeSample([2], [q]), attitudeSample([0, 2, 4], [q, [0, 0, 0, 0], q])] });
  for (const frame of [0, 4]) assert.ok(outputQuaternion(payload, frame, 1).every(Number.isNaN));
  for (const frame of [1, 2, 3]) assertAttitude(outputQuaternion(payload, frame, 1), q);
  for (const frame of [0, 1, 3, 4]) assert.ok(outputQuaternion(payload, frame, 2).every(Number.isNaN));
  assertAttitude(outputQuaternion(payload, 2, 2), q);
  for (const frame of [1, 2, 3]) assert.ok(outputQuaternion(payload, frame, 3).every(Number.isNaN));
  for (const frame of [0, 4]) assertAttitude(outputQuaternion(payload, frame, 3), q);
});

const { missionHistory, missionSegmentAt, missionTimeMapper, Timeline } = await load('src/timeline.js');
const missionFixture = JSON.parse(await readFile(join(repo, 'test/fixtures/mission_viewer.json'), 'utf8')).mission;

test('actual mission history remains optional and unchanged', () => {
  assert.equal(missionHistory(), null);
  assert.equal(missionHistory(null), null);
  const before = structuredClone(missionFixture);
  assert.equal(missionHistory(missionFixture), missionFixture);
  assert.deepEqual(missionFixture, before);
  assert.equal(missionSegmentAt(null, 0), -1);
  for (const [t, index] of [[-1, -1], [0, 0], [4.999, 0], [5, 1], [10, 1], [10.1, -1], [NaN, -1]]) {
    assert.equal(missionSegmentAt(missionFixture, t), index);
  }
  const clock = new Timeline(0, 10, { speed: 1 });
  clock.seek(5); assert.equal(missionSegmentAt(missionFixture, clock.t), 1);
  clock.seek(4); clock.tick(1); assert.equal(missionSegmentAt(missionFixture, clock.t), 1);
  const early = structuredClone(missionFixture); early.transitions.pop();
  assert.equal(missionHistory(early), early);
  const zero = structuredClone(missionFixture);
  zero.segments[0].end_s = zero.segments[1].start_s = zero.transitions[0].time_s = 0;
  assert.equal(missionHistory(zero), zero);
  assert.equal(missionSegmentAt(zero, 0), 1);
  const empty = { schema: 1, name: 'No executed segments', segments: [], transitions: [] };
  assert.equal(missionHistory(empty), empty); assert.equal(missionSegmentAt(empty, 0), -1);
});

test('invalid mission history is rejected before renderer construction', () => {
  for (const change of [
    m => m.schema = true, m => m.schema = 2, m => m.name = ' ',
    m => m.segments = 'coast', m => m.segments[0].start_s = -1,
    m => m.segments[0].end_s = Infinity, m => m.segments[0].end_s = NaN,
    m => m.segments[0].end_s = true, m => m.segments[1].name = 'coast',
    m => m.segments[1].start_s = 6, m => m.segments[1].end_s = 4,
    m => m.transitions[0].time_s = 4, m => m.transitions[0].from = 'unknown',
    m => m.transitions[0].to = null, m => m.transitions[1].to = 'coast',
    m => delete m.transitions[1].to, m => m.transitions[1].reason = ' ',
    m => m.transitions = [],
  ]) {
    const mission = structuredClone(missionFixture); change(mission);
    assert.throws(() => missionHistory(mission));
  }
});

test('Float32 mission times reconcile only with the actual saved grid', () => {
  const grid = new Float32Array([0.1, 0.7, 0.9]);
  const before = [...grid], map = missionTimeMapper(grid);
  assert.ok(grid[0] > 0.1); assert.ok(grid[1] < 0.7);
  assert.equal(map(0.1), grid[0]); assert.equal(map(0.7), grid[1]);
  assert.equal(map(0.9), grid[2]); assert.equal(map(0.71), 0.71);
  assert.equal(map(0.3), 0.3); // its rounded time is absent from the grid
  assert.equal(map(Infinity), Infinity); assert.equal(map(1e100), 1e100);
  assert.ok(Number.isNaN(map(NaN)));
  assert.deepEqual([...grid], before);
  assert.equal(missionTimeMapper(new Float32Array([0.1, 0.7, 0.7, 0.9]))(0.7), Math.fround(0.7));
  const mission = { schema: 1, name: 'Precision fixture', segments: [
    { name: 'coast', start_s: 0.1, end_s: 0.7 },
    { name: 'maneuver', start_s: 0.7, end_s: 0.9 },
  ], transitions: [{ time_s: 0.7, from: 'coast', to: 'maneuver', reason: 'deadline' }] };
  const original = structuredClone(mission);
  assert.equal(missionSegmentAt(mission, grid[0], map), 0);
  assert.equal(missionSegmentAt(mission, grid[1], map), 1);
  assert.equal(missionSegmentAt(mission, grid[2], map), 1);
  assert.equal(missionSegmentAt(mission, grid[1]), 0); // Float64/strict behavior remains exact
  assert.deepEqual(mission, original);
  const terminal = new Timeline(grid[0], grid[1], { sampleTimes: grid });
  terminal.seek(terminal.missionTime(0.7)); assert.equal(terminal.t, grid[1]);
  assert.ok(terminal.missionTime(0.71) > terminal.tEnd);
  terminal.seek(0.3); assert.equal(terminal.t, 0.3); // ordinary seeking is unchanged
  const strict = missionTimeMapper(new Float64Array(grid));
  assert.equal(strict(0.1), 0.1); assert.equal(strict(0.7), 0.7);
  assert.ok(strict(0.1) < grid[0]); assert.ok(strict(0.7) > grid[1]);
  for (const invalid of [null, [], new Float32Array(), new Float32Array([0.7, 0.1]),
    new Float32Array([0.1, NaN, 0.7]), new Float32Array([0.1, Infinity])]) {
    assert.equal(missionTimeMapper(invalid)(0.7), 0.7);
  }
  const collapsed = structuredClone(mission);
  collapsed.segments.splice(1, 0, { name: 'brief mode', start_s: 0.7, end_s: 0.700000001 });
  collapsed.segments[2].start_s = 0.700000001;
  collapsed.transitions = [
    { time_s: 0.7, from: 'coast', to: 'brief mode', reason: 'deadline' },
    { time_s: 0.700000001, from: 'brief mode', to: 'maneuver', reason: 'duration' },
  ];
  assert.equal(missionHistory(collapsed), collapsed);
  assert.equal(Math.fround(0.7), Math.fround(0.700000001));
  assert.equal(missionSegmentAt(collapsed, grid[1], map), 2);
});
