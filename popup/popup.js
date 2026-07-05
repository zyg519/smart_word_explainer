// ============================================================
// 划词解读 - Popup 设置页面逻辑
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const form = document.getElementById('settings-form');
  const statusBar = document.getElementById('status-bar');
  const apiEndpointInput = document.getElementById('api-endpoint');
  const apiKeyInput = document.getElementById('api-key');
  const modelInput = document.getElementById('model');
  const systemPromptInput = document.getElementById('system-prompt');
  const temperatureInput = document.getElementById('temperature');
  const tempValue = document.getElementById('temp-value');
  const maxTokensInput = document.getElementById('max-tokens');
  const maxContextInput = document.getElementById('max-context');
  const btnSave = document.getElementById('btn-save');
  const btnTest = document.getElementById('btn-test');
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  const debugCheckbox = document.getElementById('debug-enabled');

  // ---- 安全的消息发送 ----
  function safeSendMessage(payload) {
    if (!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage)) {
      throw new Error('扩展运行时未就绪，请重新打开此弹窗');
    }
    return chrome.runtime.sendMessage(payload);
  }

  // ---- 加载当前配置 ----
  try {
    const response = await safeSendMessage({ type: 'GET_CONFIG' });
    if (response.success) {
      const config = response.data;
      apiEndpointInput.value = config.apiEndpoint || '';
      apiKeyInput.value = config.apiKey || '';
      modelInput.value = config.model || '';
      systemPromptInput.value = config.systemPrompt || '';
      temperatureInput.value = config.temperature || 0.7;
      tempValue.textContent = config.temperature || 0.7;
      maxTokensInput.value = config.maxTokens || 1024;
      maxContextInput.value = config.maxContextLength || 2000;
    }
  } catch (error) {
    showStatus('加载配置失败: ' + error.message, 'error');
  }

  // ---- 加载调试开关 ----
  chrome.storage.local.get(['debugEnabled'], (r) => {
    debugCheckbox.checked = !!r.debugEnabled;
  });

  // ---- 调试开关即时生效 ----
  debugCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ debugEnabled: debugCheckbox.checked });
    showStatus(debugCheckbox.checked ? '🐛 调试模式已开启，按 F12 查看控制台' : '调试模式已关闭', 'info');
    setTimeout(hideStatus, 2000);
  });

  // ---- Temperature 滑块 ----
  temperatureInput.addEventListener('input', () => {
    tempValue.textContent = temperatureInput.value;
  });

  // ---- 密码显隐 ----
  btnTogglePassword.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    btnTogglePassword.querySelector('svg').style.opacity = isPassword ? '1' : '0.5';
  });

  // ---- 保存设置 ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSave.disabled = true;
    btnSave.textContent = '保存中...';

    const config = {
      apiEndpoint: apiEndpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      systemPrompt: systemPromptInput.value.trim(),
      temperature: parseFloat(temperatureInput.value),
      maxTokens: parseInt(maxTokensInput.value) || 1024,
      maxContextLength: parseInt(maxContextInput.value) || 2000
    };

    try {
      const response = await safeSendMessage({
        type: 'SAVE_CONFIG',
        payload: config
      });
      if (response.success) {
        showStatus('✅ 设置已保存', 'success');
      } else {
        showStatus('保存失败: ' + response.error, 'error');
      }
    } catch (error) {
      showStatus('保存失败: ' + error.message, 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = '保存设置';
      setTimeout(hideStatus, 3000);
    }
  });

  // ---- 测试连接 ----
  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true;
    btnTest.textContent = '测试中...';
    showStatus('正在测试 API 连接...', 'info');

    const endpoint = apiEndpointInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || 'gpt-3.5-turbo';

    if (!endpoint || !apiKey) {
      showStatus('请先填写 API 端点地址和 API Key', 'error');
      btnTest.disabled = false;
      btnTest.textContent = '测试连接';
      setTimeout(hideStatus, 3000);
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'user', content: '你好，请回复"连接成功"这两个字。' }
          ],
          max_tokens: 50,
          temperature: 0
        })
      });

      if (response.ok) {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '';
        if (reply.includes('连接成功')) {
          showStatus('✅ API 连接成功！模型回复正常', 'success');
        } else {
          showStatus(`⚠️ API 可访问，但回复异常: "${reply.substring(0, 50)}"`, 'info');
        }
      } else {
        const errorText = await response.text();
        let errorMsg;
        try {
          const err = JSON.parse(errorText);
          errorMsg = err.error?.message || err.message || `HTTP ${response.status}`;
        } catch {
          errorMsg = `HTTP ${response.status}`;
        }
        showStatus(`❌ 连接失败: ${errorMsg}`, 'error');
      }
    } catch (error) {
      showStatus(`❌ 网络错误: ${error.message}`, 'error');
    } finally {
      btnTest.disabled = false;
      btnTest.textContent = '测试连接';
      setTimeout(hideStatus, 3000);
    }
  });

  // ---- 状态栏 ----
  function showStatus(message, type) {
    statusBar.textContent = message;
    statusBar.className = 'status-bar show ' + type;
  }

  function hideStatus() {
    statusBar.className = 'status-bar';
  }
});
