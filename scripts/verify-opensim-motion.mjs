import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { buildOpenSimSkeleton } from "../src/opensim/skeletonBuilder.js";
import { applyOpenSimPose } from "../src/opensim/openSimPose.js";
import { OpenSimMotionPlayer } from "../src/opensim/motionPlayer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "public", "data", "opensim");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  throw new Error(`OpenSim motion verification failed: ${message}`);
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

const manifest = readJson(path.join(dataRoot, "skeleton-manifest.json"));
const template = readJson(path.join(dataRoot, "scaling-template.json"));
const motion = readJson(path.join(dataRoot, "motion-data.json"));
const report = readJson(path.join(dataRoot, "motion-report.json"));
const rightFile = path.join(projectRoot, "input", "全身活动测量右侧.xlsx");
const leftFile = path.join(projectRoot, "input", "全身活动测量左侧.xlsx");

if (motion.meta.frameCount !== 185) {
  fail(`expected 185 frames, got ${motion.meta.frameCount}`);
}
if (motion.frameTimesSeconds.length !== 185) {
  fail("frame time count differs from frame count");
}
if (motion.coordinateNames.length !== 87) {
  fail("motion coordinate count must match the skeleton");
}
if (motion.meta.explicitCoordinateCount !== 82) {
  fail(
    `expected 82 explicit skeleton coordinates, got ${motion.meta.explicitCoordinateCount}`,
  );
}
if (motion.meta.activationColumnCount !== 14) {
  fail(
    `expected 14 populated muscle activation columns, got ${motion.meta.activationColumnCount}`,
  );
}
if (sha256(rightFile) !== motion.source.rightWorkbookSha256) {
  fail("right workbook changed after motion export");
}
if (sha256(leftFile) !== motion.source.leftWorkbookSha256) {
  fail("left workbook changed after motion export");
}
if (!report.audit || report.audit.maxCoordinateError > 1e-7) {
  fail("motion no longer reproduces the audited source coordinate table");
}

for (let index = 1; index < motion.frameTimesSeconds.length; index += 1) {
  if (
    motion.frameTimesSeconds[index] <=
    motion.frameTimesSeconds[index - 1]
  ) {
    fail("frame time is not strictly increasing");
  }
}

