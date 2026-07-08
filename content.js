// ============================================================
// 划词解读 - 完整修复版
// 修复：1.输入框退格/删除会删掉页面原生文本 2.事件冒泡冲突 3.弹窗焦点隔离 4.全部catch带完整大括号
// ============================================================
(function () {

  // 开启 JS严格模式:
  //  字符串字面量，固定写法 'use strict'，必须写在代码块最顶部；
  //  作用范围：只对当前所在函数 / 脚本生效；
  //  严格模式规则（小白能看懂）：
  //  变量必须 let/const/var 声明才能使用，不能直接写 a=1；
  //  禁止偷偷创建全局变量，减少网页变量冲突；
  //  很多模糊、有坑的旧 JS 语法直接禁用，代码更安全。
  'use strict';

  const VERSION = '2.0.1';      // 定义常量，保存脚本版本号

  // typeof chrome：运算符 typeof，获取后面数据的类型，返回字符串
  // !==：严格不等号，左右值类型 + 内容完全不一样才为 true
  // 两个 !!：把任意值强制转成布尔；有 id= true，无 id=false；
  const runtimeReady = typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;

  // 控制台打印彩色加载日志，显示版本、扩展状态、扩展 ID
  console.log(
    '%c[划词解读]%c v' + VERSION + ' %c已加载%c | runtime: ' + (runtimeReady ? '✅' : '❌') + ' | id: ' + (runtimeReady ? chrome.runtime.id : 'N/A'),
    'color:#2563eb;font-weight:bold', 'color:#666', 'color:#059669', 'color:#888'
  );
  if (!runtimeReady) {
    console.error('[划词解读] ⚠️ Chrome 扩展运行时未就绪！刷新页面重试');
  }

  // (()=>{})()：IIFE 立即执行箭头函数
  // ()=>{}：无参匿名箭头函数
  // 外层括号把函数转为表达式，末尾()立刻执行
  // 函数内部所有变量（PREFIX/_enabled）只在函数内生效，外部访问不到，隔离全局污染
  const DBG = (() => {        
    const PREFIX = '[划词解读]';
    let _enabled = false;       // let 声明可变变量
    try {
      if (chrome && chrome.storage && chrome.storage.local) {

        // chrome.storage.local.get(键数组, 回调)：Chrome 扩展 API，异步读取本地持久存储；
        // ['debugEnabled'] 数组字面量，指定要读取的配置键；
        // r => {} 箭头回调函数：读取完成后自动执行，r是读取到的全部配置对象
        chrome.storage.local.get(['debugEnabled'], r => {
          _enabled = !!r.debugEnabled;
        });

        // .addListener(回调)：浏览器存储事件监听；
        // 当本地存储配置发生修改时，自动执行箭头回调；
        // changes 参数：保存本次变更的配置信息。
        chrome.storage.onChanged.addListener(changes => {
          if (changes.debugEnabled) {                           // 判断本次修改的配置是不是debugEnabled，只响应调试开关的变动。
            _enabled = !!changes.debugEnabled.newValue;
          }
        });
      }
    } catch (e) {
      console.warn(PREFIX, '调试工具初始化异常', e);
    }

    // 对象简写方法，等价 log: function(tag, ...args){}；
    // tag：日志分类标签（如 Context、Explain）；
    // ...args 剩余参数：接收调用时传入的所有额外内容，打包成数组；
    // if (_enabled)：只有调试开关打开才执行打印；
    // `[${tag}]` 模板字符串，${变量} 直接嵌入文本；
    // ...args 展开运算符：把数组打散，逐个传给console.log；
    // , 对象方法分隔符。

    return {
      log(tag, ...args) {
        if (_enabled) {
          console.log(PREFIX, `[${tag}]`, ...args);
        }
      },
      warn(tag, ...args) {
        if (_enabled) {
          console.warn(PREFIX, `[${tag}]`, ...args);
        }
      },
      error(tag, ...args) {
        console.error(PREFIX, `[${tag}]`, ...args);
      },
      event(tag, detail) {
        if (_enabled) {
          console.log(PREFIX, '🔔', tag, detail || '');
        }
      }
    };
  })();

  // 检测当前页面是否具备完整 Chrome 扩展通信环境
  function isRuntimeAvailable() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
  }

  // 封装安全发送消息逻辑，发送前先校验扩展通信环境，避免直接调用 API 报错
  function safeSendMessage(payload) {
    if (!isRuntimeAvailable()) {
      throw new Error('扩展运行时未就绪，请刷新页面');
    }
    return chrome.runtime.sendMessage(payload);
  }

  // 原始报错信息是英文、专业难懂的浏览器底层文字，这个函数把它翻译成用户看得懂的中文提示。
  function formatError(error) {
    const msg = error.message || String(error);
    if (msg.includes('Extension context invalidated') || msg.includes('extension context')) {
      return '⚠️ 扩展已更新，请刷新页面(F5)';
    }
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish')) {
      return '⚠️ 后台服务断开，刷新扩展+页面';
    }
    return '❌ ' + msg;
  }

  const STATE = {
    ctrlPressed: false,                      // 标记键盘 Ctrl 键是否处于按住状态，快捷键 Ctrl+Alt 组合判断用
    altPressed: false,                       // 标记 Alt 键是否按住
    isProcessing: false,                     // 是否正在请求 AI 后台
    popupEl: null,                           // 用来判断弹窗是否已经打开、遮罩点击关闭逻辑
    shadowRoot: null,                        // 用来判断光标是否落在弹窗内部，解决退格删除页面文字的冲突
    popupInner: null,                        // 拖拽、弹窗内部事件监听会用到
    conversationMessages: [],                // 存储当前弹窗完整多轮对话记录：用户提问、AI 回复, 每次发送追问时，把历史对话一并传给后台，实现多轮上下文记忆
    systemPrompt: '',                        // 保存后台返回 / 用户自定义的系统提示词，传给 AI 接口
    selectedText: '',                        // 用户最初选中、唤起弹窗的原文
    contextText: '',                         // 选中文字所在段落的上下文截取文本
    isDragging: false,                        // 标记用户是否正在拖拽弹窗标题栏移动窗口
    streamStarted: false,                     // 流式输出标记，区分首次创建气泡和后续更新
    streamBubbleEl: null,                     // 流式输出时当前 assistant 气泡的 DOM 引用
    katexReady: false                         // KaTeX 库是否已加载完成
  };

  // Shadow DOM:
  // 普通页面所有标签、CSS 全部在同一个全局空间里; 
  // 浏览器提供的隔离容器(Shadow DOM)创建一块独立封闭的微型 DOM 空间, 和外层页面 DOM 完全隔绝, 里面的 HTML、CSS、JS 不会和外面互相干扰.
  // 弹窗所有 HTML、CSS 全部塞进 shadowRoot 里面渲染。
  // 页面的 CSS 进不去 shadow，不会改你弹窗样式；
  // 弹窗内部的 CSS 不会污染外面网页；
  // 页面 document.querySelector() 选不到 shadow 里面的输入框、按钮；
  // 只有通过 shadowRoot.querySelector 才能获取弹窗内部元素

  // KaTeX 由 manifest.json content_scripts 在 content.js 之前加载，
  // 同处隔离世界，katex 直接挂到 window，无需 eval
  (function initKaTeX() {
    STATE.katexReady = typeof katex !== 'undefined' && typeof katex.renderToString === 'function';
    console.log('[划词解读] 🔍 KaTeX 检测:', STATE.katexReady ? '✅ 已就绪 v' + (katex.version || '?') : '❌ 未加载 (typeof katex = ' + typeof katex + ')');
    // CSS 在 showPopup 中注入 Shadow DOM（样式隔离要求必须在 shadow 内）
  })();

  // 从 storage 读取高级配置，上下文截取长度等设置可实时生效
  // 初始化读取 chrome.storage.local.get：页面刚加载，一次性拉取保存过的配置，初始化 maxContextLength
  let maxContextLength = 2000;
  chrome.storage.local.get(['explainerConfig'], (result) => {
    if (result.explainerConfig && result.explainerConfig.maxContextLength) {
      maxContextLength = result.explainerConfig.maxContextLength;
    }
  });

  // 实时监听用户在设置页修改配置，不用刷新页面，变量立刻同步更新
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.explainerConfig && changes.explainerConfig.newValue) {
      const cfg = changes.explainerConfig.newValue;
      if (cfg.maxContextLength) maxContextLength = cfg.maxContextLength;
    }
  });

  // 把 < > & " ' 这类有 HTML 语义的符号，自动转成安全实体字符，防止 XSS、弹窗内布局错乱、标签被浏览器解析
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 这个函数接收纯文本（AI 返回的 markdown 风格文字），先转义防 XSS，再把简易 Markdown 语法批量转换成 HTML 标签，最终返回可直接放进弹窗的安全富文本
  function formatTextToHtml(text) {
    let raw = text;
    const mathStore = [];
    const codeBlockStore = [];
    const inlineCodeStore = [];

    // 1. 优先缓存全部数学公式，避免escapeHtml转义 $ \
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
      mathStore.push({ type: 'block', formula });
      return `__MATH_BLOCK_${mathStore.length - 1}__`;
    });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, formula) => {
      mathStore.push({ type: 'block', formula });
      return `__MATH_BLOCK_${mathStore.length - 1}__`;
    });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, formula) => {
      mathStore.push({ type: 'inline', formula });
      return `__MATH_INLINE_${mathStore.length - 1}__`;
    });
    raw = raw.replace(/(?<!\w)\$([^\$]+?)\$(?!\w)/g, (_, formula) => {
      mathStore.push({ type: 'inline', formula });
      return `__MATH_INLINE_${mathStore.length - 1}__`;
    });

    // 2. 缓存代码块
    raw = raw.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      codeBlockStore.push(escapeHtml(code.trim()));
      return `__CODE_BLOCK_${codeBlockStore.length - 1}__`;
    });
    raw = raw.replace(/`([^`]+)`/g, (_, code) => {
      inlineCodeStore.push(escapeHtml(code));
      return `__CODE_INLINE_${inlineCodeStore.length - 1}__`;
    });

    // 3. HTML转义
    let html = escapeHtml(raw);

    // 4. 恢复代码占位
    html = html.replace(/__CODE_INLINE_(\d+)__/g, (_, idx) => `<code>${inlineCodeStore[Number(idx)]}</code>`);
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => `<pre><code>${codeBlockStore[Number(idx)]}</code></pre>`);

    // 5. Markdown：按段落拆分，逐段判断类型再处理
    const paragraphs = html.split(/\n\n/);
    const outputParts = [];

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // ----- 标题 -----
      if (/^### (.+)$/m.test(trimmed)) {
        outputParts.push(trimmed.replace(/^### (.+)$/gm, '<h4>$1</h4>'));
        continue;
      }
      if (/^## (.+)$/m.test(trimmed)) {
        outputParts.push(trimmed.replace(/^## (.+)$/gm, '<h3>$1</h3>'));
        continue;
      }
      if (/^# (.+)$/m.test(trimmed)) {
        outputParts.push(trimmed.replace(/^# (.+)$/gm, '<h2>$1</h2>'));
        continue;
      }

      // ----- 无序列表 -----
      if (/^- .+$/m.test(trimmed)) {
        const items = trimmed.split(/\n/).filter(l => /^- /.test(l)).map(l => `<li>${l.slice(2)}</li>`);
        outputParts.push(`<ul>${items.join('')}</ul>`);
        continue;
      }
      // ----- 有序列表 -----
      if (/^\d+\. .+$/m.test(trimmed)) {
        const items = trimmed.split(/\n/).filter(l => /^\d+\. /.test(l)).map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`);
        outputParts.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      // ----- 普通段落（\n → <br>）-----
      outputParts.push(`<p>${trimmed.replace(/\n/g, '<br>')}</p>`);
    }
    html = outputParts.join('');

    // 内联样式（在段落内部全局应用）
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 6. 恢复并渲染数学公式
    console.log('[划词解读] 🔢 公式渲染：mathStore总数=' + mathStore.length + ', katexReady=' + STATE.katexReady + ', window.katex=' + typeof window.katex);
    if (STATE.katexReady && window.katex) {
      html = html.replace(/__MATH_BLOCK_(\d+)__/g, (_, idx) => {
        const item = mathStore[Number(idx)];
        console.log('[划词解读] 📐 渲染块公式:', item.formula.substring(0, 40));
        return renderMath(item.formula, true);
      });
      html = html.replace(/__MATH_INLINE_(\d+)__/g, (_, idx) => {
        const item = mathStore[Number(idx)];
        console.log('[划词解读] 📐 渲染行内公式:', item.formula.substring(0, 40));
        return renderMath(item.formula, false);
      });
    } else {
      console.log('[划词解读] ⚠️ KaTeX 未就绪，公式原文展示 (mathStore: ' + mathStore.length + ' 条)');
      html = html.replace(/__MATH_BLOCK_(\d+)__/g, (_, idx) => {
        const f = escapeHtml(mathStore[Number(idx)].formula);
        return `<pre style="background:#f0f0f0;padding:6px;border-radius:4px;">$$${f}$$</pre>`;
      });
      html = html.replace(/__MATH_INLINE_(\d+)__/g, (_, idx) => {
        const f = escapeHtml(mathStore[Number(idx)].formula);
        return `<code>$${f}$</code>`;
      });
    }

    return html;
  }

  function renderMath(formula, displayMode) {
    try {
      return window.katex.renderToString(formula.trim(), {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        output: "html",
        trust: true
      });
    } catch {
      const safe = escapeHtml(formula.trim());
      if (displayMode) {
        return `<pre style="background:#eee;padding:6px;border-radius:4px;white-space:pre-wrap;">$$${safe}$$</pre>`;
      } else {
        return `<code>$${safe}$</code>`;
      }
    }
  }

  // 因为弹窗放在 ShadowDOM 里，样式必须通过 JS 拼接 <style> 标签注入，
  // 所以封装成函数统一输出所有弹窗样式，包含亮色 / 暗黑两套主题、动画、滚动条、聊天气泡、输入框、按钮全套布局。
  function getPopupStyles() {
    return `
      :host { all: initial; pointer-events: auto; }
      .explainer-popup {
        position: relative;
        width: 100%;
        height: 100%;
        max-height: unset;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15),0 2px 8px rgba(0,0,0,0.08);
        display: flex;
        flex-direction: column;
        font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif;
        font-size: 14px;
        color: #1a1a1a;
        line-height: 1.6;
        transition: opacity 0.2s, transform 0.2s;
        animation: explainerFadeIn 0.2s ease-out;
        user-select: text;
      }
      @keyframes explainerFadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      .explainer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 12px;
        border-bottom: 1px solid #f0f0f0;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
        background: #fafafa;
        border-radius: 12px 12px 0 0;
      }
      .explainer-header:active { cursor: grabbing; }
      .explainer-title { display: flex; align-items: center; gap:6px; font-size:13px; font-weight:600; color:#333; }
      .explainer-header-actions { display: flex; gap:4px; }
      .explainer-btn-icon { width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:#666;display:flex;align-items:center;justify-content:center;transition:0.15s; }
      .explainer-btn-icon:hover { background:#e8e8e8;color:#333; }
      .explainer-btn-send { width:32px;height:32px;border:none;background:#2563eb;color:#fff;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:0.15s; }
      .explainer-btn-send:hover { background:#1d4ed8; }
      .explainer-selected-text { padding:5px 12px;background:#f0f7ff;border-bottom:1px solid #dbeafe;font-size:12px;flex-shrink:0; }
      .explainer-label { color:#6b7280;margin-right:4px; }
      .explainer-selected-content { color:#1e40af;font-weight:500;font-style:italic; }
      .explainer-body { flex:1;overflow-y:auto;padding:10px 12px;min-height:60px;max-height:350px;display:flex;flex-direction:column;gap:6px; }
      .explainer-body::-webkit-scrollbar { width:6px; }
      .explainer-body::-webkit-scrollbar-thumb { background:#d0d0d0;border-radius:3px; }
      .explainer-message { animation:explainerFadeIn 0.2s ease-out;display:flex;flex-direction:column; }
      .explainer-message-user .explainer-bubble { align-self:flex-end;background:#2563eb;color:#fff;border-radius:12px 12px 4px 12px;padding:8px 14px;max-width:85%; }
      .explainer-message-assistant .explainer-bubble { align-self:flex-start;background:#f3f4f6;color:#1a1a1a;border-radius:12px 12px 12px 4px;padding:10px 14px;max-width:100%;line-height:1.7; }
      .explainer-bubble p { margin:0 0 4px 0; line-height:1.65; }
      .explainer-bubble p:last-child { margin-bottom:0; }
      .explainer-bubble ul, .explainer-bubble ol { margin:4px 0; padding-left:20px; }
      .explainer-bubble li { margin-bottom:2px; }
      .explainer-bubble h2, .explainer-bubble h3, .explainer-bubble h4 { margin:8px 0 4px 0; }
      .explainer-bubble pre { margin:6px 0; }
      .explainer-bubble strong { color:#1e40af;font-weight:600; }
      .explainer-bubble code { background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;font-family:SF Mono,Fira Code,monospace;font-size:0.9em; }
      .explainer-loading { display:flex;align-items:center;justify-content:center;gap:10px;padding:24px;color:#9ca3af;font-size:13px; }
      .explainer-loading-inline { display:flex;align-items:center;gap:8px; }
      .explainer-spinner { width:20px;height:20px;border:2.5px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:spin 0.7s linear infinite; }
      .explainer-spinner-sm { width:14px;height:14px;border-width:2px; }
      @keyframes spin { to { transform:rotate(360deg); } }
      .explainer-footer { padding:8px 12px;border-top:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;border-radius:0 0 12px 12px; }
      .explainer-input-wrapper { display:flex;align-items:flex-end;gap:8px; }
      .explainer-input { flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;resize:none;outline:none;line-height:1.4;max-height:120px;background:#fff;color:#1a1a1a;transition:0.15s; }
      .explainer-input:focus { border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.1); }
      .explainer-input::placeholder { color:#c0c0c0; }
      @media (prefers-color-scheme: dark) {
        .explainer-popup { background:#1e1e1e;border-color:#3a3a3a;box-shadow:0 8px 32px rgba(0,0,0,0.4);color:#e0e0e0; }
        .explainer-header { background:#252525;border-bottom-color:#3a3a3a; }
        .explainer-bubble pre { background:#333; }
        .explainer-title { color:#e0e0e0; }
        .explainer-btn-icon { color:#999; }
        .explainer-btn-icon:hover { background:#3a3a3a;color:#e0e0e0; }
        .explainer-selected-text { background:#1a2744;border-bottom-color:#2a3a5c; }
        .explainer-selected-content { color:#93c5fd; }
        .explainer-message-assistant .explainer-bubble { background:#2a2a2a;color:#e0e0e0; }
        .explainer-bubble strong { color:#93c5fd; }
        .explainer-bubble code { background:rgba(255,255,255,0.08); }
        .explainer-input { background:#2a2a2a;border-color:#3a3a3a;color:#e0e0e0; }
        .explainer-input:focus { border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.2); }
        .explainer-footer { background:#252525;border-top-color:#3a3a3a; }
        .explainer-body::-webkit-scrollbar-thumb { background:#555; }
      }
    `;
  }

  // 把 AI 回复渲染到弹窗聊天区域，一次性清空原有内容、替换成新回复，自动滚动到底部。
  function updatePopupContent(text) {
    if (!STATE.shadowRoot) {
      return;
    }
    const body = STATE.shadowRoot.getElementById('explainer-body');
    body.innerHTML = `<div class="explainer-message explainer-message-assistant"><div class="explainer-bubble">${formatTextToHtml(text)}</div></div>`;
    body.scrollTop = body.scrollHeight;
  }

  // 新增一条用户消息，不覆盖原有对话，追加在已有消息下方，自动滚到底部
  function appendUserMessage(text) {
    if (!STATE.shadowRoot) {
      return;
    }
    const body = STATE.shadowRoot.getElementById('explainer-body');
    const div = document.createElement('div');
    div.className = 'explainer-message explainer-message-user';
    div.innerHTML = `<div class="explainer-bubble">${escapeHtml(text)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  // 在聊天框底部新增一条 AI 回复气泡，保留历史所有对话，不会覆盖原有内容，渲染后自动滚动到底部。
  function appendAssistantMessage(text) {
    if (!STATE.shadowRoot) {
      return;
    }
    const body = STATE.shadowRoot.getElementById('explainer-body');
    const div = document.createElement('div');
    div.className = 'explainer-message explainer-message-assistant';
    div.innerHTML = `<div class="explainer-bubble">${formatTextToHtml(text)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  // 发送 AI 请求时，在聊天框底部生成一条带旋转加载图标的等待提示，返回这条加载 DOM 的唯一 ID，后续 AI 回复回来可以根据 ID 删除加载提示。
  function appendLoadingMessage() {
    if (!STATE.shadowRoot) {
      return;
    }
    const body = STATE.shadowRoot.getElementById('explainer-body');
    const id = 'load-' + Date.now();
    const div = document.createElement('div');
    div.className = 'explainer-message explainer-message-assistant';
    div.id = id;
    div.innerHTML = `<div class="explainer-bubble"><div class="explainer-loading-inline"><div class="explainer-spinner explainer-spinner-sm"></div><span>思考中...</span></div></div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return id;
  }

  // AI 接口返回结果（成功 / 报错）后，把之前显示的加载动画气泡从聊天框删掉。
  function removeLoadingMessage(id) {
    if (!STATE.shadowRoot || !id) {
      return;
    }
    const el = STATE.shadowRoot.getElementById(id);
    if (el) {
      el.remove();
    }
  }

  // 全局按键监听：增加弹窗焦点隔离，输入框编辑不影响页面
  // 整体作用：监听键盘按下、窗口失焦、鼠标松开事件，实现快捷键 Ctrl + Alt + 鼠标选文字 / Ctrl+Alt按住再按Alt 唤起划词弹窗；
  // 同时做冲突处理：光标在弹窗内部时，不触发全局快捷键逻辑
  document.addEventListener('keydown', (e) => {           // document.addEventListener('事件名', 回调)：全局注册事件监听

    // if (e.key === 'Escape' && STATE.popupEl) {         // 按下键盘 Esc 键，且弹窗存在时，直接销毁弹窗, 写在最前面：无论光标在哪，按 ESC 都能关掉弹窗
    //   destroyPopup();
    //   return;
    // }
    // 网页body
    //    └── popupEl（普通div，暴露在全局DOM，你能通过document查到）
    //      └── shadowRoot（独立隔离影子空间，全局看不见）
    //          ├─ <style> 弹窗全套CSS
    //          ├─ .explainer-header 标题栏
    //          ├─ .explainer-selected-text 选中文字栏
    //          ├─ #explainer-body 聊天框
    //          └─ .explainer-footer 输入框区域
    // 判断焦点是否落在弹窗内部，是则直接阻断全局按键逻辑
    if (STATE.popupEl && STATE.shadowRoot) {          // 弹窗存在才执行判断
      const activeEl = document.activeElement;        // 当前页面光标聚焦的 DOM（输入框、按钮等）
      const inPopupScope = STATE.shadowRoot.contains(activeEl) || STATE.popupEl.contains(activeEl);
      if (inPopupScope) {
        return;
      }
    }

    if (e.key === 'Control') {
      STATE.ctrlPressed = true;
      return;
    }
    if (e.key === 'Alt') {
      if (!e.repeat) {
        STATE.altPressed = true;
        e.preventDefault();
        if (STATE.ctrlPressed) {
          const sel = window.getSelection();
          if (sel && sel.toString().trim() && !STATE.isProcessing && !STATE.popupEl) {
            DBG.event('Alt键触发解释', sel.toString().trim().substring(0, 50));
            triggerExplanation();
          }
        }
      }
      return;
    }
    
  });

  // 监听键盘松开
  document.addEventListener('keyup', e => {
    if (e.key === 'Control') {
      STATE.ctrlPressed = false;
    }
    if (e.key === 'Alt') {
      STATE.altPressed = false;
    }
  });

  // 单纯靠 keyup 松开按键更新状态，存在漏洞：
  // 按住 Ctrl+Alt，直接切走窗口，没松开按键；
  // 页面收不到 keyup 事件，ctrlPressed / altPressed 会永久停留在 true；
  // 切回页面随便拖动鼠标就会误触发划词弹窗。
  // window.blur 就是兜底修复：只要窗口失去焦点，直接清空按键按住标记，避免状态卡死
  window.addEventListener('blur', () => {
    STATE.ctrlPressed = false;
    STATE.altPressed = false;
  });

  // 监听来自 background 的流式消息（STREAM_CHUNK / STREAM_DONE / STREAM_ERROR）
  chrome.runtime.onMessage.addListener((message) => {
    if (!STATE.shadowRoot) return;

    if (message.type === 'STREAM_CHUNK') {
      if (!STATE.shadowRoot) return;
      const body = STATE.shadowRoot.getElementById('explainer-body');
      if (!body) return;

      if (!STATE.streamStarted) {
        STATE.streamStarted = true;
        if (message.source === 'EXPLAIN') body.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'explainer-message explainer-message-assistant';
        div.innerHTML = `<div class="explainer-bubble"></div>`;
        body.appendChild(div);
        STATE.streamBubbleEl = div.querySelector('.explainer-bubble');
      }
      // 仅纯文本填充，不渲染HTML/公式，保护占位符缓存
      if (STATE.streamBubbleEl) {
        STATE.streamBubbleEl.textContent = message.accumulated;
        body.scrollTop = body.scrollHeight;
      }
    } else if (message.type === 'STREAM_DONE') {
      STATE.streamStarted = false;
      if (STATE.streamBubbleEl) {
        // 完整文本一次性格式化渲染，公式完整无截断
        STATE.streamBubbleEl.innerHTML = formatTextToHtml(message.fullContent);
        if (message.source === 'EXPLAIN') {
          STATE.conversationMessages.push({ role: 'assistant', content: message.fullContent });
        }
        if (message.source === 'CHAT') {
          STATE.conversationMessages.push({ role: 'assistant', content: message.fullContent });
          const input = STATE.shadowRoot.getElementById('explainer-input');
          if (input) input.focus();
        }
      }
      STATE.streamBubbleEl = null;
      STATE.isProcessing = false;
    } else if (message.type === 'STREAM_ERROR') {
      STATE.streamStarted = false;
      STATE.streamBubbleEl = null;
      if (STATE.shadowRoot) appendAssistantMessage(`❌ ${message.error}`);
      STATE.isProcessing = false;
    }
  });

  // 实现组合快捷键划词：按住 Ctrl + Alt，鼠标拖动选中文字，松开鼠标自动唤起解读弹窗
  document.addEventListener('mouseup', (e) => {
    if (STATE.popupEl && STATE.popupEl.isConnected) {
      return;
    }
    if (!STATE.ctrlPressed || !STATE.altPressed || STATE.isProcessing) {
      return;
    }
    const sel = window.getSelection();                // 获取当前鼠标选中的文本对象
    if (!sel || !sel.toString().trim()) {             // 取出选中文字并去除首尾空格
      return;                                         // 没有选中有效文字直接返回，不触发弹窗
    }
    DBG.event('鼠标选择触发', sel.toString().trim().substring(0, 50));
    triggerExplanation();
  });

  // 传入页面鼠标选中区域 Selection 对象，自动抓取选中文字所在段落 / 附近文本，裁剪成一段上下文，一起传给 AI，让 AI 结合语境解读单词句子；
  function extractContext(selection) {        // selection：window.getSelection(), 返回的选中对象，包含鼠标选区信息
    try {
      const range = selection.getRangeAt(0);             // 获取第一个选区（普通单选文字只有一个), range 包含选区起始、结束节点、偏移位置

      // commonAncestorContainer：选区起始、结束节点共同的最近父节点；
      // 例：一段文字跨两个<span>，会取包裹两个 span 的父 div/p。
      let container = range.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) {
        container = container.parentElement;
      }

      // 如果共同祖先只是纯文字，往上取它的父标签（p/div/section）作为容器。
      const block = findBlockAncestor(container);

      // 调用外部函数 findBlockAncestor，向上递归查找块级段落容器（<p> / <div> / <article> / section 等段落级标签）。
      // 目标：拿到完整段落文本，而不是零散一小段文字。
      if (block) {

        // 成功找到完整段落块：读取块内全部文本 block.textContent；
        // 调用 truncateContext 按预设长度截断上下文，同时保留选中文字在中间；
        // 直接返回处理好的上下文字符串。
        return truncateContext(block.textContent || '', STATE.selectedText);
      }

      // 没找到完整段落块时降级逻辑：取选区起始文字节点
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        const off = range.startOffset;
        return text.substring(Math.max(0, off - 500), Math.min(text.length, off + STATE.selectedText.length + 500));
      }
      return '';
    } catch (e) {
      console.warn('[划词解读] 上下文提取异常', e);
      return '';
    }
  }

  function findBlockAncestor(el) {
    const blockTags = ['P', 'DIV', 'ARTICLE', 'SECTION', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'ASIDE', 'MAIN', 'BODY'];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (blockTags.includes(cur.tagName) && (cur.textContent || '').length > STATE.selectedText.length) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function truncateContext(full, target) {
    const max = maxContextLength;
    if (full.length <= max) {
      return full;
    }
    const idx = full.indexOf(target);
    if (idx === -1) {
      return full.slice(0, max) + '...';
    }
    const half = Math.floor((max - target.length) / 2);
    const s = Math.max(0, idx - half);
    const e = Math.min(full.length, idx + target.length + half);
    return (s > 0 ? '...' : '') + full.slice(s, e) + (e < full.length ? '...' : '');
  }

  function getSelectionRect(sel) {
    try {
      if (sel.rangeCount === 0) {
        return null;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        return null;
      }
      return {
        left: r.left,
        top: r.bottom + 8,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        selectionTop: r.top
      };
    } catch {
      return null;
    }
  }

  async function triggerExplanation() {
    if (STATE.isProcessing) {
      return;
    }
    const sel = window.getSelection();
    const selectedText = sel.toString().trim();
    if (!selectedText) {
      return;
    }

    STATE.isProcessing = true;
    STATE.selectedText = selectedText;
    STATE.conversationMessages = [];
    STATE.systemPrompt = '';
    const contextText = extractContext(sel);
    STATE.contextText = contextText;
    DBG.log('Context', '选中片段', selectedText.substring(0, 50), '上下文长度', contextText.length);

    const rect = getSelectionRect(sel);
    if (!rect) {
      STATE.isProcessing = false;
      return;
    }
    showPopup(rect, 'loading');

    try {
      const res = await safeSendMessage({
        type: 'EXPLAIN',
        payload: { selectedText, contextText, conversationHistory: [] }
      });
      if (res.success) {
        if (res.streaming) {
          // 流式模式：响应立即返回，systemPrompt 先存好，内容由 STREAM_CHUNK 逐步填充
          STATE.systemPrompt = res.systemPrompt;
          STATE.streamingMessageType = 'EXPLAIN';
        } else {
          // 非流式模式：一次性拿到完整结果
          STATE.systemPrompt = res.data.systemPrompt;
          STATE.conversationMessages = res.data.messages.filter(m => m.role !== 'system');
          updatePopupContent(res.data.explanation);
          STATE.isProcessing = false;
        }
      } else {
        updatePopupContent(`❌ 解释失败：${res.error}`);
        STATE.isProcessing = false;
      }
    } catch (err) {
      updatePopupContent(formatError(err));
      DBG.error('Explain', err);
      STATE.isProcessing = false;
    }
  }

  function positionPopup(host, rect) {
    const w = 420;
    const maxH = 500;
    const margin = 16;
    let left = rect.left;
    let top = rect.top;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (left + w > vw - margin) {
      left = Math.max(margin, vw - w - margin);
    }
    if (left < margin) {
      left = margin;
    }
    const selectionBottom = rect.top;
    const selectionTop = rect.selectionTop || selectionBottom - 30;
    if (selectionBottom + maxH + margin < vh) {
      top = rect.top;
    } else if (selectionTop - maxH - margin > 0) {
      top = selectionTop - maxH - 8;
    } else {
      top = Math.max(margin, (vh - maxH) / 2);
    }
    host.style.left = left + 'px';
    host.style.top = top + 'px';
    host.style.width = w + 'px';
    host.style.maxHeight = Math.min(maxH, vh - margin * 2) + 'px';
  }

  function destroyPopup() {
    console.log('[DEBUG] 执行销毁弹窗');
    const backdrop = document.getElementById('explainer-backdrop');
    STATE.isDragging = false;
    if (!STATE.popupEl || !STATE.popupEl.isConnected) {
      STATE.popupEl = null;
      STATE.shadowRoot = null;
      STATE.popupInner = null;
      if (backdrop) {
        backdrop.remove();
      }
      return;
    }
    STATE.popupEl.remove();
    STATE.popupEl = null;
    STATE.shadowRoot = null;
    STATE.popupInner = null;
    if (backdrop) {
      backdrop.remove();
    }
  }
  // 你点击页面里内层小元素，这个点击事件会一层一层往上传递，传到它所有父元素、直到最顶层 document / window，这个向上传递的过程就叫事件冒泡
  // 修复版事件绑定：弹窗内按键停止冒泡，删除键不会穿透页面
  // popupInner 是整个弹窗容器；
  // 在弹窗内任意位置按下按键（包括 Escape），触发 keydown；
  // e.stopPropagation() 中断事件向上冒泡；
  // 以 ESC 键为例，你全局挂载在 document 的 keydown 监听收不到这个 ESC 事件，自然无法执行关闭弹窗代码
  function bindPopupEvents(shadow) {
    const popupInner = shadow.querySelector('.explainer-popup');
    const closeBtn = shadow.getElementById('explainer-btn-close');
    const clearBtn = shadow.getElementById('explainer-btn-clear');
    const sendBtn = shadow.getElementById('explainer-btn-send');
    const inputEl = shadow.getElementById('explainer-input');
    const header = shadow.querySelector('.explainer-header');
    const getHost = () => popupInner.getRootNode().host;

    // 弹窗整体拦截所有事件冒泡，隔绝页面
    popupInner.addEventListener('keydown', e => e.stopPropagation());
    popupInner.addEventListener('mousedown', e => e.stopPropagation());
    popupInner.addEventListener('click', e => e.stopPropagation());

    closeBtn.addEventListener('click', destroyPopup);
    clearBtn.addEventListener('click', async () => {
      STATE.conversationMessages = [];
      const body = shadow.getElementById('explainer-body');
      body.innerHTML = `<div class="explainer-loading"><div class="explainer-spinner"></div><span>重新解读...</span></div>`;
      try {
        const res = await safeSendMessage({
          type: 'EXPLAIN',
          payload: { selectedText: STATE.selectedText, contextText: STATE.contextText, conversationHistory: [] }
        });
        if (res.success) {
          STATE.systemPrompt = res.data.systemPrompt;
          STATE.conversationMessages = res.data.messages.filter(m => m.role !== 'system');
          updatePopupContent(res.data.explanation);
        } else {
          updatePopupContent(`❌ ${res.error}`);
        }
      } catch (err) {
        updatePopupContent(formatError(err));
      }
    });

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || STATE.isProcessing) {
        return;
      }
      STATE.isProcessing = true;
      inputEl.value = '';
      inputEl.style.height = 'auto';
      appendUserMessage(text);
      STATE.conversationMessages.push({ role: 'user', content: text });
      const loadId = appendLoadingMessage();
      try {
        const res = await safeSendMessage({
          type: 'CHAT',
          payload: { messages: STATE.conversationMessages, systemPrompt: STATE.systemPrompt }
        });
        removeLoadingMessage(loadId);
        if (res.success) {
          if (res.streaming) {
            // 流式：内容由 STREAM_CHUNK 逐步追加
            STATE.streamingMessageType = 'CHAT';
          } else {
            // 非流式：一次性显示
            STATE.conversationMessages.push({ role: 'assistant', content: res.data.reply });
            appendAssistantMessage(res.data.reply);
            STATE.isProcessing = false;
            inputEl.focus();
          }
        } else {
          appendAssistantMessage(`❌ ${res.error}`);
          STATE.isProcessing = false;
        }
      } catch (err) {
        removeLoadingMessage(loadId);
        appendAssistantMessage(formatError(err));
        STATE.isProcessing = false;
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', e => {
      // 停止冒泡，删除、方向键不会传到页面
      e.stopPropagation();
      const editKeys = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
      if (editKeys.includes(e.key)) {
        e.stopImmediatePropagation();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    let dragMoveHandler, dragUpHandler;
    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) {
        return;
      }
      STATE.isDragging = true;
      const host = getHost();
      const rect = host.getBoundingClientRect();
      const dragStartX = e.clientX;
      const dragStartY = e.clientY;
      const hostStartLeft = rect.left;
      const hostStartTop = rect.top;
      popupInner.style.transition = 'none';
      header.style.cursor = 'grabbing';
      e.preventDefault();
      dragMoveHandler = evt => {
        if (!STATE.isDragging) {
          return;
        }
        const dx = evt.clientX - dragStartX;
        const dy = evt.clientY - dragStartY;
        host.style.left = (hostStartLeft + dx) + 'px';
        host.style.top = (hostStartTop + dy) + 'px';
      };
      dragUpHandler = () => {
        STATE.isDragging = false;
        popupInner.style.transition = '';
        header.style.cursor = '';
        document.removeEventListener('mousemove', dragMoveHandler);
        document.removeEventListener('mouseup', dragUpHandler);
      };
      document.addEventListener('mousemove', dragMoveHandler);
      document.addEventListener('mouseup', dragUpHandler);
    });
  }

  function showPopup(selectionRect, mode) {
    destroyPopup();
    // 遮罩：仅自身接收鼠标，点击空白关闭
    const backdrop = document.createElement('div');
    backdrop.id = 'explainer-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:auto;background:rgba(0,0,0,0.4);';
    backdrop.addEventListener('mousedown', destroyPopup);
    document.body.appendChild(backdrop);

    // 弹窗外层容器允许交互
    const host = document.createElement('div');
    host.id = 'word-explainer-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;width:420px;max-height:500px;pointer-events:auto;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    STATE.shadowRoot = shadow;
    STATE.popupEl = host;

    const style = document.createElement('style');
    style.textContent = getPopupStyles();
    shadow.appendChild(style);

    // KaTeX CSS 必须在 Shadow DOM 内加载（样式隔离不能穿透）
    const katexLink = document.createElement('link');
    katexLink.rel = 'stylesheet';
    katexLink.href = chrome.runtime.getURL('lib/katex.min.css');
    shadow.appendChild(katexLink);

    const popupInner = document.createElement('div');
    popupInner.className = 'explainer-popup';
    popupInner.setAttribute('role', 'dialog');
    popupInner.setAttribute('aria-label', '划词解读');
    STATE.popupInner = popupInner;

    popupInner.innerHTML = `
      <div class="explainer-header">
        <span class="explainer-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5A6.5 6.5 0 111.5 8 6.507 6.507 0 018 1.5zm0 1A5.5 5.5 0 1013.5 8 5.506 5.506 0 008 2.5zm-.5 3h1v4h-1zm.5 5.5a.75.75 0 11-.75.75.752.752 0 01.75-.75z" fill="currentColor"/>
          </svg>
          划词解读
        </span>
        <div class="explainer-header-actions">
          <button class="explainer-btn-icon" id="explainer-btn-clear" title="清空对话" aria-label="清空对话">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12l-1.09 9.79A2 2 0 0110.92 15H5.08a2 2 0 01-1.99-1.21L2 4zm2.24 1l.87 7.79a1 1 0 00.97.71h3.84a1 1 0 00.97-.71L11.76 5H4.24zM5.5 2h5v1h-5zm2 0h1v1h-1z" fill="currentColor"/>
            </svg>
          </button>
          <button class="explainer-btn-icon" id="explainer-btn-close" title="关闭" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3.646 3.646a.5.5 0 01.708 0L8 7.293l3.646-3.647a.5.5 0 01.708.708L8.707 8l3.647 3.646a.5.5 0 01-.708.708L8 8.707l-3.646 3.647a.5.5 0 01-.708-.708L7.293 8 3.646 4.354a.5.5 0 010-.708z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="explainer-selected-text">
        <span class="explainer-label">选中内容:</span>
        <span class="explainer-selected-content">${escapeHtml(STATE.selectedText.length > 100 ? STATE.selectedText.substring(0, 100) + '...' : STATE.selectedText)}</span>
      </div>
      <div class="explainer-body" id="explainer-body">
        ${mode === 'loading' ? `<div class="explainer-loading"><div class="explainer-spinner"></div><span>正在解读...</span></div>` : ''}
      </div>
      <div class="explainer-footer">
        <div class="explainer-input-wrapper">
          <textarea id="explainer-input" class="explainer-input" placeholder="继续提问..." rows="1" aria-label="输入追问内容"></textarea>
          <button class="explainer-btn-send" id="explainer-btn-send" title="发送" aria-label="发送">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14.854.146a.5.5 0 01.111.54l-5 13a.5.5 0 01-.911.06L5.854 8 1.254 4.946a.5.5 0 01.06-.91l13-5a.5.5 0 01.54.11zM6.296 8.146l2.176 4.06L12.382 2.5 6.296 8.146zM2.5 4.118l3.157 2.052 4.943-4.943L2.5 4.118z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    shadow.appendChild(popupInner);

    positionPopup(host, selectionRect);
    bindPopupEvents(shadow);

    setTimeout(() => {
      const input = shadow.getElementById('explainer-input');
      if (input) {
        input.focus();
      }
    }, 300);
  }
})();