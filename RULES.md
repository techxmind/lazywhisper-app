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