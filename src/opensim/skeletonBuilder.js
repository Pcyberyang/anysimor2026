import * as THREE from "three";
import { createCoordinateCatalog } from "./openSimPose.js";

const BONE_COLOR = 0xe7d7c1;
const BONE_ACCENT_COLOR = 0xcfb894;
const JOINT_COLOR = 0x39c5bb;
const JOINT_HALO_COLOR = 0x0e7c86;

function applyTransform(object, transform) {
  object.position.fromArray(transform.position);
  object.quaternion.fromArray(transform.quaternion);
  object.updateMatrix();
}

function isRib(bodyId) {
  return bodyId.startsWith("rib");
}

function isArm(bodyId) {
  return (
    bodyId.startsWith("clavicle") ||
    bodyId.startsWith("scapula") ||
    bodyId.startsWith("humerus") ||
    bodyId.startsWith("ulna") ||
    bodyId.startsWith("radius") ||
    bodyId.startsWith("hand")
  );
}

function bodyColor(bodyId) {
  if (isRib(bodyId)) {
    return 0xd8c08e;
  }
  if (isArm(bodyId)) {
    return 0xe3cfb4;
  }
  return BONE_COLOR;
}

function createMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

function createJointMarkerGeometry(radius) {
  const geometry = new THREE.SphereGeometry(radius, 16, 12);
  geometry.userData.isJointMarkerGeometry = true;
  return geometry;
}

export function createJointMarker(radius, size = "small") {
  const material = new THREE.MeshBasicMaterial({
    color: JOINT_COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.92,
  });
  const marker = new THREE.Mesh(createJointMarkerGeometry(radius), material);
  marker.userData.isJointMarker = true;
  marker.userData.markerSize = size;
  marker.renderOrder = 30;
  return marker;
}

export function createJointHalo(radius) {
  const material = new THREE.MeshBasicMaterial({
    color: JOINT_HALO_COLOR,
    depthWrite: false,
    transparent: true,
    opacity: 0.4,
    wireframe: true,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
  halo.userData.isJointMarker = true;
  halo.userData.markerSize = "halo";
  halo.renderOrder = 29;
  return halo;
}

function addJointVisuals(body, parentGroup, childGroup, targetState) {
  if (!body.joint) {
    return;
  }
  const joint = body.joint;
  const parentFrame = targetState
    ? joint.parentFrame.translation
    : joint.parentFrame.unscaledTranslation;
  const childFrame = targetState
    ? joint.childFrame.translation
    : joint.childFrame.unscaledTranslation;
  const relative = targetState
    ? joint.targetRelativeTransform
    : joint.initialRelativeTransform;
  const centerInParent = new THREE.Vector3()
    .fromArray(childFrame)
    .applyMatrix4(matrixFromTransform(relative));

  const markerRadius = body.id.includes("rib") ? 0.0025 : 0.0045;
  const haloRadius = body.id.includes("rib") ? 0.004 : 0.007;

  const parentMarker = createJointMarker(markerRadius);
  parentMarker.position.copy(centerInParent);
  parentMarker.name = `joint_${joint.id}_parent`;
  parentMarker.userData.jointId = joint.id;
  (parentGroup ?? childGroup.parent ?? childGroup).add(parentMarker);

  const childMarker = createJointMarker(markerRadius);
  childMarker.position.fromArray(childFrame);
  childMarker.name = `joint_${joint.id}_child`;
  childMarker.userData.jointId = joint.id;
  childGroup.add(childMarker);

  if (!body.id.includes("rib")) {
    const parentHalo = createJointHalo(haloRadius);
    parentHalo.position.copy(centerInParent);
    parentHalo.name = `joint_${joint.id}_halo`;
    parentHalo.userData.jointId = joint.id;
    (parentGroup ?? childGroup.parent ?? childGroup).add(parentHalo);
  }

  body.userDataJointCenter = centerInParent.toArray();
  body.userDataParentFrame = [...parentFrame];
}

function matrixFromTransform(transform) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(transform.position),
    new THREE.Quaternion().fromArray(transform.quaternion),
    new THREE.Vector3(1, 1, 1),
  );
}

export function buildOpenSimSkeleton(
  manifest,
  scalingTemplate,
  geometryMap,
  { targetState = false } = {},
) {
  const root = new THREE.Group();
  root.name = targetState
    ? "opensimSkeletonTarget"
    : "opensimSkeletonInitial";

  const groups = new Map();
  const bodyById = new Map(manifest.bodies.map((body) => [body.id, body]));

  for (const body of manifest.bodies) {
    const group = new THREE.Group();
    group.name = body.id;
    group.userData.bodyId = body.id;
    group.userData.label = body.label;
    group.userData.parent = body.parent;
    group.userData.side = body.side;

    const jointTransform = targetState
      ? body.joint.targetRelativeTransform
      : body.joint.initialRelativeTransform;
    applyTransform(group, jointTransform);

    const material = createMaterial(bodyColor(body.id));
    const templateBody = scalingTemplate.bodies[body.id];

    for (const geometryDefinition of body.geometry) {
      const sourceGeometry = geometryMap[geometryDefinition.file];
      if (!sourceGeometry) {
        continue;
      }
      const templateGeometry =
        templateBody.geometry[geometryDefinition.id];
      const geometryTransform = targetState
        ? templateGeometry.transform
        : geometryDefinition.transform;
      const geometryScale = targetState
        ? templateGeometry.scaleFactors
        : geometryDefinition.scaleFactors;

      const mesh = new THREE.Mesh(sourceGeometry, material);
      mesh.name = `${body.id}_${geometryDefinition.id}`;
      mesh.userData.isSegmentVisual = true;
      mesh.userData.bodyId = body.id;
      mesh.userData.geometryId = geometryDefinition.id;
      mesh.userData.sourceFile = geometryDefinition.sourceFile;
      mesh.userData.sourceVisible = geometryDefinition.appearance.visible;
      mesh.position.fromArray(geometryTransform.position);
      mesh.quaternion.fromArray(geometryTransform.quaternion);
      mesh.scale.fromArray(geometryScale);
      mesh.visible = geometryDefinition.appearance.visible;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    groups.set(body.id, group);
    root.add(group);
  }

  for (const body of manifest.bodies) {
    const group = groups.get(body.id);
    if (!body.parent) {
      root.add(group);
      continue;
    }
    const parentGroup = groups.get(body.parent);
    if (!parentGroup) {
      root.add(group);
      continue;
    }
    parentGroup.add(group);
  }

  for (const body of manifest.bodies) {
    const childGroup = groups.get(body.id);
    const parentBodyId = body.joint?.parentFrame?.body;
    const parentGroup =
      parentBodyId && parentBodyId !== "ground"
        ? groups.get(parentBodyId)
        : null;
    addJointVisuals(body, parentGroup, childGroup, targetState);
  }

  return {
    root,
    groups,
    bodyById,
    targetState,
    coordinateCatalog: createCoordinateCatalog(manifest),
  };
}
