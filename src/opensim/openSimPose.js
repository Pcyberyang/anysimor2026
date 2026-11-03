import * as THREE from "three";

const COORDINATE_LABELS = {
  pelvis_rotation: "骨盆旋转",
  pelvis_tilt: "骨盆前倾/后倾",
  pelvis_list: "骨盆侧倾",
  pelvis_tx: "骨盆前后平移",
  pelvis_ty: "骨盆上下平移",
  pelvis_tz: "骨盆左右平移",
  Abs_FE: "胸腰段屈伸",
  Abs_LB: "胸腰段侧弯",
  Abs_AR: "胸腰段轴向旋转",
  shoulder_elv_r: "肩胛骨上提",
  shoulder_rot_r: "肩胛骨旋转",
  elv_angle_r: "肩关节抬高角",
  shoulder_elv_l: "肩胛骨上提",
  shoulder_rot_l: "肩胛骨旋转",
  elv_angle_l: "肩关节抬高角",
  elbow_flexion_r: "肘关节屈伸",
  elbow_flexion_l: "肘关节屈伸",
  pro_sup_r: "前臂旋前/旋后",
  pro_sup_l: "前臂旋前/旋后",
  wrist_dev_r: "腕关节桡偏/尺偏",
  wrist_flex_r: "腕关节屈伸",
  wrist_dev_l: "腕关节桡偏/尺偏",
  wrist_flex_l: "腕关节屈伸",
  hip_flexion_r: "髋关节屈伸",
  hip_adduction_r: "髋关节内收/外展",
  hip_rotation_r: "髋关节旋转",
  hip_flexion_l: "髋关节屈伸",
  hip_adduction_l: "髋关节内收/外展",
  hip_rotation_l: "髋关节旋转",
  knee_angle_r: "膝关节屈伸",
  knee_angle_l: "膝关节屈伸",
  ankle_angle_r: "踝关节背屈/跖屈",
  ankle_angle_l: "踝关节背屈/跖屈",
  subtalar_angle_r: "距下关节内翻/外翻",
  subtalar_angle_l: "距下关节内翻/外翻",
  knee_angle_r_beta: "右髌骨耦合角",
  knee_angle_l_beta: "左髌骨耦合角",
};

function coordinateLabel(name) {
  if (COORDINATE_LABELS[name]) {
    return COORDINATE_LABELS[name];
  }
  if (name.endsWith("_FE")) {
    return "屈伸（屈曲 / 伸展）";
  }
  if (name.endsWith("_LB")) {
    return "侧弯（左侧 / 右侧）";
  }
  if (name.endsWith("_AR")) {
    return "轴向旋转（右旋 / 左旋）";
  }
  return name.replaceAll("_", " ");
}

function coordinateDirections(name) {
  if (name.endsWith("_FE")) {
    return {
      negative: "屈曲",
      positive: "伸展",
    };
  }
  if (name.endsWith("_LB")) {
    return {
      negative: "左侧弯",
      positive: "右侧弯",
    };
  }
  if (name.endsWith("_AR")) {
    return {
      negative: "右旋",
      positive: "左旋",
    };
  }
  return {
    negative: "负向",
    positive: "正向",
  };
}

function dominantAxisLabel(axis) {
  if (!axis) {
    return "";
  }
  const names = ["X", "Y", "Z"];
  let dominantIndex = 0;
  for (let index = 1; index < 3; index += 1) {
    if (Math.abs(axis[index]) > Math.abs(axis[dominantIndex])) {
      dominantIndex = index;
    }
  }
  if (Math.abs(axis[dominantIndex]) < 1e-9) {
    return "";
  }
  return `${axis[dominantIndex] >= 0 ? "+" : "−"}${names[dominantIndex]}`;
}

