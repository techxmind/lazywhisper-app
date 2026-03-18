# LazyWhisper - AI Architecture & Philosophy Context

## 1. Product Philosophy (产品哲学)
* **Local-First & Zero-Knowledge**: 用户的设备就是最终的边界。绝不假设存在云端服务器，绝不将任何明文数据或密钥持久化到网络。
* **Cryptographic Segmentation (加密隔离)**: 整体金库（Vault）与局部密语块（Whisper Block）是分离的加密域。AI 在设计数据流时，必须时刻保持“主密码”与“临时密码”的生命周期隔离。
* **Zen & Hostile-Environment Ready**: 界面极简，但底层必须时刻防范“恶劣环境”——包括系统突然休眠、后台被杀、剪贴板嗅探等。

## 2. System Architecture Guardrails (系统级架构护栏)
* **Memory-Only Secrets**: 任何解密后的明文、用户输入的密码，只允许存在于 React/Rust 的内存变量中。严禁将其写入 `localStorage`、`IndexedDB` 或磁盘日志。
* **State Kill Switch (状态熔断)**: 系统必须具备全局的“锁屏/熔断”能力。在任何涉及数据读取、导出的关键流入口，必须优先校验当前的锁定状态。锁屏触发时，必须拥有最高 UI 层级并销毁底层敏感状态。
* **Cross-Platform Asynchrony**: 永远假设 Desktop (Tauri) 和 Mobile (WebView) 的原生 API 响应存在延迟和竞态条件。初始化和通信机制必须是防御性、容错的（例如事件握手队列）。