import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

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
const manifestPath = path.join(dataRoot, "skeleton-manifest.json");
const templatePath = path.join(dataRoot, "scaling-template.json");
const reportPath = path.join(dataRoot, "export-report.json");

function fail(message) {
  throw new Error(`OpenSim skeleton verification failed: ${message}`);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function matrixFromTransform(transform) {
  const quaternion = new THREE.Quaternion().fromArray(
    transform.quaternion,
  );
  if (
    !Number.isFinite(quaternion.x) ||
    !Number.isFinite(quaternion.y) ||
    !Number.isFinite(quaternion.z) ||
    !Number.isFinite(quaternion.w)
  ) {
    fail("transform contains a non-finite quaternion");
  }
  quaternion.normalize();
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(transform.position),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
}

function frameMatrix(frame) {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      frame.orientation[0] || 0,
      frame.orientation[1] || 0,
      frame.orientation[2] || 0,
      "XYZ",
    ),
  );
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(frame.translation),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );
}

function defaultJointMatrix(transformAxes, parentScale = [1, 1, 1]) {
  const rotations = new THREE.Matrix4();
  const translations = new THREE.Matrix4();
  for (const axis of transformAxes) {
    if (Math.abs(axis.defaultValue) < 1e-12) {
      continue;
    }
    const direction = new THREE.Vector3()
      .fromArray(axis.axis)
      .normalize();
    const axisMatrix = new THREE.Matrix4();
    if (axis.kind === "rotation") {
      axisMatrix.makeRotationAxis(direction, axis.defaultValue);
      rotations.multiply(axisMatrix);
    } else {
      const translation = direction.multiplyScalar(axis.defaultValue);
      translation.fromArray(
        translation
          .toArray()
          .map(
            (value, index) =>
              value /
              (Number.isFinite(parentScale[index])
                ? parentScale[index]
                : 1),
          ),
      );
      axisMatrix.makeTranslation(
        translation.x,
        translation.y,
        translation.z,
      );
      translations.multiply(axisMatrix);
    }
  }
  return translations.multiply(rotations);
}

function validateTransform(label, actualTransform, expectedMatrix) {
  const actualMatrix = matrixFromTransform(actualTransform);
  let maxError = 0;
  for (let index = 0; index < 16; index += 1) {
    maxError = Math.max(
      maxError,
      Math.abs(actualMatrix.elements[index] - expectedMatrix.elements[index]),
    );
  }
  if (maxError > 1e-9) {
    fail(
      `${label} matrix mismatch: ${maxError}`,
    );
  }
}