function jointLabel(body) {
  const labels = {
    pelvis: "骨盆根关节",
    Abdomen: "腹部/胸腰连接",
    lumbar5: "腰骶 L5-S1",
    lumbar4: "腰椎 L4-L5",
    lumbar3: "腰椎 L3-L4",
    lumbar2: "腰椎 L2-L3",
    lumbar1: "腰椎 L1-L2",
    thoracic12: "胸腰交界 T12-L1（可见屈伸）",
    thoracic9: "胸椎 T9-T10",
    thoracic6: "胸椎 T6-T7",
    thoracic4: "胸椎 T4-T5",
    thoracic2: "胸椎 T2-T3",
    cerv7: "颈胸 T1-C7",
    cerv6: "颈椎 C7-C6",
    cerv5: "颈椎 C6-C5",
    cerv4: "颈椎 C5-C4",
    cerv3: "颈椎 C4-C3",
    cerv2: "颈椎 C3-C2",
    cerv1: "寰枢 C2-C1",
    head: "寰枕 C1-Head",
    humerus_R: "右肩复合关节",
    ulna_R: "右肘关节",
    radius_R: "右前臂",
    hand_R: "右腕关节",
    humerus_L: "左肩复合关节",
    ulna_L: "左肘关节",
    radius_L: "左前臂",
    hand_L: "左腕关节",
    femur_r: "右髋关节",
    tibia_r: "右膝关节",
    talus_r: "右踝关节",
    calcn_r: "右距下关节",
    femur_l: "左髋关节",
    tibia_l: "左膝关节",
    talus_l: "左踝关节",
    calcn_l: "左距下关节",
    patella_r: "右髌股约束",
    patella_l: "左髌股约束",
  };
  return labels[body.id] ?? body.label;
}

function jointDofNote(bodyId) {
  if (bodyId === "cerv1") {
    return "源模型 C2-C1 仅定义 C2_C1_AR（1 DOF）；FE、LB 未在 .osim 中创建。";
  }
  if (bodyId === "head") {
    return "源模型 C1-Head 仅定义 C1_head_FE（1 DOF）；LB、AR 未在 .osim 中创建。";
  }
  if (bodyId === "thoracic12") {
    return "胸腰段可见的屈伸控制是 T12_L1_FE；Abdomen 的 Abs_* 只驱动无网格辅助包裹体。";
  }
  return "";
}

function regionForBody(body) {
  if (body.id === "pelvis") {
    return "骨盆与根运动";
  }
  if (
    body.id === "Abdomen" ||
    body.id.startsWith("lumbar") ||
    body.id.startsWith("thoracic")
  ) {
    return "躯干与胸廓";
  }
  if (body.id.startsWith("cerv") || body.id === "head") {
    return "颈段与头部";
  }
  if (
    body.side === "right" &&
    (body.id.startsWith("clavicle") ||
      body.id.startsWith("scapula") ||
      body.id.startsWith("humerus") ||
      body.id.startsWith("ulna") ||
      body.id.startsWith("radius") ||
      body.id.startsWith("hand"))
  ) {
    return "右上肢";
  }
  if (
    body.side === "left" &&
    (body.id.startsWith("clavicle") ||
      body.id.startsWith("scapula") ||
      body.id.startsWith("humerus") ||
      body.id.startsWith("ulna") ||
      body.id.startsWith("radius") ||
      body.id.startsWith("hand"))
  ) {
    return "左上肢";
  }
  if (body.side === "right") {
    return "右下肢";
  }
  if (body.side === "left") {
    return "左下肢";
  }
  return "其他";
}

function naturalCubicValue(x, y, value) {
  if (!x.length || x.length !== y.length) {
    return 0;
  }
  if (value <= x[0]) {
    return y[0];
  }
  if (value >= x.at(-1)) {
    return y.at(-1);
  }

  const y2 = new Array(x.length).fill(0);
  const u = new Array(x.length).fill(0);
  for (let index = 1; index < x.length - 1; index += 1) {
    const sigma =
      (x[index] - x[index - 1]) / (x[index + 1] - x[index - 1]);
    const pivot = sigma * y2[index - 1] + 2;
    y2[index] = (sigma - 1) / pivot;
    u[index] =
      (6 *
        ((y[index + 1] - y[index]) / (x[index + 1] - x[index]) -
          (y[index] - y[index - 1]) / (x[index] - x[index - 1])) /
          (x[index + 1] - x[index - 1]) -
        sigma * u[index - 1]) /
      pivot;
  }
  y2[x.length - 1] = 0;
  for (let index = x.length - 2; index >= 0; index -= 1) {
    y2[index] = y2[index] * y2[index + 1] + u[index];
  }

  let interval = 0;
  while (interval < x.length - 2 && value > x[interval + 1]) {
    interval += 1;
  }
  const width = x[interval + 1] - x[interval];
  const a = (x[interval + 1] - value) / width;
  const b = (value - x[interval]) / width;
  return (
    a * y[interval] +
    b * y[interval + 1] +
    ((a ** 3 - a) * y2[interval] +
      (b ** 3 - b) * y2[interval + 1]) *
      (width ** 2) /
      6
  );
}

