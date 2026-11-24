import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { TDSLoader } from "three/addons/loaders/TDSLoader.js";
import { AMFLoader } from "three/addons/loaders/AMFLoader.js";
import { VTKLoader } from "three/addons/loaders/VTKLoader.js";
import { PCDLoader } from "three/addons/loaders/PCDLoader.js";
import { XYZLoader } from "three/addons/loaders/XYZLoader.js";
import { MD2Loader } from "three/addons/loaders/MD2Loader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { USDAParser } from "three/addons/loaders/usd/USDAParser.js";
import {
  unzipSync,
  zipSync,
  strFromU8,
} from "three/addons/libs/fflate.module.js";

const FORMATS = new Set([
  "glb",
  "gltf",
  "vrm",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "3ds",
  "amf",
  "vtk",
  "vtp",
  "pcd",
  "xyz",
  "md2",
  "usdz",
]);
export const SUPPORTED_FORMATS =
  "GLB / glTF / VRM · OBJ + MTL · FBX · STL · PLY · DAE · 3MF · 3DS · USDZ（USDA）· AMF · VTK / VTP · PCD · XYZ · MD2";
const extension = (file) =>
  String(typeof file === "string" ? file : file?.name || "")
    .split(".")
    .pop()
    .toLowerCase();
export const supportsFile = (file) => FORMATS.has(extension(file));
const ORIGINAL_FORMATS = new Set([
  "blend",
  "max",
  "ma",
  "mb",
  "step",
  "stp",
  "iges",
  "igs",
  "usd",
  "usda",
  "usdc",
  "3dm",
  "skp",
  "c4d",
  "lwo",
  "lws",
  "abc",
  "u3d",
  "x3d",
  "wrl",
  "zpr",
  "ztl",
  "sldprt",
  "sldasm",
  "prt",
  "asm",
  "jt",
  "catpart",
  "catproduct",
  "dwg",
  "dxf",
  "vox",
  "vdb",
  "nwd",
  "nwc",
  "ifc",
  "rvt",
  "rfa",
  "b3d",
  "ms3d",
  "x",
  "mesh",
  "gltf",
  "glb",
  "vrm",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "3ds",
  "amf",
  "vtk",
  "vtp",
  "pcd",
  "xyz",
  "md2",
  "usdz",
]);
export const isKnown3DFile = (file) => ORIGINAL_FORMATS.has(extension(file));
const MAX_BYTES = 50 * 1024 * 1024;
const DB_NAME = "lingdang-avatar-v1";
const STORE = "models";
const SLOT = "my-agent";
const VIRTUAL = "local-asset:///";

function cleanPath(value) {
  let text = String(value || "")
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    /* Preserve literal percent signs in filenames. */
  }
  const parts = [];
  for (const part of text.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

const filePath = (file) =>
  cleanPath(file.webkitRelativePath || file.relativePath || file.name);
const virtualURL = (path) =>
  VIRTUAL + path.split("/").map(encodeURIComponent).join("/");
const packedFiles = (files) =>
  files.map((file) => ({
    name: file.name,
    path: filePath(file),
    type: file.type,
    lastModified: file.lastModified || 0,
    blob: file,
  }));
const unpackedFiles = (items) =>
  items.map((item) => {
    const file = new File([item.blob], item.name, {
      type: item.type,
      lastModified: item.lastModified,
    });
    Object.defineProperty(file, "relativePath", { value: item.path });
    return file;
  });
function selectedFiles(input) {
  const files = [...input];
  if (!files.length)
    throw new Error("请选择一个模型文件，也可以同时选择它的材质和贴图。");
  if (files.length > 256)
    throw new Error("一次最多选择 256 个文件，请将大型资源打包为 GLB。");
  if (files.some((file) => !(file instanceof Blob) || !file.name))
    throw new Error("请选择有效的本地文件。");
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES)
    throw new Error("模型与配套资源总大小不能超过 50 MB。");
  const paths = files.map(filePath);
  if (paths.some((path) => !path) || new Set(paths).size !== paths.length)
    throw new Error("所选文件存在重复或无效路径。");
  return files;
}

