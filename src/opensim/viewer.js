import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { buildOpenSimSkeleton } from "./skeletonBuilder.js";
import {
  applyOpenSimPose,
  createCoordinateCatalog,
  resolveCoordinateValues,
} from "./openSimPose.js";
import { OpenSimMotionPlayer } from "./motionPlayer.js";
import { OpenSimMuscleRenderer } from "./muscleRenderer.js";

const PROFILE_URL = new URL(
  "./data/opensim/model-profile.json",
  document.baseURI,
).href;

const canvas = document.querySelector("#scene");
const loadingPanel = document.querySelector("#loadingPanel");
const loadingText = document.querySelector("#loadingText");
const stateLabel = document.querySelector("#stateLabel");
const sourceLabel = document.querySelector("#sourceLabel");
const bodyCount = document.querySelector("#bodyCount");
const jointCount = document.querySelector("#jointCount");
const coordinateCount = document.querySelector("#coordinateCount");
const geometryCount = document.querySelector("#geometryCount");
const warningPanel = document.querySelector("#warningPanel");
const warningText = document.querySelector("#warningText");
const poseModeLabel = document.querySelector("#poseModeLabel");
const motionSlider = document.querySelector("#motionSlider");
const motionTime = document.querySelector("#motionTime");
const motionFrame = document.querySelector("#motionFrame");
const motionPlayButton = document.querySelector("#motionPlay");
const motionPrevButton = document.querySelector("#motionPrev");
const motionNextButton = document.querySelector("#motionNext");
const motionDataNote = document.querySelector("#motionDataNote");
const showMuscles = document.querySelector("#showOpenSimMuscles");
const muscleOpacitySlider = document.querySelector(
  "#openSimMuscleOpacity",
);
const muscleOpacityValue = document.querySelector(
  "#openSimMuscleOpacityValue",
);
const opacitySlider = document.querySelector("#opacitySlider");
const opacityValue = document.querySelector("#opacityValue");
const showBones = document.querySelector("#showBones");
const showJoints = document.querySelector("#showJoints");
const showGrid = document.querySelector("#showGrid");
const followMotion = document.querySelector("#followMotion");
const resetViewButton = document.querySelector("#resetView");
const freeDriveButton = document.querySelector("#freeDriveButton");
const freeDriveDialog = document.querySelector("#freeDriveDialog");
const freeDriveGroups = document.querySelector("#freeDriveGroups");
const freeRegionTabs = document.querySelector("#freeRegionTabs");
const freeDriveSearch = document.querySelector("#freeDriveSearch");
const resetFreePoseButton = document.querySelector("#resetFreePose");
const closeFreeDriveButton = document.querySelector("#closeFreeDrive");
const freeCouplingNote = document.querySelector("#freeCouplingNote");
const stateButtons = [...document.querySelectorAll("[data-model-state]")];
const requestedParameters = new URLSearchParams(window.location.search);
const requestedState =
  requestedParameters.get("state") === "initial" ? "initial" : "target";
