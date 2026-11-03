import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { buildOpenSimSkeleton } from "../src/opensim/skeletonBuilder.js";
import { applyOpenSimPose } from "../src/opensim/openSimPose.js";
import { OpenSimMotionPlayer } from "../src/opensim/motionPlayer.js";
import { OpenSimMuscleRenderer } from "../src/opensim/muscleRenderer.js";
import { muscleDrawStateForActivation } from "../src/opensim/muscleDrawState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "public", "data", "opensim");

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(path.join(dataRoot, name), "utf8"),
  );
}

function fail(message) {
  throw new Error(`OpenSim muscle verification failed: ${message}`);
}

const manifest = readJson("skeleton-manifest.json");
const template = readJson("scaling-template.json");
const motion = readJson("motion-data.json");
const muscleGroups = readJson("muscle-groups.json");
const bodyById = new Map(manifest.bodies.map((body) => [body.id, body]));

const rightColumns = Object.keys(motion.activations.right).sort();
const leftColumns = Object.keys(motion.activations.left).sort();
if (
  rightColumns.length !== 14 ||
  JSON.stringify(rightColumns) !== JSON.stringify(leftColumns)
) {
  fail("expected 14 matching left/right activation columns");
}
const expectedColumns = new Set(rightColumns);

if (muscleGroups.meta.groupCount !== 28) {
  fail(`expected 28 side-groups, got ${muscleGroups.meta.groupCount}`);
}
if (muscleGroups.meta.pathCount !== 92) {
  fail(`expected 92 representative paths, got ${muscleGroups.meta.pathCount}`);
}

let pathCount = 0;
let pointCount = 0;
for (const group of muscleGroups.groups) {
  if (!expectedColumns.has(group.activationColumn)) {
    fail(`${group.id} has no activation column`);
  }
  const activation =
    motion.activations[group.side]?.[group.activationColumn];
  if (
    !Array.isArray(activation) ||
    activation.length !== motion.meta.frameCount
  ) {
    fail(`${group.id} activation length is invalid`);
  }
  if (
    activation.some(
      (value) =>
        !Number.isFinite(value) || value < 0 || value > 1,
    )
  ) {
    fail(`${group.id} activation is outside 0..1`);
  }

  for (const pathDefinition of group.paths) {
    pathCount += 1;
    if (pathDefinition.points.length < 2) {
      fail(`${group.id}/${pathDefinition.sourceMuscle} has too few points`);
    }
    for (const point of pathDefinition.points) {
      pointCount += 1;
      const body = bodyById.get(point.bodyId);
      if (!body) {
        fail(`${group.id} references unknown Body ${point.bodyId}`);
      }
      const scale = template.bodies[point.bodyId].scaleFactors;
      for (let axis = 0; axis < 3; axis += 1) {
        const expected = point.targetLocal[axis] / scale[axis];
        if (Math.abs(point.initialLocal[axis] - expected) > 1e-10) {
          fail(`${group.id} initial local point is not unscaled`);
        }
      }
    }
  }
}
if (pathCount !== muscleGroups.meta.pathCount) {
  fail("path count is inconsistent");
}
if (pointCount !== muscleGroups.meta.pointCount) {
  fail("point count is inconsistent");
}

function verifyState(targetState) {
  const skeleton = buildOpenSimSkeleton(
    manifest,
    template,
    {},
    { targetState },
  );
  const modelRoot = new THREE.Group();
  modelRoot.add(skeleton.root);
  const player = new OpenSimMotionPlayer(
    motion,
    skeleton.coordinateCatalog,
  );
  const frame = 92;
  applyOpenSimPose(
    skeleton,
    manifest,
    template,
    player.coordinateValuesAt(frame),
    { targetState },
  );
  modelRoot.updateMatrixWorld(true);

  const renderer = new OpenSimMuscleRenderer({
    muscleGroups,
    segmentGroups: skeleton.groups,
    modelRoot,
    targetState,
  });
  renderer.update(motion, frame);
  if (renderer.muscles.length !== muscleGroups.meta.pathCount) {
    fail(
      `runtime muscle path count mismatch in ${targetState ? "target" : "initial"} state`,
    );
  }
  for (const muscle of renderer.muscles) {
    const positions = muscle.geometry.getAttribute("position").array;
    if (!positions.every(Number.isFinite)) {
      fail(`${muscle.definition.id} tube has non-finite vertices`);
    }
    const activation =
      motion.activations[muscle.definition.side]?.[
        muscle.definition.activationColumn
      ]?.[frame] ?? 0;
    const expectedColor = muscleDrawStateForActivation(activation).color;
    if (muscle.material.color.getHex() !== expectedColor.getHex()) {
      fail(`${muscle.definition.id} color mapping differs`);
    }
  }
  renderer.setOpacityScale(0.5);
  const expectedOpacity =
    (renderer.muscles[0]?.definition.opacity ?? 1) * 0.5;
  if (
    renderer.muscles.length &&
    Math.abs(renderer.muscles[0].material.opacity - expectedOpacity) >
      1e-10
  ) {
    fail("muscle opacity mapping failed");
  }
  renderer.setVisible(false);
  if (renderer.muscles.some((muscle) => muscle.mesh.visible)) {
    fail("muscle visibility toggle failed");
  }
  renderer.dispose();
}

verifyState(true);
verifyState(false);

console.log("OpenSim muscle verification passed.");
console.log(`  Side-groups: ${muscleGroups.meta.groupCount}`);
console.log(`  Representative paths: ${pathCount}`);
console.log(`  Body-local points: ${pointCount}`);
console.log(`  Activation columns: ${expectedColumns.size}`);
