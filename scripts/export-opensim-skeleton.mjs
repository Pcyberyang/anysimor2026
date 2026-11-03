import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_MODEL_PATH = path.join(
  projectRoot,
  "public",
  "models",
  "opensim",
  "source",
  "SpineModel_mass60marktoPlugInGait_PY2026_vascap_anklefootX_1011PSneck_mir5_fullarm_R2L_v11_anybody_subtalar.osim",
);

const MODEL_PATH = path.resolve(
  process.env.OPENSIM_MODEL_PATH ?? DEFAULT_MODEL_PATH,
);
const GEOMETRY_ROOT = path.resolve(
  process.env.OPENSIM_GEOMETRY_ROOT ??
    path.join(path.dirname(MODEL_PATH), "geometry"),
);
const OUTPUT_DATA_DIR = path.resolve(
  process.env.OPENSIM_DATA_OUTPUT_DIR ??
    path.join(projectRoot, "public", "data", "opensim"),
);
const OUTPUT_MODEL_DIR = path.resolve(
  process.env.OPENSIM_MODEL_OUTPUT_DIR ??
    path.join(projectRoot, "public", "models", "opensim"),
);
const OUTPUT_GEOMETRY_DIR = path.join(OUTPUT_MODEL_DIR, "geometry");
const OUTPUT_SOURCE_DIR = path.join(OUTPUT_MODEL_DIR, "source");
const MANIFEST_OUTPUT = path.join(
  OUTPUT_DATA_DIR,
  "skeleton-manifest.json",
);
const SCALING_OUTPUT = path.join(
  OUTPUT_DATA_DIR,
  "scaling-template.json",
);
const PROFILE_OUTPUT = path.join(OUTPUT_DATA_DIR, "model-profile.json");
const REPORT_OUTPUT = path.join(OUTPUT_DATA_DIR, "export-report.json");

function projectRelative(filePath) {
  return path
    .relative(projectRoot, filePath)
    .replaceAll("\\", "/");
}

const BODY_LABELS = {
  pelvis: "骨盆",
  sacrum: "骶骨",
  Abdomen: "腹部",
  head: "头颅",
  sternum: "胸骨",
  clavicle_R: "右锁骨",
  clavicle_L: "左锁骨",
  scapula_R: "右肩胛骨",
  scapula_L: "左肩胛骨",
  humerus_R: "右肱骨",
  humerus_L: "左肱骨",
  ulna_R: "右尺骨",
  ulna_L: "左尺骨",
  radius_R: "右桡骨",
  radius_L: "左桡骨",
  hand_R: "右手",
  hand_L: "左手",
  femur_r: "右股骨",
  femur_l: "左股骨",
  tibia_r: "右胫骨",
  tibia_l: "左胫骨",
  talus_r: "右距骨",
  talus_l: "左距骨",
  calcn_r: "右跟骨",
  calcn_l: "左跟骨",
  toes_r: "右足趾",
  toes_l: "左足趾",
  patella_r: "右髌骨",
  patella_l: "左髌骨",
};

function decodeXml(value) {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hexadecimal = entity[1]?.toLowerCase() === "x";
        const number = Number.parseInt(
          entity.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        return Number.isFinite(number) ? String.fromCodePoint(number) : match;
      }
      return {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      }[entity.toLowerCase()];
    },
  );
}

// Small purpose-built XML tree. It keeps all source attributes and text while
// avoiding a runtime dependency on a platform-specific XML parser.
function parseXml(source) {
  const document = {
    type: "document",
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };
  const stack = [document];
  let cursor = 0;

  function appendText(value) {
    if (!value) {
      return;
    }
    stack.at(-1).text += decodeXml(value);
  }

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) {
      appendText(source.slice(cursor));
      break;
    }

    appendText(source.slice(cursor, tagStart));

    if (source.startsWith("<!--", tagStart)) {
      const end = source.indexOf("-->", tagStart + 4);
      if (end < 0) {
        throw new Error("XML 注释未闭合。");
      }
      cursor = end + 3;
      continue;
    }

    if (source.startsWith("<?", tagStart)) {
      const end = source.indexOf("?>", tagStart + 2);
      if (end < 0) {
        throw new Error("XML 声明未闭合。");
      }
      cursor = end + 2;
      continue;
    }

    if (source.startsWith("<![CDATA[", tagStart)) {
      const end = source.indexOf("]]>", tagStart + 9);
      if (end < 0) {
        throw new Error("XML CDATA 未闭合。");
      }
      appendText(source.slice(tagStart + 9, end));
      cursor = end + 3;
      continue;
    }

    const tagEnd = source.indexOf(">", tagStart + 1);
    if (tagEnd < 0) {
      throw new Error("XML 标签未闭合。");
    }

    let rawTag = source.slice(tagStart + 1, tagEnd).trim();
    cursor = tagEnd + 1;

    if (!rawTag || rawTag.startsWith("!")) {
      continue;
    }

    if (rawTag.startsWith("/")) {
      const closingName = rawTag.slice(1).trim();
      const current = stack.at(-1);
      if (current.name !== closingName) {
        throw new Error(
          `XML 标签不匹配：期望 </${current.name}>，实际 </${closingName}>。`,
        );
      }
      stack.pop();
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    if (selfClosing) {
      rawTag = rawTag.slice(0, -1).trim();
    }

    const nameMatch = rawTag.match(/^([^\s/>]+)/);
    if (!nameMatch) {
      throw new Error(`无法识别 XML 标签：${rawTag.slice(0, 80)}`);
    }

    const attributes = {};
    const attributeSource = rawTag.slice(nameMatch[0].length);
    const attributePattern =
      /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of attributeSource.matchAll(attributePattern)) {
      attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
    }

    const node = {
      type: "element",
      name: nameMatch[1],
      attributes,
      children: [],
      text: "",
    };
    stack.at(-1).children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (stack.length !== 1) {
    throw new Error(`XML 仍有未闭合标签：${stack.at(-1).name}`);
  }
  return document;
}

