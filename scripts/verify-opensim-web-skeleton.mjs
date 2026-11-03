import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { buildOpenSimSkeleton } from "../src/opensim/skeletonBuilder.js";
import {
  applyOpenSimPose,
  resolveCoordinateValues,
} from "../src/opensim/openSimPose.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "public", "data", "opensim");
const geometryRoot = path.join(
  projectRoot,
  "public",
  "models",
  "opensim",
  "geometry",
);

function fail(message) {
  throw new Error(`OpenSim Web skeleton verification failed: ${message}`);
}

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(path.join(dataRoot, name), "utf8"),
  );
}

const manifest = readJson("skeleton-manifest.json");
const template = readJson("scaling-template.json");
const files = [
  ...new Set(
    manifest.bodies.flatMap((body) =>
      body.geometry.map((geometry) => geometry.file),
    ),
  ),
];
const loader = new STLLoader();
const geometryMap = {};

for (const file of files) {
  const buffer = fs.readFileSync(path.join(geometryRoot, file));
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  const geometry = loader.parse(arrayBuffer);
  geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
    fail(`empty geometry ${file}`);
  }
  geometryMap[file] = geometry;
}

function finiteVector(vector, label) {
  if (!vector.toArray().every(Number.isFinite)) {
    fail(`${label} is not finite`);
  }
}

function inspectState(targetState) {
  const skeleton = buildOpenSimSkeleton(
    manifest,
    template,
    geometryMap,
    { targetState },
  );
  if (skeleton.groups.size !== manifest.bodies.length) {
    fail("runtime skeleton group count is inconsistent");
  }
  if (skeleton.coordinateCatalog.definitions.length !== 87) {
    fail("coordinate catalog is incomplete");
  }

  const restTransforms = new Map(
    [...skeleton.groups].map(([id, group]) => [
      id,
      {
        position: group.position.clone(),
        quaternion: group.quaternion.clone(),
      },
    ]),
  );
  const defaults = resolveCoordinateValues(skeleton.coordinateCatalog);
  applyOpenSimPose(
    skeleton,
    manifest,
    template,
    defaults,
    { targetState },
  );
  for (const [id, group] of skeleton.groups) {
    const rest = restTransforms.get(id);
    if (
      group.position.distanceTo(rest.position) > 1e-10 ||
      1 - Math.abs(group.quaternion.dot(rest.quaternion)) > 1e-12
    ) {
      fail(`default coordinate pose differs from rest transform at ${id}`);
    }
  }

  skeleton.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(skeleton.root);
  if (bounds.isEmpty()) {
    fail("runtime skeleton has empty world bounds");
  }

  let meshCount = 0;
  let jointMarkerCount = 0;
  for (const group of skeleton.groups.values()) {
    group.getWorldPosition(new THREE.Vector3());
    finiteVector(group.position, `${group.name} local position`);
    if (!Number.isFinite(group.quaternion.x)) {
      fail(`${group.name} quaternion is not finite`);
    }
  }
  skeleton.root.traverse((object) => {
    if (object.userData.isSegmentVisual) {
      meshCount += 1;
    }
    if (object.userData.isJointMarker) {
      jointMarkerCount += 1;
    }
  });

  if (meshCount !== manifest.meta.geometryCount) {
    fail(`runtime mesh count ${meshCount} != ${manifest.meta.geometryCount}`);
  }
  if (jointMarkerCount < manifest.meta.jointCount) {
    fail("runtime joint marker count is too small");
  }

  const size = bounds.getSize(new THREE.Vector3());
  if (size.y < 1 || size.y > 2.5) {
    fail(`unexpected skeleton height ${size.y}`);
  }

  return {
    bounds,
    size,
    meshCount,
    jointMarkerCount,
    skeleton,
  };
}

const initial = inspectState(false);
const target = inspectState(true);
const heightRatio = target.size.y / initial.size.y;
if (heightRatio < 0.7 || heightRatio > 1.3) {
  fail(`implausible initial/target height ratio: ${heightRatio}`);
}

const freeSkeleton = target.skeleton;
const restTibia = freeSkeleton.groups.get("tibia_r").quaternion.clone();
const restPatella = freeSkeleton.groups.get("patella_r").quaternion.clone();
const restTalusWorld = freeSkeleton.groups
  .get("talus_r")
  .getWorldPosition(new THREE.Vector3());
const restPelvisWorld = freeSkeleton.groups
  .get("pelvis")
  .getWorldPosition(new THREE.Vector3());
const freeValues = resolveCoordinateValues(freeSkeleton.coordinateCatalog, {
  knee_angle_r: -0.6,
  ankle_angle_r: 0.3,
  pelvis_tx: 0.12,
});
applyOpenSimPose(
  freeSkeleton,
  manifest,
  template,
  freeValues,
  { targetState: true },
);

if (Math.abs(freeValues.knee_angle_r_beta + 0.6) > 1e-12) {
  fail("patella coupling coordinate did not follow the knee angle");
}
for (const [id, restQuaternion] of [
  ["tibia_r", restTibia],
  ["patella_r", restPatella],
]) {
  const delta = 1 - Math.abs(
    freeSkeleton.groups.get(id).quaternion.dot(restQuaternion),
  );
  if (delta < 1e-8) {
    fail(`free drive did not change ${id} orientation`);
  }
}
const movedTalusWorld = freeSkeleton.groups
  .get("talus_r")
  .getWorldPosition(new THREE.Vector3());
if (movedTalusWorld.distanceTo(restTalusWorld) < 0.01) {
  fail("free drive did not propagate through the knee and ankle chain");
}
const movedPelvisWorld = freeSkeleton.groups
  .get("pelvis")
  .getWorldPosition(new THREE.Vector3());
if (
  Math.abs(
    movedPelvisWorld.distanceTo(restPelvisWorld) - 0.12,
  ) > 1e-8
) {
  fail("root pelvis translation was not applied exactly");
}

console.log("OpenSim Web skeleton verification passed.");
console.log(`  Geometry loaded: ${files.length}`);
console.log(`  Runtime meshes: ${target.meshCount}`);
console.log(`  Joint markers: ${target.jointMarkerCount}`);
console.log(
  `  Initial bounds: ${initial.size.toArray().map((value) => value.toFixed(4)).join(" × ")} m`,
);
console.log(
  `  Target bounds: ${target.size.toArray().map((value) => value.toFixed(4)).join(" × ")} m`,
);
console.log(`  Height ratio: ${heightRatio.toFixed(6)}`);
console.log(
  `  Free drive coordinates: ${freeSkeleton.coordinateCatalog.definitions.length} (${freeSkeleton.coordinateCatalog.constraints.length} coupled)`,
);
