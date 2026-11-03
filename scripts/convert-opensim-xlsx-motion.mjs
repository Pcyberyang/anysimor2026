import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readXlsxFile from "read-excel-file/node";
import {
  createCoordinateCatalog,
  resolveCoordinateValues,
} from "../src/opensim/openSimPose.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(
  projectRoot,
  "public",
  "data",
  "opensim",
  "skeleton-manifest.json",
);
const mappingPath = process.env.OPENSIM_JOINT_MAPPING_CSV
  ? path.resolve(projectRoot, process.env.OPENSIM_JOINT_MAPPING_CSV)
  : null;
const sourceMotionPath = path.resolve(
  projectRoot,
  process.env.OPENSIM_IK_MOTION ??
    path.join("input", "ik_v11_walking_full_smooth6.mot"),
);
const rightWorkbookPath = path.join(
  projectRoot,
  "input",
  "全身活动测量右侧.xlsx",
);
const leftWorkbookPath = path.join(
  projectRoot,
  "input",
  "全身活动测量左侧.xlsx",
);
const outputPath = path.join(
  projectRoot,
  "public",
  "data",
  "opensim",
  "motion-data.json",
);
const reportPath = path.join(
  projectRoot,
  "public",
  "data",
  "opensim",
  "motion-report.json",
);

const DEFAULT_FPS = 90;

function projectRelative(filePath) {
  return filePath
    ? path.relative(projectRoot, filePath).replaceAll("\\", "/")
    : null;
}

function fail(message) {
  throw new Error(`OpenSim XLSX motion conversion failed: ${message}`);
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function normalizeField(value) {
  return String(value ?? "")
    .replace(/\/\([^)]*\)\s*$/, "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

async function readWorkbook(filePath, side) {
  let sheets;
  try {
    sheets = await readXlsxFile(filePath);
  } catch {
    fail(`${side} workbook could not be read`);
  }
  const sheet = sheets.find(
    (candidate) => candidate.sheet.toLowerCase() === "sheet1",
  );
  if (!sheet) {
    fail(`${side} workbook does not contain sheet1`);
  }
  const rows = sheet.data;
  if (rows.length < 3) {
    fail(`${side} sheet1 does not contain two header rows and frame data`);
  }
  return {
    filePath,
    sha256: sha256(filePath),
    humanHeader: rows[0],
    coordinateHeader: rows[1],
    rows: rows.slice(2),
  };
}

function readMotion(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const endHeader = lines.indexOf("endheader");
  if (endHeader < 0) {
    fail(`motion audit file has no endheader: ${filePath}`);
  }
  const header = lines[endHeader + 1].trim().split(/\s+/);
  const rows = lines
    .slice(endHeader + 2)
    .filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/));
  const degrees = lines
    .slice(0, endHeader)
    .some((line) => /^inDegrees\s*=\s*yes/i.test(line.trim()));
  return { filePath, header, rows, degrees };
}

function factorFromFormula(formula) {
  return /^\s*-\s*1\s*\*/.test(String(formula ?? "")) ? -1 : 1;
}

function findColumn(coordinateHeader, coordinateName) {
  return coordinateHeader.findIndex(
    (value) => String(value ?? "").trim() === coordinateName,
  );
}

