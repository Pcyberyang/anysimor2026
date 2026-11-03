import * as THREE from "three";

const RADIAL_SEGMENTS = 10;
const RING_SEGMENTS = 16;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

export function createDynamicTubeGeometry() {
  const vertexCount = (RING_SEGMENTS + 1) * RADIAL_SEGMENTS;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = [];

  for (let ring = 0; ring <= RING_SEGMENTS; ring += 1) {
    const v = ring / RING_SEGMENTS;
    for (let radial = 0; radial < RADIAL_SEGMENTS; radial += 1) {
      const index = ring * RADIAL_SEGMENTS + radial;
      uvs[index * 2] = radial / RADIAL_SEGMENTS;
      uvs[index * 2 + 1] = v;
    }
  }

  for (let ring = 0; ring < RING_SEGMENTS; ring += 1) {
    for (let radial = 0; radial < RADIAL_SEGMENTS; radial += 1) {
      const nextRadial = (radial + 1) % RADIAL_SEGMENTS;
      const a = ring * RADIAL_SEGMENTS + radial;
      const b = ring * RADIAL_SEGMENTS + nextRadial;
      const c = (ring + 1) * RADIAL_SEGMENTS + radial;
      const d = (ring + 1) * RADIAL_SEGMENTS + nextRadial;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(normals, 3),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function updateTubeGeometry(
  geometry,
  curve,
  bellyRadius,
  radiusScale,
) {
  const positionAttribute = geometry.getAttribute("position");
  const normalAttribute = geometry.getAttribute("normal");
  const center = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const radialDirection = new THREE.Vector3();
  curve.getTangent(0, tangent).normalize();
  const reference =
    Math.abs(tangent.dot(WORLD_UP)) < 0.92 ? WORLD_UP : WORLD_RIGHT;
  normal.crossVectors(tangent, reference).normalize();
  if (normal.lengthSq() < 1e-12) {
    normal.set(1, 0, 0);
  }

  for (let ring = 0; ring <= RING_SEGMENTS; ring += 1) {
    const progress = ring / RING_SEGMENTS;
    curve.getPoint(progress, center);
    curve.getTangent(progress, tangent).normalize();

    normal.projectOnPlane(tangent);
    if (normal.lengthSq() < 1e-12) {
      normal.crossVectors(tangent, reference);
    }
    normal.normalize();
    binormal.crossVectors(tangent, normal).normalize();

    const belly =
      0.1 + 0.9 * Math.pow(Math.sin(Math.PI * progress), 0.72);
    const radius = Math.max(bellyRadius * belly * radiusScale, 1e-5);

    for (let radial = 0; radial < RADIAL_SEGMENTS; radial += 1) {
      const angle = (radial / RADIAL_SEGMENTS) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      radialDirection
        .copy(normal)
        .multiplyScalar(cosine)
        .addScaledVector(binormal, sine);

      const vertex = ring * RADIAL_SEGMENTS + radial;
      positionAttribute.setXYZ(
        vertex,
        center.x + radialDirection.x * radius,
        center.y + radialDirection.y * radius,
        center.z + radialDirection.z * radius,
      );
      normalAttribute.setXYZ(
        vertex,
        radialDirection.x,
        radialDirection.y,
        radialDirection.z,
      );
    }
  }

  positionAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
}