async function withStore(mode, action) {
  if (!globalThis.indexedDB)
    throw new Error(
      "浏览器不支持本地模型存储，请使用支持 IndexedDB 的浏览器。",
    );
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "slot" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("无法打开模型存储，请检查浏览器的存储权限。"));
    request.onblocked = () =>
      reject(new Error("模型存储正在被其他页面更新，请关闭旧页面后重试。"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let request;
      try {
        request = action(transaction.objectStore(STORE));
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = transaction.onabort = () =>
        reject(
          new Error(
            "模型未能保存到浏览器，可能是存储空间不足。请释放空间后重试。",
          ),
        );
    });
  } finally {
    db.close();
  }
}

function releaseObject(object) {
  if (!object) return;
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  object.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture) textures.add(value);
    }
    if (node.isSkinnedMesh) node.skeleton?.dispose();
  });
  textures.forEach((texture) => {
    texture.dispose();
    texture.source?.data?.close?.();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  object.removeFromParent();
}

function appearanceValue(value) {
  const input = typeof value === "string" ? { shape: value } : value || {};
  const shape = ["pebble", "rabbit", "fox", "bird"].includes(input.shape)
    ? input.shape
    : "rabbit";
  const color =
    typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color)
      ? input.color
      : "#b8c8b0";
  return { shape, color };
}

function defaultAvatar(appearance) {
  const { shape, color } = appearance;
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.86,
    metalness: 0,
    flatShading: true,
  });
  const cream = new THREE.MeshStandardMaterial({
    color: "#f4efe3",
    roughness: 0.95,
    flatShading: true,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#26362f",
    roughness: 0.62,
  });
  const inner = new THREE.MeshStandardMaterial({
    color: "#d8b9ae",
    roughness: 0.95,
    flatShading: true,
  });
  const part = (geometry, material, position, scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  if (shape === "pebble") {
    const body = part(
      new THREE.IcosahedronGeometry(1, 2),
      coat,
      [0, -0.03, 0],
      [1.03, 1.12, 0.87],
    );
    body.rotation.z = -0.08;
    part(
      new THREE.IcosahedronGeometry(0.38, 1),
      cream,
      [0.58, 0.82, -0.1],
      [0.65, 1, 0.45],
    ).rotation.z = -0.5;
    part(new THREE.SphereGeometry(0.048, 12, 8), dark, [-0.25, 0.12, 0.78]);
    part(new THREE.SphereGeometry(0.048, 12, 8), dark, [0.25, 0.12, 0.78]);
  } else if (shape === "bird") {
    part(
      new THREE.IcosahedronGeometry(1, 2),
      coat,
      [0, -0.05, 0],
      [0.85, 1.08, 0.81],
    );
    part(
      new THREE.IcosahedronGeometry(0.7, 2),
      cream,
      [0, -0.15, 0.42],
      [0.75, 1, 0.65],
    );
    part(
      new THREE.ConeGeometry(0.14, 0.3, 4),
      inner,
      [0, 0.36, 0.8],
    ).rotation.x = Math.PI / 2;
    [-1, 1].forEach((sign) => {
      part(new THREE.SphereGeometry(0.052, 12, 8), dark, [
        sign * 0.27,
        0.51,
        0.67,
      ]);
      part(
        new THREE.IcosahedronGeometry(0.45, 1),
        coat,
        [sign * 0.71, -0.13, -0.02],
        [0.42, 1.22, 0.65],
      ).rotation.z = sign * 0.28;
    });
  } else {
    part(
      new THREE.IcosahedronGeometry(1, 2),
      coat,
      [0, -0.24, 0],
      [0.79, 1.02, 0.67],
    );
    part(
      new THREE.IcosahedronGeometry(0.79, 2),
      coat,
      [0, 0.65, 0.09],
      [1, 0.91, 0.83],
    );
    part(
      new THREE.IcosahedronGeometry(0.54, 2),
      cream,
      [0, -0.3, 0.47],
      [0.83, 1.1, 0.4],
    );
    [-1, 1].forEach((sign) => {
      if (shape === "rabbit") {
        part(
          new THREE.IcosahedronGeometry(0.35, 2),
          coat,
          [sign * 0.37, 1.47, 0.02],
          [0.59, 1.75, 0.59],
        ).rotation.z = -sign * 0.14;
        part(
          new THREE.IcosahedronGeometry(0.24, 1),
          inner,
          [sign * 0.38, 1.54, 0.17],
          [0.45, 1.6, 0.16],
        ).rotation.z = -sign * 0.14;
      } else {
        part(new THREE.ConeGeometry(0.36, 0.75, 3), coat, [
          sign * 0.48,
          1.23,
          0,
        ]).rotation.z = -sign * 0.2;
        part(new THREE.ConeGeometry(0.19, 0.39, 3), inner, [
          sign * 0.48,
          1.26,
          0.15,
        ]).rotation.z = -sign * 0.2;
      }
      part(new THREE.SphereGeometry(0.052, 12, 8), dark, [
        sign * 0.24,
        0.72,
        0.66,
      ]);
      part(
        new THREE.IcosahedronGeometry(0.28, 1),
        coat,
        [sign * 0.49, -1.03, 0.27],
        [1.12, 0.62, 1.2],
      );
      part(
        new THREE.IcosahedronGeometry(0.24, 1),
        cream,
        [sign * 0.18, 0.44, 0.66],
        [1, 0.65, 0.6],
      );
    });
    part(
      new THREE.IcosahedronGeometry(0.095, 1),
      dark,
      [0, 0.53, 0.81],
      [1, 0.7, 0.7],
    );
    part(new THREE.IcosahedronGeometry(0.25, 1), cream, [0.63, -0.66, -0.44]);
  }
  return group;
}