function validateStl(filePath, expectedTriangles, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} geometry file missing: ${filePath}`);
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 84) {
    fail(`${label} STL is too short`);
  }
  const triangles = bytes.readUInt32LE(80);
  if (triangles !== expectedTriangles) {
    fail(
      `${label} STL triangle count ${triangles} != ${expectedTriangles}`,
    );
  }
  if (bytes.length !== 84 + triangles * 50) {
    fail(`${label} STL byte length does not match triangle count`);
  }
}

const manifest = readJson(manifestPath);
const template = readJson(templatePath);
const report = readJson(reportPath);

if (manifest.modelKind !== "opensim-skeleton") {
  fail("unexpected skeleton manifest kind");
}
if (template.modelKind !== "opensim-scaling-template") {
  fail("unexpected scaling template kind");
}
if (manifest.source.modelSha256 !== template.source.modelSha256) {
  fail("manifest and scaling template source hashes differ");
}
if (manifest.meta.bodyCount !== manifest.bodies.length) {
  fail("manifest body count is inconsistent");
}
if (manifest.meta.jointCount !== manifest.bodies.length) {
  fail("expected one incoming joint for every OpenSim Body");
}
if (manifest.meta.jointCount !== report.jointCount) {
  fail("manifest and export report joint count differ");
}
if (manifest.meta.geometryCount !== report.geometryCount) {
  fail("manifest and export report geometry count differ");
}

const sourceCopy = path.resolve(projectRoot, report.sourceCopy);
if (!fs.existsSync(sourceCopy)) {
  fail("source .osim copy is missing");
}
const sourceHash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(sourceCopy))
  .digest("hex");
if (sourceHash !== manifest.source.modelSha256) {
  fail("source .osim copy hash does not match the manifest");
}

const bodyIds = new Set();
const childBodyIds = new Set();
const bodyById = new Map();
let geometryCount = 0;
let triangleCount = 0;

for (const body of manifest.bodies) {
  if (!body.id || bodyIds.has(body.id)) {
    fail(`invalid or duplicate Body id: ${body.id}`);
  }
  bodyIds.add(body.id);
  bodyById.set(body.id, body);

  if (!body.joint) {
    fail(`Body ${body.id} has no incoming joint`);
  }
  if (childBodyIds.has(body.id)) {
    fail(`Body ${body.id} is connected more than once`);
  }
  childBodyIds.add(body.id);
  if (body.joint.childBody !== body.id) {
    fail(`Body ${body.id} joint child does not match`);
  }

  const templateBody = template.bodies[body.id];
  if (!templateBody) {
    fail(`scaling template missing Body ${body.id}`);
  }
  if (
    !Array.isArray(templateBody.scaleFactors) ||
    templateBody.scaleFactors.length !== 3 ||
    templateBody.scaleFactors.some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  ) {
    fail(`Body ${body.id} has invalid scale factors`);
  }

  const geometryIds = new Set();
  for (const geometry of body.geometry) {
    if (geometryIds.has(geometry.id)) {
      fail(`Body ${body.id} has duplicate geometry id ${geometry.id}`);
    }
    geometryIds.add(geometry.id);
    geometryCount += 1;
    triangleCount += geometry.triangleCount;

    const templateGeometry = templateBody.geometry?.[geometry.id];
    if (!templateGeometry) {
      fail(
        `scaling template missing geometry ${body.id}/${geometry.id}`,
      );
    }
    if (
      !Array.isArray(templateGeometry.scaleFactors) ||
      templateGeometry.scaleFactors.length !== 3 ||
      templateGeometry.scaleFactors.some(
        (value) => !Number.isFinite(value) || value <= 0,
      )
    ) {
      fail(`invalid geometry scale for ${body.id}/${geometry.id}`);
    }

    validateStl(
      path.join(geometryRoot, geometry.file),
      geometry.triangleCount,
      `${body.id}/${geometry.id}`,
    );
  }
}

if (geometryCount !== manifest.meta.geometryCount) {
  fail(`manifest geometry count ${geometryCount} is inconsistent`);
}
if (triangleCount !== report.triangleCount) {
  fail("manifest and report triangle counts differ");
}

for (const body of manifest.bodies) {
  if (body.parent === null) {
    if (body.id !== "pelvis" || body.joint.parentFrame.body !== "ground") {
      fail(`unexpected root Body: ${body.id}`);
    }
  } else if (!bodyIds.has(body.parent)) {
    fail(`Body ${body.id} references missing parent ${body.parent}`);
  }

  const targetParentFrame = frameMatrix(body.joint.parentFrame);
  const targetChildFrame = frameMatrix(body.joint.childFrame);
  const targetExpected = targetParentFrame
    .clone()
    .multiply(defaultJointMatrix(body.joint.transformAxes))
    .multiply(targetChildFrame.clone().invert());
  validateTransform(
    `${body.id}/${body.joint.id}/targetRelativeTransform`,
    body.joint.targetRelativeTransform,
    targetExpected,
  );

  const parentBodyId = body.joint.parentFrame.body;
  const parentScale =
    parentBodyId === "ground"
      ? [1, 1, 1]
      : template.bodies[parentBodyId]?.scaleFactors;
  if (!parentScale) {
    fail(`missing parent scale for ${body.id}`);
  }
  const initialParentFrame = frameMatrix({
    translation: body.joint.parentFrame.unscaledTranslation,
    orientation: body.joint.parentFrame.orientation,
  });
  const initialChildFrame = frameMatrix({
    translation: body.joint.childFrame.unscaledTranslation,
    orientation: body.joint.childFrame.orientation,
  });
  const initialExpected = initialParentFrame
    .clone()
    .multiply(defaultJointMatrix(body.joint.transformAxes, parentScale))
    .multiply(initialChildFrame.clone().invert());
  validateTransform(
    `${body.id}/${body.joint.id}/initialRelativeTransform`,
    body.joint.initialRelativeTransform,
    initialExpected,
  );

  const templateJoint = template.joints[body.id];
  if (!templateJoint) {
    fail(`scaling template missing joint for Body ${body.id}`);
  }
  validateTransform(
    `${body.id}/${body.joint.id}/template target`,
    templateJoint.targetRelativeTransform,
    targetExpected,
  );
}

const coordinateNames = new Set(Object.keys(manifest.coordinateDefaults));
if (coordinateNames.size !== manifest.meta.coordinateCount) {
  fail("coordinate count is inconsistent");
}
const constraints = manifest.constraints ?? [];
if (constraints.length !== 2) {
  fail(`expected 2 coordinate coupler constraints, got ${constraints.length}`);
}
for (const body of manifest.bodies) {
  for (const coordinate of body.joint.coordinates) {
    if (!coordinateNames.has(coordinate.name)) {
      fail(
        `joint ${body.joint.id} references missing coordinate ${coordinate.name}`,
      );
    }
  }
  if (body.joint.coordinates.length && !body.joint.transformAxes.length) {
    fail(`joint ${body.joint.id} has coordinates but no evaluable transform axes`);
  }
}
for (const constraint of constraints) {
  if (!coordinateNames.has(constraint.dependent)) {
    fail(`constraint ${constraint.id} has an unknown dependent coordinate`);
  }
  for (const independent of constraint.independent) {
    if (!coordinateNames.has(independent)) {
      fail(`constraint ${constraint.id} has an unknown independent coordinate`);
    }
  }
}

let maxParentDepth = 0;
for (const body of manifest.bodies) {
  let depth = 0;
  let cursor = body;
  const seen = new Set();
  while (cursor.parent) {
    if (seen.has(cursor.id)) {
      fail(`cycle detected at Body ${cursor.id}`);
    }
    seen.add(cursor.id);
    cursor = bodyById.get(cursor.parent);
    if (!cursor) {
      fail(`broken parent chain at ${body.id}`);
    }
    depth += 1;
  }
  maxParentDepth = Math.max(maxParentDepth, depth);
}

console.log("OpenSim skeleton verification passed.");
console.log(`  Bodies: ${bodyIds.size}`);
console.log(`  Joints: ${childBodyIds.size}`);
console.log(`  Coordinates: ${coordinateNames.size}`);
console.log(`  Geometry: ${geometryCount}`);
console.log(`  Triangles: ${triangleCount}`);
console.log(`  Max parent depth: ${maxParentDepth}`);
console.log(`  Source SHA256: ${manifest.source.modelSha256}`);
