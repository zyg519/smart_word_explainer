// ============================================================
// 划词解读 - Background Service Worker
// 负责调用大模型 API，处理存储读写
// ============================================================

// 加载外部模块
importScripts('prompts.js', 'debug.js');

// 默认配置
const DEFAULT_CONFIG = {
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  systemPrompt: '',
  maxContextLength: 2000,
  temperature: 0.7,
  maxTokens: 1024,
  // 新增：思考开关 enabled / disabled
  thinkingType: "disabled",
  reasoningEffort: "high",
  streamEnabled: false
};

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  DEBUG.event('收到消息', { type: message.type, from: sender.url });

  if (message.type === 'EXPLAIN') {
    handleExplainStreamOrNot(message.payload, sender.tab.id, sendResponse);
    return true;
  }

  if (message.type === 'GET_CONFIG') {
    getConfig()
      .then(config => sendResponse({ success: true, data: config }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SAVE_CONFIG') {
    saveConfig(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHAT') {
    handleChatStreamOrNot(message.payload, sender.tab.id, sendResponse);
    return true;
  }
});

// 获取配置
async function getConfig() {
  const result = await chrome.storage.local.get(['explainerConfig']);
  return result.explainerConfig || DEFAULT_CONFIG;
}

// 保存配置
async function saveConfig(config) {
  await chrome.storage.local.set({ explainerConfig: config });
  DEBUG.log('Config', '配置已保存:', { ...config, apiKey: config.apiKey ? '***' : '(空)' });
}

// 构建系统提示词
// 优先使用用户自定义提示词，否则使用 prompts.js 中的默认提示词
function buildSystemPrompt(contextText, selectedText, customPrompt) {
  const template = customPrompt || DEFAULT_SYSTEM_PROMPT;
  const prompt = template
    .replace(/\{CONTEXT\}/g, contextText)
    .replace(/\{SELECTION\}/g, selectedText);

  DEBUG.log('Prompt', '使用', customPrompt ? '自定义提示词' : '默认提示词',
    '| 上下文长度:', contextText?.length, '| 选中长度:', selectedText?.length);
  return prompt;
}

// 构建 API 请求体（流式/非流式共用）
function buildRequestBody(config, messages, stream) {
  const body = {
    model: config.model,
    messages: messages,
    temperature: config.temperature || 0.7,
    max_tokens: config.maxTokens || 1024,
    stream: stream,
    extra_body: {
      thinking: { type: config.thinkingType }
    }
  };
  if (config.thinkingType === "enabled") {
    let effort = config.reasoningEffort || "high";
    if (["low", "medium"].includes(effort)) effort = "high";
    else if (effort === "xhigh") effort = "max";
    body.reasoning_effort = effort;
  }
  return body;
}

// 统一入口：根据 config.streamEnabled 走流式或非流式
async function handleExplainStreamOrNot(payload, tabId, sendResponse) {
  const { selectedText, contextText, conversationHistory } = payload;
  DEBUG.log('Explain', '开始解释, 选中:', selectedText?.substring(0, 50));

  const config = await getConfig();
  if (!config.apiKey) {
    sendResponse({ success: false, error: '请先在扩展弹出窗口中配置 API Key' });
    return;
  }

  const systemPrompt = buildSystemPrompt(contextText, selectedText, config.systemPrompt);
  const messages = [{ role: 'system', content: systemPrompt }];
  if (conversationHistory && conversationHistory.length > 0) messages.push(...conversationHistory);
  messages.push({ role: 'user', content: `请解读我选中的内容："${selectedText}"` });

  if (config.streamEnabled) {
    // 流式：立即确认，然后逐块推送
    sendResponse({ success: true, streaming: true, systemPrompt });
    const fullMessages = messages;
    streamToTab(config, fullMessages, tabId, 'EXPLAIN')
      .catch(err => {
        DEBUG.error('Explain', err.message);
        chrome.tabs.sendMessage(tabId, { type: 'STREAM_ERROR', error: err.message });
      });
  } else {
    // 非流式：等待完整结果
    try {
      const startTime = Date.now();
      const response = await callLLMAPI(config, messages);
      DEBUG.log('Explain', `API 耗时: ${Date.now() - startTime}ms`);
      sendResponse({
        success: true,
        data: {
          explanation: response,
          systemPrompt,
          messages: [...messages, { role: 'assistant', content: response }]
        }
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

// 统一入口：对话追问流式/非流式
async function handleChatStreamOrNot(payload, tabId, sendResponse) {
  const { messages, systemPrompt } = payload;
  DEBUG.log('Chat', '追问消息数:', messages?.length);

  const config = await getConfig();
  if (!config.apiKey) {
    sendResponse({ success: false, error: '请先在扩展弹出窗口中配置 API Key' });
    return;
  }

  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

  if (config.streamEnabled) {
    sendResponse({ success: true, streaming: true });
    streamToTab(config, fullMessages, tabId, 'CHAT')
      .catch(err => {
        DEBUG.error('Chat', err.message);
        chrome.tabs.sendMessage(tabId, { type: 'STREAM_ERROR', error: err.message });
      });
  } else {
    try {
      const startTime = Date.now();
      const response = await callLLMAPI(config, fullMessages);
      DEBUG.log('Chat', `API 耗时: ${Date.now() - startTime}ms`);
      sendResponse({ success: true, data: { reply: response } });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

// 流式 SSE 推送到 tab
async function streamToTab(config, messages, tabId, source) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  const body = buildRequestBody(config, messages, true);

  DEBUG.request('POST', config.apiEndpoint, headers, { ...body, messages: `[${messages.length}条消息]` });

  const response = await fetch(config.apiEndpoint, {
    method: 'POST', headers, body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg;
    try { errMsg = JSON.parse(errText).error?.message || `HTTP ${response.status}`; }
    catch { errMsg = `HTTP ${response.status}`; }
    throw new Error(`API 调用失败: ${errMsg}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        chrome.tabs.sendMessage(tabId, { type: 'STREAM_DONE', source, fullContent });
        return;
      }
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          fullContent += chunk;
          chrome.tabs.sendMessage(tabId, { type: 'STREAM_CHUNK', source, chunk, accumulated: fullContent });
        }
      } catch (e) { /* skip malformed SSE lines */ }
    }
  }
  // stream ended without [DONE]
  chrome.tabs.sendMessage(tabId, { type: 'STREAM_DONE', source, fullContent });
}

// 非流式 API 调用
async function callLLMAPI(config, messages) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  const body = buildRequestBody(config, messages, false);

  DEBUG.request('POST', config.apiEndpoint, headers, { ...body, messages: `[${messages.length}条消息]` });

  const response = await fetch(config.apiEndpoint, {
    method: 'POST', headers, body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage;
    try {
      errorMessage = JSON.parse(errorText).error?.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
    }
    throw new Error(`API 调用失败: ${errorMessage}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('API 返回格式异常，未找到回复内容');
  return content;
}