function resourceManager(files) {
  const urls = new Map(),
    basenames = new Map(),
    failures = [],
    loadFailures = [];
  const paths = files.map(filePath);
  if (paths.some((path) => !path) || new Set(paths).size !== paths.length)
    throw new Error("所选文件存在重复或无效路径。请选择同一模型的完整文件。");
  for (const file of files) {
    const path = filePath(file);
    const url = URL.createObjectURL(file);
    urls.set(path, url);
    const name = path.split("/").pop();
    basenames.set(name, basenames.has(name) ? null : url);
  }
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga(?:[?#].*)?$/i, new TGALoader(manager));
  manager.addHandler(/\.dds(?:[?#].*)?$/i, new DDSLoader(manager));
  manager.setURLModifier((value) => {
    // Embedded data and loader-created blob URLs never make network requests.
    if (/^(?:data:|blob:)/i.test(value)) return value;
    if (/^(?:https?:|ftp:|file:|\/\/)/i.test(value)) {
      const message =
        "模型引用了网络或磁盘资源。请把引用的文件与模型一同选择；预览不会自动联网下载。";
      failures.push(message);
      throw new Error(message);
    }
    const path = cleanPath(
      value.startsWith(VIRTUAL) ? value.slice(VIRTUAL.length) : value,
    );
    const url = urls.get(path) || basenames.get(path.split("/").pop());
    if (url) return url;
    const message = `缺少模型资源「${path}」。请同时选择 .bin、.mtl 和贴图文件，或使用打包的 GLB。`;
    failures.push(message);
    throw new Error(message);
  });
  manager.onError = (value) =>
    loadFailures.push(
      `无法读取模型资源：${String(value).startsWith("blob:") ? "所选文件" : value}`,
    );
  return {
    manager,
    failures,
    loadFailures,
    release() {
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}

function geometryObject(geometry, points = false) {
  if (points) {
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#a6bfae",
        size: 0.018,
        vertexColors: Boolean(geometry.attributes.color),
      }),
    );
  }
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: geometry.attributes.color ? "#ffffff" : "#bccbb6",
      vertexColors: Boolean(geometry.attributes.color),
      roughness: 0.75,
      metalness: 0.03,
      side: THREE.DoubleSide,
    }),
  );
}

// The stock USD loader creates its texture loader without the supplied manager.
// Parse USDA packages with an explicit asset table instead: missing references
// throw before TextureLoader sees them, so imports cannot fall back to the web.
async function parseUSDZ(file) {
  let count = 0,
    expanded = 0,
    object;
  const urls = [];
  try {
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter(entry) {
        count++;
        expanded += entry.originalSize;
        if (count > 256 || expanded > MAX_BYTES)
          throw new Error(
            "USDZ 解包后超过 50 MB 或 256 个文件，请简化模型后重试。",
          );
        if (entry.name.split(/[\\/]/).includes(".."))
          throw new Error("USDZ 包含无效的资源路径。");
        return true;
      },
    });
    const names = Object.keys(zip).filter((name) => !name.endsWith("/"));
    const main = names[0];
    if (
      !main ||
      !/\.(usd|usda)$/i.test(main) ||
      new TextDecoder().decode(zip[main].subarray(0, 8)) === "PXR-USDC"
    ) {
      throw new Error(
        "目前可预览内部使用 USDA 文本的 USDZ。USDC 二进制层请转换为 GLB 或 USDA 格式。",
      );
    }
    const parser = new USDAParser(),
      table = Object.create(null);
    for (const name of names) {
      const path = cleanPath(name);
      if (/\.(png|jpe?g|webp|gif)$/i.test(name)) {
        const mime = /\.png$/i.test(name)
          ? "image/png"
          : /\.webp$/i.test(name)
            ? "image/webp"
            : /\.gif$/i.test(name)
              ? "image/gif"
              : "image/jpeg";
        table[path] = URL.createObjectURL(
          new Blob([zip[name]], { type: mime }),
        );
        urls.push(table[path]);
      } else if (/\.(usd|usda)$/i.test(name)) {
        if (new TextDecoder().decode(zip[name].subarray(0, 8)) === "PXR-USDC")
          throw new Error("USDZ 包含暂不支持的 USDC 二进制层，请导出 GLB。");
        table[path] = parser.parseText(strFromU8(zip[name]));
      }
    }
    const assets = new Proxy(table, {
      get(target, key) {
        if (typeof key !== "string") return target[key];
        if (/^(?:https?:|ftp:|file:|\/\/)/i.test(key))
          throw new Error("USDZ 只能引用包内资源，不能自动下载远端资源。");
        const path = cleanPath(key);
        const resolved =
          target[path] ||
          target[
            cleanPath(main.split("/").slice(0, -1).join("/") + "/" + path)
          ];
        if (!resolved)
          throw new Error(`USDZ 缺少包内资源「${path}」，请重新导出完整模型。`);
        return resolved;
      },
    });
    object = parser.parse(strFromU8(zip[main]), assets);
    const textures = new Set();
    object.traverse((node) => {
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        if (material)
          for (const value of Object.values(material))
            if (value?.isTexture) textures.add(value);
      }
    });
    const until = performance.now() + 10_000;
    while ([...textures].some((texture) => !texture.image?.complete)) {
      if (performance.now() > until)
        throw new Error(
          "USDZ 内部贴图无法解码，请使用 PNG / JPEG 贴图后重新导出。",
        );
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return object;
  } catch (error) {
    releaseObject(object);
    throw error;
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

async function parseModel(files, main) {
  if (extension(main) === "usdz")
    return { object: await parseUSDZ(main), animations: [] };
  // AMF and 3MF can contain ZIP packages. Read the directory without inflating
  // entries first, so a small uploaded archive cannot allocate unbounded memory.
  if (["3mf", "amf"].includes(extension(main))) {
    const bytes = new Uint8Array(await main.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      let count = 0,
        expanded = 0;
      unzipSync(bytes, {
        filter(entry) {
          count++;
          expanded += entry.originalSize;
          if (count > 256 || expanded > MAX_BYTES)
            throw new Error(
              "模型解包后超过 50 MB 或 256 个文件，请简化模型后重试。",
            );
          return false;
        },
      });
    }
  }
  const resources = resourceManager(files);
  const { manager, failures, loadFailures } = resources;
  const url = virtualURL(filePath(main));
  const format = extension(main);
  let object,
    animations = [];
  let finished,
    ended = false;
  const ready = new Promise((resolve) => {
    finished = resolve;
  });
  manager.onLoad = finished;
  manager.itemStart("avatar-import");
  try {
    let result;
    switch (format) {
      case "gltf":
      case "glb":
      case "vrm": {
        result = await new GLTFLoader(manager)
          .setMeshoptDecoder(MeshoptDecoder)
          .loadAsync(url);
        object = result.scene || result.scenes?.[0];
        animations = result.animations || [];
        break;
      }
      case "obj": {
        const loader = new OBJLoader(manager);
        const mtl =
          files.find(
            (file) =>
              extension(file) === "mtl" &&
              file.name.replace(/\.mtl$/i, "") ===
                main.name.replace(/\.obj$/i, ""),
          ) || files.find((file) => extension(file) === "mtl");
        if (mtl) {
          const materials = await new MTLLoader(manager).loadAsync(
            virtualURL(filePath(mtl)),
          );
          materials.preload();
          loader.setMaterials(materials);
        } else {
          const text = await main.text();
          if (/^\s*mtllib\s+\S+/im.test(text))
            throw new Error(
              "OBJ 引用了 MTL 材质文件。请将对应的 .mtl 和贴图一同选择。",
            );
        }
        object = await loader.loadAsync(url);
        break;
      }
      case "fbx":
        object = await new FBXLoader(manager).loadAsync(url);
        animations = object.animations || [];
        break;
      case "dae":
        result = await new ColladaLoader(manager).loadAsync(url);
        object = result.scene;
        animations = result.animations || object.animations || [];
        break;
      case "3mf":
        object = await new ThreeMFLoader(manager).loadAsync(url);
        break;
      case "3ds":
        object = await new TDSLoader(manager).loadAsync(url);
        break;
      case "amf":
        object = await new AMFLoader(manager).loadAsync(url);
        break;
      case "pcd":
        object = await new PCDLoader(manager).loadAsync(url);
        break;
      case "stl":
        object = geometryObject(await new STLLoader(manager).loadAsync(url));
        break;
      case "ply": {
        const geometry = await new PLYLoader(manager).loadAsync(url);
        object = geometryObject(
          geometry,
          !geometry.index && !geometry.attributes.normal,
        );
        break;
      }
      case "vtk":
      case "vtp": {
        let bytes = new Uint8Array(await main.arrayBuffer());
        // VTKLoader inspects a fixed 250-byte header. Valid tiny ASCII meshes
        // need harmless trailing whitespace before calling its parser.
        if (bytes.length < 250 || bytes.at(-1) !== 10) {
          const padded = new Uint8Array(Math.max(250, bytes.length + 1));
          padded.fill(10);
          padded.set(bytes);
          bytes = padded;
        }
        object = geometryObject(new VTKLoader(manager).parse(bytes.buffer));
        break;
      }
      case "xyz":
        object = geometryObject(
          await new XYZLoader(manager).loadAsync(url),
          true,
        );
        break;
      case "md2": {
        const geometry = await new MD2Loader(manager).loadAsync(url);
        object = geometryObject(geometry);
        animations = geometry.animations || [];
        break;
      }
      default:
        throw new Error(
          "此格式不能直接预览。请从原软件导出 GLB、glTF、OBJ 或 FBX。",
        );
    }
    manager.itemEnd("avatar-import");
    ended = true;
    await ready;
    if (failures.length) throw new Error(failures[0]);
    if (loadFailures.length) throw new Error(loadFailures[0]);
    if (!object?.isObject3D) throw new Error("文件中没有可显示的三维对象。");
    return { object, animations };
  } catch (error) {
    if (!ended) manager.itemEnd("avatar-import");
    manager.abort?.();
    releaseObject(object);
    if (failures.length) throw new Error(failures[0]);
    if (/draco|ktx2|basis/i.test(error.message || ""))
      throw new Error(
        "这个模型使用了 Draco 或 KTX2 压缩。请导出未压缩的 GLB，或将贴图转换为 PNG / JPEG 后重试。",
      );
    throw new Error(
      error.message || "模型无法解析，请检查文件格式及配套资源。",
    );
  } finally {
    resources.release();
  }
}

/** A local-only 3D viewer. onLoaded receives metadata, never source files. */
export async function mountAvatar(
  container,
  { appearance, onLoaded = () => {}, onError = () => {} } = {},
) {
  if (!(container instanceof HTMLElement))
    throw new Error("需要一个用于显示三维形象的容器。");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    throw new Error(
      "当前浏览器无法创建 3D 画布，请启用 WebGL 或换用现代浏览器。",
    );
  }
  renderer.setClearColor(0xffffff, 0);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const canvas = renderer.domElement;
  canvas.style.cssText =
    "display:block;width:100%;height:100%;touch-action:none;outline:none";
  canvas.setAttribute(
    "aria-label",
    "三维 Agent 形象；拖动旋转，滚轮或双指缩放",
  );
  canvas.tabIndex = 0;
  container.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.minDistance = 2.8;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.87;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x849681, 2.3));
  const key = new THREE.DirectionalLight(0xfff7e9, 3.1);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe3edf6, 1.6);
  fill.position.set(-4, 2, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 2);
  rim.position.set(1, 4, -4);
  scene.add(rim);
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const context = shadowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(30,45,35,.23)");
  gradient.addColorStop(0.5, "rgba(30,45,35,.1)");
  gradient.addColorStop(1, "rgba(30,45,35,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.265;
  scene.add(shadow);
  let current,
    mixer,
    clips = [],
    metadata,
    appearanceState = appearanceValue(appearance);
  let originalFiles = [],
    originalInfo = null;
  let disposed = false,
    visible = true,
    contextLost = false,
    frame = 0,
    lastTime = 0,
    revision = 0;
  const report = (error) => {
    try {
      onError(error instanceof Error ? error : new Error(String(error)));
    } catch {
      /* Host callback cannot break cleanup. */
    }
  };
  const notify = () => {
    try {
      onLoaded({ ...metadata });
    } catch (error) {
      console.warn("Avatar callback:", error);
    }
  };

  function invalidate() {
    if (
      !disposed &&
      !contextLost &&
      visible &&
      document.visibilityState !== "hidden" &&
      !frame
    )
      frame = requestAnimationFrame(renderFrame);
  }
  function renderFrame(time) {
    frame = 0;
    if (
      disposed ||
      contextLost ||
      !visible ||
      document.visibilityState === "hidden"
    ) {
      lastTime = 0;
      return;
    }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.06) : 0;
    lastTime = time;
    if (mixer && clips.length) mixer.update(delta);
    controls.update();
    renderer.render(scene, camera);
    if (mixer && clips.length) invalidate();
  }
  controls.addEventListener("change", invalidate);
  function fit() {
    const box = new THREE.Box3().setFromObject(current);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const distance = Math.max(
      3.4,
      (sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.12,
    );
    controls.target.copy(sphere.center);
    camera.position
      .copy(sphere.center)
      .add(
        new THREE.Vector3(1.1, 0.6, 2.8).normalize().multiplyScalar(distance),
      );
    controls.minDistance = Math.max(1.8, sphere.radius * 1.4);
    controls.maxDistance = Math.max(16, distance * 2);
    controls.update();
    invalidate();
  }
  function replace(object, animations, info) {
    const box = new THREE.Box3().setFromObject(object, true);
    const size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (
      box.isEmpty() ||
      ![...size, ...center].every(Number.isFinite) ||
      max <= 0
    ) {
      releaseObject(object);
      throw new Error("模型尺寸无效或没有可显示的几何体。");
    }
    mixer?.stopAllAction();
    if (current && mixer) mixer.uncacheRoot(current.children[0]);
    releaseObject(current);
    const normalized = new THREE.Group();
    const scale = 2.6 / max;
    normalized.add(object);
    normalized.scale.setScalar(scale);
    normalized.position.set(
      -center.x * scale,
      -box.min.y * scale - 1.25,
      -center.z * scale,
    );
    current = normalized;
    scene.add(current);
    clips = animations || [];
    mixer = clips.length ? new THREE.AnimationMixer(object) : null;
    // Starting every take at once causes conflicting skeleton transforms. Play the
    // first authored clip; every animation remains available in the loaded model.
    if (clips.length) mixer.clipAction(clips[0]).play();
    metadata = info;
    lastTime = 0;
    fit();
  }
  function showDefault() {
    replace(defaultAvatar(appearanceState), [], {
      name: "我的 Agent",
      format: "procedural",
      uploaded: false,
    });
  }
  const resize = () => {
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (current) fit();
    else invalidate();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersection =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (!visible && frame) {
            cancelAnimationFrame(frame);
            frame = 0;
            lastTime = 0;
          } else invalidate();
        })
      : null;
  intersection?.observe(container);
  const visibilityChange = () => {
    if (document.visibilityState === "hidden" && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else invalidate();
  };
  const lost = (event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const restored = () => {
    contextLost = false;
    lastTime = 0;
    resize();
  };
  document.addEventListener("visibilitychange", visibilityChange);
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  showDefault();
  resize();

  async function importFiles(
    input,
    { persist = true, mainPath, preserveOriginal = false } = {},
  ) {
    if (disposed) throw new Error("三维预览已经关闭。");
    const ticket = ++revision;
    let parsed;
    try {
      const files = selectedFiles(input);
      if (preserveOriginal && !originalFiles.length)
        throw new Error("请先保存 3D 原件，再为它添加可预览的通用格式。");
      if (preserveOriginal && files.length + originalFiles.length > 256)
        throw new Error("原件与预览资源合计不能超过 256 个文件。");
      if (
        preserveOriginal &&
        [...files, ...originalFiles].reduce((sum, file) => sum + file.size, 0) >
          MAX_BYTES
      )
        throw new Error("原件与预览资源合计不能超过 50 MB。");
      const candidates = files.filter(supportsFile);
      if (!candidates.length)
        throw new Error(
          "这个格式当前无法直接预览。可以选择“保存 3D 原件”保留文件，或从原软件导出 GLB / glTF / OBJ / FBX 后预览。",
        );
      const main =
        candidates.find((file) => filePath(file) === mainPath) ||
        candidates.find((file) =>
          ["glb", "gltf", "vrm"].includes(extension(file)),
        ) ||
        candidates[0];
      if (candidates.length > 1 && !mainPath)
        throw new Error(
          "一次请选择一个主模型及其配套资源。当前选择中包含多个模型文件。",
        );
      parsed = await parseModel(files, main);
      if (disposed || ticket !== revision) {
        releaseObject(parsed.object);
        return null;
      }
      const baseInfo = preserveOriginal
        ? originalInfo
        : {
            name: main.name,
            format: extension(main).toUpperCase(),
            uploaded: true,
          };
      const info = {
        ...baseInfo,
        previewable: true,
        ...(preserveOriginal
          ? {
              previewName: main.name,
              previewFormat: extension(main).toUpperCase(),
            }
          : {}),
      };
      // Validate dimensions before touching the saved model or current scene.
      const box = new THREE.Box3().setFromObject(parsed.object, true);
      if (
        box.isEmpty() ||
        ![...box.min, ...box.max].every(Number.isFinite) ||
        box.getSize(new THREE.Vector3()).length() <= 0
      )
        throw new Error("模型没有有效的几何体。");
      if (persist)
        await withStore("readwrite", (store) =>
          store.put({
            slot: SLOT,
            metadata: info,
            mainPath: filePath(main),
            mode: "preview",
            files: packedFiles(preserveOriginal ? originalFiles : files),
            previewFiles: preserveOriginal ? packedFiles(files) : undefined,
          }),
        );
      if (disposed || ticket !== revision) {
        releaseObject(parsed.object);
        return null;
      }
      replace(parsed.object, parsed.animations, info);
      parsed = null;
      if (!preserveOriginal) {
        originalFiles = files;
        originalInfo = baseInfo;
      }
      notify();
      return { ...metadata };
    } catch (error) {
      if (parsed) releaseObject(parsed.object);
      if (!disposed && ticket === revision) report(error);
      throw error;
    }
  }
  const api = {
    loadFiles: (files) => importFiles(files),
    loadPreviewFiles: (files) => importFiles(files, { preserveOriginal: true }),
    async saveOriginalFiles(input) {
      if (disposed) throw new Error("三维预览已经关闭。");
      const ticket = ++revision;
      try {
        const files = selectedFiles(input);
        // This is an explicit archival action, not a parser. Unknown extensions
        // and extensionless proprietary models are retained without executing them.
        const nonModels =
          /\.(?:txt|md|markdown|csv|tsv|pdf|docx?|pptx?|xlsx?|html?|[cm]?js|tsx?|css|py|sh|exe|dmg|png|jpe?g|gif|webp|bmp|tiff?|tga|dds)$/i;
        const main =
          files.find(isKnown3DFile) ||
          files.find((file) => !nonModels.test(file.name));
        if (!main)
          throw new Error(
            "当前选择只有文档、图片或程序文件。请选择你的 3D 原始模型及配套资源。",
          );
        const info = {
          name: main.name,
          format: main.name.includes(".")
            ? extension(main).toUpperCase()
            : "原始文件",
          uploaded: true,
          previewable: false,
        };
        await withStore("readwrite", (store) =>
          store.put({
            slot: SLOT,
            metadata: info,
            mode: "original",
            files: packedFiles(files),
          }),
        );
        if (disposed || ticket !== revision) return null;
        originalFiles = files;
        originalInfo = { name: info.name, format: info.format, uploaded: true };
        replace(defaultAvatar(appearanceState), [], info);
        notify();
        return { ...metadata };
      } catch (error) {
        if (!disposed && ticket === revision) report(error);
        throw error;
      }
    },
    getOriginalFiles: () => originalFiles.slice(),
    async downloadOriginal() {
      if (!originalFiles.length) throw new Error("当前没有已保存的 3D 原件。");
      let blob, filename;
      if (originalFiles.length === 1) {
        blob = originalFiles[0];
        filename = originalFiles[0].name;
      } else {
        const archive = Object.create(null);
        for (const file of originalFiles)
          archive[filePath(file)] = new Uint8Array(await file.arrayBuffer());
        blob = new Blob([zipSync(archive, { level: 0 })], {
          type: "application/zip",
        });
        filename = `${(originalInfo?.name || "agent").replace(/\.[^.]+$/, "")}-original.zip`;
      }
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { name: filename, count: originalFiles.length };
    },
    setAppearance(value) {
      appearanceState = appearanceValue({
        ...appearanceState,
        ...(typeof value === "string" ? { shape: value } : value),
      });
      if (!disposed && (!metadata?.uploaded || metadata.previewable === false))
        replace(defaultAvatar(appearanceState), [], metadata);
    },
    getMetadata: () => ({ ...metadata }),
    async clearUpload() {
      revision++;
      try {
        await withStore("readwrite", (store) => store.delete(SLOT));
        if (!disposed) {
          originalFiles = [];
          originalInfo = null;
          showDefault();
          notify();
        }
      } catch (error) {
        report(error);
        throw error;
      }
      return { ...metadata };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection?.disconnect();
      controls.dispose();
      document.removeEventListener("visibilitychange", visibilityChange);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      mixer?.stopAllAction();
      releaseObject(current);
      releaseObject(shadow);
      originalFiles = [];
      originalInfo = null;
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  try {
    const saved = await withStore("readonly", (store) => store.get(SLOT));
    if (saved?.files?.length && !disposed && revision === 0) {
      const files = unpackedFiles(saved.files);
      originalFiles = files;
      originalInfo = {
        name: saved.metadata?.name || files[0].name,
        format: saved.metadata?.format || extension(files[0]).toUpperCase(),
        uploaded: true,
      };
      if (saved.mode === "original" || saved.metadata?.previewable === false) {
        replace(defaultAvatar(appearanceState), [], {
          ...originalInfo,
          previewable: false,
        });
        notify();
      } else
        await importFiles(
          saved.previewFiles?.length
            ? unpackedFiles(saved.previewFiles)
            : files,
          {
            persist: false,
            mainPath: saved.mainPath,
            preserveOriginal: Boolean(saved.previewFiles?.length),
          },
        );
    }
  } catch (error) {
    // Restoration is optional: an unreadable upload must not remove the default.
    if (!disposed && revision === 0) report(error);
  }
  return api;
}