const requestedFreeDrive = requestedParameters.get("free") === "1";
const requestedRegion = requestedParameters.get("region") ?? "";
const requestedMotionFrame = Number(
  requestedParameters.get("frame") ?? 0,
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d13);
scene.fog = new THREE.Fog(0x090d13, 4.8, 10);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.01,
  30,
);
camera.position.set(2.6, 1.25, 3.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.25;
controls.maxDistance = 8;
controls.update();

scene.add(new THREE.HemisphereLight(0xdff8ff, 0x25252b, 2.2));

const keyLight = new THREE.DirectionalLight(0xfff6ea, 3.4);
keyLight.position.set(2.5, 4.5, 3.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 15;
keyLight.shadow.camera.left = -3;
keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 3;
keyLight.shadow.camera.bottom = -3;
keyLight.shadow.bias = -0.00015;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x68a8ff, 1.6);
rimLight.position.set(-3, 1.4, -2.5);
scene.add(rimLight);

const groundGrid = new THREE.GridHelper(5, 40, 0x314052, 0x19212b);
groundGrid.position.y = -0.001;
scene.add(groundGrid);

const worldAxes = new THREE.AxesHelper(0.25);
worldAxes.position.set(-0.7, 0.002, 0.7);
scene.add(worldAxes);

let profile = null;
let manifest = null;
let scalingTemplate = null;
let geometryMap = null;
let currentSkeleton = null;
let currentState = "initial";
let originalCamera = null;
let coordinateCatalog = null;
let coordinateValues = {};
let freeInputMap = new Map();
let freeDriveActive = false;
let activeRegion = "";
let motionData = null;
let motionPlayer = null;
let muscleGroupsData = null;
let muscleRenderer = null;
let currentMotionFrame = 0;
let isMotionPlaying = false;
let lastTimestamp = 0;
let motionAccumulator = 0;
let previousPelvisPosition = null;
const motionFrameInterval = 1 / 30;

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}加载失败：${response.status} ${response.statusText}`);
  }
  return response.json();
}

function resolveAssetUrl(assetPath) {
  return new URL(assetPath, document.baseURI).href;
}

async function loadGeometry(manifest, root) {
  const loader = new STLLoader();
  const files = [
    ...new Set(
      manifest.bodies.flatMap((body) =>
        body.geometry.map((geometry) => geometry.file),
      ),
    ),
  ];
  let completed = 0;

  const entries = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(`${root}/${file}`);
      if (!response.ok) {
        throw new Error(
          `骨骼网格加载失败：${file} (${response.status})`,
        );
      }
      const buffer = await response.arrayBuffer();
      const geometry = loader.parse(buffer);
      geometry.computeBoundingBox();
      geometry.computeVertexNormals();
      completed += 1;
      loadingText.textContent =
        `正在加载 OpenSim 骨骼网格 ${completed} / ${files.length}`;
      return [file, geometry];
    }),
  );
  return Object.fromEntries(entries);
}

function updateCounts() {
  bodyCount.textContent = String(manifest.meta.bodyCount);
  jointCount.textContent = String(manifest.meta.jointCount);
  coordinateCount.textContent = String(manifest.meta.coordinateCount);
  geometryCount.textContent = String(manifest.meta.geometryCount);
}

function removeSkeleton() {
  muscleRenderer?.dispose();
  muscleRenderer = null;
  if (!currentSkeleton) {
    return;
  }
  scene.remove(currentSkeleton.root);
  currentSkeleton.root.traverse((object) => {
    if (object.isMesh) {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    }
  });
  currentSkeleton = null;
  previousPelvisPosition = null;
}

function renderState(state, { fit = false } = {}) {
  removeSkeleton();
  currentState = state;
  currentSkeleton = buildOpenSimSkeleton(
    manifest,
    scalingTemplate,
    geometryMap,
    { targetState: state === "target" },
  );
  scene.add(currentSkeleton.root);
  if (muscleGroupsData) {
    muscleRenderer = new OpenSimMuscleRenderer({
      muscleGroups: muscleGroupsData,
      segmentGroups: currentSkeleton.groups,
      modelRoot: scene,
      targetState: state === "target",
    });
  }
  applyVisibility();
  if (freeDriveActive) {
    applyFreePose();
  } else if (motionPlayer) {
    applyMotionFrame(currentMotionFrame, { updateControls: true });
  } else {
    setStateLabels();
  }

  if (fit) {
    fitCameraToSkeleton();
  }
}

function setStateLabels() {
  const target = currentState === "target";
  stateLabel.textContent = target
    ? freeDriveActive
      ? "目标尺寸 · 自由驱动"
      : motionPlayer
        ? "目标尺寸 · 动作回放"
        : "目标尺寸"
    : freeDriveActive
      ? "原始框架 · 自由驱动"
      : motionPlayer
        ? "原始框架 · 动作回放"
        : "原始框架";
  stateLabel.classList.toggle("target", target);
  poseModeLabel.textContent = freeDriveActive
    ? "OpenSim 坐标驱动"
    : motionPlayer
      ? `${motionPlayer.timeAt(currentMotionFrame).toFixed(3)} s`
      : "默认中立位 · 0°";
  for (const button of stateButtons) {
    button.classList.toggle(
      "active",
      button.dataset.modelState === currentState,
    );
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.modelState === currentState),
    );
  }
}

function coordinateInputValue(coordinate) {
  const value = coordinateValues[coordinate.name] ?? coordinate.default;
  return coordinate.motionType === "rotation"
    ? THREE.MathUtils.radToDeg(value)
    : value * 100;
}

function coordinateInputLimits(coordinate) {
  const range = coordinate.range ?? [-Math.PI, Math.PI];
  if (coordinate.motionType === "rotation") {
    return {
      min: THREE.MathUtils.radToDeg(range[0]),
      max: THREE.MathUtils.radToDeg(range[1]),
      step: 0.5,
      toBase: (value) => THREE.MathUtils.degToRad(Number(value)),
      format: (value) => `${Number(value).toFixed(1)}°`,
    };
  }
  return {
    min: range[0] * 100,
    max: range[1] * 100,
    step: 1,
    toBase: (value) => Number(value) / 100,
    format: (value) => `${Number(value).toFixed(1)} cm`,
  };
}

function coupledCoordinatesFor(coordinateName) {
  return coordinateCatalog.constraints.filter((constraint) =>
    constraint.independent.includes(coordinateName),
  );
}

function renderFreeDriveControls({ region = activeRegion, query = "" } = {}) {
  activeRegion = region;
  const normalizedQuery = query.trim().toLowerCase();
  const matches = coordinateCatalog.definitions.filter((coordinate) => {
    if (coordinate.constrained || !coordinate.hasVisualInfluence) {
      return false;
    }
    if (!normalizedQuery && coordinate.region !== activeRegion) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [
      coordinate.name,
      coordinate.label,
      coordinate.jointLabel,
      coordinate.region,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  freeInputMap = new Map();
  freeDriveGroups.innerHTML = "";
  const groups = new Map();
  for (const coordinate of matches) {
    const key = `${coordinate.region}::${coordinate.jointId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(coordinate);
  }

  if (!matches.length) {
    freeDriveGroups.innerHTML =
      '<p class="free-empty">没有匹配的 OpenSim 坐标。</p>';
    return;
  }

  for (const coordinates of groups.values()) {
    const card = document.createElement("section");
    card.className = "free-joint-card";

    const header = document.createElement("div");
    header.className = "free-joint-header";
    const title = document.createElement("h3");
    title.textContent = coordinates[0].jointLabel;
    const meta = document.createElement("span");
    meta.textContent = coordinates[0].axisLabel
      ? `${coordinates[0].jointId} · ${coordinates[0].axisLabel}`
      : coordinates[0].jointId;
    header.append(title, meta);
    card.appendChild(header);

    for (const coordinate of coordinates) {
      const limits = coordinateInputLimits(coordinate);
      const row = document.createElement("label");
      row.className = "free-coordinate";

      const top = document.createElement("span");
      top.className = "free-coordinate-top";
      const text = document.createElement("span");
      text.className = "free-coordinate-label";
      text.textContent = coordinate.label;
      const output = document.createElement("output");
      output.textContent = limits.format(coordinateInputValue(coordinate));
      top.append(text, output);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(limits.min);
      input.max = String(limits.max);
      input.step = String(limits.step);
      input.value = String(coordinateInputValue(coordinate));
      input.dataset.coordinate = coordinate.name;
      input.setAttribute(
        "aria-label",
        `${coordinate.jointLabel} ${coordinate.label}`,
      );
      input.addEventListener("input", () => {
        coordinateValues[coordinate.name] = limits.toBase(input.value);
        output.textContent = limits.format(input.value);
        applyFreePose();
      });
      input.addEventListener("dblclick", () => {
        input.value = String(
          coordinate.motionType === "rotation"
            ? THREE.MathUtils.radToDeg(coordinate.default)
            : coordinate.default * 100,
        );
        output.textContent = limits.format(input.value);
        coordinateValues[coordinate.name] = coordinate.default;
        applyFreePose();
      });

      const signs = document.createElement("span");
      signs.className = "free-range-signs";
      const negative = document.createElement("span");
      negative.textContent = `− ${coordinate.negativeDirection}`;
      const positive = document.createElement("span");
      positive.textContent = `+ ${coordinate.positiveDirection}`;
      signs.append(negative, positive);

      row.append(top, input, signs);
      card.appendChild(row);
      freeInputMap.set(coordinate.name, input);
    }

    const coupling = coordinates
      .flatMap((coordinate) => coupledCoordinatesFor(coordinate.name))
      .filter(
        (constraint, index, list) =>
          list.findIndex((item) => item.id === constraint.id) === index,
      );
    if (coupling.length) {
      const note = document.createElement("p");
      note.className = "free-coupling-note";
      note.textContent =
        `耦合坐标自动跟随：${coupling.map((item) => item.dependent).join("、")}`;
      card.appendChild(note);
    }
    if (coordinates[0].jointDofNote) {
      const note = document.createElement("p");
      note.className = "free-model-note";
      note.textContent = coordinates[0].jointDofNote;
      card.appendChild(note);
    }

    freeDriveGroups.appendChild(card);
  }
}

