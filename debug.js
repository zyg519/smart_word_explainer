// ============================================================
// 划词解读 - 调试工具模块
// 通过 chrome.storage 控制开关，无需额外依赖
// ============================================================

const DEBUG = (() => {
  const PREFIX = '[划词解读]';
  let _enabled = false;

  // 从 storage 读取调试开关状态
  chrome.storage.local.get(['debugEnabled'], (result) => {
    _enabled = !!result.debugEnabled;
  });

  // 监听 storage 变化，实时响应开关
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.debugEnabled) {
      _enabled = !!changes.debugEnabled.newValue;
      if (_enabled) {
        console.log(`${PREFIX} 🐛 调试模式已开启`);
      }
    }
  });

  return {
    get enabled() {
      return _enabled;
    },

    /** 普通日志 */
    log(tag, ...args) {
      if (_enabled) {
        console.log(`${PREFIX} [${tag}]`, ...args);
      }
    },

    /** 警告 */
    warn(tag, ...args) {
      if (_enabled) {
        console.warn(`${PREFIX} [${tag}]`, ...args);
      }
    },

    /** 错误（始终输出） */
    error(tag, ...args) {
      console.error(`${PREFIX} [${tag}]`, ...args);
    },

    /** API 请求详情 */
    request(method, url, headers, body) {
      if (_enabled) {
        console.group(`${PREFIX} 📤 API 请求`);
        console.log('端点:', url);
        console.log('方法:', method);
        console.log('请求头:', { ...headers, Authorization: headers.Authorization ? 'Bearer ***' : undefined });
        console.log('请求体:', body);
        console.groupEnd();
      }
    },

    /** API 响应详情 */
    response(status, data, durationMs) {
      if (_enabled) {
        console.group(`${PREFIX} 📥 API 响应 (${durationMs}ms)`);
        console.log('状态码:', status);
        console.log('响应体:', data);
        console.groupEnd();
      } else {
        this.log('API', `响应 ${status} (${durationMs}ms)`);
      }
    },

    /** 事件追踪 */
    event(event, detail = {}) {
      if (_enabled) {
        console.log(`${PREFIX} 🔔 [事件] ${event}`, detail);
      }
    }
  };
})();
