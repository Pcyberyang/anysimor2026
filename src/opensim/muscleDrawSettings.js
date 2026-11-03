// Shared activation-driven color, radius and opacity mapping for this viewer.
export const MUSCLE_DRAW_SETTINGS = Object.freeze({
  rgb: [149 / 256, 51 / 256, 55 / 256],
  bulging: 1,
  colorScale: 1,
  rgbColorScale: [0.957031, 0.785156, 0.785156],
  maxStress: 40000,
  opacity: 1,
  drawScaleOn: true,
  enableSmoothing: true,
  viewerRadius: Object.freeze({
    baseScale: 1,
    activationParams: Object.freeze([0, 0.15, 0.25, 0.35, 0.5, 0.75, 1]),
    activationScales: Object.freeze([0.3, 0.55, 0.75, 0.95, 1.1, 1.2, 1.3]),
  }),
  drawScale: Object.freeze({
    params: Object.freeze([0, 0.167, 0.333, 0.5, 0.667, 1]),
    colors: Object.freeze([
      Object.freeze([0.5, 0.16, 0.16]),
      Object.freeze([0.7, 0.1, 0.3]),
      Object.freeze([1, 0, 0]),
      Object.freeze([0.29, 0, 0.5]),
      Object.freeze([0.7, 0, 0.94]),
      Object.freeze([1, 0, 1]),
    ]),
    opacities: Object.freeze([1, 1, 1, 1, 1, 1]),
  }),
});
