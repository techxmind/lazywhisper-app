# LazyWhisper Design Guidelines

## 核心领域概念 (Domain Ontology)
- **密语空间 (Space / Vault)**: 指代整个应用的底层加密容器（`.wspace` 文件）。
- **手记 (Note)**: 指代左侧边栏中的每一个独立页面（原“文档”）。
- **密语 (Whisper)**: 仅限指代手记内容中，那些被单独加密、需要局部密码解锁的内联富文本块。绝对禁止将整个手记页面称为“密语”或“文档”。

## Core Principles
- **Zen & Minimalist**: Breathe spacing into all elements. Never crowd the user.
- **macOS Native Feel**: Interactions should feel like a native, premium desktop application.

## Iconography
- **Strictly No Emojis**: Absolutely no emojis (🔒, 🔑, 👁️, 🔓, etc.) are permitted for UI icons.
- **Lucide React**: Exclusively use `lucide-react` monochromatic wireframe icons.
  - Line thickness must remain consistent.
  - Default color should map to context, usually `text-gray-500` for secondary hints, or `text-gray-800` for active states.

## Color Palette & Buttons
- **Primary Action (Primary Button)**:
  - Base: `bg-gray-800 text-white font-medium rounded-lg px-5 py-2.5 transition-colors shadow-sm`
  - Hover: `hover:bg-gray-900`
  - Disabled/Locked: `disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:cursor-not-allowed disabled:shadow-none`
- **Secondary Action (Cancel/Close Button)**:
  - Base/Bordered: `bg-white border border-gray-200 text-gray-600 font-medium rounded-lg px-4 py-2 transition-colors`
  - Hover: `hover:bg-gray-50`
- **Avoid High Saturation**: Do not use generic, highly saturated colors like bright blue or flat red for primary structural bounds. Use muted grays, slates, and rich dark tones.

## Inputs & Textareas
- **Focus Rings**:
  - `bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 transition-shadow`
- **No Underlines**: Absolutely no minimalist underline text fields. All inputs must be fully bounded containers.

## States & Feedback
- **Error/Warning States**:
  - Do not use naked red text suspended in empty space.
  - Wrap errors in contained structural blocks:
  - Example: `bg-red-50 text-red-600 border border-red-100 rounded-lg px-4 py-3 text-sm`
  - Pair with a corresponding Lucide icon (e.g., `AlertCircle`, `Lock`) for clarity.

## Typography
- **Tracking & Weight**:
  - Passwords: Use `tracking-widest` to enforce visual separation of masked dots.
  - Sub-headers/Labels: Use `uppercase tracking-widest text-[11px] font-bold text-gray-500` for grouping labels (like the Reveal Modal categories).

## Strict i18n Policy (🌐 多语言强制规范)
- **Zero Hardcoding**: Absolutely no hardcoded raw Chinese or English strings are permitted in front-end React code (JSX text, placeholders, alerts, modals).
- **Enforced keys**: All user-facing text must be added as synchronized key-value pairs in `src/i18n.ts` (or respective localization JSON files).
- **Dynamic Translation**: Exclusively use `const { t } = useTranslation();` to dynamically render strings.
- **Proactive Checklist**: On every feature addition or refactor, proactively check for un-translated strings and map them systematically before requesting user review.