function renderRegionTabs() {
  const regions = [
    ...new Set(
      coordinateCatalog.definitions
        .filter(
          (coordinate) =>
            !coordinate.constrained && coordinate.hasVisualInfluence,
        )
        .map((coordinate) => coordinate.region),
    ),
  ];
  if (!activeRegion || !regions.includes(activeRegion)) {
    activeRegion = regions[0] ?? "";
  }
  freeRegionTabs.innerHTML = "";
  for (const region of regions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = region;
    button.classList.toggle("active", region === activeRegion);
    button.addEventListener("click", () => {
      freeDriveSearch.value = "";
      renderFreeDriveControls({ region, query: "" });
      for (const item of freeRegionTabs.querySelectorAll("button")) {
        item.classList.toggle("active", item === button);
      }
      freeDriveGroups.scrollTop = 0;
    });
    freeRegionTabs.appendChild(button);
  }
}

function applyFreePose() {
  if (!currentSkeleton || !coordinateCatalog) {
    return;
  }
  coordinateValues = applyOpenSimPose(
    currentSkeleton,
    manifest,
    scalingTemplate,
    coordinateValues,
    { targetState: currentState === "target" },
  );
  currentSkeleton.root.updateMatrixWorld(true);
  muscleRenderer?.update(motionData, currentMotionFrame);
  freeDriveActive = true;
  setStateLabels();
}

