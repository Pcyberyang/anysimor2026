import * as THREE from "three";
import { MUSCLE_DRAW_SETTINGS } from "./muscleDrawSettings.js";
import { muscleDrawStateForActivation } from "./muscleDrawState.js";
import {
  createDynamicTubeGeometry,
  updateTubeGeometry,
} from "./muscleTubeGeometry.js";

export class OpenSimMuscleRenderer {
  constructor({
    muscleGroups,
    segmentGroups,
    modelRoot,
    targetState,
  }) {
    this.muscleGroups = muscleGroups;
    this.segmentGroups = segmentGroups;
    this.modelRoot = modelRoot;
    this.opacityScale = 1;
    this.muscles = [];

    for (const definition of muscleGroups.groups) {
      for (const [pathIndex, path] of definition.paths.entries()) {
        const anchors = [];
        let valid = true;
        for (const [pointIndex, point] of path.points.entries()) {
          const group = segmentGroups.get(point.bodyId);
          if (!group) {
            valid = false;
            break;
          }
          const anchor = new THREE.Object3D();
          anchor.name =
            `${definition.id}_${pathIndex}_pathAnchor_${pointIndex}`;
          anchor.position.fromArray(
            targetState ? point.targetLocal : point.initialLocal,
          );
          group.add(anchor);
          anchors.push(anchor);
        }
        if (!valid || anchors.length < 2) {
          for (const anchor of anchors) {
            anchor.removeFromParent();
          }
          continue;
        }

        const geometry = createDynamicTubeGeometry();
        const material = new THREE.MeshStandardMaterial({
          color: muscleDrawStateForActivation(0).color,
          roughness: 0.45,
          metalness: 0.04,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          side: THREE.DoubleSide,
          flatShading: !MUSCLE_DRAW_SETTINGS.enableSmoothing,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${definition.id}_${pathIndex}_visual`;
        mesh.userData.isMuscleVisual = true;
        mesh.userData.muscleId = definition.id;
        mesh.userData.sourceMuscle = path.sourceMuscle;
        mesh.frustumCulled = false;
        mesh.renderOrder =
          definition.opacity < 1 || material.opacity < 1 ? 997 : 998;
        this.modelRoot.add(mesh);

        const curvePoints = path.points.map(() => new THREE.Vector3());
        const curve =
          curvePoints.length === 2
            ? new THREE.LineCurve3(curvePoints[0], curvePoints[1])
            : new THREE.CatmullRomCurve3(
                curvePoints,
                false,
                "centripetal",
              );
        this.muscles.push({
          definition,
          sourceMuscle: path.sourceMuscle,
          anchors,
          curvePoints,
          curve,
          geometry,
          material,
          mesh,
        });
      }
    }
  }

  update(motionData, frameIndex) {
    if (!motionData) {
      return;
    }
    const worldPoint = new THREE.Vector3();
    for (const muscle of this.muscles) {
      const definition = muscle.definition;
      const activation =
        motionData.activations?.[definition.side]?.[
          definition.activationColumn
        ]?.[frameIndex] ?? 0;
      const drawState = muscleDrawStateForActivation(activation);

      for (const [index, anchor] of muscle.anchors.entries()) {
        anchor.getWorldPosition(worldPoint);
        muscle.curvePoints[index].copy(
          this.modelRoot.worldToLocal(worldPoint.clone()),
        );
      }
      updateTubeGeometry(
        muscle.geometry,
        muscle.curve,
        definition.restBellyRadius,
        drawState.radiusScale,
      );
      muscle.material.color.copy(drawState.color);
      this.setMaterialOpacity(muscle);
    }
  }

  setOpacityScale(value) {
    const numericValue = Number(value);
    this.opacityScale = Number.isFinite(numericValue)
      ? Math.max(0, Math.min(1, numericValue))
      : 1;
    for (const muscle of this.muscles) {
      this.setMaterialOpacity(muscle);
    }
  }

  setMaterialOpacity(muscle) {
    const opacity = Math.max(
      0,
      Math.min(
        1,
        MUSCLE_DRAW_SETTINGS.opacity *
          (muscle.definition.opacity ?? 1) *
          this.opacityScale,
      ),
    );
    muscle.material.opacity = opacity;
    muscle.material.transparent = opacity < 1;
    muscle.material.depthWrite = opacity >= 0.95;
    muscle.material.needsUpdate = true;
    muscle.mesh.renderOrder = opacity < 1 ? 997 : 998;
  }

  setVisible(visible) {
    for (const muscle of this.muscles) {
      muscle.mesh.visible = visible;
    }
  }

  dispose() {
    for (const muscle of this.muscles) {
      for (const anchor of muscle.anchors) {
        anchor.removeFromParent();
      }
      muscle.mesh.removeFromParent();
      muscle.geometry.dispose();
      muscle.material.dispose();
    }
    this.muscles = [];
  }
}
