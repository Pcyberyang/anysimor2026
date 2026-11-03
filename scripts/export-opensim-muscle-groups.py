"""Export selected OpenSim muscle paths for lightweight Web rendering.

The path points stay in their owning Body-local coordinates. The runtime applies
the same body scale and animation transforms as the skeleton.
"""

from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MODEL = Path(
    os.environ.get(
        "OPENSIM_MODEL_PATH",
        ROOT
        / "public"
        / "models"
        / "opensim"
        / "source"
        / "SpineModel_mass60marktoPlugInGait_PY2026_vascap_anklefootX_1011PSneck_mir5_fullarm_R2L_v11_anybody_subtalar.osim",
    )
)
MANIFEST = ROOT / "public" / "data" / "opensim" / "skeleton-manifest.json"
TEMPLATE = ROOT / "public" / "data" / "opensim" / "scaling-template.json"
OUTPUT = ROOT / "public" / "data" / "opensim" / "muscle-groups.json"


GROUPS = [
    {
        "id": "gastrocnemius_lateralis",
        "label": "腓肠肌外侧头",
        "activation": "Activitymean-GastrocnemiusLat",
        "muscles": ["gastrocnemius_lateralis"],
        "radius": 0.011,
        "opacity": 1.0,
    },
    {
        "id": "gastrocnemius_medialis",
        "label": "腓肠肌内侧头",
        "activation": "Activitymean-GastrocnemiusMed",
        "muscles": ["med_gas"],
        "radius": 0.012,
        "opacity": 1.0,
    },
    {
        "id": "gastrocnemius_total",
        "label": "腓肠肌总体",
        "activation": "Activitymean-Gastrocnemius",
        "muscles": ["gastrocnemius_lateralis", "med_gas"],
        "radius": 0.017,
        "opacity": 0.2,
    },
    {
        "id": "rectus_femoris",
        "label": "股直肌",
        "activation": "Activitymean-RectusFemoris",
        "muscles": ["rect_fem"],
        "radius": 0.011,
        "opacity": 1.0,
    },
    {
        "id": "iliacus_total",
        "label": "髂肌总体",
        "activation": "Activitymean-Iliacus",
        "muscles": ["iliacus"],
        "radius": 0.010,
        "opacity": 0.2,
    },
    {
        "id": "psoas_major_t12_l2",
        "label": "腰大肌 T12-L2",
        "activation": "Activitymean-PsoasMajorT12L2",
        "muscles": [
            "Ps_L1_VB",
            "Ps_L1_TP",
            "Ps_L1_L2_IVD",
            "Ps_L2_TP",
            "Ps_L2_L3_IVD",
        ],
        "radius": 0.008,
        "opacity": 1.0,
    },
    {
        "id": "psoas_major_l3_l5",
        "label": "腰大肌 L3-L5",
        "activation": "Activitymean-PsoasMajorL3L5",
        "muscles": [
            "Ps_L3_TP",
            "Ps_L3_L4_IVD",
            "Ps_L4_TP",
            "Ps_L4_L5_IVD",
            "Ps_L5_TP",
            "Ps_L5_VB",
        ],
        "radius": 0.008,
        "opacity": 1.0,
    },
    {
        "id": "psoas_major_total",
        "label": "腰大肌总体",
        "activation": "Activitymean-PsoasMajor",
        "muscles": [
            "Ps_L1_VB",
            "Ps_L1_TP",
            "Ps_L1_L2_IVD",
            "Ps_L2_TP",
            "Ps_L2_L3_IVD",
            "Ps_L3_TP",
            "Ps_L3_L4_IVD",
            "Ps_L4_TP",
            "Ps_L4_L5_IVD",
            "Ps_L5_TP",
            "Ps_L5_VB",
        ],
        "radius": 0.012,
        "opacity": 0.2,
    },
    {
        "id": "psoas_major_upper",
        "label": "腰大肌上部",
        "activation": "Activitymean-PsoasMajor-Upper",
        "muscles": [
            "Ps_L1_VB",
            "Ps_L1_TP",
            "Ps_L1_L2_IVD",
            "Ps_L2_TP",
            "Ps_L2_L3_IVD",
        ],
        "radius": 0.008,
        "opacity": 1.0,
    },
    {
        "id": "psoas_major_mid",
        "label": "腰大肌中部",
        "activation": "Activitymean-PsoasMajor-Mid",
        "muscles": [
            "Ps_L2_L3_IVD",
            "Ps_L3_TP",
            "Ps_L3_L4_IVD",
            "Ps_L4_TP",
        ],
        "radius": 0.008,
        "opacity": 1.0,
    },
    {
        "id": "psoas_major_lower",
        "label": "腰大肌下部",
        "activation": "Activitymean-PsoasMajor-Lower",
        "muscles": ["Ps_L4_L5_IVD", "Ps_L5_TP", "Ps_L5_VB"],
        "radius": 0.008,
        "opacity": 1.0,
    },
    {
        "id": "gluteus_medius_anterior",
        "label": "臀中肌前束",
        "activation": "Activitymean-GluteusMediusAnterior",
        "muscles": ["glut_med1"],
        "radius": 0.010,
        "opacity": 1.0,
    },
    {
        "id": "gluteus_medius_posterior",
        "label": "臀中肌后束",
        "activation": "Activitymean-GluteusMediusPosterior",
        "muscles": ["glut_med2", "glut_med3"],
        "radius": 0.010,
        "opacity": 1.0,
    },
    {
        "id": "gluteus_medius_total",
        "label": "臀中肌总体",
        "activation": "Activitymean-GluteusMed",
        "muscles": ["glut_med1", "glut_med2", "glut_med3"],
        "radius": 0.015,
        "opacity": 0.2,
    },
]