function elements(node, name = null) {
  if (!node) {
    return [];
  }
  return node.children.filter(
    (child) =>
      child.type === "element" && (name === null || child.name === name),
  );
}

function firstElement(node, name) {
  return elements(node, name)[0] ?? null;
}

function firstDescendant(node, name) {
  if (!node) {
    return null;
  }
  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.name === name) {
      return child;
    }
    const nested = firstDescendant(child, name);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function descendants(node, name) {
  const matches = [];
  if (!node) {
    return matches;
  }
  for (const child of node.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.name === name) {
      matches.push(child);
    }
    matches.push(...descendants(child, name));
  }
  return matches;
}

function textOf(node, childName = null, fallback = "") {
  const target = childName ? firstElement(node, childName) : node;
  return (target?.text ?? fallback).trim() || fallback;
}

function parseNumbers(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

function parseVector3(value, fallback = [0, 0, 0]) {
  const values = parseNumbers(value);
  return values.length === 3 && values.every(Number.isFinite)
    ? values
    : [...fallback];
}

function sanitizeId(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]+/g, "_");
}

function sideFromBodyName(name) {
  if (/(?:^|_)[rR](?:_|$)/.test(name) || /_r$/.test(name)) {
    return "right";
  }
  if (/(?:^|_)[lL](?:_|$)/.test(name) || /_l$/.test(name)) {
    return "left";
  }
  return "shared";
}

function labelForBody(name) {
  if (BODY_LABELS[name]) {
    return BODY_LABELS[name];
  }
  const lumbar = name.match(/^lumbar([1-5])$/);
  if (lumbar) {
    return `腰椎 L${lumbar[1]}`;
  }
  const thoracic = name.match(/^thoracic(\d+)$/);
  if (thoracic) {
    return `胸椎 T${thoracic[1]}`;
  }
  const cervical = name.match(/^cerv(\d+)$/);
  if (cervical) {
    return `颈椎 C${cervical[1]}`;
  }
  const rib = name.match(/^rib(\d+)_([RL])$/);
  if (rib) {
    return `${rib[2] === "R" ? "右" : "左"}第 ${rib[1]} 肋`;
  }
  if (name.startsWith("Abd_")) {
    return `腹部标记 ${name}`;
  }
  return name;
}

function socketBodyName(socketText) {
  const normalized = String(socketText ?? "").replace(/\\/g, "/");
  const parts = normalized
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.at(-1) ?? "";
}

function orientationQuaternion(orientation) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      orientation[0] || 0,
      orientation[1] || 0,
      orientation[2] || 0,
      "XYZ",
    ),
  );
}

function transformMatrix(translation, orientation) {
  const quaternion = orientationQuaternion(orientation);
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(translation),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
}

function matrixToTransform(matrix) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);

  const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
    quaternion,
  );
  const rotationElements = rotationMatrix.elements;
  return {
    position: position.toArray(),
    quaternion: quaternion.toArray(),
    rotation: [
      [
        rotationElements[0],
        rotationElements[4],
        rotationElements[8],
      ],
      [
        rotationElements[1],
        rotationElements[5],
        rotationElements[9],
      ],
      [
        rotationElements[2],
        rotationElements[6],
        rotationElements[10],
      ],
    ],
    matrix: matrix.toArray(),
  };
}

function divideVector3(vector, scale) {
  return vector.map((value, index) => {
    const factor = Number(scale[index]);
    return Number.isFinite(factor) && Math.abs(factor) > 1e-12
      ? value / factor
      : value;
  });
}

function unscaledDefaultJointMatrix(matrix, parentScale) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  position.fromArray(divideVector3(position.toArray(), parentScale));
  return new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
}

function parseOffsetFrame(frame) {
  return {
    id: frame.attributes.name ?? "",
    parentBody: socketBodyName(textOf(frame, "socket_parent")),
    translation: parseVector3(textOf(frame, "translation")),
    orientation: parseVector3(textOf(frame, "orientation")),
  };
}

