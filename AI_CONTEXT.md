# 🧠 LazyWhisper (懒人密语) - AI Onboarding & Architecture Knowledge Base

## 1. Project Overview (项目概述)
* **Name**: LazyWhisper (懒人密语)
* **Slogan**: Your Data has a Soul. Math Keeps it Private. (数据有灵，数学封存 / 数学级封存，个人级守护)
* **Core Concept**: 极简、本地优先 (Local-first)、深度加密的个人隐私金库。无云端同步，无用户追踪，提供段落级（Paragraph-level）的加密控制。
* **Tech Stack**: 
  * **Backend/System**: Tauri, Rust
  * **Frontend**: React 18, TypeScript, Vite
  * **UI/Styling**: Tailwind CSS, shadcn/ui (Dark mode as default for security contexts, Light mode for editing)

---

## 2. Core Business Logic (核心业务逻辑)
* **The `.wspace` Vault**: 用户的整个工作区（包含多篇手记）被加密打包为一个 `.wspace` 后缀的单文件。
* **Whisper Blocks (密语块/局部加密)**: 核心杀手锏功能。允许在同一篇 Note 中，使用独立于主金库的“临时密码（Whisper Key）”对特定段落进行二次加密。UI 上表现为未解锁时是乱码/模糊状态。
* **Partial Export (局部导出)**: 支持导出整个金库，也支持默认仅导出当前高亮的单篇 Note 作为一个全新的、合法的 `.wspace` 文件，方便极其私密的安全分享。

---

## 3. Critical Security Architecture (高危安全架构)
在对本项目进行任何修改时，**绝对不能破坏**以下三道安全防线：

1. **Throttled Timestamp Auto-Lock (心跳轮询自动锁定)**
   * **机制**: 弃用了不安全的 `setTimeout`。采用 `mousemove/keydown` 节流更新全局 `useRef` 时间戳，并使用 `setInterval` 进行心跳比对。
   * **防御目标**: 完美免疫操作系统休眠（OS Sleep）导致的时间轴冻结问题，防止性能灾难。
   * **兜底逻辑**: 在锁屏触发前，如果检测到 `hasUnsaved` 为 true，必须静默调用 Rust 的 `save_vault` 落盘，确保数据绝对不丢，然后再执行锁定。

2. **Absolute UI Overlay & State Kill Switch (UI 绝对压制与状态熔断)**
   * **机制**: 锁定界面 (`LockScreen`) 具有全站最高 z-index 且通过 Portal 挂载。触发锁定时，必须强制关闭所有的弹窗（Settings, Export 等），并清除内存中的主密码明文。
   * **防御目标**: 防止“UI 穿透绕过漏洞（Overlay Bypass）”，即使在锁屏下也绝对无法点击底层元素。在任何涉及数据修改的敏感函数入口，必须存在 `if (isLocked) return;` 的逻辑熔断。

---

## 4. System-Level Workarounds & Gotchas (系统级时序处理方案)
本项目处理了极其复杂的跨平台系统级 API 时序问题。**严禁随意重构前端的初始化生命周期！**

* **The "Race Condition" Handshake (冷启动事件握手)**:
  * **背景**: macOS 的 `RunEvent::Opened` (AppleEvents) 派发时机与 React Webview 挂载时间存在不可控的竞态冲突。
  * **解决方案**: Rust 端充当“邮箱”，收到启动参数或双击路径后存入 `AppState` 缓存队列。React 前端通过 `useRef` 拦截 Strict Mode 双重挂载，并在应用初始化时主动向 Rust 发起 `frontend_is_ready` 握手指令拉取路径。同时配合 `listen` 拦截迟到的系统广播。
* **Transient Sessions (临时会话降级)**:
  * 用户双击外部的 `export.wspace` 文件时，仅在内存中加载该路径以供本次查看（临时会话）。**绝对不能**将其覆盖写入 `localStorage('lastVaultPath')`，以免劫持用户的主金库路径。

---

## 5. Engineering Standards (强制工程规范)
任何在此代码库中工作的 AI 助手，必须严格遵守以下军规：

1. **Strict i18n Policy (零硬编码规范)**
   * 绝对禁止在前端 JSX/TSX 中硬编码中文或英文字符串。
   * 任何面向用户的文案，必须同步更新 `locales/zh.json` 和 `locales/en.json`，并使用 `const { t } = useTranslation()` 动态渲染。
2. **Zero Panic Rust (Rust 端防崩溃)**
   * 严禁在 `src-tauri` 中使用未捕获的 `.unwrap()` 或 `.expect()`。必须使用 `Result` 将错误优雅地传递给前端弹窗提示。桌面软件闪退是最高级别事故。
3. **Cross-Platform Paths (跨平台路径安全)**
   * 处理文件路径时，严禁使用硬编码的 `/` 或 `\` 字符串拼接。必须使用 Rust 的 `std::path::PathBuf` 或 Tauri 暴露的 `path` API。

---
**Dear AI Assistant:** If you have read and understood this document, please reply with: *"LazyWhisper Architecture Context Loaded. Mathematically Sealed, Personally Guarded."* before proceeding with the user's instructions.
---