async function main() {
  for (const filePath of [
    manifestPath,
    rightWorkbookPath,
    leftWorkbookPath,
  ]) {
    if (!fs.existsSync(filePath)) {
      fail(`missing input: ${filePath}`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const catalog = createCoordinateCatalog(manifest);
  const right = await readWorkbook(rightWorkbookPath, "right");
  const left = await readWorkbook(leftWorkbookPath, "left");
  if (right.rows.length !== left.rows.length) {
    fail(
      `left/right frame count differs: ${right.rows.length} vs ${left.rows.length}`,
    );
  }

  const mappings = mappingPath && fs.existsSync(mappingPath)
    ? (() => {
        const mappingRows = parseCsv(
          fs.readFileSync(mappingPath, "utf8").replace(/^\uFEFF/, ""),
        );
        const mappingHeader = mappingRows.shift();
        return mappingRows.map((values) =>
          Object.fromEntries(
            mappingHeader.map((name, index) => [
              name,
              values[index] ?? "",
            ]),
          ),
        );
      })()
    : [];
  const sourceMotion = readMotion(sourceMotionPath);
  const sourceMotionIndex = new Map(
    (sourceMotion?.header ?? []).map((name, index) => [name, index]),
  );

  function mappingFactor(side, coordinateName, workbook, column) {
    const sourceColumn = sourceMotionIndex.get(coordinateName);
    if (
      sourceMotion &&
      Number.isInteger(sourceColumn) &&
      column >= 0
    ) {
      let plusError = 0;
      let minusError = 0;
      let samples = 0;
      for (let frame = 0; frame < workbook.rows.length; frame += 1) {
        const workbookValue = Number(workbook.rows[frame][column]);
        const sourceValue = Number(
          sourceMotion.rows[frame]?.[sourceColumn],
        );
        if (!Number.isFinite(workbookValue) || !Number.isFinite(sourceValue)) {
          continue;
        }
        plusError += Math.abs(workbookValue - sourceValue);
        minusError += Math.abs(workbookValue + sourceValue);
        samples += 1;
      }
      if (samples > 0) {
        return {
          factor: minusError < plusError ? -1 : 1,
          mapping: null,
          source: "motion-audit",
        };
      }
    }

    const candidates = mappings
      .filter(
        (mapping) =>
          mapping.side === side &&
          mapping.source_coordinate === coordinateName,
      )
      .sort(
        (a, b) =>
          Number(a.output_column || Infinity) -
          Number(b.output_column || Infinity),
      );
    // One source coordinate can feed more than one output row. The first row
    // is the primary coordinate row; proxy rows must not override its sign.
    const factor = candidates.length
      ? factorFromFormula(candidates[0].formula)
      : 1;
    return {
      factor,
      mapping: candidates[0] ?? null,
      source: "mapping-csv",
    };
  }

  function extractSide(workbook, side) {
    const valuesByName = {};
    const columnAudit = {};
    const activations = {};
    for (const coordinate of catalog.definitions) {
      const column = findColumn(
        workbook.coordinateHeader,
        coordinate.name,
      );
      if (column < 0) {
        continue;
      }
      const humanHeader = workbook.humanHeader[column];
      const { factor, mapping, source } = mappingFactor(
        side,
        coordinate.name,
        workbook,
        column,
      );
      const toModelUnit =
        coordinate.motionType === "rotation" ? Math.PI / 180 : 1;
      const values = workbook.rows.map((row) => {
        const raw = Number(row[column]);
        return Number.isFinite(raw)
          ? factor * raw * toModelUnit
          : null;
      });
      if (values.some(Number.isFinite)) {
        valuesByName[coordinate.name] = values;
        columnAudit[coordinate.name] = {
          side,
          oneBasedColumn: column + 1,
          humanHeader,
          sourceHeader: workbook.coordinateHeader[column],
          sourceFactor: factor,
          sourceUnit:
            coordinate.motionType === "rotation" ? "degree" : "meter",
          modelUnit:
            coordinate.motionType === "rotation" ? "radian" : "meter",
          mappingStatus: mapping?.status ?? "direct",
          factorSource: source,
        };
      }
    }
    const seenActivationColumns = new Set();
    for (
      let column = 0;
      column < workbook.coordinateHeader.length;
      column += 1
    ) {
      const name = String(workbook.coordinateHeader[column] ?? "")
        .trim()
        .replace(/\/%$/, "");
      if (
        !name.startsWith("Activitymean-") ||
        seenActivationColumns.has(name)
      ) {
        continue;
      }
      seenActivationColumns.add(name);
      const values = workbook.rows.map((row) => {
        const raw = Number(row[column]);
        return Number.isFinite(raw) ? raw / 100 : null;
      });
      if (values.some((value) => Number.isFinite(value) && value !== 0)) {
        activations[name] = values;
      }
    }
    return { valuesByName, columnAudit, activations };
  }

  const rightData = extractSide(right, "Right");
  const leftData = extractSide(left, "Left");
  const frameCount = right.rows.length;
  const coordinates = {};
  const ranges = {};
  const mergeWarnings = [];

  for (const coordinate of catalog.definitions) {
    const rightValues = rightData.valuesByName[coordinate.name];
    const leftValues = leftData.valuesByName[coordinate.name];
    const merged = new Array(frameCount).fill(null);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const rightValue = rightValues?.[frame];
      const leftValue = leftValues?.[frame];
      if (Number.isFinite(rightValue) && Number.isFinite(leftValue)) {
        const difference = Math.abs(rightValue - leftValue);
        if (difference > 1e-7) {
          mergeWarnings.push(
            `${coordinate.name} frame ${frame} differs by ${difference} between left/right workbooks; right value used.`,
          );
        }
        merged[frame] = rightValue;
      } else if (Number.isFinite(rightValue)) {
        merged[frame] = rightValue;
      } else if (Number.isFinite(leftValue)) {
        merged[frame] = leftValue;
      } else {
        merged[frame] = coordinate.default;
      }
    }
    coordinates[coordinate.name] = merged;
  }

  const resolvedFrames = Array.from({ length: frameCount }, (_, frame) =>
    resolveCoordinateValues(
      catalog,
      Object.fromEntries(
        catalog.definitions.map((coordinate) => [
          coordinate.name,
          coordinates[coordinate.name][frame],
        ]),
      ),
    ),
  );

  for (const coordinate of catalog.definitions) {
    coordinates[coordinate.name] = resolvedFrames.map(
      (frame) => frame[coordinate.name],
    );
    const values = coordinates[coordinate.name];
    ranges[coordinate.name] = {
      min: Math.min(...values),
      max: Math.max(...values),
      motionType: coordinate.motionType,
    };
  }

  let audit = null;
  let frameTimesSeconds = Array.from(
    { length: frameCount },
    (_, frame) => frame / DEFAULT_FPS,
  );
  let fps = DEFAULT_FPS;

  if (sourceMotion) {
    if (sourceMotion.rows.length !== frameCount) {
      fail(
        `source motion has ${sourceMotion.rows.length} frames, expected ${frameCount}`,
      );
    }
    const times = sourceMotion.rows.map((row) => Number(row[0]));
    frameTimesSeconds = times;
    fps = 1 / ((times.at(-1) - times[0]) / Math.max(1, times.length - 1));
    const indexByName = new Map(
      sourceMotion.header.map((name, index) => [name, index]),
    );
    let maxError = 0;
    const errors = {};
    const sourceScales = {};
    for (const coordinate of catalog.definitions) {
      const sourceColumn = indexByName.get(coordinate.name);
      if (!Number.isInteger(sourceColumn)) {
        continue;
      }
      const candidates =
        coordinate.motionType === "rotation" &&
        sourceMotion.degrees
          ? [
              { scale: Math.PI / 180, unit: "degree" },
              { scale: 1, unit: "radian" },
            ]
          : [{ scale: 1, unit: coordinate.motionType === "rotation" ? "radian" : "meter" }];
      let best = null;
      for (const candidate of candidates) {
        let maxCandidateError = 0;
        for (let frame = 0; frame < frameCount; frame += 1) {
          const expected =
            Number(sourceMotion.rows[frame][sourceColumn]) *
            candidate.scale;
          const actual = coordinates[coordinate.name][frame];
          maxCandidateError = Math.max(
            maxCandidateError,
            Math.abs(actual - expected),
          );
        }
        if (!best || maxCandidateError < best.maxError) {
          best = { ...candidate, maxError: maxCandidateError };
        }
      }
      const maxCoordinateError = best?.maxError ?? 0;
      errors[coordinate.name] = maxCoordinateError;
      sourceScales[coordinate.name] = best?.unit ?? "meter";
      maxError = Math.max(maxError, maxCoordinateError);
    }
    audit = {
      sourceMotionPath: projectRelative(sourceMotionPath),
      maxCoordinateError: maxError,
      coordinateErrors: errors,
      inferredSourceUnits: sourceScales,
      largestErrors: Object.entries(errors)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 12),
    };
    if (maxError > 1e-7) {
      fail(
        `converted XLSX data differs from source motion by ${maxError}; ${JSON.stringify(audit.largestErrors)}`,
      );
    }
  }

  const explicitCoordinates = [
    ...new Set([
      ...Object.keys(rightData.valuesByName),
      ...Object.keys(leftData.valuesByName),
    ]),
  ].filter((name) => {
    const coordinate = catalog.byName.get(name);
    return (
      rightData.valuesByName[name]?.some(Number.isFinite) ||
      leftData.valuesByName[name]?.some(Number.isFinite)
    );
  });
  const missingExplicitCoordinates = catalog.definitions
    .filter(
      (coordinate) =>
        !rightData.valuesByName[coordinate.name] &&
        !leftData.valuesByName[coordinate.name],
    )
    .map((coordinate) => coordinate.name);
  const nearStaticCoordinates = catalog.definitions
    .filter((coordinate) => {
      const range = ranges[coordinate.name];
      if (coordinate.motionType === "rotation") {
        return (range.max - range.min) * 180 / Math.PI < 0.1;
      }
      return range.max - range.min < 0.001;
    })
    .map((coordinate) => coordinate.name);
  const nearStaticSet = new Set(nearStaticCoordinates);
  const nearStaticByRegion = {};
  for (const coordinate of catalog.definitions) {
    if (!nearStaticSet.has(coordinate.name)) {
      continue;
    }
    if (!nearStaticByRegion[coordinate.region]) {
      nearStaticByRegion[coordinate.region] = [];
    }
    nearStaticByRegion[coordinate.region].push(coordinate.name);
  }

  const output = {
    schemaVersion: 1,
    modelKind: "opensim-motion",
    source: {
      rightWorkbook: projectRelative(right.filePath),
      rightWorkbookSha256: right.sha256,
      leftWorkbook: projectRelative(left.filePath),
      leftWorkbookSha256: left.sha256,
      mappingCsv: projectRelative(mappingPath),
      sourceMotion: projectRelative(sourceMotion?.filePath),
      skeletonModelSha256: manifest.source.modelSha256,
    },
    meta: {
      frameCount,
      fps,
      durationSeconds:
        frameTimesSeconds.at(-1) - frameTimesSeconds[0],
      coordinateCount: catalog.definitions.length,
      explicitCoordinateCount: new Set(explicitCoordinates).size,
      activationColumnCount: new Set([
        ...Object.keys(rightData.activations),
        ...Object.keys(leftData.activations),
      ]).size,
      missingExplicitCoordinates,
      nearStaticCoordinates,
      nearStaticByRegion,
      units: {
        rotation: "radian",
        translation: "meter",
        sourceRotation: "degree",
      },
      note:
        "Left and right Sheet1 rows are merged by row-2 OpenSim coordinate names. Source sign transformations are restored before pose evaluation.",
    },
    frameTimesSeconds,
    coordinateNames: catalog.definitions.map(
      (coordinate) => coordinate.name,
    ),
    coordinates,
    activations: {
      right: rightData.activations,
      left: leftData.activations,
    },
    ranges,
    columnAudit: {
      right: rightData.columnAudit,
      left: leftData.columnAudit,
    },
    audit,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        source: output.source,
        meta: output.meta,
        audit,
        mergeWarnings: mergeWarnings.slice(0, 100),
        mergeWarningCount: mergeWarnings.length,
        coordinateRangesDegrees: Object.fromEntries(
          catalog.definitions.map((coordinate) => [
            coordinate.name,
            {
              min:
                coordinate.motionType === "rotation"
                  ? ranges[coordinate.name].min * 180 / Math.PI
                  : ranges[coordinate.name].min,
              max:
                coordinate.motionType === "rotation"
                  ? ranges[coordinate.name].max * 180 / Math.PI
                  : ranges[coordinate.name].max,
              unit:
                coordinate.motionType === "rotation" ? "deg" : "m",
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`OpenSim XLSX motion converted: ${outputPath}`);
  console.log(
    `  Frames: ${frameCount}, fps: ${fps.toFixed(6)}, duration: ${output.meta.durationSeconds.toFixed(6)} s`,
  );
  console.log(
    `  Coordinates: ${output.meta.explicitCoordinateCount} explicit / ${catalog.definitions.length} total`,
  );
  console.log(
    `  Missing explicit: ${missingExplicitCoordinates.join(", ") || "none"}`,
  );
  console.log(
    `  Near-static: ${nearStaticCoordinates.join(", ") || "none"}`,
  );
  if (audit) {
    console.log(
      `  Source motion audit error: ${audit.maxCoordinateError.toExponential(3)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
