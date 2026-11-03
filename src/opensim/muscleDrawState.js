import * as THREE from "three";
import { MUSCLE_DRAW_SETTINGS } from "./muscleDrawSettings.js";

export function muscleDrawStateForActivation(activation) {
  const parameter = Number.isFinite(activation)
    ? Math.max(0, Math.min(1, activation))
    : 0;
  return {
    param: parameter,
    color: getDrawScaleColor(parameter),
    radiusScale: activationRadiusScale(parameter),
  };
}

function interpolateScaleValues(values, parameter) {
  return interpolateValues(
    MUSCLE_DRAW_SETTINGS.drawScale.params,
    values,
    parameter,
  );
}

function interpolateValues(stops, values, parameter) {
  const value = Math.max(
    stops[0],
    Math.min(stops[stops.length - 1], parameter),
  );
  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index];
    const end = stops[index + 1];
    if (value < start || value > end) {
      continue;
    }
    return {
      start: values[index],
      end: values[index + 1],
      ratio: end > start ? (value - start) / (end - start) : 0,
    };
  }
  return {
    start: values[values.length - 1],
    end: values[values.length - 1],
    ratio: 0,
  };
}

function getDrawScaleColor(activation) {
  if (!MUSCLE_DRAW_SETTINGS.drawScaleOn) {
    const [red, green, blue] = MUSCLE_DRAW_SETTINGS.rgb.map(
      (component) => component * MUSCLE_DRAW_SETTINGS.colorScale,
    );
    return new THREE.Color().setRGB(
      Math.min(red, 1),
      Math.min(green, 1),
      Math.min(blue, 1),
      THREE.SRGBColorSpace,
    );
  }

  const { start, end, ratio } = interpolateScaleValues(
    MUSCLE_DRAW_SETTINGS.drawScale.colors,
    activation,
  );
  return new THREE.Color().setRGB(
    start[0] + (end[0] - start[0]) * ratio,
    start[1] + (end[1] - start[1]) * ratio,
    start[2] + (end[2] - start[2]) * ratio,
    THREE.SRGBColorSpace,
  );
}

function activationRadiusScale(activation) {
  if (!MUSCLE_DRAW_SETTINGS.drawScaleOn) {
    return MUSCLE_DRAW_SETTINGS.viewerRadius.baseScale;
  }
  const { start, end, ratio } = interpolateValues(
    MUSCLE_DRAW_SETTINGS.viewerRadius.activationParams,
    MUSCLE_DRAW_SETTINGS.viewerRadius.activationScales,
    activation,
  );
  return (
    MUSCLE_DRAW_SETTINGS.viewerRadius.baseScale *
    MUSCLE_DRAW_SETTINGS.bulging *
    (start + (end - start) * ratio)
  );
}