export function evaluateFunction(functionDefinition, values) {
  if (!functionDefinition) {
    return 0;
  }
  const inputs = Array.isArray(values) ? values : [values ?? 0];
  const first = Number.isFinite(inputs[0]) ? inputs[0] : 0;

  if (functionDefinition.type === "LinearFunction") {
    const coefficients = functionDefinition.coefficients ?? [];
    if (inputs.length === 1) {
      return (coefficients[0] ?? 1) * first + (coefficients[1] ?? 0);
    }
    return inputs.reduce(
      (sum, value, index) =>
        sum +
        (coefficients[index] ?? 0) *
          (Number.isFinite(value) ? value : 0),
      coefficients.at(-1) ?? 0,
    );
  }
  if (functionDefinition.type === "MultiplierFunction") {
    return (
      (Number.isFinite(functionDefinition.scale)
        ? functionDefinition.scale
        : 1) * evaluateFunction(functionDefinition.function, inputs)
    );
  }
  if (functionDefinition.type === "SimmSpline") {
    return naturalCubicValue(
      functionDefinition.x ?? [],
      functionDefinition.y ?? [],
      first,
    );
  }
  if (functionDefinition.type === "PolynomialFunction") {
    return (functionDefinition.coefficients ?? []).reduce(
      (sum, coefficient, index) => sum + coefficient * first ** index,
      0,
    );
  }
  return Number.isFinite(functionDefinition.value)
    ? functionDefinition.value
    : 0;
}

export function createCoordinateCatalog(manifest) {
  const constraints = (manifest.constraints ?? []).filter(
    (constraint) =>
      constraint.enforced &&
      constraint.type === "CoordinateCouplerConstraint",
  );
  const dependentNames = new Set(
    constraints.map((constraint) => constraint.dependent),
  );
  const definitions = [];
  const bodyById = new Map(manifest.bodies.map((body) => [body.id, body]));
  const visualInfluenceCache = new Map();

  function hasVisualInfluence(bodyId) {
    if (visualInfluenceCache.has(bodyId)) {
      return visualInfluenceCache.get(bodyId);
    }
    const body = bodyById.get(bodyId);
    const visible =
      body.geometry.length > 0 ||
      manifest.bodies
        .filter((candidate) => candidate.parent === bodyId)
        .some((child) => hasVisualInfluence(child.id));
    visualInfluenceCache.set(bodyId, visible);
    return visible;
  }

  for (const body of manifest.bodies) {
    for (const coordinate of body.joint.coordinates) {
      const relatedAxes = body.joint.transformAxes.filter((axis) => {
        const names = axis.coordinateNames ?? [axis.coordinates];
        return names.includes(coordinate.name);
      });
      const motionType = relatedAxes.some((axis) => axis.kind === "rotation")
        ? "rotation"
        : "translation";
      const primaryAxis =
        relatedAxes.find((axis) => axis.kind === "rotation") ??
        relatedAxes[0] ??
        null;
      const directions = coordinateDirections(coordinate.name);
      definitions.push({
        ...coordinate,
        label: coordinateLabel(coordinate.name),
        motionType,
        unit: motionType === "rotation" ? "deg" : "cm",
        bodyId: body.id,
        jointId: body.joint.id,
        jointLabel: jointLabel(body),
        region: regionForBody(body),
        constrained: dependentNames.has(coordinate.name),
        hasVisualInfluence: hasVisualInfluence(body.id),
        jointDofNote: jointDofNote(body.id),
        axisLabel: dominantAxisLabel(primaryAxis?.axis),
        negativeDirection: directions.negative,
        positiveDirection: directions.positive,
      });
    }
  }

  return {
    definitions,
    byName: new Map(
      definitions.map((coordinate) => [coordinate.name, coordinate]),
    ),
    constraints,
  };
}