function resetFreePose() {
  coordinateValues = resolveCoordinateValues(coordinateCatalog);
  applyFreePose();
  renderFreeDriveControls({
    region: activeRegion,
    query: freeDriveSearch.value,
  });
}

function openFreeDrive(region = activeRegion) {
  if (!coordinateCatalog) {
    return;
  }
  pauseMotion();
  activeRegion = region || activeRegion;
  renderRegionTabs();
  renderFreeDriveControls({ region: activeRegion, query: "" });
  freeDriveButton.classList.add("active");
  freeDriveActive = true;
  applyFreePose();
  freeDriveDialog.show();
}

function closeFreeDrive() {
  freeDriveActive = false;
  freeDriveButton.classList.remove("active");
  if (motionPlayer) {
    applyMotionFrame(currentMotionFrame, { updateControls: true });
  } else {
    coordinateValues = resolveCoordinateValues(coordinateCatalog);
    applyOpenSimPose(
      currentSkeleton,
      manifest,
      scalingTemplate,
      coordinateValues,
      { targetState: currentState === "target" },
    );
    setStateLabels();
  }
  if (freeDriveDialog.open) {
    freeDriveDialog.close();
  }
}

function makeFreeDriveDialogDraggable() {
  const handle = freeDriveDialog.querySelector(".free-drive-header");
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    const rect = freeDriveDialog.getBoundingClientRect();
    freeDriveDialog.style.left = `${rect.left}px`;
    freeDriveDialog.style.top = `${rect.top}px`;
    freeDriveDialog.style.right = "auto";
    freeDriveDialog.style.bottom = "auto";
    freeDriveDialog.style.margin = "0";
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragging = true;
    freeDriveDialog.classList.add("drag-enabled");
  });

  freeDriveDialog.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const rect = freeDriveDialog.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    freeDriveDialog.style.left =
      `${Math.min(maxLeft, Math.max(margin, event.clientX - offsetX))}px`;
    freeDriveDialog.style.top =
      `${Math.min(maxTop, Math.max(margin, event.clientY - offsetY))}px`;
  });

  freeDriveDialog.addEventListener("click", () => {
    if (dragging) {
      dragging = false;
      freeDriveDialog.classList.remove("drag-enabled");
    }
  });

  window.addEventListener("click", () => {
    if (dragging) {
      dragging = false;
      freeDriveDialog.classList.remove("drag-enabled");
    }
  });
}