def parse_vector(text: str) -> list[float]:
    values = [float(value) for value in re.split(r"\s+", text.strip()) if value]
    if len(values) != 3:
        raise ValueError(f"Expected Vec3, got {text!r}")
    return values


def body_from_socket(socket: str) -> str:
    match = re.match(r"^/bodyset/([^/]+)", socket.strip())
    if not match:
        raise ValueError(f"Path point does not point directly to a Body: {socket}")
    return match.group(1)


def find_muscles(root: ET.Element) -> dict[str, ET.Element]:
    muscles = {}
    for tag in (
        "Millard2012EquilibriumMuscle",
        "Thelen2003Muscle",
        "DeGrooteFregly2016Muscle",
    ):
        for muscle in root.findall(f".//{tag}"):
            name = muscle.get("name")
            if name:
                muscles[name] = muscle
    return muscles


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    bodies = {body["id"]: body for body in manifest["bodies"]}
    root = ET.parse(MODEL).getroot()
    muscles = find_muscles(root)
    output_groups = []
    missing = []

    for group in GROUPS:
        for side, suffix in (("right", "_r"), ("left", "_l")):
            paths = []
            for muscle_base in group["muscles"]:
                muscle_name = muscle_base + suffix
                muscle = muscles.get(muscle_name)
                if muscle is None:
                    missing.append(muscle_name)
                    continue
                path_container = muscle.find("./GeometryPath/PathPointSet/objects")
                if path_container is None:
                    missing.append(f"{muscle_name}:GeometryPath")
                    continue
                points = []
                for point in list(path_container):
                    if point.tag not in ("PathPoint", "ConditionalPathPoint"):
                        continue
                    # Conditional points encode alternate wrapping contacts.
                    # The lightweight renderer uses stable base points.
                    if point.tag == "ConditionalPathPoint":
                        continue
                    socket = point.findtext("socket_parent_frame")
                    location = point.findtext("location")
                    if not socket or not location:
                        raise ValueError(
                            f"{muscle_name}/{point.get('name')} lacks frame/location"
                        )
                    body_id = body_from_socket(socket)
                    if body_id not in bodies:
                        raise ValueError(
                            f"{muscle_name}/{point.get('name')} unknown Body {body_id}"
                        )
                    target_local = parse_vector(location)
                    scale = template["bodies"][body_id]["scaleFactors"]
                    initial_local = [
                        value / scale[index] for index, value in enumerate(target_local)
                    ]
                    points.append(
                        {
                            "bodyId": body_id,
                            "targetLocal": target_local,
                            "initialLocal": initial_local,
                        }
                    )
                if len(points) >= 2:
                    paths.append(
                        {
                            "sourceMuscle": muscle_name,
                            "points": points,
                        }
                    )

            if not paths:
                missing.append(f"{group['id']}_{side}")
                continue
            output_groups.append(
                {
                    "id": f"{group['id']}_{side}",
                    "label": f"{group['label']}（{'右' if side == 'right' else '左'}）",
                    "side": side,
                    "activationColumn": group["activation"],
                    "restBellyRadius": group["radius"],
                    "opacity": group["opacity"],
                    "paths": paths,
                }
            )

    if missing:
        raise RuntimeError(f"Missing source muscles/path data: {sorted(set(missing))}")

    output = {
        "schemaVersion": 1,
        "modelKind": "opensim-muscle-groups",
        "source": {
            "modelFile": MODEL.relative_to(ROOT).as_posix(),
            "modelSha256": manifest["source"]["modelSha256"],
            "pathPointStorage": "Body-local",
            "wrapping": "Representative straight paths; PathWrap is not evaluated",
        },
        "meta": {
            "groupCount": len(output_groups),
            "pathCount": sum(len(group["paths"]) for group in output_groups),
            "pointCount": sum(
                len(path["points"])
                for group in output_groups
                for path in group["paths"]
            ),
            "drawMapping": "Activitymean drives the shared color, radius and opacity mapping",
        },
        "groups": output_groups,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Exported {len(output_groups)} muscle groups to {OUTPUT}")
    print(f"  paths: {output['meta']['pathCount']}")
    print(f"  points: {output['meta']['pointCount']}")


if __name__ == "__main__":
    main()
