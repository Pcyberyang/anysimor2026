# 多刚体模型 轻量化模型展示

页面由 OpenSim 骨架、逐帧 IK 动作、自由坐标驱动和肌肉激活共同驱动。

## 页面能力

- 原始框架与 `.osim` 目标尺寸切换
- 185 帧、90 Hz 的 OpenSim IK 动作回放与时间轴拖动
- 按 OpenSim 坐标定义的自由动作驱动
- 14 个肌肉激活通道，左右共 28 个显示组、92 条代表性路径
- 肌肉颜色、粗细和透明度随激活度变化
- 骨骼、关节中心、地面、跟随骨盆和肌肉显示开关

## 启动

需要 Node.js 20.19.x，或 22.12 及更高版本。

```powershell
npm install
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:5173/
```

`index.html` 会自动进入 `opensim.html`。

## 构建与 GitHub Pages

```powershell
npm run build
npm run preview
```

构建结果位于 `dist/`。Vite 使用相对基础路径，可部署到 GitHub Pages 的仓库子路径。把 `dist/` 发布到 Pages 即可，源仓库本身不需要上传 `dist/`。

## 主要数据

```text
public/models/opensim/source/  原始 OpenSim .osim 与源格式骨骼网格
public/models/opensim/geometry/ Web 使用的轻量化 STL
public/data/opensim/           骨架清单、缩放模板、动作、肌肉路径和验证报告
input/                         左右全身活动测量 XLSX 与 OpenSim IK .mot
```

运行时入口为 `src/opensim/viewer.js`。肌肉绘制映射位于 `src/opensim/muscleDrawSettings.js`、`muscleDrawState.js` 和 `muscleTubeGeometry.js`，均为本发布包内的 OpenSim 命名空间文件。

## 重新导出与验证

```powershell
npm run export:opensim
npm run verify:opensim
```

肌肉重导出需要 Python 3。骨架和动作重导出只需要 Node.js。

当前验证覆盖骨架拓扑、OpenSim SpatialTransform 顺序、初始/目标缩放、动作与源 IK 的一致性、脊柱坐标方向、肌肉路径的 Body-local 存储以及颜色/透明度映射。

## 数据限制

- 肌肉路径采用代表性直线或样条路径，尚未逐帧求解 OpenSim `PathWrap`。
- 聚合肌肉组和子组会重叠显示，聚合组使用较低透明度。
- 当前 IK 源数据中的上肢和大部分脊柱坐标变化很小，因此回放中接近静止；这是源数据状态，不是 Web 渲染丢失自由度。
