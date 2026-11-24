import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
process.on("uncaughtException", (error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exit(1);
});

const project = fileURLToPath(new URL("../", import.meta.url));
const { build } = await import(
  pathToFileURL(`${project}node_modules/esbuild/lib/main.js`)
);
const { zipSync, strToU8 } = await import(
  pathToFileURL(
    `${project}node_modules/three/examples/jsm/libs/fflate.module.js`,
  )
);
const source = await readFile(`${project}public/avatar.mjs`, "utf8");
const bundle = await build({
  stdin: {
    contents: `${source}\nexport { parseModel, resourceManager, defaultAvatar };`,
    resolveDir: `${project}public`,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
});
const { parseModel, resourceManager, defaultAvatar, supportsFile } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
globalThis.ProgressEvent = class {
  constructor(type, props) {
    this.type = type;
    Object.assign(this, props);
  }
};
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith("blob:") && !url.startsWith("data:")) {
    networkCalls++;
    throw new Error(`Unexpected network request: ${url}`);
  }
  return originalFetch(input, ...args);
};
const triangleText = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const obj = new File([triangleText], "triangle.obj");
assert.ok((await parseModel([obj], obj)).object.isGroup);
const mtl = new File(["newmtl green\nKd 0.2 0.5 0.3\n"], "triangle.mtl");
const materialObj = new File(
  [`mtllib triangle.mtl\nusemtl green\n${triangleText}`],
  "triangle.obj",
);
assert.equal(
  (await parseModel([materialObj, mtl], materialObj)).object.children[0]
    .material.name,
  "green",
);
await assert.rejects(parseModel([materialObj], materialObj), /MTL/);
const geometryFixtures = [
  [
    "triangle.stl",
    "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n",
  ],
  [
    "triangle.ply",
    "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n",
  ],
  ["triangle.xyz", "0 0 0\n1 0 0\n0 1 0\n"],
  [
    "triangle.pcd",
    "VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 3\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS 3\nDATA ascii\n0 0 0\n1 0 0\n0 1 0\n",
  ],
  [
    "triangle.vtk",
    "# vtk DataFile Version 3.0\nTriangle\nASCII\nDATASET POLYDATA\nPOINTS 3 float\n0 0 0 1 0 0 0 1 0\nPOLYGONS 1 4\n3 0 1 2\n",
  ],
];
for (const [name, content] of geometryFixtures) {
  const file = new File([content], name);
  const model = await parseModel([file], file);
  assert.equal(
    model.object.geometry.attributes.position.count,
    3,
    `${name} retains its geometry`,
  );
}

const data = new Uint8Array(42);
new Float32Array(data.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
new Uint16Array(data.buffer, 36, 3).set([0, 1, 2]);
const gltfJSON = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: [{ uri: "buffers/mesh.bin", byteLength: 42 }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
    { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    },
    { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
  ],
};
const gltf = new File([JSON.stringify(gltfJSON)], "avatar.gltf");
const bin = new File([data], "mesh.bin");
assert.ok(
  (await parseModel([gltf, bin], gltf)).object.isGroup,
  "flat selection resolves unique relative-resource basenames",
);
await assert.rejects(parseModel([gltf], gltf), /缺少模型资源/);
gltfJSON.buffers[0].uri = "https://example.invalid/remote.bin";
const remote = new File([JSON.stringify(gltfJSON)], "remote.gltf");
await assert.rejects(parseModel([remote], remote), /网络|磁盘/);

const manager = resourceManager([obj]);
assert.throws(
  () => manager.manager.resolveURL("file:///etc/passwd"),
  /网络|磁盘/,
);
assert.throws(
  () => manager.manager.resolveURL("https://example.invalid/a.png"),
  /网络|磁盘/,
);
assert.throws(() => manager.manager.resolveURL("missing.png"), /缺少模型资源/);
manager.release();
const usda =
  '#usda 1.0\ndef Xform "Root"\n{\n def Mesh "Triangle"\n {\n int[] faceVertexCounts = [3]\n int[] faceVertexIndices = [0, 1, 2]\n point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n }\n}\n';
const usdz = new File(
  [zipSync({ "model.usda": strToU8(usda) })],
  "avatar.usdz",
);
assert.ok((await parseModel([usdz], usdz)).object.isGroup);
const usdc = new File(
  [zipSync({ "model.usd": strToU8("PXR-USDC") })],
  "binary.usdz",
);
await assert.rejects(parseModel([usdc], usdc), /USDA|USDC/);
const oversizedArchive = zipSync({ "a.model": new Uint8Array([1]) });
for (let offset = 0; offset < oversizedArchive.length - 28; offset++) {
  if (
    new DataView(oversizedArchive.buffer).getUint32(offset, true) === 0x02014b50
  ) {
    new DataView(oversizedArchive.buffer).setUint32(
      offset + 24,
      51 * 1024 * 1024,
      true,
    );
    break;
  }
}
const archive = new File([oversizedArchive], "oversize.3mf");
await assert.rejects(parseModel([archive], archive), /解包后超过/);
for (const shape of ["rabbit", "pebble", "fox", "bird"])
  assert.ok(defaultAvatar({ shape, color: "#b8c8b0" }).children.length > 0);
assert.equal(supportsFile({ name: "Avatar.GLTF" }), true);
assert.equal(supportsFile({ name: "project.blend" }), false);
assert.equal(supportsFile({ name: "project.max" }), false);
assert.equal(networkCalls, 0);
console.log(
  "PASS avatar fixtures: OBJ/MTL, STL, PLY, XYZ, PCD, VTK, glTF+BIN, missing resources, remote blocking, USDA/USDZ, unsupported USDC, archive expansion limit, procedural shapes; zero network requests.",
);
