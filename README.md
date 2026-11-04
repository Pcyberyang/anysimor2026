# 多刚体模型 轻量化模型展示



## 页面能力

- 原始框架与 `.osim` 目标尺寸切换
- 第一版仅对14 个肌肉激活通道，左右共 28 个显示组、92 条代表性路径
- 肌肉颜色、粗细和透明度随激活度变化
- 骨骼、关节中心、地面、跟随骨盆和肌肉显示开关
- 展示：
- 
<img width="1263" height="871" alt="1" src="https://github.com/user-attachments/assets/8f9b0440-601c-4276-9b61-76ab52b67ca1" />
<img width="1079" height="875" alt="2" src="https://github.com/user-attachments/assets/2f5920ec-4580-4e54-9d96-8381f0abeb34" />
<img width="1093" height="724" alt="3" src="https://github.com/user-attachments/assets/7616e009-16b9-434f-bd00-f46ca14e31df" />
<img width="1071" height="768" alt="4" src="https://github.com/user-attachments/assets/78ef879a-30e6-4ed2-866c-7458c15a24c7" />
<img width="1003" height="652" alt="10" src="https://github.com/user-attachments/assets/6673c419-d1d4-44cf-b0f0-45f9482e9d57" />
<img width="1068" height="948" alt="11" src="https://github.com/user-attachments/assets/d024f3d4-ca10-47c3-9cbf-c94a234897b8" />

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


  
