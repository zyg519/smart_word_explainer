<div align="center">
  <h1>Smart Word Explainer</h1>
  <p><strong>Select · Press · Understand</strong></p>
  <p>A Chrome extension that provides AI-powered contextual explanations for any selected text, with follow-up conversation support.</p>

  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/Chrome-88%2B-4285F4?logo=googlechrome&logoColor=white" alt="Chrome 88+"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/Manifest_V3-FF6F00?logo=googlechrome&logoColor=white" alt="Manifest V3"></a>
  <a href="https://github.com/yourname/explain_module/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-CC_BY--NC_4.0-2ea44f" alt="License CC BY-NC 4.0"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/dependencies-0-2ea44f" alt="Zero Dependencies"></a>
  <br>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/API-OpenAI_Compatible-412991?logo=openai&logoColor=white" alt="OpenAI Compatible"></a>
  <a href="https://github.com/yourname/explain_module"><img src="https://img.shields.io/badge/API-DeepSeek_Compatible-536DFE" alt="DeepSeek Compatible"></a>

  <a href="README.md">中文</a>
</div>

---

## 📄 Documentation

Quickstart guide for installation and usage. See below for detailed configuration options.

<details open>
<summary>Install</summary>

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "**Developer mode**" (top-right toggle)
3. Click "**Load unpacked**"
4. Select the project root directory

```bash
# Clone the repository
git clone https://github.com/zyg519/smart_word_explainer.git

# Then load the smart_word_explainer directory in Chrome
```

</details>

<details open>
<summary>Usage</summary>

### Explaining Text

Select any text on a webpage and press **Ctrl + Alt**, or hold **Ctrl + Alt** while selecting text. A popup will appear with a contextual explanation.

| Action | Result |
|--------|--------|
| Select text + **Ctrl + Alt** | Open explanation popup with contextual interpretation |
| Input field at popup bottom | Continue the conversation with follow-up questions |
| Drag the popup title bar | Reposition the popup |
| Click the gray backdrop outside | Close popup |
| `Shift + Enter` | Insert a new line in the input field |

> **macOS users**: Use **Control + Option (⌃ + ⌥)** instead of Ctrl + Alt. The Option key is recognized as `Alt` in Chrome; all other features work identically across platforms.

### Configuring the API

Click the extension icon to open the settings panel. Fill in your LLM API details and save. Compatible with any OpenAI-style endpoint.

```json
// Example API configuration
{
  "endpoint": "https://api.deepseek.com/v1/chat/completions",
  "model": "deepseek-chat",
  "key": "sk-xxx"
}
```

</details>

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔗 **Context-Aware** | Automatically extracts the surrounding paragraph as context for explanations that fit the original text |
| 💬 **Follow-Up Chat** | Multi-turn conversation support — continue asking after the initial explanation |
| 📡 **Streaming Output** | Optional streaming mode — replies appear word-by-word in real time |
| 📐 **Math Rendering** | KaTeX integration — renders `$...$` `$$...$$` `\(...\)` `\[...\]` math formulas |
| 📝 **Markdown** | Headers, ordered/unordered lists, code blocks, bold, links — full Markdown support |
| 🎨 **Dark Mode** | Automatically follows the system color scheme, blending seamlessly into any webpage |
| 🔌 **Multi-API Compatible** | Works with DeepSeek, Qwen, GLM, Kimi, OpenAI, and any OpenAI-compatible endpoint |
| ✏️ **Custom Prompts** | Supports `{CONTEXT}` and `{SELECTION}` placeholders for fully customizable explanation style |
| 🖱️ **Draggable Popup** | Reposition the popup by dragging its title bar |
| 🛡️ **Event Isolation** | Shadow DOM encapsulation — edit keys inside the popup never leak to the host page |

## 🔌 Compatible API Providers

The following are reference configurations for common providers. Endpoints must include the full path (e.g., `/v1/chat/completions`).

| Provider | Endpoint | Example Model |
|----------|----------|---------------|
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-plus` |
| GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4` |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |

## 🏗️ Project Structure

```
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service Worker — API communication layer
├── content.js             # Content Script — selection detection, popup rendering, interaction
├── content.css            # Host element base styles
├── prompts.js             # System prompt templates (standalone file for easy editing)
├── debug.js               # Debug utility module (toggled via settings panel)
├── lib/
│   ├── katex.min.js       # KaTeX math rendering library
│   ├── katex.min.css
│   └── fonts/             # KaTeX font files
├── popup/
│   ├── popup.html         # Settings panel page
│   ├── popup.js           # Settings panel logic
│   └── popup.css          # Settings panel styles
└── icons/                 # Extension icons
```

<details>
<summary>Architecture Overview</summary>

- **content.js**: Injected into every page. Creates an isolated popup UI using Shadow DOM, detects text selection via `window.getSelection()`, extracts the surrounding block element's text as context, and communicates with the background via `chrome.runtime.sendMessage`.
- **background.js**: Service Worker. Receives explain/chat requests from the content script, builds system prompts, and calls the LLM API. Does not manipulate the DOM.
- **prompts.js**: Prompt template file. Contains default system prompts with `{CONTEXT}` and `{SELECTION}` placeholders. Edit and reload the extension to apply changes.
- **Event Isolation**: All `keydown`/`mousedown`/`click` events inside the popup call `stopPropagation`. Edit keys additionally call `stopImmediatePropagation`, ensuring they never leak to the host page. The global keydown listener detects popup focus and skips page-level logic accordingly.

</details>

## 🐛 Debugging

1. Click the extension icon → check "🐛 Debug Mode"
2. Press **F12** on any page to open DevTools
3. Look for logs prefixed with `[划词解读]`

Isolated debugging:

| Component | How to access |
|-----------|--------------|
| Service Worker | `chrome://extensions/` → click the "Service Worker" link |
| Content Script | Press F12 on the target page → Console tab |
| Settings Panel | Right-click extension icon → "Inspect popup" |

## ❓ FAQ

<details>
<summary>Backspace in the popup deleted my page content?</summary>

Fixed. All edit keys (Backspace, Delete, arrow keys, Home, End) within the popup are event-isolated and will not propagate to the host page.

</details>

<details>
<summary>Popup won't open after reloading the extension?</summary>

After refreshing the extension in `chrome://extensions/`, all already-open pages must be **refreshed** (F5) to receive the updated content script. Old scripts are injected at page load and are not automatically updated.

</details>

<details>
<summary>"Extension context invalidated" error?</summary>

Refresh the page (F5). This occurs when the extension is reloaded or updated while a page with the old content script is still open.

</details>

<details>
<summary>API returns 404?</summary>

Verify the endpoint URL includes the full path (e.g., `/v1/chat/completions`) and the model name matches what the API provider expects.

</details>

<details>
<summary>Browser compatibility?</summary>

Chrome 88+ (Manifest V3). All Chromium-based browsers (Edge, Brave, etc.) are supported. Firefox is not supported (requires Manifest V2 adaptation).

</details>

## 📜 License

This project is licensed under [CC BY-NC 4.0](LICENSE). You are free to use, modify, and share it, but **commercial use is not permitted**.

## 📞 Contact

- Bug reports & feature requests: Open a [GitHub Issue](https://github.com/yourname/explain_module/issues)
- Code contributions: Submit a Pull Request

<br>
<div align="center">
  <sub>Built with ❤️ for curious readers</sub>
</div>
