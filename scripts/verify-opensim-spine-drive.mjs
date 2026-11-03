import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { buildOpenSimSkeleton } from "../src/opensim/skeletonBuilder.js";
import {
  applyOpenSimPose,
  resolveCoordinateValues,
} from "../src/opensim/openSimPose.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "public", "data", "opensim");
const manifest = JSON.parse(
  fs.readFileSync(path.join(dataRoot, "skeleton-manifest.json"), "utf8"),
);
const template = JSON.parse(
  fs.readFileSync(path.join(dataRoot, "scaling-template.json"), "utf8"),
);

function fail(message) {
  throw new Error(`OpenSim spine drive verification failed: ${message}`);
}

function coordinate(name) {
  const result = skeleton.coordinateCatalog.byName.get(name);
  if (!result) {
    fail(`missing coordinate ${name}`);
  }
  return result;
}

function resetPose() {
  applyOpenSimPose(
    skeleton,
    manifest,
    template,
    resolveCoordinateValues(skeleton.coordinateCatalog),
    { targetState: true },
  );
}

function positionOf(bodyId) {
  skeleton.root.updateMatrixWorld(true);
  return skeleton.groups
    .get(bodyId)
    .getWorldPosition(new THREE.Vector3());
}

const skeleton = buildOpenSimSkeleton(
  manifest,
  template,
  {},
  { targetState: true },
);
const catalog = skeleton.coordinateCatalog;

const spineBases = [
  "L5_S1",
  "L4_L5",
  "L3_L4",
  "L2_L3",
  "L1_L2",
  "T12_L1",
  "T9_T10",
  "T6_T7",
  "T4_T5",
  "T2_T3",
  "T1_C7",
  "C7_C6",
  "C6_C5",
  "C5_C4",
  "C4_C3",
  "C3_C2",
];

for (const base of spineBases) {
  const expected = [
    [`${base}_FE`, "rotation", "+Z", "屈曲", "伸展"],
    [`${base}_LB`, "rotation", "+X", "左侧弯", "右侧弯"],
    [`${base}_AR`, "rotation", "+Y", "右旋", "左旋"],
  ];
  for (const [name, motionType, axis, negative, positive] of expected) {
    const definition = coordinate(name);
    if (
      definition.motionType !== motionType ||
      definition.axisLabel !== axis ||
      definition.negativeDirection !== negative ||
      definition.positiveDirection !== positive
    ) {
      fail(`spine coordinate convention mismatch for ${name}`);
    }
  }
}

const c2c1 = coordinate("C2_C1_AR");
if (
  c2c1.motionType !== "rotation" ||
  c2c1.axisLabel !== "+Y" ||
  c2c1.positiveDirection !== "左旋" ||
  c2c1.negativeDirection !== "右旋"
) {
  fail("C2-C1 axial rotation convention is inconsistent");
}

const c2Body = manifest.bodies.find((body) => body.id === "cerv1");
if (
  c2Body.joint.id !== "C2_C1" ||
  c2Body.joint.coordinates.length !== 1 ||
  c2Body.joint.coordinates[0].name !== "C2_C1_AR"
) {
  fail("source .osim is expected to define only C2_C1_AR for C2-C1");
}
if (!c2c1.jointDofNote.includes("只有") && !c2c1.jointDofNote.includes("仅定义")) {
  fail("C2-C1 missing-DOF note is absent");
}

const headBody = manifest.bodies.find((body) => body.id === "head");
if (
  headBody.joint.id !== "C1_head" ||
  headBody.joint.coordinates.length !== 1 ||
  headBody.joint.coordinates[0].name !== "C1_head_FE"
) {
  fail("source .osim is expected to define only C1_head_FE for C1-head");
}

const auxiliary = catalog.definitions.filter(
  (definition) => definition.bodyId === "Abdomen",
);
if (
  auxiliary.length !== 3 ||
  auxiliary.some((definition) => definition.hasVisualInfluence)
) {
  fail("Abdomen auxiliary coordinates should not be visible skeleton controls");
}
const visibleControls = catalog.definitions.filter(
  (definition) =>
    !definition.constrained && definition.hasVisualInfluence,
);
if (visibleControls.length !== 82) {
  fail(`expected 82 visible free-drive controls, got ${visibleControls.length}`);
}

resetPose();
const neutralC7 = positionOf("cerv7");
applyOpenSimPose(
  skeleton,
  manifest,
  template,
  resolveCoordinateValues(catalog, { T12_L1_FE: 0.1 }),
  { targetState: true },
);
const extensionC7 = positionOf("cerv7");
if (
  extensionC7.x >= neutralC7.x - 0.005 ||
  Math.abs(extensionC7.z - neutralC7.z) > 0.005
) {
  fail("T12-L1_FE positive motion is not extension in OpenSim axes");
}

resetPose();
applyOpenSimPose(
  skeleton,
  manifest,
  template,
  resolveCoordinateValues(catalog, { T12_L1_LB: 0.1 }),
  { targetState: true },
);
const rightBendC7 = positionOf("cerv7");
if (rightBendC7.z <= neutralC7.z + 0.005) {
  fail("T12-L1_LB positive motion is not right lateral bending");
}

resetPose();
applyOpenSimPose(
  skeleton,
  manifest,
  template,
  resolveCoordinateValues(catalog, { T12_L1_AR: 0.1 }),
  { targetState: true },
);
const leftRotationC7 = positionOf("cerv7");
if (leftRotationC7.z >= neutralC7.z - 0.001) {
  fail("T12-L1_AR positive motion is not left axial rotation");
}

console.log("OpenSim spine free-drive verification passed.");
console.log(`  Spine tri-axial joints checked: ${spineBases.length}`);
console.log(`  Visible skeleton controls: ${visibleControls.length}`);
console.log("  T12-L1 FE: positive extension / negative flexion");
console.log("  T12-L1 LB: positive right / negative left");
console.log("  T12-L1 AR: positive left / negative right");
console.log("  Abs_FE/LB/AR: excluded as non-visual auxiliary controls");
console.log("  C2-C1: source model has only C2_C1_AR (1 DOF)");
console.log("  C1-head: source model has only C1_head_FE (1 DOF)");
