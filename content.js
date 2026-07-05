// ============================================================
// 划词解读 - Content Script
// 负责文本选择检测、上下文提取、悬浮弹窗交互
// ============================================================

(function () {
  'use strict';

  // ---- 调试工具（content script 内联版） ----
  const DBG = (() => {
    const PREFIX = '[划词解读]';
    let _enabled = false;

    // 启动时从 storage 读取开关
    chrome.storage.local.get(['debugEnabled'], (r) => { _enabled = !!r.debugEnabled; });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.debugEnabled) { _enabled = !!changes.debugEnabled.newValue; }
    });

    return {
      get enabled() { return _enabled; },
      log(tag, ...args) { if (_enabled) console.log(PREFIX, `[${tag}]`, ...args); },
      warn(tag, ...args) { if (_enabled) console.warn(PREFIX, `[${tag}]`, ...args); },
      error(tag, ...args) { console.error(PREFIX, `[${tag}]`, ...args); },
      event(tag, detail) { if (_enabled) console.log(PREFIX, '🔔', tag, detail || ''); }
    };
  })();

  // ---- 状态管理 ----
  const STATE = {
    ctrlPressed: false,
    altPressed: false,
    isProcessing: false,
    popupEl: null,
    shadowRoot: null,
    conversationMessages: [],  // 对话历史（不含 system prompt）
    systemPrompt: '',           // 当前对话的 system prompt
    selectedText: '',
    contextText: '',
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0
  };

  // ---- 快捷键 Ctrl+Alt 监听 ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') {
      STATE.ctrlPressed = true;
      return;
    }

    if (e.key === 'Alt') {
      if (!e.repeat) {
        STATE.altPressed = true;

        // 阻止浏览器默认行为（防止 Alt 键激活菜单栏导致失焦）
        e.preventDefault();

        // 如果 Ctrl+Alt 都已按下且有文本被选中，触发解释
        if (STATE.ctrlPressed) {
          const selection = window.getSelection();
          if (selection && selection.toString().trim().length > 0 && !STATE.isProcessing) {
            DBG.event('Alt键触发解释', { selected: selection.toString().trim().substring(0, 50) });
            triggerExplanation();
          }
        }
      }
      return;
    }

    // Esc 关闭弹窗
    if (e.key === 'Escape') {
      destroyPopup();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control') {
      STATE.ctrlPressed = false;
    }
    if (e.key === 'Alt') {
      STATE.altPressed = false;
    }
  });

  // 窗口失焦时重置按键状态，防止状态卡住
  window.addEventListener('blur', () => {
    STATE.ctrlPressed = false;
    STATE.altPressed = false;
  });

  // ---- 鼠标选择监听 ----
  document.addEventListener('mouseup', (e) => {
    // 短暂延迟，确保 selection 已更新
    setTimeout(() => {
      if (!STATE.ctrlPressed || !STATE.altPressed || STATE.isProcessing) return;

      // 检查点击是否在弹窗内部（弹窗内的选择不触发）
      if (STATE.popupEl && STATE.popupEl.contains(e.target)) return;

      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) return;

      DBG.event('鼠标选择触发', { selected: selection.toString().trim().substring(0, 50) });
      triggerExplanation();
    }, 50);
  });

  // ---- 核心：触发解释流程 ----
  async function triggerExplanation() {
    if (STATE.isProcessing) return;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    STATE.isProcessing = true;
    STATE.selectedText = selectedText;
    STATE.conversationMessages = [];
    STATE.systemPrompt = '';

    // 提取上下文
    const contextText = extractContext(selection);
    STATE.contextText = contextText;
    DBG.log('Context', '选中:', selectedText.substring(0, 50), '| 上下文长度:', contextText?.length);

    // 获取选区位置
    const selectionRect = getSelectionRect(selection);
    if (!selectionRect) {
      STATE.isProcessing = false;
      return;
    }

    // 创建或更新弹窗
    showPopup(selectionRect, 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXPLAIN',
        payload: {
          selectedText: selectedText,
          contextText: contextText,
          conversationHistory: []
        }
      });

      if (response.success) {
        STATE.systemPrompt = response.data.systemPrompt;
        STATE.conversationMessages = response.data.messages.filter(m => m.role !== 'system');
        updatePopupContent(response.data.explanation);
        DBG.log('Explain', '解释成功, 回复长度:', response.data.explanation?.length);
      } else {
        DBG.error('Explain', '解释失败:', response.error);
        updatePopupContent(`❌ 解释失败: ${response.error}`);
      }
    } catch (error) {
      DBG.error('Explain', '通信失败:', error.message);
      updatePopupContent(`❌ 通信失败: ${error.message}`);
    } finally {
      STATE.isProcessing = false;
    }
  }

  // ---- 上下文提取 ----
  function extractContext(selection) {
    try {
      const range = selection.getRangeAt(0);
      if (!range) return '';

      // 向上查找最近的块级元素
      let container = range.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) {
        container = container.parentElement;
      }

      const blockElement = findBlockAncestor(container);
      if (blockElement) {
        // 获取块级元素的文本，但限制长度
        const fullText = blockElement.textContent || blockElement.innerText || '';
        return truncateContext(fullText, STATE.selectedText);
      }

      // 后备方案：取选区前后各 N 个字符
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const offset = range.startOffset;
        const text = node.textContent || '';
        const start = Math.max(0, offset - 500);
        const end = Math.min(text.length, offset + STATE.selectedText.length + 500);
        return text.substring(start, end);
      }

      return '';
    } catch (e) {
      console.warn('[划词解读] 上下文提取失败:', e);
      return '';
    }
  }

  // 查找块级祖先元素
  function findBlockAncestor(element) {
    const blockTags = ['P', 'DIV', 'ARTICLE', 'SECTION', 'BLOCKQUOTE',
      'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'PRE', 'ASIDE', 'MAIN', 'BODY'];

    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName;
      if (blockTags.includes(tag)) {
        // 如果该块元素有足够的文本内容，使用它
        const textLen = (current.textContent || '').length;
        if (textLen > STATE.selectedText.length) {
          return current;
        }
      }
      current = current.parentElement;
    }

    // 如果没找到合适的块元素，返回 body 的前部分
    return null;
  }

  // 截断上下文到合理长度
  function truncateContext(fullText, selectedText) {
    const maxLen = 2000;
    const selIndex = fullText.indexOf(selectedText);

    if (fullText.length <= maxLen) {
      return fullText;
    }

    if (selIndex === -1) {
      return fullText.substring(0, maxLen) + '...';
    }

    // 以选中内容为中心，前后各取一半
    const half = Math.floor((maxLen - selectedText.length) / 2);
    const start = Math.max(0, selIndex - half);
    const end = Math.min(fullText.length, selIndex + selectedText.length + half);

    let context = '';
    if (start > 0) context += '...';
    context += fullText.substring(start, end);
    if (end < fullText.length) context += '...';

    return context;
  }

  // 获取选区的屏幕位置
  function getSelectionRect(selection) {
    try {
      if (selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      // 获取选区末尾位置（弹窗出现在选区下方）
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;

      return {
        left: rect.left + window.scrollX,
        top: rect.bottom + window.scrollY + 8,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        selectionTop: rect.top + window.scrollY
      };
    } catch (e) {
      return null;
    }
  }

  // ---- 弹窗管理 ----
  function showPopup(selectionRect, mode) {
    // 先销毁旧弹窗
    destroyPopup();

    // 创建宿主元素（使用 Shadow DOM 宿主 + fixed 定位）
    const host = document.createElement('div');
    host.id = 'word-explainer-host';
    host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none;';
    document.body.appendChild(host);

    // 使用 Shadow DOM 隔离样式
    const shadow = host.attachShadow({ mode: 'open' });
    STATE.shadowRoot = shadow;

    // 注入样式
    const style = document.createElement('style');
    style.textContent = getPopupStyles();
    shadow.appendChild(style);

    // 创建弹窗 HTML
    const popup = document.createElement('div');
    popup.className = 'explainer-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '划词解读');

    popup.innerHTML = `
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
        <span class="explainer-selected-content">${escapeHtml(STATE.selectedText.length > 100
          ? STATE.selectedText.substring(0, 100) + '...'
          : STATE.selectedText)}</span>
      </div>
      <div class="explainer-body" id="explainer-body">
        ${mode === 'loading' ? `
          <div class="explainer-loading">
            <div class="explainer-spinner"></div>
            <span>正在解读...</span>
          </div>
        ` : ''}
      </div>
      <div class="explainer-footer">
        <div class="explainer-input-wrapper">
          <textarea
            id="explainer-input"
            class="explainer-input"
            placeholder="继续提问..."
            rows="1"
            aria-label="输入追问内容"
          ></textarea>
          <button class="explainer-btn-send" id="explainer-btn-send" title="发送" aria-label="发送">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14.854.146a.5.5 0 01.111.54l-5 13a.5.5 0 01-.911.06L5.854 8 1.254 4.946a.5.5 0 01.06-.91l13-5a.5.5 0 01.54.11zM6.296 8.146l2.176 4.06L12.382 2.5 6.296 8.146zM2.5 4.118l3.157 2.052 4.943-4.943L2.5 4.118z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    shadow.appendChild(popup);
    STATE.popupEl = host;

    // 定位弹窗
    positionPopup(popup, selectionRect);

    // 绑定事件
    bindPopupEvents(shadow, selectionRect);

    // 点击弹窗外部关闭
    setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick, true);
    }, 100);

    // 自动聚焦输入框
    setTimeout(() => {
      const input = shadow.getElementById('explainer-input');
      if (input) input.focus();
    }, 300);
  }

  function updatePopupContent(explanationHtml) {
    if (!STATE.shadowRoot) return;

    const body = STATE.shadowRoot.getElementById('explainer-body');
    if (!body) return;

    // 将 markdown 风格的文本转为 HTML
    const formatted = formatTextToHtml(explanationHtml);

    body.innerHTML = `
      <div class="explainer-message explainer-message-assistant">
        <div class="explainer-bubble">${formatted}</div>
      </div>
    `;

    // 滚动到底部
    body.scrollTop = body.scrollHeight;
  }

  function appendUserMessage(text) {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    if (!body) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'explainer-message explainer-message-user';
    msgDiv.innerHTML = `<div class="explainer-bubble">${escapeHtml(text)}</div>`;
    body.appendChild(msgDiv);
    body.scrollTop = body.scrollHeight;
  }

  function appendAssistantMessage(text) {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    if (!body) return;

    const formatted = formatTextToHtml(text);
    const msgDiv = document.createElement('div');
    msgDiv.className = 'explainer-message explainer-message-assistant';
    msgDiv.innerHTML = `<div class="explainer-bubble">${formatted}</div>`;
    body.appendChild(msgDiv);
    body.scrollTop = body.scrollHeight;
  }

  function appendLoadingMessage() {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    if (!body) return;

    const loadingId = 'explainer-loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'explainer-message explainer-message-assistant';
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = `
      <div class="explainer-bubble">
        <div class="explainer-loading-inline">
          <div class="explainer-spinner explainer-spinner-sm"></div>
          <span>思考中...</span>
        </div>
      </div>
    `;
    body.appendChild(loadingDiv);
    body.scrollTop = body.scrollHeight;
    return loadingId;
  }

  function removeLoadingMessage(loadingId) {
    if (!STATE.shadowRoot || !loadingId) return;
    const el = STATE.shadowRoot.getElementById(loadingId);
    if (el) el.remove();
  }

  function positionPopup(popup, selectionRect) {
    const popupWidth = 420;
    const popupMaxHeight = 500;
    const margin = 16;

    let left = selectionRect.left;
    let top = selectionRect.top;

    // 水平方向调整，确保不超出视口
    const viewportWidth = window.innerWidth;
    if (left + popupWidth > viewportWidth - margin) {
      left = Math.max(margin, viewportWidth - popupWidth - margin);
    }
    if (left < margin) {
      left = margin;
    }

    // 垂直方向：优先显示在选区下方
    const viewportHeight = window.innerHeight;
    const selectionBottom = selectionRect.top - window.scrollY; // 转为视口坐标
    const selectionTop = selectionRect.selectionTop - window.scrollY || selectionBottom - 30;

    if (selectionBottom + popupMaxHeight + margin < viewportHeight) {
      // 下方有空间
      top = selectionRect.top;
    } else if (selectionTop - popupMaxHeight - margin > 0) {
      // 上方有空间
      top = selectionRect.selectionTop - popupMaxHeight - 8;
    } else {
      // 居中显示
      top = Math.max(margin, (viewportHeight - popupMaxHeight) / 2 + window.scrollY);
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.maxHeight = Math.min(popupMaxHeight, viewportHeight - margin * 2) + 'px';
  }

  function destroyPopup() {
    if (STATE.popupEl) {
      STATE.popupEl.remove();
      STATE.popupEl = null;
      STATE.shadowRoot = null;
    }
    document.removeEventListener('mousedown', handleOutsideClick, true);
  }

  function handleOutsideClick(e) {
    if (STATE.popupEl && !STATE.popupEl.contains(e.target)) {
      destroyPopup();
    }
  }

  // ---- 弹窗事件绑定 ----
  function bindPopupEvents(shadow, selectionRect) {
    const popup = shadow.querySelector('.explainer-popup');
    const closeBtn = shadow.getElementById('explainer-btn-close');
    const clearBtn = shadow.getElementById('explainer-btn-clear');
    const sendBtn = shadow.getElementById('explainer-btn-send');
    const inputEl = shadow.getElementById('explainer-input');
    const header = shadow.querySelector('.explainer-header');

    // 关闭按钮
    closeBtn.addEventListener('click', destroyPopup);

    // 清空对话按钮（重置为初始解释）
    clearBtn.addEventListener('click', async () => {
      STATE.conversationMessages = [];
      const body = shadow.getElementById('explainer-body');
      body.innerHTML = `
        <div class="explainer-loading">
          <div class="explainer-spinner"></div>
          <span>正在重新解读...</span>
        </div>
      `;

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'EXPLAIN',
          payload: {
            selectedText: STATE.selectedText,
            contextText: STATE.contextText,
            conversationHistory: []
          }
        });
        if (response.success) {
          STATE.systemPrompt = response.data.systemPrompt;
          STATE.conversationMessages = response.data.messages.filter(m => m.role !== 'system');
          updatePopupContent(response.data.explanation);
        } else {
          updatePopupContent(`❌ 错误: ${response.error}`);
        }
      } catch (error) {
        updatePopupContent(`❌ 错误: ${error.message}`);
      }
    });

    // 发送消息
    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || STATE.isProcessing) return;

      STATE.isProcessing = true;
      inputEl.value = '';
      inputEl.style.height = 'auto';

      // 显示用户消息
      appendUserMessage(text);

      // 添加到对话历史
      STATE.conversationMessages.push({ role: 'user', content: text });

      // 显示加载状态
      const loadingId = appendLoadingMessage();

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'CHAT',
          payload: {
            messages: STATE.conversationMessages,
            systemPrompt: STATE.systemPrompt
          }
        });

        removeLoadingMessage(loadingId);

        if (response.success) {
          STATE.conversationMessages.push({ role: 'assistant', content: response.data.reply });
          appendAssistantMessage(response.data.reply);
        } else {
          appendAssistantMessage(`❌ 错误: ${response.error}`);
        }
      } catch (error) {
        removeLoadingMessage(loadingId);
        appendAssistantMessage(`❌ 通信失败: ${error.message}`);
      } finally {
        STATE.isProcessing = false;
        inputEl.focus();
      }
    }

    sendBtn.addEventListener('click', sendMessage);

    // 回车发送（Shift+Enter 换行）
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // 自动调整输入框高度
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    // ---- 拖拽功能 ----
    let isDragging = false;
    let dragStartX, dragStartY, popupStartLeft, popupStartTop;

    header.addEventListener('mousedown', (e) => {
      // 不拦截按钮的点击
      if (e.target.closest('button')) return;

      isDragging = true;
      const popupRect = popup.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      popupStartLeft = popupRect.left;
      popupStartTop = popupRect.top;

      popup.style.transition = 'none';
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      popup.style.left = (popupStartLeft + dx) + 'px';
      popup.style.top = (popupStartTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        popup.style.transition = '';
        header.style.cursor = '';
      }
    });
  }

  // ---- 工具函数 ----
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 将文本格式化为 HTML（处理 markdown 风格）
  function formatTextToHtml(text) {
    let html = escapeHtml(text);

    // 处理加粗 **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 处理行内代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 处理换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';

    // 处理 markdown 列表
    html = html.replace(/<p>- /g, '<p>• ');
    html = html.replace(/<p>\d+\. /g, (match) => {
      return match.replace(/<p>/, '<p>');
    });

    // 清理空段落
    html = html.replace(/<p><\/p>/g, '<p><br></p>');

    return html;
  }

  // ---- 弹窗样式（注入到 Shadow DOM） ----
  function getPopupStyles() {
    return `
      :host {
        all: initial;
      }

      .explainer-popup {
        position: fixed;
        z-index: 2147483647;
        width: 420px;
        max-height: 500px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08);
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
        font-size: 14px;
        color: #1a1a1a;
        line-height: 1.6;
        transition: opacity 0.2s, transform 0.2s;
        animation: explainerFadeIn 0.2s ease-out;
        user-select: text;
      }

      @keyframes explainerFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      /* ---- 头部 ---- */
      .explainer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid #f0f0f0;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
        background: #fafafa;
        border-radius: 12px 12px 0 0;
      }
      .explainer-header:active {
        cursor: grabbing;
      }
      .explainer-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: #333;
      }
      .explainer-header-actions {
        display: flex;
        gap: 4px;
      }

      /* ---- 按钮 ---- */
      .explainer-btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        border-radius: 6px;
        cursor: pointer;
        color: #666;
        transition: background 0.15s, color 0.15s;
      }
      .explainer-btn-icon:hover {
        background: #e8e8e8;
        color: #333;
      }
      .explainer-btn-send {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: #2563eb;
        color: #fff;
        border-radius: 8px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s;
      }
      .explainer-btn-send:hover {
        background: #1d4ed8;
      }
      .explainer-btn-send:disabled {
        background: #a5b4fc;
        cursor: not-allowed;
      }

      /* ---- 选中文本展示 ---- */
      .explainer-selected-text {
        padding: 8px 14px;
        background: #f0f7ff;
        border-bottom: 1px solid #dbeafe;
        font-size: 12px;
        flex-shrink: 0;
      }
      .explainer-label {
        color: #6b7280;
        margin-right: 4px;
      }
      .explainer-selected-content {
        color: #1e40af;
        font-weight: 500;
        font-style: italic;
      }

      /* ---- 对话主体 ---- */
      .explainer-body {
        flex: 1;
        overflow-y: auto;
        padding: 14px;
        min-height: 60px;
        max-height: 350px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .explainer-body::-webkit-scrollbar {
        width: 6px;
      }
      .explainer-body::-webkit-scrollbar-thumb {
        background: #d0d0d0;
        border-radius: 3px;
      }
      .explainer-body::-webkit-scrollbar-track {
        background: transparent;
      }

      /* ---- 消息气泡 ---- */
      .explainer-message {
        display: flex;
        flex-direction: column;
        animation: explainerFadeIn 0.2s ease-out;
      }
      .explainer-message-user .explainer-bubble {
        align-self: flex-end;
        background: #2563eb;
        color: #fff;
        border-radius: 12px 12px 4px 12px;
        padding: 8px 14px;
        max-width: 85%;
      }
      .explainer-message-assistant .explainer-bubble {
        align-self: flex-start;
        background: #f3f4f6;
        color: #1a1a1a;
        border-radius: 12px 12px 12px 4px;
        padding: 10px 14px;
        max-width: 100%;
        line-height: 1.7;
      }
      .explainer-bubble p {
        margin: 0 0 6px 0;
      }
      .explainer-bubble p:last-child {
        margin-bottom: 0;
      }
      .explainer-bubble strong {
        color: #1e40af;
        font-weight: 600;
      }
      .explainer-bubble code {
        background: rgba(0,0,0,0.06);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: "SF Mono", "Fira Code", "Fira Mono", monospace;
        font-size: 0.9em;
      }

      /* ---- 加载动画 ---- */
      .explainer-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        color: #9ca3af;
        font-size: 13px;
      }
      .explainer-loading-inline {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .explainer-spinner {
        width: 20px;
        height: 20px;
        border: 2.5px solid #e5e7eb;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: explainerSpin 0.7s linear infinite;
      }
      .explainer-spinner-sm {
        width: 14px;
        height: 14px;
        border-width: 2px;
      }
      @keyframes explainerSpin {
        to { transform: rotate(360deg); }
      }

      /* ---- 底部输入 ---- */
      .explainer-footer {
        padding: 10px 14px;
        border-top: 1px solid #f0f0f0;
        flex-shrink: 0;
        background: #fafafa;
        border-radius: 0 0 12px 12px;
      }
      .explainer-input-wrapper {
        display: flex;
        align-items: flex-end;
        gap: 8px;
      }
      .explainer-input {
        flex: 1;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 13px;
        font-family: inherit;
        resize: none;
        outline: none;
        line-height: 1.4;
        max-height: 120px;
        transition: border-color 0.15s;
        background: #fff;
        color: #1a1a1a;
      }
      .explainer-input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
      }
      .explainer-input::placeholder {
        color: #c0c0c0;
      }

      /* ---- 暗色模式适配 ---- */
      @media (prefers-color-scheme: dark) {
        .explainer-popup {
          background: #1e1e1e;
          border-color: #3a3a3a;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          color: #e0e0e0;
        }
        .explainer-header {
          background: #252525;
          border-bottom-color: #3a3a3a;
        }
        .explainer-title {
          color: #e0e0e0;
        }
        .explainer-btn-icon {
          color: #999;
        }
        .explainer-btn-icon:hover {
          background: #3a3a3a;
          color: #e0e0e0;
        }
        .explainer-selected-text {
          background: #1a2744;
          border-bottom-color: #2a3a5c;
        }
        .explainer-selected-content {
          color: #93c5fd;
        }
        .explainer-message-assistant .explainer-bubble {
          background: #2a2a2a;
          color: #e0e0e0;
        }
        .explainer-bubble strong {
          color: #93c5fd;
        }
        .explainer-bubble code {
          background: rgba(255,255,255,0.08);
        }
        .explainer-input {
          background: #2a2a2a;
          border-color: #3a3a3a;
          color: #e0e0e0;
        }
        .explainer-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
        }
        .explainer-footer {
          background: #252525;
          border-top-color: #3a3a3a;
        }
        .explainer-body::-webkit-scrollbar-thumb {
          background: #555;
        }
      }
    `;
  }
})();
