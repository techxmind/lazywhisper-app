# LazyWhisper - AI Coding Standards & Rules (.cursorrules)

在生成或修改任何代码时，必须强制遵守以下开发铁律：

## 1. Defensive Frontend Engineering (防御性前端编程)
* **Event Propagation Control (事件流阻断)**: 
  * 在复杂的嵌套组件（如富文本编辑器内的交互块）中，必须严格管理事件冒泡（`stopPropagation`），并主动清理/校验浏览器的默认选区（Selection），防止触发意外的悬浮菜单或失去焦点。
* **Animation-Aware State (感知动画的生命周期)**: 
  * 凡是涉及入场/出场动画的组件（Modal/Popover），焦点获取或 DOM 测量必须在动画挂载完成后进行，严禁单纯依赖原生的 `autoFocus`。

## 2. Mobile-First Viewport Resilience (移动端视口韧性)
* **Keyboard Intrusion Defense (软键盘侵入防御)**: 
  * 永远假设移动端软键盘会破坏布局。开发全屏或底部固定的组件时，必须使用动态视口单位（如 `dvh`），并锁定根节点的滚动（`overflow: hidden`），将滚动区域严格限制在内容层内。
* **Safe Area Padding (安全区预留)**: 
  * 所有贴边的导航栏、固定按钮，必须结合 CSS 环境变量（`env(safe-area-inset-*)`）进行内边距计算，防止被刘海屏或手势条遮挡。

## 3. Code Modernity & Cleanliness (现代代码规范)
* **State Colocation (状态就近原则)**: 
  * 避免无意义的全局状态提升。UI 状态（如弹窗开关）应保留在局部组件或 Context 中；仅将影响应用生命周期的核心数据（如密码缓存）放入全局 Store。
* **Absolute i18n (绝对国际化)**: 
  * 严禁在视图层（JSX/TSX）硬编码任何用户可见的文本串。所有文案变更必须通过多语言键值对（i18n keys）动态映射。
* **Strict Type Safety**: 
  * 禁用 `any`。所有组件 Props、API 响应、IPC 通信负载必须拥有明确的 TypeScript Interface 定义。

## 4. Mobile-First & Touch UI Verification (移动端优先与触控验证)

为了确保 UI 在 iOS/Android 端的绝对可靠性，在生成任何新的交互组件（特别是浮层、菜单、按钮）时，必须在内心执行以下自检，并在代码中落实：

- **原则 1：无 Hover 依赖 (Zero Hover Fallback)**。移动端没有鼠标。任何重要的信息或操作（如 Tooltip、Popover），绝对禁止仅通过 `hover` 触发，必须有明确的 `onClick` 或长按触控替代方案。
- **原则 2：浮动元素必须 Portal 逃逸 (Portal Everything Floating)**。所有的 Dropdown Menu、Popover、Tooltip，**必须使用 React Portal 渲染到 `document.body`**。严禁就地渲染，防止被移动端复杂的 `overflow: hidden` 或 Transform 上下文意外裁剪。
- **原则 3：触控区尺寸下限 (Touch Targets Min-Size)**。任何可点击的图标、按钮，在移动端断点下，其视觉大小或透明的内边距 (`p-`) 必须保证最小 44x44 像素的触控热区，防止误触。
- **原则 4：幽灵点击防御 (Ghost Click & Bubbling)**。在处理自定义的 `Click-Outside` 逻辑时，必须同时监听 `touchstart`。在移动端触发弹窗的按钮上，必须注意拦截冒泡，防止“打开即关闭”的闪退 Bug。

## 5. Rich Text & Nested Interactivity (富文本与内嵌交互防坑)

在基于 `contentEditable` 的编辑器内开发任何“可点击的内嵌交互元素（如密语块、标签、提及）”时，必须严格遵守以下隔离规范：

- **局部不可编辑声明**：内嵌交互块的根节点必须明确声明 `contentEditable={false}`，将其从编辑器的输入流中剥离，防止移动端误弹键盘。
- **事件绝对阻断**：任何挂载在内嵌块上的触发事件（Click/PointerDown），必须在第一行同时执行 `e.preventDefault()` 和 `e.stopPropagation()`，彻底切断与父级编辑器的焦点争夺。
- **触控热区与响应声明**：非 `<button>` 或 `<a>` 的自定义点击元素，必须加上 `cursor: pointer` 以确保 iOS Safari 的 Click 引擎不掉帧，并利用 `inline-block` 与 `padding` 适度放大触控面积。

## 7. Cross-Context Data Flow & Graceful Degradation (跨上下文流转与优雅降级)

在处理富文本编辑器中带有独立加密上下文的自定义节点（如密语块）的剪贴板操作时：

- **拒绝强阻断 (No Hard Blocking)**：严禁在用户执行常规的复制/粘贴操作时弹窗报错或插入强烈的警告色块，这会严重破坏笔记软件的书写心流。
- **降级解包策略 (Unwrap Strategy)**：当系统检测到带有安全上下文约束的节点被跨域粘贴时，必须在剪贴板管道中执行“解包 (Unwrapping)”。剥离其自定义 Node 的属性与交互能力，仅将其内部的纯文本 (Text Content) 作为普通字符串注入到目标编辑器中。
- 核心目标：宁可让其退化为无交互的普通文本，也绝对不允许异构的加密对象污染当前的系统状态。

## 8. Cryptographic Memory Hygiene (密码学内存卫生)
- **阅后即焚 (Zeroization)**：任何包含用户密码、临时解密密钥的变量（如 React State, ref），在完成加密/解密计算后，或在鉴权 Modal 卸载 (Unmount) 时，必须显式清空（赋值为 `''` 或重置状态）。绝对禁止明文密码在内存中无限期驻留。
- **无痕日志 (Silent Logs)**：严禁在前端代码和 Rust 后端代码中 `console.log` 或 `println!` 任何密钥、密文负载、文件绝对路径。如果为了调试必须打印，必须在提交前删除。

## 9. Strict Internationalization (i18n) Enforcement (强制多语言与去硬编码规范)

作为一款全球化的产品，所有面向用户展示的文本（User-Facing Text）必须严格遵守国际化规范：

- **绝对禁止硬编码 (Zero Hardcoded Strings)**：在任何 React 组件（如页面、模态框、气泡、侧边栏）、Tauri Rust 后端返回的业务提示，甚至 GitHub Actions 的发版日志中，**绝对禁止**直接写入英文或中文的纯文本字符串。
- **强制使用翻译机制**：
  - 前端组件必须通过统一的 i18n Hook（如 `useTranslation`, `t()` 等）获取文案。
  - 新增任何功能（如搜索框的 Placeholder、按钮文本、空状态提示、报错 Toast），必须同步在对应的语言字典文件（如 `en.json`, `zh.json` 等）中补充 key-value 映射。
- **全面覆盖盲区**：不仅是主文本，翻译范围必须强制覆盖：`placeholder`、`<img alt="">`、`aria-label`、工具提示 (`Tooltip`) 以及各类校验失败的错误信息。