# LazyWhisper - UI/UX Design System

## 1. Interaction Paradigms (核心交互范式)
* **Contextual Over Global (上下文优于全局中断)**: 
  * 尽可能避免使用全局 Modal 遮罩打断用户心流。
  * 对于局部信息的查看、解密、轻量级操作，优先使用紧贴目标的浮层（Popover/Tooltip）或内联展开（Accordion）。仅在涉及全局设置、高危确认时使用 Modal。
* **Zero-Click Input (零点击输入预测)**: 
  * 永远预测用户的下一步输入意图。进入任何具有明确输入目的的新界面时，必须自动将焦点（Focus）劫持到主输入框。
* **Graceful Degradation (优雅降级与响应式)**: 
  * 移动端不是桌面端的缩小版。侧边栏必须转换为抽屉（Drawer），复杂的多栏布局必须折叠为栈式布局。
* **Density & Proportions (移动端密度法则)**:
  * 移动端的屏幕不仅小，而且距离用户的眼睛更近。
  * 严禁在移动端组件（如 Popover、Card、Modal）中使用桌面级的巨大内边距（如 `p-6` 或 `p-8`）。必须通过响应式断点将其缩减为紧凑的 `p-3` 或 `p-4`。
  * 表单输入框在移动端严禁无脑 100% 撑满宽度，必须使用 `max-w-sm mx-auto` 进行“收腰”，保持精致感。

## 2. Visual Language (视觉语言)
* **Monochromatic Hierarchy (单色层级)**: 
  * 放弃高饱和度的主题色。依靠 `zinc/gray` 灰度色阶、字体粗细（Weight）、字间距（Tracking）来构建视觉焦点。
* **Elevation & Material (层级与材质)**: 
  * 基础背景保持扁平纯色。通过柔和的阴影（Shadows）和背景模糊（Backdrop Blur）来区分浮层与底层，构建深度感。
* **Strict Iconography**: 
  * 禁用任何平台自带的 Emoji。统一使用线框风格的 SVG 图标库（如 Lucide），保持线条粗细绝对一致。

## 3. Security UX (安全类 UI 专属原则)
* **Input Sandbox (输入框沙盒)**: 
  * 涉及密码和密语的输入区域，必须从 UI 层面彻底切断操作系统的辅助干扰（禁用拼写检查、首字母大写、自动联想）。
* **Clear Cryptographic State**: 
  * 加密/解密、锁定/解锁的视觉状态必须有强烈的对比（例如：掩码模糊 vs 清晰粗体）。
* **Strict Separation of Auth & Content (鉴权与消费严格分离)**:
  * **鉴权行为 (Authentication)** 必须是强阻断的，统一使用 Modal（模态框）来承载密码输入。
  * **内容消费 (Content Consumption)** 必须是轻量、连贯的。一旦鉴权通过，密文的查看必须使用 Popover（气泡）或内联展开，**严禁使用 Modal 来展示最终的内容**。
  * **体验无缝移交**：当用户在 Modal 中鉴权成功后，Modal 必须立即销毁，并自动唤起目标内容的 Popover，实现状态的“零点击”无缝流转。