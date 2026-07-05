// ============================================================
// 划词解读 - Content Script 【修复语法报错+彻底解决点内部误关】
// ============================================================
(function () {
  'use strict';

  // ---- 启动自检 ----
  const VERSION = '2.0.1';
  const runtimeReady = typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
  console.log(
    '%c[划词解读]%c v' + VERSION + ' %c已加载%c | runtime: ' + (runtimeReady ? '✅' : '❌') + ' | id: ' + (runtimeReady ? chrome.runtime.id : 'N/A'),
    'color:#2563eb;font-weight:bold', 'color:#666', 'color:#059669', 'color:#888'
  );
  if (!runtimeReady) {
    console.error('[划词解读] ⚠️ Chrome 扩展运行时未就绪！刷新扩展+页面重试');
  }

  // ---- 调试工具 ----
  const DBG = (() => {
    const PREFIX = '[划词解读]';
    let _enabled = false;
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['debugEnabled'], r => _enabled = !!r.debugEnabled);
        chrome.storage.onChanged.addListener(changes => {
          if (changes.debugEnabled) _enabled = !!changes.debugEnabled.newValue;
        });
      }
    } catch (e) {}
    return {
      log(tag, ...args) { if (_enabled) console.log(PREFIX, `[${tag}]`, ...args); },
      warn(tag, ...args) { if (_enabled) console.warn(PREFIX, `[${tag}]`, ...args); },
      error(tag, ...args) { console.error(PREFIX, `[${tag}]`, ...args); },
      event(tag, detail) { if (_enabled) console.log(PREFIX, '🔔', tag, detail || ''); }
    };
  })();

  // ---- Chrome API 安全封装 ----
  function isRuntimeAvailable() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;
  }
  function safeSendMessage(payload) {
    if (!isRuntimeAvailable()) throw new Error('扩展运行时未就绪，请刷新页面');
    return chrome.runtime.sendMessage(payload);
  }
  function formatError(error) {
    const msg = error.message || String(error);
    if (msg.includes('Extension context invalidated') || msg.includes('extension context'))
      return '⚠️ 扩展已更新，请刷新页面(F5)';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish'))
      return '⚠️ 后台服务断开，刷新扩展+页面';
    return '❌ ' + msg;
  }

  // ---- 全局状态 ----
  const STATE = {
    ctrlPressed: false,
    altPressed: false,
    isProcessing: false,
    popupEl: null,
    shadowRoot: null,
    popupInner: null,
    conversationMessages: [],
    systemPrompt: '',
    selectedText: '',
    contextText: '',
    isDragging: false
  };

  // ========== 几何坐标判断鼠标是否在弹窗内 ==========
  function isMouseOverPopup(clientX, clientY) {
    if (!STATE.popupEl || !STATE.popupEl.isConnected) return false;
    const rect = STATE.popupEl.getBoundingClientRect();
    const padding = 2;
    return (
      clientX >= rect.left - padding &&
      clientX <= rect.right + padding &&
      clientY >= rect.top - padding &&
      clientY <= rect.bottom + padding
    );
  }

  // ---- 通用工具函数【全部前置，消除标识符未定义报错】 ----
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  function formatTextToHtml(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>- /g, '<p>• ');
    html = html.replace(/<p><\/p>/g, '<p><br></p>');
    return html;
  }
  function getPopupStyles() {
    return `
      :host { all: initial; }
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
        padding: 10px 14px;
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
      .explainer-selected-text { padding:8px 14px;background:#f0f7ff;border-bottom:1px solid #dbeafe;font-size:12px;flex-shrink:0; }
      .explainer-label { color:#6b7280;margin-right:4px; }
      .explainer-selected-content { color:#1e40af;font-weight:500;font-style:italic; }
      .explainer-body { flex:1;overflow-y:auto;padding:14px;min-height:60px;max-height:350px;display:flex;flex-direction:column;gap:10px; }
      .explainer-body::-webkit-scrollbar { width:6px; }
      .explainer-body::-webkit-scrollbar-thumb { background:#d0d0d0;border-radius:3px; }
      .explainer-message { animation:explainerFadeIn 0.2s ease-out;display:flex;flex-direction:column; }
      .explainer-message-user .explainer-bubble { align-self:flex-end;background:#2563eb;color:#fff;border-radius:12px 12px 4px 12px;padding:8px 14px;max-width:85%; }
      .explainer-message-assistant .explainer-bubble { align-self:flex-start;background:#f3f4f6;color:#1a1a1a;border-radius:12px 12px 12px 4px;padding:10px 14px;max-width:100%;line-height:1.7; }
      .explainer-bubble p { margin:0 0 6px 0; }
      .explainer-bubble p:last-child { margin-bottom:0; }
      .explainer-bubble strong { color:#1e40af;font-weight:600; }
      .explainer-bubble code { background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px;font-family:SF Mono,Fira Code,monospace;font-size:0.9em; }
      .explainer-loading { display:flex;align-items:center;justify-content:center;gap:10px;padding:24px;color:#9ca3af;font-size:13px; }
      .explainer-loading-inline { display:flex;align-items:center;gap:8px; }
      .explainer-spinner { width:20px;height:20px;border:2.5px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:spin 0.7s linear infinite; }
      .explainer-spinner-sm { width:14px;height:14px;border-width:2px; }
      @keyframes spin { to { transform:rotate(360deg); } }
      .explainer-footer { padding:10px 14px;border-top:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;border-radius:0 0 12px 12px; }
      .explainer-input-wrapper { display:flex;align-items:flex-end;gap:8px; }
      .explainer-input { flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;resize:none;outline:none;line-height:1.4;max-height:120px;background:#fff;color:#1a1a1a;transition:0.15s; }
      .explainer-input:focus { border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.1); }
      .explainer-input::placeholder { color:#c0c0c0; }
      @media (prefers-color-scheme: dark) {
        .explainer-popup { background:#1e1e1e;border-color:#3a3a3a;box-shadow:0 8px 32px rgba(0,0,0,0.4);color:#e0e0e0; }
        .explainer-header { background:#252525;border-bottom-color:#3a3a3a; }
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
  function updatePopupContent(text) {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    body.innerHTML = `<div class="explainer-message explainer-message-assistant"><div class="explainer-bubble">${formatTextToHtml(text)}</div></div>`;
    body.scrollTop = body.scrollHeight;
  }
  function appendUserMessage(text) {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    const div = document.createElement('div');
    div.className = 'explainer-message explainer-message-user';
    div.innerHTML = `<div class="explainer-bubble">${escapeHtml(text)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
  function appendAssistantMessage(text) {
    if (!STATE.shadowRoot) return;
    const body = STATE.shadowRoot.getElementById('explainer-body');
    const div = document.createElement('div');
    div.className = 'explainer-message explainer-message-assistant';
    div.innerHTML = `<div class="explainer-bubble">${formatTextToHtml(text)}</div>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
  function appendLoadingMessage() {
    if (!STATE.shadowRoot) return;
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
  function removeLoadingMessage(id) {
    if (!STATE.shadowRoot || !id) return;
    const el = STATE.shadowRoot.getElementById(id);
    if (el) el.remove();
  }

  // ---- 快捷键监听 ----
  document.addEventListener('keydown', (e) => {
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
          if (sel && sel.toString().trim() && !STATE.isProcessing) {
            DBG.event('Alt键触发解释', sel.toString().trim().substring(0, 50));
            triggerExplanation();
          }
        }
      }
      return;
    }
    if (e.key === 'Escape' && STATE.popupEl) destroyPopup();
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Control') STATE.ctrlPressed = false;
    if (e.key === 'Alt') STATE.altPressed = false;
  });
  window.addEventListener('blur', () => {
    STATE.ctrlPressed = false;
    STATE.altPressed = false;
  });

  document.addEventListener('selectionchange', () => {
    if (STATE.popupEl && STATE.popupEl.isConnected) return;
  });

  document.addEventListener('mouseup', (e) => {
    if (isMouseOverPopup(e.clientX, e.clientY)) return;
    if (!STATE.ctrlPressed || !STATE.altPressed || STATE.isProcessing) return;
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;
    DBG.event('鼠标选择触发', sel.toString().trim().substring(0, 50));
    triggerExplanation();
  });

  // ---- 上下文提取工具 ----
  function extractContext(selection) {
    try {
      const range = selection.getRangeAt(0);
      let container = range.commonAncestorContainer;
      if (container.nodeType === Node.TEXT_NODE) container = container.parentElement;
      const block = findBlockAncestor(container);
      if (block) return truncateContext(block.textContent || '', STATE.selectedText);
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
      if (blockTags.includes(cur.tagName) && (cur.textContent || '').length > STATE.selectedText.length) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function truncateContext(full, target) {
    const max = 2000;
    if (full.length <= max) return full;
    const idx = full.indexOf(target);
    if (idx === -1) return full.slice(0, max) + '...';
    const half = Math.floor((max - target.length) / 2);
    const s = Math.max(0, idx - half);
    const e = Math.min(full.length, idx + target.length + half);
    return (s > 0 ? '...' : '') + full.slice(s, e) + (e < full.length ? '...' : '');
  }
  function getSelectionRect(sel) {
    try {
      if (sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return {
        left: r.left,
        top: r.bottom + 8,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        selectionTop: r.top
      };
    } catch { return null; }
  }

  // ---- 核心解释逻辑 ----
  async function triggerExplanation() {
    if (STATE.isProcessing) return;
    const sel = window.getSelection();
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    STATE.isProcessing = true;
    STATE.selectedText = selectedText;
    STATE.conversationMessages = [];
    STATE.systemPrompt = '';
    const contextText = extractContext(sel);
    STATE.contextText = contextText;
    DBG.log('Context', '选中片段', selectedText.substring(0, 50), '上下文长度', contextText.length);

    const rect = getSelectionRect(sel);
    if (!rect) { STATE.isProcessing = false; return; }
    showPopup(rect, 'loading');

    try {
      const res = await safeSendMessage({
        type: 'EXPLAIN',
        payload: { selectedText, contextText, conversationHistory: [] }
      });
      if (res.success) {
        STATE.systemPrompt = res.data.systemPrompt;
        STATE.conversationMessages = res.data.messages.filter(m => m.role !== 'system');
        updatePopupContent(res.data.explanation);
        DBG.log('Explain', '解释完成，文本长度', res.data.explanation.length);
      } else {
        updatePopupContent(`❌ 解释失败：${res.error}`);
      }
    } catch (err) {
      updatePopupContent(formatError(err));
      DBG.error('Explain', err);
    } finally {
      STATE.isProcessing = false;
    }
  }

  // 弹窗定位
  function positionPopup(host, rect) {
    const popupWidth = 420;
    const popupMaxHeight = 500;
    const margin = 16;
    let left = rect.left;
    let top = rect.top;
    const viewportWidth = window.innerWidth;
    if (left + popupWidth > viewportWidth - margin) left = Math.max(margin, viewportWidth - popupWidth - margin);
    if (left < margin) left = margin;
    const viewportHeight = window.innerHeight;
    const selectionBottom = rect.top;
    const selectionTop = rect.selectionTop || selectionBottom - 30;
    if (selectionBottom + popupMaxHeight + margin < viewportHeight) {
      top = rect.top;
    } else if (selectionTop - popupMaxHeight - margin > 0) {
      top = selectionTop - popupMaxHeight - 8;
    } else {
      top = Math.max(margin, (viewportHeight - popupMaxHeight) / 2);
    }
    host.style.left = left + 'px';
    host.style.top = top + 'px';
    host.style.width = popupWidth + 'px';
    host.style.maxHeight = Math.min(popupMaxHeight, viewportHeight - margin * 2) + 'px';
  }

  // 幂等销毁弹窗
  function destroyPopup() {
    console.log('[DEBUG] 执行销毁弹窗');
    const backdrop = document.getElementById('explainer-backdrop');
    STATE.isDragging = false;
    if (!STATE.popupEl || !STATE.popupEl.isConnected) {
      STATE.popupEl = null;
      STATE.shadowRoot = null;
      STATE.popupInner = null;
      if (backdrop) backdrop.remove();
      return;
    }
    STATE.popupEl.remove();
    STATE.popupEl = null;
    STATE.shadowRoot = null;
    STATE.popupInner = null;
    if (backdrop) backdrop.remove();
  }

  // 弹窗事件绑定
  function bindPopupEvents(shadow) {
    const popupInner = shadow.querySelector('.explainer-popup');
    const closeBtn = shadow.getElementById('explainer-btn-close');
    const clearBtn = shadow.getElementById('explainer-btn-clear');
    const sendBtn = shadow.getElementById('explainer-btn-send');
    const inputEl = shadow.getElementById('explainer-input');
    const header = shadow.querySelector('.explainer-header');
    const getHost = () => popupInner.getRootNode().host;

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
        } else updatePopupContent(`❌ ${res.error}`);
      } catch (err) { updatePopupContent(formatError(err)); }
    });
    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || STATE.isProcessing) return;
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
          STATE.conversationMessages.push({ role: 'assistant', content: res.data.reply });
          appendAssistantMessage(res.data.reply);
        } else appendAssistantMessage(`❌ ${res.error}`);
      } catch (err) {
        removeLoadingMessage(loadId);
        appendAssistantMessage(formatError(err));
      } finally {
        STATE.isProcessing = false;
        inputEl.focus();
      }
    }
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        sendMessage();
      }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    let dragMoveHandler, dragUpHandler;
    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
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
      e.stopPropagation();
      dragMoveHandler = evt => {
        if (!STATE.isDragging) return;
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

  // ---- 弹窗创建渲染 ----
  function showPopup(selectionRect, mode) {
    destroyPopup();
    const backdrop = document.createElement('div');
    backdrop.id = 'explainer-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:auto;background:transparent;';
    backdrop.addEventListener('click', (e) => {
      console.log('[DEBUG] 遮罩点击坐标', e.clientX, e.clientY);
      if (isMouseOverPopup(e.clientX, e.clientY)) return;
      destroyPopup();
    });
    document.body.appendChild(backdrop);

    const host = document.createElement('div');
    host.id = 'word-explainer-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    STATE.shadowRoot = shadow;
    STATE.popupEl = host;

    const style = document.createElement('style');
    style.textContent = getPopupStyles();
    shadow.appendChild(style);

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
    STATE.popupEl = host;

    popupInner.addEventListener('click', e => e.stopPropagation(), true);
    popupInner.addEventListener('mousedown', e => e.stopPropagation(), true);
    popupInner.addEventListener('mouseup', e => e.stopPropagation(), true);

    positionPopup(host, selectionRect);
    bindPopupEvents(shadow);

    setTimeout(() => {
      const input = shadow.getElementById('explainer-input');
      if (input) input.focus();
    }, 300);
  }
})();