export function resolveCoordinateValues(catalog, sourceValues = {}) {
  const resolved = {};
  for (const coordinate of catalog.definitions) {
    const raw = sourceValues[coordinate.name];
    resolved[coordinate.name] = Number.isFinite(raw)
      ? raw
      : coordinate.default;
  }

  // The current model has direct linear coupling constraints. A few passes
  // also handle chained couplers without pretending to solve general IK.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const constraint of catalog.constraints) {
      const independentValues = constraint.independent.map(
        (name) => resolved[name] ?? catalog.byName.get(name)?.default ?? 0,
      );
      const value = evaluateFunction(
        constraint.function,
        independentValues,
      );
      if (
        Number.isFinite(value) &&
        Math.abs((resolved[constraint.dependent] ?? 0) - value) > 1e-12
      ) {
        resolved[constraint.dependent] = value;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return resolved;
}

function frameMatrix(translation, orientation) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(translation),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        orientation[0] || 0,
        orientation[1] || 0,
        orientation[2] || 0,
        "XYZ",
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
}

export function createRelativeJointMatrix({
  body,
  coordinateValues,
  targetState,
  scalingTemplate,
}) {
  const joint = body.joint;
  const parentFrame = targetState
    ? joint.parentFrame.translation
    : joint.parentFrame.unscaledTranslation;
  const childFrame = targetState
    ? joint.childFrame.translation
    : joint.childFrame.unscaledTranslation;
  const parentBodyId = joint.parentFrame.body;
  const parentScale =
    parentBodyId === "ground"
      ? [1, 1, 1]
      : scalingTemplate.bodies[parentBodyId]?.scaleFactors ?? [1, 1, 1];

  const rotations = new THREE.Matrix4();
  const translations = new THREE.Matrix4();
  for (const axis of joint.transformAxes) {
    const coordinateNames = axis.coordinateNames ?? [axis.coordinates];
    const values = coordinateNames
      .filter(Boolean)
      .map((name) => coordinateValues[name] ?? 0);
    const displacement = evaluateFunction(axis.function, values);
    if (Math.abs(displacement) < 1e-14) {
      continue;
    }
    const direction = new THREE.Vector3()
      .fromArray(axis.axis)
      .normalize();
    const axisMatrix = new THREE.Matrix4();
    if (axis.kind === "rotation") {
      axisMatrix.makeRotationAxis(direction, displacement);
      rotations.multiply(axisMatrix);
    } else {
      const translation = direction.multiplyScalar(displacement);
      if (!targetState) {
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
      }
      axisMatrix.makeTranslation(
        translation.x,
        translation.y,
        translation.z,
      );
      translations.multiply(axisMatrix);
    }
  }

  return frameMatrix(parentFrame, joint.parentFrame.orientation)
    // OpenSim SpatialTransform composes the translation chain first and then
    // the rotation chain: T1*T2*T3*R1*R2*R3.
    .multiply(translations.multiply(rotations))
    .multiply(
      frameMatrix(childFrame, joint.childFrame.orientation).invert(),
    );
}

export function applyOpenSimPose(
  skeleton,
  manifest,
  scalingTemplate,
  coordinateValues,
  { targetState },
) {
  const catalog = skeleton.coordinateCatalog ?? createCoordinateCatalog(manifest);
  const resolved = resolveCoordinateValues(catalog, coordinateValues);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const unitScale = new THREE.Vector3();

  for (const body of manifest.bodies) {
    const group = skeleton.groups.get(body.id);
    if (!group) {
      continue;
    }
    const relative = createRelativeJointMatrix({
      body,
      coordinateValues: resolved,
      targetState,
      scalingTemplate,
    });
    relative.decompose(position, quaternion, unitScale);
    group.position.copy(position);
    group.quaternion.copy(quaternion);

    const childFrame = targetState
      ? body.joint.childFrame.translation
      : body.joint.childFrame.unscaledTranslation;
    const centerInParent = new THREE.Vector3()
      .fromArray(childFrame)
      .applyMatrix4(relative);
    const parentMarker = skeleton.root.getObjectByName(
      `joint_${body.joint.id}_parent`,
    );
    const parentHalo = skeleton.root.getObjectByName(
      `joint_${body.joint.id}_halo`,
    );
    parentMarker?.position.copy(centerInParent);
    parentHalo?.position.copy(centerInParent);
  }

  skeleton.root.updateMatrixWorld(true);
  return resolved;
}
