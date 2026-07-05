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
  reasoningEffort: "high"
};

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  DEBUG.event('收到消息', { type: message.type, from: sender.url });

  if (message.type === 'EXPLAIN') {
    handleExplain(message.payload)
      .then(result => {
        DEBUG.log('Explain', '解释完成, 长度:', result.explanation?.length);
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        DEBUG.error('Explain', error.message);
        sendResponse({ success: false, error: error.message });
      });
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
    handleChat(message.payload)
      .then(result => {
        DEBUG.log('Chat', '追问完成, 长度:', result.reply?.length);
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        DEBUG.error('Chat', error.message);
        sendResponse({ success: false, error: error.message });
      });
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

// 处理初次解释请求
async function handleExplain(payload) {
  const { selectedText, contextText, conversationHistory } = payload;
  DEBUG.log('Explain', '开始解释, 选中:', selectedText?.substring(0, 50));

  const config = await getConfig();

  if (!config.apiKey) {
    throw new Error('请先在扩展弹出窗口中配置 API Key');
  }

  const systemPrompt = buildSystemPrompt(contextText, selectedText, config.systemPrompt);

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory);
  }

  messages.push({
    role: 'user',
    content: `请解读我选中的内容："${selectedText}"`
  });

  const startTime = Date.now();
  const response = await callLLMAPI(config, messages);
  const duration = Date.now() - startTime;
  DEBUG.log('Explain', `API 耗时: ${duration}ms`);

  return {
    explanation: response,
    systemPrompt: systemPrompt,
    messages: [
      ...messages,
      { role: 'assistant', content: response }
    ]
  };
}

// 处理对话追问
async function handleChat(payload) {
  const { messages, systemPrompt } = payload;
  DEBUG.log('Chat', '追问消息数:', messages?.length, '| 最后一条:', messages?.[messages.length - 1]?.content?.substring(0, 30));

  const config = await getConfig();

  if (!config.apiKey) {
    throw new Error('请先在扩展弹出窗口中配置 API Key');
  }

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const startTime = Date.now();
  const response = await callLLMAPI(config, fullMessages);
  const duration = Date.now() - startTime;
  DEBUG.log('Chat', `API 耗时: ${duration}ms`);

  return { reply: response };
}

// 调用大模型 API（OpenAI 兼容格式）
async function callLLMAPI(config, messages) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  const body = {
    model: config.model,
    messages: messages,
    temperature: config.temperature || 0.7,
    max_tokens: config.maxTokens || 1024,
    stream: false,
    // 仅当思考开启时才传 effort，关闭则只传type:disabled
	  extra_body: {
	    thinking: {
	      type: config.thinkingType
	    }
	  }
  };

  // 思考启用时追加 reasoning_effort 映射规则
  if (config.thinkingType === "enabled") {
    let effort = config.reasoningEffort || "high";
    // 规则映射 low/medium → high；xhigh → max
    if (["low", "medium"].includes(effort)) {
      effort = "high";
    } else if (effort === "xhigh") {
      effort = "max";
    }
    body.reasoning_effort = effort;
  }

  DEBUG.request('POST', config.apiEndpoint, headers, {
    ...body,
    messages: `[${messages.length}条消息]`,
    model: body.model
  });

  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;
    }
    DEBUG.error('API', `请求失败: ${errorMessage}`);
    throw new Error(`API 调用失败: ${errorMessage}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    DEBUG.error('API', '返回格式异常:', JSON.stringify(data).substring(0, 200));
    throw new Error('API 返回格式异常，未找到回复内容');
  }

  DEBUG.response(response.status, { content: content.substring(0, 100) + '...' }, 0);
  return content;
}