function updateMotionControls() {
  if (!motionPlayer) {
    motionSlider.disabled = true;
    motionPlayButton.disabled = true;
    motionPrevButton.disabled = true;
    motionNextButton.disabled = true;
    motionDataNote.textContent = "没有可用的 OpenSim 动作数据。";
    return;
  }
  const frame = currentMotionFrame;
  const time = motionPlayer.timeAt(frame);
  motionSlider.max = String(motionPlayer.lastFrame);
  motionSlider.value = String(frame);
  motionFrame.textContent = `帧 ${frame + 1} / ${motionPlayer.frameCount}`;
  motionTime.textContent =
    `${time.toFixed(3)} / ${motionPlayer.duration.toFixed(3)} s`;
  motionPlayButton.textContent = isMotionPlaying ? "暂停" : "播放";
  motionPlayButton.classList.toggle("active", isMotionPlaying);
}

function applyMotionFrame(frame, { updateControls = true } = {}) {
  if (!motionPlayer || !currentSkeleton) {
    return;
  }
  currentMotionFrame = motionPlayer.setFrame(frame);
  coordinateValues = motionPlayer.coordinateValuesAt(currentMotionFrame);
  freeDriveActive = false;
  applyOpenSimPose(
    currentSkeleton,
    manifest,
    scalingTemplate,
    coordinateValues,
    { targetState: currentState === "target" },
  );
  currentSkeleton.root.updateMatrixWorld(true);
  const pelvis = currentSkeleton.groups.get("pelvis");
  const nextPelvisPosition = pelvis.getWorldPosition(new THREE.Vector3());
  if (
    followMotion.checked &&
    previousPelvisPosition &&
    previousPelvisPosition.distanceToSquared(nextPelvisPosition) > 1e-16
  ) {
    const delta = nextPelvisPosition
      .clone()
      .sub(previousPelvisPosition);
    camera.position.add(delta);
    controls.target.add(delta);
  }
  previousPelvisPosition = nextPelvisPosition;
  muscleRenderer?.update(motionData, currentMotionFrame);
  setStateLabels();
  if (updateControls) {
    updateMotionControls();
  }
}

function pauseMotion() {
  isMotionPlaying = false;
  motionAccumulator = 0;
  updateMotionControls();
}

function toggleMotionPlayback() {
  if (!motionPlayer) {
    return;
  }
  if (freeDriveDialog.open) {
    closeFreeDrive();
  }
  isMotionPlaying = !isMotionPlaying;
  motionAccumulator = 0;
  if (isMotionPlaying) {
    applyMotionFrame(currentMotionFrame);
  } else {
    updateMotionControls();
    setStateLabels();
  }
}

function stepMotionFrame(delta) {
  if (!motionPlayer) {
    return;
  }
  pauseMotion();
  applyMotionFrame(currentMotionFrame + delta);
}

function applyVisibility() {
  const opacity = Number(opacitySlider.value) / 100;
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;
  if (!currentSkeleton) {
    return;
  }
  currentSkeleton.root.traverse((object) => {
    if (object.userData.isSegmentVisual) {
      object.visible = showBones.checked && object.userData.sourceVisible;
      object.material.transparent = opacity < 1;
      object.material.opacity = opacity;
      object.material.depthWrite = opacity >= 0.98;
      object.material.needsUpdate = true;
    }
    if (object.userData.isJointMarker) {
      object.visible = showJoints.checked;
    }
  });
  groundGrid.visible = showGrid.checked;
  worldAxes.visible = showGrid.checked;
  muscleRenderer?.setVisible(showMuscles.checked);
  const muscleOpacity = Number(muscleOpacitySlider.value) / 100;
  muscleOpacityValue.textContent = `${Math.round(muscleOpacity * 100)}%`;
  muscleRenderer?.setOpacityScale(muscleOpacity);
}