function parseFunction(axisNode) {
  const functionNode = elements(axisNode).find((child) =>
    child.name.endsWith("Function") ||
    ["Constant", "SimmSpline", "PolynomialFunction"].includes(child.name),
  );
  if (!functionNode) {
    return { type: "Constant", value: 0 };
  }
  if (functionNode.name === "LinearFunction") {
    return {
      type: functionNode.name,
      coefficients: parseNumbers(textOf(functionNode, "coefficients")),
    };
  }
  if (functionNode.name === "MultiplierFunction") {
    const nestedContainer = firstElement(functionNode, "function");
    const nested = nestedContainer
      ? elements(nestedContainer)[0] ?? null
      : null;
    return {
      type: functionNode.name,
      scale: Number(textOf(functionNode, "scale", "1")),
      function: nested ? parseFunction(nestedContainer) : { type: "Constant", value: 0 },
    };
  }
  if (functionNode.name === "SimmSpline") {
    return {
      type: functionNode.name,
      x: parseNumbers(textOf(functionNode, "x")),
      y: parseNumbers(textOf(functionNode, "y")),
    };
  }
  if (functionNode.name === "PolynomialFunction") {
    return {
      type: functionNode.name,
      coefficients: parseNumbers(textOf(functionNode, "coefficients")),
    };
  }
  return {
    type: functionNode.name,
    value: Number(textOf(functionNode, "value", "0")),
  };
}

function evaluateFunction(functionDefinition, coordinateValue) {
  if (!functionDefinition) {
    return 0;
  }
  if (functionDefinition.type === "LinearFunction") {
    const [slope = 1, intercept = 0] = functionDefinition.coefficients;
    return slope * coordinateValue + intercept;
  }
  if (functionDefinition.type === "MultiplierFunction") {
    return (
      (Number.isFinite(functionDefinition.scale)
        ? functionDefinition.scale
        : 1) *
      evaluateFunction(functionDefinition.function, coordinateValue)
    );
  }
  if (functionDefinition.type === "SimmSpline") {
    const x = functionDefinition.x;
    const y = functionDefinition.y;
    if (!x.length || x.length !== y.length) {
      return 0;
    }
    if (coordinateValue <= x[0]) {
      return y[0];
    }
    if (coordinateValue >= x.at(-1)) {
      return y.at(-1);
    }

    // SimmSpline stores a natural cubic spline. OpenSim joint definitions
    // commonly rely on its value at q=0 even when 0 is not an explicit knot.
    const secondDerivatives = new Array(x.length).fill(0);
    const work = new Array(x.length).fill(0);
    secondDerivatives[0] = 0;
    work[0] = 0;
    for (let index = 1; index < x.length - 1; index += 1) {
      const sigma =
        (x[index] - x[index - 1]) / (x[index + 1] - x[index - 1]);
      const pivot =
        sigma * secondDerivatives[index - 1] + 2;
      secondDerivatives[index] =
        (sigma - 1) / pivot;
      work[index] =
        (6 *
          ((y[index + 1] - y[index]) /
            (x[index + 1] - x[index]) -
            (y[index] - y[index - 1]) /
              (x[index] - x[index - 1])) /
            (x[index + 1] - x[index - 1]) -
          sigma * work[index - 1]) /
        pivot;
    }
    secondDerivatives[x.length - 1] = 0;
    for (let index = x.length - 2; index >= 0; index -= 1) {
      secondDerivatives[index] =
        secondDerivatives[index] * secondDerivatives[index + 1] +
        work[index];
    }

    let index = 0;
    while (index < x.length - 2 && coordinateValue > x[index + 1]) {
      index += 1;
    }
    const interval = x[index + 1] - x[index];
    const a = (x[index + 1] - coordinateValue) / interval;
    const b = (coordinateValue - x[index]) / interval;
    return (
      a * y[index] +
      b * y[index + 1] +
      ((a ** 3 - a) * secondDerivatives[index] +
        (b ** 3 - b) * secondDerivatives[index + 1]) *
        (interval ** 2) /
        6
    );
  }
  if (functionDefinition.type === "PolynomialFunction") {
    return functionDefinition.coefficients.reduce(
      (sum, coefficient, index) =>
        sum + coefficient * coordinateValue ** index,
      0,
    );
  }
  return Number.isFinite(functionDefinition.value)
    ? functionDefinition.value
    : 0;
}

function parseTransformAxis(axisNode, coordinateDefaults) {
  const coordinateNames = textOf(axisNode, "coordinates")
    .split(/\s+/)
    .filter(Boolean);
  const coordinateName = coordinateNames[0] ?? "";
  const functionDefinition = parseFunction(axisNode);
  const coordinateValue = coordinateName
    ? coordinateDefaults[coordinateName] ?? 0
    : 0;
  return {
    name: axisNode.attributes.name ?? "",
    kind: (axisNode.attributes.name ?? "").startsWith("rotation")
      ? "rotation"
      : "translation",
    axis: parseVector3(textOf(axisNode, "axis"), [1, 0, 0]),
    coordinates: coordinateName,
    coordinateNames,
    function: functionDefinition,
    defaultValue: evaluateFunction(functionDefinition, coordinateValue),
  };
}

