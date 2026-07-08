<div align="center">
  <h1>划词解读</h1>
  <p><strong>选中 · 按键 · 解读</strong></p>
  <p>基于大语言模型 API 的 Chrome 上下文划词解释插件，选中任意文本，一键获得 AI 解读，支持多轮追问。</p>

  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/Chrome-88%2B-4285F4?logo=googlechrome&logoColor=white" alt="Chrome 88+"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/Manifest_V3-FF6F00?logo=googlechrome&logoColor=white" alt="Manifest V3"></a>
  <a href="https://github.com/yourname/explain_module/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ea44f" alt="License MIT"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/dependencies-0-2ea44f" alt="Zero Dependencies"></a>
  <br>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/API-OpenAI_Compatible-412991?logo=openai&logoColor=white" alt="OpenAI Compatible"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/API-DeepSeek_Compatible-536DFE" alt="DeepSeek Compatible"></a>
  <br>
  <a href="README_EN.md">English</a>
</div>

---

## 📄 文档

以下为快速安装与使用指南。详细配置说明请参考后文。

<details open>
<summary>安装</summary>

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「**开发者模式**」
3. 点击「**加载已解压的扩展程序**」
4. 选择本项目根目录，确认

```bash
# 克隆仓库
git clone https://github.com/yourname/explain_module.git

# 然后在 Chrome 中加载 explain_module 目录
```

</details>

<details open>
<summary>使用</summary>

### 划词解读

选中页面中任意文本后按下 **Ctrl + Alt**，或按住 **Ctrl + Alt** 后划选文本，弹窗将结合上下文给出解读。

| 操作 | 效果 |
|------|------|
| 选中文本 + **Ctrl + Alt** | 弹出解读窗口，展示上下文解释 |
| 弹窗底部输入框 | 继续追问，多轮对话 |
| 拖拽弹窗标题栏 | 移动弹窗位置 |
| 点击弹窗外灰色遮罩 | 关闭弹窗 |
| `Shift + Enter` | 输入框内换行 |

> **macOS 用户**：使用 **Control + Option（⌃ + ⌥）** 代替 Ctrl + Alt。macOS 的 Option 键在 Chrome 中被识别为 Alt，其余操作完全一致。

### 配置 API

点击扩展图标打开设置面板，填入大模型 API 信息后保存。支持任意 OpenAI 兼容接口。

```json
// 以大模型返回的典型解释为例
{
  "endpoint": "https://api.deepseek.com/v1/chat/completions",
  "model": "deepseek-v4-flash",
  "key": "sk-xxx"
}
```

</details>

## ✨ 特性

| 特性 | 说明 |
|------|------|
| 🔗 **上下文感知** | 自动提取选中内容所在段落的上下文，解读贴合原文语境，而非孤立解释单词 |
| 💬 **对话追问** | 解读完成后可在弹窗内继续提问，完整的多轮对话体验 |
| 🎨 **明暗主题** | 自动跟随系统深色模式，弹窗 UI 无缝融入任意网页 |
| 🔌 **多 API 兼容** | 支持 DeepSeek、通义千问、智谱、Kimi、OpenAI 等所有 OpenAI 兼容接口 |
| ✏️ **自定义提示词** | 支持 `{CONTEXT}` 和 `{SELECTION}` 变量，可自由定制解读风格 |
| 🖱️ **可拖拽弹窗** | 标题栏拖拽移动，不影响页面操作 |
| 🛡️ **事件隔离** | Shadow DOM 封装样式与事件，输入框编辑键不回传到页面 |
| 📦 **零依赖** | 纯原生 JavaScript，不引入任何第三方库 |

## 🔌 兼容的 API 服务

以下为常见兼容服务的配置参考。端点地址需包含完整路径（如 `/v1/chat/completions`）。

| 服务 | 端点 | 模型示例 |
|------|------|----------|
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4` |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |

## 🏗️ 项目结构

```
├── manifest.json          # 扩展清单 (Manifest V3)
├── background.js          # Service Worker — API 调用层
├── content.js             # Content Script — 选区检测、弹窗渲染、交互逻辑
├── content.css            # 宿主元素基础样式
├── prompts.js             # 系统提示词模板（独立文件，方便修改）
├── debug.js               # 调试工具模块（通过设置面板开启）
├── popup/
│   ├── popup.html         # 设置面板页面
│   ├── popup.js           # 设置面板逻辑
│   └── popup.css          # 设置面板样式
└── icons/                 # 扩展图标
```

<details>
<summary>核心架构说明</summary>

- **content.js**：注入每个页面的内容脚本。使用 Shadow DOM 创建隔离的弹窗 UI，通过 `window.getSelection()` 检测选区，提取所在块级元素的文本作为上下文，通过 `chrome.runtime.sendMessage` 与后台通信。
- **background.js**：Service Worker。负责接收 content script 的解释/追问请求，构建系统提示词，调用大模型 API。不直接操作 DOM。
- **prompts.js**：提示词模板文件。默认包含带有 `{CONTEXT}` 和 `{SELECTION}` 占位符的中文系统提示词，修改后刷新扩展即可生效。
- **事件隔离**：弹窗内 `keydown`/`mousedown`/`click` 均 `stopPropagation`，输入框编辑键额外 `stopImmediatePropagation`，确保不会穿透到宿主页面。弹窗焦点的按键被全局 keydown 监听识别并跳过页面逻辑。

</details>

## 🐛 调试

1. 点击扩展图标 → 勾选「🐛 调试模式」
2. 在目标页面按 **F12** 打开控制台
3. 日志前缀为 `[划词解读]`

独立调试入口：

| 组件 | 方式 |
|------|------|
| Service Worker | `chrome://extensions/` → 点击「Service Worker」链接 |
| Content Script | 目标页面按 F12，Console 面板 |
| 设置面板 | 右键扩展图标 →「检查弹出内容」 |

## ❓ 常见问题

<details>
<summary>弹窗内输入退格键删掉了页面文字？</summary>

已修复。弹窗内所有编辑键（Backspace、Delete、方向键、Home、End）做了事件隔离，不会穿透到宿主页面。

</details>

<details>
<summary>刷新扩展后弹窗打不开？</summary>

`chrome://extensions/` 中刷新扩展后，已打开的页面必须**刷新**（F5）才能注入新版 content script。旧版脚本在页面加载时注入，之后不会自动更新。

</details>

<details>
<summary>报 "Extension context invalidated" 错误？</summary>

刷新页面（F5）即可。原因是扩展被更新/重载后，旧页面中注入的 content script 与原 Service Worker 的连接已断开。

</details>

<details>
<summary>API 调用返回 404？</summary>

检查端点地址是否包含完整路径（如 `/v1/chat/completions`），且模型名称与 API 服务要求一致。

</details>

<details>
<summary>浏览器兼容性？</summary>

Chrome 88+（Manifest V3）。Edge、Brave 等所有 Chromium 内核浏览器均可使用。不支持 Firefox（Manifest V2 需适配）。

</details>

## 📜 许可

本项目采用 [MIT](LICENSE) 许可协议。你可以自由使用、修改和分发。

## 📞 反馈

- 问题报告与功能请求：提交 [GitHub Issue](https://github.com/yourname/explain_module/issues)
- 代码贡献：提交 Pull Request

<br>
<div align="center">
  <sub>Built with ❤️ for curious readers</sub>
</div>