function fitCameraToSkeleton() {
  currentSkeleton.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(currentSkeleton.root);
  if (bounds.isEmpty()) {
    return;
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z);
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(19)) * 0.72;

  controls.target.copy(center);
  camera.position.copy(
    center.clone().add(new THREE.Vector3(0.58, 0.10, 1).normalize().multiplyScalar(distance)),
  );
  camera.near = Math.max(0.005, distance / 100);
  camera.far = Math.max(20, distance * 20);
  camera.updateProjectionMatrix();
  controls.update();
  originalCamera = {
    position: camera.position.clone(),
    target: controls.target.clone(),
  };
  const pelvis = currentSkeleton.groups.get("pelvis");
  previousPelvisPosition = pelvis
    ? pelvis.getWorldPosition(new THREE.Vector3())
    : null;
}

function resetView() {
  if (!originalCamera) {
    return;
  }
  camera.position.copy(originalCamera.position);
  controls.target.copy(originalCamera.target);
  controls.update();
}

function setLoading(message, error = false) {
  loadingPanel.hidden = false;
  loadingPanel.classList.toggle("error", error);
  loadingText.textContent = message;
}

async function start() {
  try {
    setLoading("正在读取 OpenSim 模型配置…");
    profile = await fetchJson(PROFILE_URL, "模型配置");
    manifest = await fetchJson(
      resolveAssetUrl(profile.manifest),
      "骨架清单",
    );
    scalingTemplate = await fetchJson(
      resolveAssetUrl(profile.scalingTemplate),
      "缩放模板",
    );
    coordinateCatalog = createCoordinateCatalog(manifest);
    coordinateValues = resolveCoordinateValues(coordinateCatalog);
    try {
      motionData = await fetchJson(
        resolveAssetUrl(profile.motion),
        "OpenSim 动作数据",
      );
      motionPlayer = new OpenSimMotionPlayer(
        motionData,
        coordinateCatalog,
      );
      if (Number.isFinite(requestedMotionFrame)) {
        currentMotionFrame = motionPlayer.clampFrame(requestedMotionFrame);
      }
      motionDataNote.textContent =
        `${motionData.meta.frameCount} 帧 · ${motionData.meta.fps.toFixed(0)} Hz · ${motionData.meta.durationSeconds.toFixed(3)} s · ${motionData.meta.explicitCoordinateCount} 个显式坐标`;
      if (motionData.meta.nearStaticCoordinates?.length) {
        motionDataNote.textContent +=
          `；其中 ${motionData.meta.nearStaticCoordinates.length} 个坐标全程幅度小于 0.1°，视图中会接近静止。`;
      }
      const staticUpperLimb = [
        ...(motionData.meta.nearStaticByRegion?.["右上肢"] ?? []),
        ...(motionData.meta.nearStaticByRegion?.["左上肢"] ?? []),
      ];
      if (staticUpperLimb.length) {
        motionDataNote.textContent +=
          ` 上肢 ${staticUpperLimb.length} 个坐标在源 IK 中被保持为近似默认姿态。`;
      }
    } catch (error) {
      console.warn(error);
      motionData = null;
      motionPlayer = null;
      motionDataNote.textContent =
        `动作数据未加载：${error.message}`;
    }
    try {
      muscleGroupsData = await fetchJson(
        resolveAssetUrl(profile.muscleGroups),
        "OpenSim 肌肉路径",
      );
      motionDataNote.textContent +=
        ` 肌肉显示：${muscleGroupsData.meta.groupCount} 组 / ${muscleGroupsData.meta.pathCount} 条路径。`;
    } catch (error) {
      console.warn(error);
      muscleGroupsData = null;
      warningPanel.hidden = false;
      warningText.textContent =
        `肌肉路径未加载：${error.message}`;
    }

    bodyCount.textContent = String(manifest.meta.bodyCount);
    jointCount.textContent = String(manifest.meta.jointCount);
    coordinateCount.textContent = String(manifest.meta.coordinateCount);
    geometryCount.textContent = String(manifest.meta.geometryCount);
    sourceLabel.textContent = `${manifest.source.modelName} · ${manifest.source.modelSha256.slice(0, 12)}`;
    updateCounts();

    const warningCount = manifest.bodies.filter((body) =>
      body.joint.transformAxes.some(
        (axis) => Math.abs(axis.defaultValue) > 1e-9,
      ),
    ).length;
    if (warningCount) {
      warningPanel.hidden = false;
      warningText.textContent =
        `${warningCount} 个 CustomJoint 在默认坐标下包含非零平移轴（膝关节与髌股关节）；导出器已按 OpenSim SpatialTransform 顺序计算。`;
    }
    freeCouplingNote.textContent =
      [
        coordinateCatalog.constraints.length > 0
          ? `已读取 ${coordinateCatalog.constraints.length} 条 CoordinateCouplerConstraint；拖动膝关节时髌骨坐标会自动跟随。`
          : "当前模型没有启用坐标耦合约束。",
        "脊柱正向按 OpenSim 轴定义：FE 正伸负屈，LB 正右负左，AR 正左负右。",
        "Abs_FE/LB/AR 只驱动无网格辅助 Abdomen 体，未列入骨架驱动。",
      ].join(" ");

    setLoading("正在加载 OpenSim 骨骼网格 0 / 131");
    geometryMap = await loadGeometry(
      manifest,
      resolveAssetUrl(profile.geometryRoot),
    );
    loadingPanel.hidden = true;
    updateMotionControls();
    renderState(requestedState, { fit: true });
    if (requestedFreeDrive) {
      openFreeDrive(requestedRegion);
    }
  } catch (error) {
    console.error(error);
    setLoading(error.message, true);
  }
}