function parseCoordinates(jointNode) {
  return elements(firstElement(jointNode, "coordinates"), "Coordinate").map(
    (coordinate) => {
      const range = parseNumbers(textOf(coordinate, "range"));
      return {
        name: coordinate.attributes.name ?? "",
        default: Number(textOf(coordinate, "default_value", "0")),
        defaultSpeed: Number(
          textOf(coordinate, "default_speed_value", "0"),
        ),
        range: range.length === 2 ? range : null,
        clamped: textOf(coordinate, "clamped").toLowerCase() === "true",
        locked: textOf(coordinate, "locked").toLowerCase() === "true",
        prescribed: textOf(coordinate, "prescribed").toLowerCase() === "true",
      };
    },
  );
}

function buildDefaultJointMatrix(transformAxes) {
  const rotations = new THREE.Matrix4();
  const translations = new THREE.Matrix4();
  const nonZeroAxes = [];

  for (const axis of transformAxes) {
    const value = axis.defaultValue;
    if (Math.abs(value) < 1e-12) {
      continue;
    }
    nonZeroAxes.push({ name: axis.name, value });
    const axisVector = new THREE.Vector3().fromArray(axis.axis);
    if (axisVector.lengthSq() < 1e-16) {
      axisVector.set(1, 0, 0);
    } else {
      axisVector.normalize();
    }

    const axisTransform = new THREE.Matrix4();
    if (axis.kind === "rotation") {
      axisTransform.makeRotationAxis(axisVector, value);
      rotations.multiply(axisTransform);
    } else {
      axisTransform.makeTranslation(
        axisVector.x * value,
        axisVector.y * value,
        axisVector.z * value,
      );
      translations.multiply(axisTransform);
    }
  }

  return {
    matrix: translations.multiply(rotations),
    nonZeroAxes,
  };
}

function applyBinaryStl(inputPath, outputPath) {
  fs.copyFileSync(inputPath, outputPath);
}

function parseObj(inputPath) {
  const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/);
  const positions = [];
  const indices = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("v ")) {
      const values = parseNumbers(trimmed.slice(2));
      if (values.length >= 3) {
        positions.push(values[0], values[1], values[2]);
      }
      continue;
    }
    if (!trimmed.startsWith("f ")) {
      continue;
    }
    const vertices = trimmed
      .slice(2)
      .trim()
      .split(/\s+/)
      .map((token) => {
        const rawIndex = Number(token.split("/")[0]);
        return rawIndex < 0
          ? positions.length / 3 + rawIndex
          : rawIndex - 1;
      });
    if (vertices.length < 3) {
      continue;
    }
    for (let index = 1; index < vertices.length - 1; index += 1) {
      indices.push(vertices[0], vertices[index], vertices[index + 1]);
    }
  }
  return {
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}

function parseVtp(inputPath) {
  const root = parseXml(fs.readFileSync(inputPath, "utf8")).children.find(
    (child) => child.type === "element",
  );
  const points = firstDescendant(root, "Points");
  const pointArray = firstElement(points, "DataArray");
  const polys = firstDescendant(root, "Polys");
  const connectivityNode = polys
    ? elements(polys, "DataArray").find(
        (array) => array.attributes.Name === "connectivity",
      )
    : null;
  const offsetsNode = polys
    ? elements(polys, "DataArray").find(
        (array) => array.attributes.Name === "offsets",
      )
    : null;

  if (!pointArray || !connectivityNode || !offsetsNode) {
    throw new Error(`VTP 缺少 Points/Polys 数据：${inputPath}`);
  }
  for (const array of [pointArray, connectivityNode, offsetsNode]) {
    if ((array.attributes.format ?? "ascii") !== "ascii") {
      throw new Error(
        `暂不支持二进制 VTP DataArray：${inputPath} (${array.attributes.Name ?? "Points"})`,
      );
    }
  }

  const positions = Float64Array.from(parseNumbers(pointArray.text));
  const connectivity = parseNumbers(connectivityNode.text);
  const offsets = parseNumbers(offsetsNode.text);
  const indices = [];
  let start = 0;

  for (const end of offsets) {
    const polygon = connectivity.slice(start, end);
    for (let index = 1; index < polygon.length - 1; index += 1) {
      indices.push(polygon[0], polygon[index], polygon[index + 1]);
    }
    start = end;
  }

  return {
    positions,
    indices: Uint32Array.from(indices),
  };
}

function normalizeVector(vector) {
  const length = vector.length();
  if (length <= 1e-16) {
    return new THREE.Vector3(0, 0, 0);
  }
  return vector.multiplyScalar(1 / length);
}

function writeBinaryStl(outputPath, positions, indices) {
  const triangleCount = Math.floor(indices.length / 3);
  const buffer = Buffer.allocUnsafe(84 + triangleCount * 50);
  buffer.write("OpenSim Web skeleton export", 0, 80, "ascii");
  buffer.writeUInt32LE(triangleCount, 80);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let offset = 84;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const i0 = indices[triangle * 3];
    const i1 = indices[triangle * 3 + 1];
    const i2 = indices[triangle * 3 + 2];
    a.fromArray(positions, i0 * 3);
    b.fromArray(positions, i1 * 3);
    c.fromArray(positions, i2 * 3);
    normal.copy(b).sub(a).cross(c.clone().sub(a));
    normalizeVector(normal);

    for (const value of normal.toArray()) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    for (const vertex of [a, b, c]) {
      for (const value of vertex.toArray()) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }

  fs.writeFileSync(outputPath, buffer);
}

function getBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return {
    min: min.map((value) => (Number.isFinite(value) ? value : 0)),
    max: max.map((value) => (Number.isFinite(value) ? value : 0)),
  };
}

function convertGeometrySource(sourcePath, outputPath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".stl") {
    applyBinaryStl(sourcePath, outputPath);
    return {
      format: "stl",
      triangleCount: Math.max(
        0,
        Math.floor((fs.statSync(outputPath).size - 84) / 50),
      ),
      bounds: null,
    };
  }

  const parsed =
    extension === ".obj" ? parseObj(sourcePath) : parseVtp(sourcePath);
  const triangleCount = Math.floor(parsed.indices.length / 3);
  writeBinaryStl(outputPath, parsed.positions, parsed.indices);
  return {
    format: extension.slice(1),
    triangleCount,
    bounds: getBounds(parsed.positions),
  };
}

function collectBodyMeshes(bodyNode) {
  const meshes = [];
  const directContainer = firstElement(bodyNode, "attached_geometry");
  for (const mesh of elements(directContainer, "Mesh")) {
    meshes.push({
      mesh,
      frame: {
        id: "",
        parentBody: bodyNode.attributes.name,
        translation: [0, 0, 0],
        orientation: [0, 0, 0],
      },
    });
  }

  const components = firstElement(bodyNode, "components");
  for (const frameNode of elements(components, "PhysicalOffsetFrame")) {
    const frame = parseOffsetFrame(frameNode);
    for (const mesh of elements(
      firstElement(frameNode, "attached_geometry"),
      "Mesh",
    )) {
      meshes.push({ mesh, frame });
    }
  }
  return meshes;
}

function meshColor(meshNode) {
  const appearance = firstDescendant(meshNode, "Appearance");
  const color = parseVector3(
    textOf(appearance, "color"),
    [0.91, 0.85, 0.78],
  );
  const opacity = Number(textOf(appearance, "opacity", "1"));
  const visible = textOf(appearance, "visible", "true").toLowerCase();
  return {
    color,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    visible: visible !== "false",
  };
}

function fileSha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function validatePath(label, value) {
  if (!fs.existsSync(value)) {
    throw new Error(`${label}不存在：${value}`);
  }
}

