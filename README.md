# dsh-screenshot

两个能力，一个插件：

1. **输入框截图按钮（给用户）**：点一下截屏，图片直接进当前草稿，可发可删，不用再开系统截图工具再粘贴。
2. **模型截图工具（给 agent，可选）**：`screenshot` 工具，模型可以截桌面 / 某个窗口 / 区域，图片直接作为图片块返回。
3. **设置页**（设置 → 截图）：`允许模型自己截屏`、`截图前先询问` 两个开关。后者是硬约束：开启后模型每次截屏都要先经你同意（`tools/pre-execute` 返回 `ask`，不是口头约定）。

截图引擎是 `capture.ps1`：PowerShell + GDI，DPI aware、多显示器、DWM 窗口边框、区域裁剪、等比缩放，零原生依赖。

## 用法

- 输入框左侧有**相机按钮 + 下拉箭头**：

  | 选项 | 行为 |
  | --- | --- |
  | 框选截图（默认） | 点相机直接进系统级框选 |
  | 隐藏窗口后框选 | 先把 DSH 窗口藏起来再截，截出来的图里没有 DSH 自己 |
  | 按上次选区截图 | 复用上一次的选区直接截（下拉里显示尺寸，如 `640x480`） |
  | 截取整个屏幕 | 直接截整屏插入 |

- 窗口聚焦时按 **Ctrl+Shift+S** 等价于点相机（框选）。
- 框选时左上角会**实时显示选区尺寸**（`宽 x 高`）。

- 框选是**系统级置顶窗口**（PowerShell + WinForms，覆盖所有显示器），桌面先冻结成图再选：
  拖动鼠标框选任意区域（不限 DSH 窗口），松手自动裁剪并插入输入框；`Esc` / 右键取消。
  选完自动裁到 ≤1600px 宽（原图不受影响）。原生选择器起不来时会自动退回“窗口内框选”。
- 拖拽闪动已修：选择窗口开了双缓冲（`OptimizedDoubleBuffer` + `AllPaintingInWmPaint`），并且把“变暗的整屏”预先烘焙成一张位图，每次重绘只画一张暗图 + 选区里那块亮的，不再每次重画两张 2560×1600 的图。
- 模型侧：`screenshot(target="screen")`、`screenshot(target="window", window="Edge")`、`screenshot(target="region", regionX=..., regionY=..., regionWidth=..., regionHeight=...)`。

## 设置

`设置 → 截图`：

| 开关 | 默认 | 作用 |
| --- | --- | --- |
| 允许模型自己截屏 | 开 | 关闭后 `screenshot` 工具直接拒绝执行 |
| 截图前先询问 | 开 | 硬约束：模型每次截图前需要你确认 |

设置页还会显示**上次选区**（`宽x高 @ (x,y)`）并可以一键清除；这两个开关只影响模型发起的截图，用户点按钮 / Ctrl+Shift+S 不弹询问。

设置保存在 `$DSH_HOME/screenshot/settings.json`（默认 `~/.dsh/screenshot/settings.json`），截图文件在 `$DSH_HOME/screenshot/shots/`。

## 限制

- 只在 Windows 上可用。
- 截的是屏幕上实际显示的内容：被遮挡的部分拍不到；最小化的窗口要还原。
- 框选是独立的 PowerShell + WinForms 置顶窗口：独占全屏的游戏/视频可能盖不住它；混合 DPI 的多显示器上坐标可能有偏差。
- `select.ps1` 里有中文提示文本，**文件必须保持 UTF-8 带 BOM**（Windows PowerShell 5.1 按 ANSI 解析无 BOM 文件会乱码报错）。
- 客户端插件改动需要刷新页面；Host 改动需要重启 DSH。

## 结构

```
index.js        # Host：工具 + Remote 服务（capture/getSettings/saveSettings）+ 硬约束闸门
capture.ps1     # 截图引擎
lib/client.js   # Client：输入框按钮 + 设置页
```
