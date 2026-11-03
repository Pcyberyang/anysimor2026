export class OpenSimMotionPlayer {
  constructor(motionData, coordinateCatalog) {
    this.motionData = motionData;
    this.coordinateCatalog = coordinateCatalog;
    this.currentFrame = 0;
  }

  get frameCount() {
    return this.motionData.meta.frameCount;
  }

  get lastFrame() {
    return Math.max(0, this.frameCount - 1);
  }

  get fps() {
    return this.motionData.meta.fps;
  }

  get duration() {
    return this.motionData.meta.durationSeconds;
  }

  clampFrame(frame) {
    return Math.max(
      0,
      Math.min(this.lastFrame, Math.round(Number(frame) || 0)),
    );
  }

  setFrame(frame) {
    this.currentFrame = this.clampFrame(frame);
    return this.currentFrame;
  }

  timeAt(frame = this.currentFrame) {
    return (
      this.motionData.frameTimesSeconds?.[this.clampFrame(frame)] ??
      this.clampFrame(frame) / this.fps
    );
  }

  coordinateValuesAt(frame = this.currentFrame) {
    const index = this.clampFrame(frame);
    return Object.fromEntries(
      this.motionData.coordinateNames.map((name) => [
        name,
        this.motionData.coordinates[name]?.[index] ??
          this.coordinateCatalog.byName.get(name)?.default ??
          0,
      ]),
    );
  }
}