function main() {
  validatePath("OpenSim 模型", MODEL_PATH);
  validatePath("OpenSim 几何目录", GEOMETRY_ROOT);
  fs.mkdirSync(OUTPUT_GEOMETRY_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_SOURCE_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DATA_DIR, { recursive: true });

  const xml = parseXml(fs.readFileSync(MODEL_PATH, "utf8"));
  const openSimDocument = elements(xml, "OpenSimDocument")[0];
  const modelNode = firstElement(openSimDocument, "Model");
  const bodySet = firstElement(modelNode, "BodySet");
  const jointSet = firstElement(modelNode, "JointSet");
  const bodyNodes = elements(firstElement(bodySet, "objects"), "Body");
  const jointNodes = elements(firstElement(jointSet, "objects")).filter(
    (node) =>
      node.name === "CustomJoint" ||
      node.name === "WeldJoint" ||
      node.name === "PinJoint",
  );

  if (!modelNode || !bodyNodes.length || !jointNodes.length) {
    throw new Error("未从 .osim 中读取到 Model/BodySet/JointSet。");
  }

  const geometryCache = new Map();
  const geometryReport = [];
  let geometryIndex = 0;

  function resolveGeometry(meshNode) {
    const meshFile = textOf(meshNode, "mesh_file");
    if (!meshFile) {
      return null;
    }
    const sourcePath = path.resolve(GEOMETRY_ROOT, meshFile);
    validatePath(`网格文件 ${meshFile}`, sourcePath);

    if (!geometryCache.has(sourcePath)) {
      const extension = path.extname(meshFile).toLowerCase();
      const relative = path
        .relative(GEOMETRY_ROOT, sourcePath)
        .replace(/[\\/]+/g, "__")
        .replace(/[^\w.-]+/g, "_");
      const outputName = `${sanitizeId(relative.replace(/\.[^.]+$/, ""))}.stl`;
      const outputPath = path.join(OUTPUT_GEOMETRY_DIR, outputName);
      const conversion = convertGeometrySource(sourcePath, outputPath);
      geometryCache.set(sourcePath, {
        file: outputName,
        sourceFile: sourcePath,
        sourceFileRelative: path.relative(GEOMETRY_ROOT, sourcePath),
        sourceFormat: extension.slice(1),
        triangleCount: conversion.triangleCount,
        bounds: conversion.bounds,
      });
      geometryReport.push({
        source: projectRelative(sourcePath),
        output: projectRelative(outputPath),
        format: extension.slice(1),
        triangles: conversion.triangleCount,
      });
    }
    return geometryCache.get(sourcePath);
  }

  const rawBodies = bodyNodes.map((bodyNode) => {
    const bodyName = bodyNode.attributes.name;
    const rawMeshes = collectBodyMeshes(bodyNode);
    const parsedMeshes = rawMeshes.map(({ mesh, frame }) => {
      const resolved = resolveGeometry(mesh);
      if (!resolved) {
        return null;
      }
      return {
        id: mesh.attributes.name ?? `geometry_${geometryIndex++}`,
        frame,
        scaleFactors: parseVector3(
          textOf(mesh, "scale_factors"),
          [1, 1, 1],
        ),
        resolved,
        appearance: meshColor(mesh),
      };
    }).filter(Boolean);

    const scaleFactors = parsedMeshes[0]?.scaleFactors ?? [1, 1, 1];
    const conflictingScales = parsedMeshes.some(
      (geometry) =>
        geometry.scaleFactors.some(
          (value, index) => Math.abs(value - scaleFactors[index]) > 1e-9,
        ),
    );

    return {
      id: bodyName,
      label: labelForBody(bodyName),
      side: sideFromBodyName(bodyName),
      bodyNode,
      geometry: parsedMeshes,
      scaleFactors,
      conflictingScales,
      massKg: Number(textOf(bodyNode, "mass", "0")),
      massCenter: parseVector3(textOf(bodyNode, "mass_center")),
    };
  });

  const bodyNames = new Set(rawBodies.map((body) => body.id));
  const bodyByName = new Map(rawBodies.map((body) => [body.id, body]));
  const jointByChildBody = new Map();
  const warnings = [];
  const coordinateDefaults = {};

  for (const rawBody of rawBodies) {
    for (const geometry of rawBody.geometry) {
      if (geometry.appearance.visible === false) {
        warnings.push(
          `${rawBody.id}/${geometry.id} 在源模型中设为不可见，Web 已保留可见性元数据。`,
        );
      }
    }
    if (rawBody.conflictingScales) {
      warnings.push(
        `${rawBody.id} 的多个 Mesh scale_factors 不一致，模板以第一项作为 Body 缩放。`,
      );
    }
  }

  const parsedJoints = jointNodes.map((jointNode) => {
    const jointName = jointNode.attributes.name;
    const coordinates = parseCoordinates(jointNode);
    for (const coordinate of coordinates) {
      coordinateDefaults[coordinate.name] = coordinate.default;
    }

    const frameNodes = elements(firstElement(jointNode, "frames")).map(
      parseOffsetFrame,
    );
    const parentFrameReference = textOf(jointNode, "socket_parent_frame");
    const childFrameReference = textOf(jointNode, "socket_child_frame");
    const parentFrame =
      frameNodes.find((frame) => frame.id === parentFrameReference) ??
      frameNodes[0];
    const childFrame =
      frameNodes.find((frame) => frame.id === childFrameReference) ??
      frameNodes[1];

    if (!parentFrame || !childFrame) {
      throw new Error(`关节 ${jointName} 缺少 parent/child PhysicalOffsetFrame。`);
    }
    if (!bodyNames.has(childFrame.parentBody)) {
      throw new Error(
        `关节 ${jointName} 的 child frame 指向未知 Body：${childFrame.parentBody}`,
      );
    }
    const parentBody = bodyNames.has(parentFrame.parentBody)
      ? parentFrame.parentBody
      : null;
    if (parentFrame.parentBody !== "ground" && !parentBody) {
      throw new Error(
        `关节 ${jointName} 的 parent frame 指向未知 Body：${parentFrame.parentBody}`,
      );
    }
    if (jointByChildBody.has(childFrame.parentBody)) {
      throw new Error(
        `Body ${childFrame.parentBody} 被多个关节作为 child 连接。`,
      );
    }
    jointByChildBody.set(childFrame.parentBody, jointName);

    let transformAxes = elements(
      firstElement(jointNode, "SpatialTransform"),
    ).map((axis) => parseTransformAxis(axis, coordinateDefaults));
    if (
      !transformAxes.length &&
      jointNode.name === "PinJoint" &&
      coordinates.length === 1
    ) {
      transformAxes = [
        {
          name: "rotation1",
          kind: "rotation",
          axis: [0, 0, 1],
          coordinates: coordinates[0].name,
          coordinateNames: [coordinates[0].name],
          function: {
            type: "LinearFunction",
            coefficients: [1, 0],
          },
          defaultValue: coordinates[0].default,
        },
      ];
    }
    const defaultJoint = buildDefaultJointMatrix(transformAxes);
    if (defaultJoint.nonZeroAxes.length) {
      warnings.push(
        `关节 ${jointName} 在默认坐标下存在非零 TransformAxis：${JSON.stringify(defaultJoint.nonZeroAxes)}`,
      );
    }

    return {
      id: jointName,
      type: jointNode.name,
      parentBody,
      childBody: childFrame.parentBody,
      parentFrame,
      childFrame,
      coordinates,
      transformAxes,
      defaultJointMatrix: defaultJoint.matrix,
      jointNode,
    };
  });

  // Every Body has exactly one incoming joint. The pelvis is connected to
  // Ground through ground_pelvis and is therefore not a parentless Body.
  if (jointByChildBody.size !== rawBodies.length) {
    const disconnected = rawBodies
      .filter((body) => !jointByChildBody.has(body.id))
      .map((body) => body.id);
    throw new Error(
      `关节拓扑没有覆盖全部 Body。未连接：${disconnected.join(", ")}`,
    );
  }

  function targetTransformForJoint(joint) {
    const parentScale =
      joint.parentBody && bodyByName.has(joint.parentBody)
        ? bodyByName.get(joint.parentBody).scaleFactors
        : [1, 1, 1];
    const childScale = bodyByName.get(joint.childBody).scaleFactors;
    const parentFrameMatrix = transformMatrix(
      joint.parentFrame.translation,
      joint.parentFrame.orientation,
    );
    const childFrameMatrix = transformMatrix(
      joint.childFrame.translation,
      joint.childFrame.orientation,
    );
    const relative = parentFrameMatrix
      .clone()
      .multiply(joint.defaultJointMatrix)
      .multiply(childFrameMatrix.clone().invert());
    return {
      parentScale,
      childScale,
      target: matrixToTransform(relative),
    };
  }

  for (const body of rawBodies) {
    const joint = parsedJoints.find((item) => item.childBody === body.id);
    if (!joint) {
      continue;
    }
    const computed = targetTransformForJoint(joint);
    body.parentBody = joint.parentBody;
    body.joint = {
      id: joint.id,
      type: joint.type,
      parentBody: joint.parentBody,
      childBody: joint.childBody,
      parentFrame: {
        id: joint.parentFrame.id,
        body: joint.parentFrame.parentBody,
        translation: joint.parentFrame.translation,
        orientation: joint.parentFrame.orientation,
      },
      childFrame: {
        id: joint.childFrame.id,
        body: joint.childFrame.parentBody,
        translation: joint.childFrame.translation,
        orientation: joint.childFrame.orientation,
      },
      coordinates: joint.coordinates,
      transformAxes: joint.transformAxes,
      initialRelativeTransform: (() => {
        const parentScale =
          joint.parentBody && bodyByName.has(joint.parentBody)
            ? bodyByName.get(joint.parentBody).scaleFactors
            : [1, 1, 1];
        const childScale = bodyByName.get(joint.childBody).scaleFactors;
        const parentMatrix = transformMatrix(
          divideVector3(joint.parentFrame.translation, parentScale),
          joint.parentFrame.orientation,
        );
        const childMatrix = transformMatrix(
          divideVector3(joint.childFrame.translation, childScale),
          joint.childFrame.orientation,
        );
        return matrixToTransform(
          parentMatrix
            .clone()
            .multiply(
              unscaledDefaultJointMatrix(
                joint.defaultJointMatrix,
                parentScale,
              ),
            )
            .multiply(childMatrix.clone().invert()),
        );
      })(),
      targetRelativeTransform: computed.target,
    };
  }

  const manifestBodies = rawBodies.map((body) => ({
    id: body.id,
    label: body.label,
    parent: body.parentBody,
    side: body.side,
    massKg: body.massKg,
    massCenter: body.massCenter,
    sourceScaleFactors: body.scaleFactors,
    joint: body.joint
      ? {
          ...body.joint,
          parentFrame: {
            ...body.joint.parentFrame,
            unscaledTranslation: divideVector3(
              body.joint.parentFrame.translation,
              body.joint.parentBody &&
                bodyByName.has(body.joint.parentBody)
                ? bodyByName.get(body.joint.parentBody).scaleFactors
                : [1, 1, 1],
            ),
          },
          childFrame: {
            ...body.joint.childFrame,
            unscaledTranslation: divideVector3(
              body.joint.childFrame.translation,
              body.scaleFactors,
            ),
          },
        }
      : null,
    geometry: body.geometry.map((geometry) => ({
      id: geometry.id,
      file: geometry.resolved.file,
      sourceFile: geometry.resolved.sourceFileRelative,
      sourceFormat: geometry.resolved.sourceFormat,
      triangleCount: geometry.resolved.triangleCount,
      scaleFactors: [1, 1, 1],
      sourceScaleFactors: geometry.scaleFactors,
      appearance: geometry.appearance,
      transform: matrixToTransform(
        transformMatrix(
          divideVector3(
            geometry.frame.translation,
            body.scaleFactors,
          ),
          geometry.frame.orientation,
        ),
      ),
    })),
  }));

  const manifest = {
    schemaVersion: 1,
    modelKind: "opensim-skeleton",
    source: {
      modelFile: projectRelative(MODEL_PATH),
      modelName: modelNode.attributes.name ?? "",
      modelSha256: fileSha256(MODEL_PATH),
      openSimDocumentVersion:
        openSimDocument.attributes.Version ?? "",
      geometryRoot: projectRelative(GEOMETRY_ROOT),
      lengthUnits: textOf(modelNode, "length_units", "meters"),
      forceUnits: textOf(modelNode, "force_units", "N"),
      coordinateSystem:
        "OpenSim right-handed; model coordinates are converted directly to Three.js without axis swapping",
    },
    meta: {
      generatedAt: new Date().toISOString(),
      bodyCount: rawBodies.length,
      jointCount: parsedJoints.length,
      geometryCount: geometryCache.size,
      coordinateCount: Object.keys(coordinateDefaults).length,
      defaultPose: "All OpenSim Coordinate default_value entries",
      limitation:
        "This export contains shared topology and the unscaled neutral skeleton. Motion, muscles and constraints are later layers.",
    },
    coordinateDefaults,
    constraints: (() => {
      const constraintSet = firstElement(modelNode, "ConstraintSet");
      const constraintObjects = firstElement(constraintSet, "objects");
      return elements(constraintObjects, "CoordinateCouplerConstraint").map(
        (constraintNode) => {
          const functionContainer = firstElement(
            constraintNode,
            "coupled_coordinates_function",
          );
          return {
            id: constraintNode.attributes.name ?? "",
            type: constraintNode.name,
            enforced:
              textOf(constraintNode, "isEnforced", "true").toLowerCase() ===
              "true",
            dependent:
              textOf(constraintNode, "dependent_coordinate_name"),
            independent: textOf(
              constraintNode,
              "independent_coordinate_names",
            )
              .split(/\s+/)
              .filter(Boolean),
            function: parseFunction(functionContainer),
          };
        },
      );
    })(),
    bodies: manifestBodies,
  };

  const scalingBodies = {};
  for (const body of rawBodies) {
    scalingBodies[body.id] = {
      scaleFactors: body.scaleFactors,
      geometry: Object.fromEntries(
        body.geometry.map((geometry) => [
          geometry.id,
          {
            scaleFactors: geometry.scaleFactors,
            transform: matrixToTransform(
              transformMatrix(
                geometry.frame.translation,
                geometry.frame.orientation,
              ),
            ),
          },
        ]),
      ),
    };
  }

  const scalingTemplate = {
    schemaVersion: 1,
    modelKind: "opensim-scaling-template",
    source: {
      modelFile: projectRelative(MODEL_PATH),
      modelSha256: manifest.source.modelSha256,
    },
    meta: {
      generatedAt: manifest.meta.generatedAt,
      method: "Preserved per-Body geometry ScaleSet and PhysicalOffsetFrame values",
      targetState: "The supplied .osim's current scaled subject/model state",
      note:
        "Apply these templates to the shared unscaled skeleton; do not rebuild Body or Joint topology for a new subject.",
    },
    bodies: scalingBodies,
    joints: Object.fromEntries(
      parsedJoints.map((joint) => {
        const computed = targetTransformForJoint(joint);
        return [
          joint.childBody,
          {
            id: joint.id,
            parentBody: joint.parentBody,
            childBody: joint.childBody,
            parentFrame: {
              translation: joint.parentFrame.translation,
              orientation: joint.parentFrame.orientation,
            },
            childFrame: {
              translation: joint.childFrame.translation,
              orientation: joint.childFrame.orientation,
            },
            targetRelativeTransform: computed.target,
          },
        ];
      }),
    ),
    coordinateDefaults,
  };

  fs.writeFileSync(MANIFEST_OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    SCALING_OUTPUT,
    `${JSON.stringify(scalingTemplate, null, 2)}\n`,
  );
  fs.writeFileSync(
    PROFILE_OUTPUT,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: "opensim-v11-subject",
        label: "OpenSim v11 · Subject-specific · 60 kg",
        manifest: "./data/opensim/skeleton-manifest.json",
        scalingTemplate: "./data/opensim/scaling-template.json",
        motion: "./data/opensim/motion-data.json",
        muscleGroups: "./data/opensim/muscle-groups.json",
        geometryRoot: "./models/opensim/geometry",
        sourceModel: `./models/opensim/source/${path.basename(MODEL_PATH)}`,
      },
      null,
      2,
    )}\n`,
  );

  const sourceCopy = path.join(OUTPUT_SOURCE_DIR, path.basename(MODEL_PATH));
  if (path.resolve(MODEL_PATH) !== path.resolve(sourceCopy)) {
    fs.copyFileSync(MODEL_PATH, sourceCopy);
  }

  const report = {
    schemaVersion: 1,
    sourceModel: projectRelative(MODEL_PATH),
    sourceModelSha256: manifest.source.modelSha256,
    sourceCopy: projectRelative(sourceCopy),
    manifest: projectRelative(MANIFEST_OUTPUT),
    scalingTemplate: projectRelative(SCALING_OUTPUT),
    profile: projectRelative(PROFILE_OUTPUT),
    bodyCount: rawBodies.length,
    jointCount: parsedJoints.length,
    coordinateCount: Object.keys(coordinateDefaults).length,
    geometryCount: geometryCache.size,
    triangleCount: geometryReport.reduce(
      (sum, geometry) => sum + geometry.triangles,
      0,
    ),
    warnings,
    geometry: geometryReport,
  };
  fs.writeFileSync(REPORT_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`OpenSim skeleton export complete: ${manifest.source.modelName}`);
  console.log(`  Bodies: ${rawBodies.length}`);
  console.log(`  Joints: ${parsedJoints.length}`);
  console.log(`  Coordinates: ${Object.keys(coordinateDefaults).length}`);
  console.log(`  Geometry files: ${geometryCache.size}`);
  console.log(`  Manifest: ${MANIFEST_OUTPUT}`);
  console.log(`  Scaling template: ${SCALING_OUTPUT}`);
  if (warnings.length) {
    console.log(`  Warnings: ${warnings.length} (see ${REPORT_OUTPUT})`);
  }
}

main();
