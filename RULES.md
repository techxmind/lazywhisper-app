# LazyWhisper React/Frontend Rules (.cursorrules)

在生成或修改本项目的前端 React 代码时，必须**严格遵守**以下架构级铁律：

## 1. 焦点管理与零点击输入 (Zero-Click Input)
- **默认自动聚焦**：用户进入需要输入的新界面（Modal、新页面）时，光标必须自动置于第一个主要 `<input>` 或 `<textarea>` 内。
- **Modal 安全聚焦策略**：严禁在具有入场动画的 Modal/Dialog 中单纯依赖 `<input autoFocus />`。必须使用 `useRef` + `useEffect`，在挂载后显式调用 `inputRef.current?.focus()`。
- **移动端防御**：移动端 (iOS/Android) 仅在“明确需要输入的场景”（如点击了“新建”或“解锁”按钮）才允许执行自动聚焦，避免首页软键盘意外遮挡屏幕。

## 2. 移动端视口与软键盘防抖死 (Mobile Viewport & Keyboard Lock)
- **禁止 iOS 默认推移**：iOS Safari/WebView 在键盘弹起时会将整个 `<body>` 推飞。开发全屏容器布局时，根节点必须使用 `h-[100dvh] overflow-hidden bg-zinc-950`，内部滚动区使用 `overflow-y-auto`。
- **动态高度监听**：如果遭遇严重的键盘遮挡，必须优先编写/使用 `useVisualViewport` Hook 监听 `window.visualViewport.height` 来动态设定容器的精确像素高度。

## 3. DOM 事件冲突与选区拦截 (Event & Selection Guard)
- **阻止悬浮菜单误触发**：在开发处理选中文本后弹出的“悬浮操作栏 (Floating Toolbar)”时，**必须**在显示逻辑前拦截空选区：
  ```javascript
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return;