for (const coordinateName of motion.coordinateNames) {
  const values = motion.coordinates[coordinateName];
  if (!Array.isArray(values) || values.length !== motion.meta.frameCount) {
    fail(`coordinate ${coordinateName} has an invalid frame array`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    fail(`coordinate ${coordinateName} contains a non-finite value`);
  }
}
const rightActivationColumns = Object.keys(motion.activations.right).sort();
const leftActivationColumns = Object.keys(motion.activations.left).sort();
if (
  JSON.stringify(rightActivationColumns) !==
  JSON.stringify(leftActivationColumns)
) {
  fail("left/right muscle activation columns differ");
}
for (const side of ["right", "left"]) {
  for (const [columnName, values] of Object.entries(
    motion.activations[side],
  )) {
    if (!Array.isArray(values) || values.length !== motion.meta.frameCount) {
      fail(`${side} ${columnName} has an invalid activation array`);
    }
    if (
      values.some(
        (value) =>
          !Number.isFinite(value) || value < 0 || value > 1,
      )
    ) {
      fail(`${side} ${columnName} activation is outside 0..1`);
    }
  }
}

for (let frame = 0; frame < motion.meta.frameCount; frame += 1) {
  const kneeRight = motion.coordinates.knee_angle_r[frame];
  const betaRight = motion.coordinates.knee_angle_r_beta[frame];
  if (Math.abs(kneeRight - betaRight) > 1e-10) {
    fail(`right patella coupling failed at frame ${frame}`);
  }
  const kneeLeft = motion.coordinates.knee_angle_l[frame];
  const betaLeft = motion.coordinates.knee_angle_l_beta[frame];
  if (Math.abs(kneeLeft - betaLeft) > 1e-10) {
    fail(`left patella coupling failed at frame ${frame}`);
  }
}

const skeleton = buildOpenSimSkeleton(
  manifest,
  template,
  {},
  { targetState: true },
);
const player = new OpenSimMotionPlayer(
  motion,
  skeleton.coordinateCatalog,
);

function poseAt(frame) {
  const values = player.coordinateValuesAt(frame);
  applyOpenSimPose(
    skeleton,
    manifest,
    template,
    values,
    { targetState: true },
  );
  skeleton.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(skeleton.root);
  if (bounds.isEmpty() || !bounds.min.toArray().every(Number.isFinite)) {
    fail(`frame ${frame} produces invalid skeleton bounds`);
  }
  return {
    pelvis: skeleton.groups
      .get("pelvis")
      .getWorldPosition(new THREE.Vector3()),
    femur_r: skeleton.groups
      .get("femur_r")
      .getWorldPosition(new THREE.Vector3()),
    tibia_r: skeleton.groups
      .get("tibia_r")
      .getWorldPosition(new THREE.Vector3()),
    patella_r: skeleton.groups
      .get("patella_r")
      .getWorldPosition(new THREE.Vector3()),
    rightFoot: skeleton.groups
      .get("calcn_r")
      .getWorldPosition(new THREE.Vector3()),
    leftFoot: skeleton.groups
      .get("calcn_l")
      .getWorldPosition(new THREE.Vector3()),
  };
}

const first = poseAt(0);
const middle = poseAt(92);
const last = poseAt(player.lastFrame);
if (first.pelvis.distanceTo(last.pelvis) < 0.2) {
  fail("root motion is not visible in the converted data");
}
if (
  first.rightFoot.distanceTo(middle.rightFoot) < 0.01 ||
  first.leftFoot.distanceTo(middle.leftFoot) < 0.01
) {
  fail("lower-limb motion is not visible in the converted data");
}

// Independent transforms read from OpenSim 4.6 with the same coordinate set.
// These catch SpatialTransform translation/rotation order regressions that
// cannot be detected by comparing the exporter and runtime to each other.
const openSimReference = {
  0: {
    pelvis: [-1.493042986292882, 1.0214029174853743, 0.20527443442864252],
    femur_r: [-1.5672762790219879, 0.965305479874806, 0.28228769944987453],
    tibia_r: [-1.5004483929190457, 0.5434194650597688, 0.32167173981744973],
    patella_r: [-1.4837673352366478, 0.5071858058888568, 0.32550925498337663],
  },
  92: {
    pelvis: [-0.3220482363139356, 0.9909357886616652, 0.24318006101105683],
    femur_r: [-0.39787326444790333, 0.9348145596451587, 0.31860896798488936],
    tibia_r: [-0.4441206383984425, 0.5138891957161329, 0.3463074009036388],
    patella_r: [-0.4207165623208664, 0.4725759513850638, 0.3502122904364644],
  },
};

for (const [label, pose] of [
  ["frame0", first],
  ["frame92", middle],
]) {
  const frame = label === "frame0" ? 0 : 92;
  for (const [bodyId, expectedPosition] of Object.entries(
    openSimReference[frame],
  )) {
    const error = pose[bodyId].distanceTo(
      new THREE.Vector3().fromArray(expectedPosition),
    );
    if (error > 5e-5) {
      fail(
        `${label} ${bodyId} differs from OpenSim by ${(error * 1000).toFixed(4)} mm`,
      );
    }
  }
}

const nearStatic = new Set(motion.meta.nearStaticCoordinates);
for (const name of [
  "T12_L1_FE",
  "T12_L1_LB",
  "T12_L1_AR",
  "C2_C1_AR",
  "C1_head_FE",
]) {
  if (!nearStatic.has(name)) {
    fail(`${name} no longer matches the source table's near-static audit`);
  }
}

console.log("OpenSim XLSX motion verification passed.");
console.log(
  `  Frames: ${motion.meta.frameCount}, fps: ${motion.meta.fps.toFixed(6)}, duration: ${motion.meta.durationSeconds.toFixed(6)} s`,
);
console.log(
  `  Coordinates: ${motion.meta.explicitCoordinateCount} explicit / ${motion.coordinateNames.length} total`,
);
console.log(
  `  Source audit error: ${report.audit.maxCoordinateError.toExponential(3)}`,
);
console.log(
  `  Pelvis travel: ${first.pelvis.distanceTo(last.pelvis).toFixed(4)} m`,
);
console.log(
  `  Near-static source coordinates: ${motion.meta.nearStaticCoordinates.length}`,
);