for (const button of stateButtons) {
  button.addEventListener("click", () => {
    const state = button.dataset.modelState;
    if (state !== currentState) {
      renderState(state, { fit: true });
    }
  });
}

opacitySlider.addEventListener("input", applyVisibility);
showBones.addEventListener("change", applyVisibility);
showJoints.addEventListener("change", applyVisibility);
showGrid.addEventListener("change", applyVisibility);
showMuscles.addEventListener("change", applyVisibility);
muscleOpacitySlider.addEventListener("input", applyVisibility);
resetViewButton.addEventListener("click", resetView);
freeDriveButton.addEventListener("click", () => openFreeDrive());
resetFreePoseButton.addEventListener("click", resetFreePose);
closeFreeDriveButton.addEventListener("click", closeFreeDrive);
motionPlayButton.addEventListener("click", toggleMotionPlayback);
motionPrevButton.addEventListener("click", () => stepMotionFrame(-1));
motionNextButton.addEventListener("click", () => stepMotionFrame(1));
motionSlider.addEventListener("input", () => {
  // pauseMotion() refreshes the controls from the current frame. Capture the
  // newly dragged value first so it is not overwritten by that refresh.
  const frame = Number(motionSlider.value);
  pauseMotion();
  applyMotionFrame(frame);
});
freeDriveSearch.addEventListener("input", () => {
  renderFreeDriveControls({
    region: activeRegion,
    query: freeDriveSearch.value,
  });
});
freeDriveDialog.addEventListener("close", () => {
  if (freeDriveActive) {
    closeFreeDrive();
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

makeFreeDriveDialogDraggable();

renderer.setAnimationLoop((timestamp) => {
  const deltaSeconds = lastTimestamp
    ? Math.min((timestamp - lastTimestamp) / 1000, 0.1)
    : 0;
  lastTimestamp = timestamp;
  if (isMotionPlaying && motionPlayer) {
    motionAccumulator += deltaSeconds;
    while (motionAccumulator >= motionFrameInterval) {
      motionAccumulator -= motionFrameInterval;
      const nextFrame =
        currentMotionFrame >= motionPlayer.lastFrame
          ? 0
          : currentMotionFrame + 1;
      applyMotionFrame(nextFrame);
    }
  }
  controls.update();
  renderer.render(scene, camera);
});

start();
