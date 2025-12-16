(() => {
  const PANEL_ID = 'ai-block-injector-panel';
  const DEFAULT_API_BASE = 'https://aihubmix.com/v1/chat/completions';
  const DEFAULT_MODEL = 'inference-pro';
  const SYSTEM_PROMPT = [
    '你是 MIT App Inventor 的 Blockly 积木生成助手。',
    '只输出 JSON，对象里必须包含 blocksXml (字符串)，可选 description。',
    'blocksXml 是有效的 Blockly XML：<xml xmlns="https://developers.google.com/blockly/xml"> ... </xml>。',
    '使用 App Inventor 的积木类型和字段名；如需要组件，保持用户给出的组件名 (Button1、Label1)。',
    '若不知道组件名就使用变量或占位值，保证 XML 能被解析。',
    '不要写解释文本、不要 Markdown 代码块。'
  ].join(' ');

  if (window.__aiBlockInjectorLoaded) return;
  window.__aiBlockInjectorLoaded = true;

  const state = {
    workspace: null,
    statusEl: null,
    outputEl: null,
    promptEl: null,
    apiEl: null,
    keyEl: null,
    modelEl: null,
    clearCheckbox: null
  };

  const log = (...args) => console.log('[AI Blocks]', ...args);

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findWorkspace = () => {
    const { Blockly } = window;
    if (!Blockly) return null;
    if (Blockly.mainWorkspace) return Blockly.mainWorkspace;
    if (typeof Blockly.getMainWorkspace === 'function') {
      const ws = Blockly.getMainWorkspace();
      if (ws) return ws;
    }
    if (Blockly.Workspace && typeof Blockly.Workspace.getAll === 'function') {
      const all = Blockly.Workspace.getAll();
      if (all && all.length) return all[0];
    }
    return null;
  };

  const waitForWorkspace = async (timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ws = findWorkspace();
      if (ws) return ws;
      await delay(400);
    }
    throw new Error('无法找到 Blockly 工作区，请确认已进入 Blocks 编辑器。');
  };

  const ensureWorkspace = async () => {
    if (state.workspace) return state.workspace;
    const ws = findWorkspace();
    if (ws) {
      state.workspace = ws;
      return ws;
    }
    const awaited = await waitForWorkspace(5000);
    state.workspace = awaited;
    return awaited;
  };

  const setStatus = (msg, tone = 'info') => {
    if (!state.statusEl) return;
    state.statusEl.textContent = msg;
    state.statusEl.dataset.tone = tone;
  };

  const extractBlocksXml = (payloadText) => {
    if (!payloadText) return null;

    // Try JSON first.
    try {
      const obj = JSON.parse(payloadText);
      if (obj?.blocksXml) return obj.blocksXml;
      if (obj?.xml) return obj.xml;
      if (obj?.choices?.[0]?.message?.content) {
        return extractBlocksXml(obj.choices[0].message.content);
      }
    } catch (err) {
      // not JSON, continue
    }

    // Try fenced JSON block.
    const jsonFence = payloadText.match(/```json([\s\S]*?)```/i);
    if (jsonFence?.[1]) {
      try {
        const obj = JSON.parse(jsonFence[1]);
        if (obj?.blocksXml) return obj.blocksXml;
        if (obj?.xml) return obj.xml;
      } catch (err) {
        // ignore
      }
    }

    // Direct XML in text.
    const xmlMatch = payloadText.match(/<xml[\s\S]*<\/xml>/i);
    if (xmlMatch) return xmlMatch[0];

    return null;
  };

  const parseModelContent = (responseText) => {
    try {
      const parsed = JSON.parse(responseText);
      const content = parsed?.choices?.[0]?.message?.content ?? parsed?.message ?? responseText;
      const xml = extractBlocksXml(content);
      return { xml, raw: content };
    } catch (err) {
      const xml = extractBlocksXml(responseText);
      return { xml, raw: responseText };
    }
  };

  const proxyFetch = async (url, options) => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const resp = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'ai-block-fetch', url, options },
            (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve(res);
            }
          );
        });
        if (resp?.error) throw new Error(resp.error);
        return {
          ok: resp.ok,
          status: resp.status,
          text: () => Promise.resolve(resp.body)
        };
      } catch (err) {
        log('Background fetch failed, fallback to window.fetch', err);
      }
    }

    const res = await fetch(url, options);
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text()
    };
  };

  const askLLM = async ({ apiBase, apiKey, model, userPrompt }) => {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const body = {
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    };

    const res = await proxyFetch(apiBase, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`API 请求失败: ${res.status}, ${text}`);
    return text;
  };

  const fetchModels = async ({ apiBase, apiKey }) => {
    // Try OpenAI-compatible /models endpoint.
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const modelsUrl = apiBase.replace(/\/v1\/chat\/completions.*/i, '/v1/models');
    const res = await proxyFetch(modelsUrl, { method: 'GET', headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型列表获取失败: ${res.status}`);
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data?.data)) {
        return data.data.map((m) => m.id).filter(Boolean);
      }
    } catch (err) {
      throw new Error('无法解析模型列表响应');
    }
    throw new Error('模型列表响应格式未知');
  };

  const applyXmlToWorkspace = (xmlString, workspace, clearFirst) => {
    if (!xmlString) throw new Error('没有可用的 XML。');
    const { Blockly } = window;
    if (!Blockly) throw new Error('Blockly 未加载。');

    try {
      const dom = Blockly.Xml.textToDom(xmlString);
      if (clearFirst) workspace.clear();
      Blockly.Xml.domToWorkspace(dom, workspace);
      workspace.render();
    } catch (err) {
      throw new Error(`XML 解析失败: ${err.message || err}`);
    }
  };

  const createPanel = (workspace) => {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'ai-block-panel';

    const header = document.createElement('div');
    header.className = 'ai-block-header';
    header.textContent = 'AI Block Injector';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '隐藏';
    toggleBtn.className = 'ai-block-btn small';
    toggleBtn.addEventListener('click', () => {
      const body = panel.querySelector('.ai-block-body');
      const hidden = body.classList.toggle('hidden');
      toggleBtn.textContent = hidden ? '展开' : '隐藏';
    });

    header.appendChild(toggleBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ai-block-body';

    const status = document.createElement('div');
    status.className = 'ai-block-status';
    status.textContent = '等待操作';
    state.statusEl = status;
    body.appendChild(status);

    const row = (label, inputEl) => {
      const wrap = document.createElement('label');
      wrap.className = 'ai-block-row';
      const span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(span);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const apiInput = document.createElement('input');
    apiInput.type = 'text';
    apiInput.value = DEFAULT_API_BASE;
    apiInput.placeholder = 'API base，例如 https://aihubmix.com/v1/chat/completions';
    apiInput.className = 'ai-block-input';
    state.apiEl = apiInput;
    body.appendChild(row('API', apiInput));

    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.placeholder = 'API Key（可留空）';
    keyInput.className = 'ai-block-input';
    state.keyEl = keyInput;
    body.appendChild(row('Key', keyInput));

    const modelWrap = document.createElement('div');
    modelWrap.className = 'ai-block-row';
    const modelLabel = document.createElement('span');
    modelLabel.textContent = '模型';
    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.value = DEFAULT_MODEL;
    modelInput.placeholder = '模型 ID';
    modelInput.className = 'ai-block-input';
    state.modelEl = modelInput;

    const modelBtn = document.createElement('button');
    modelBtn.textContent = '拉取模型';
    modelBtn.className = 'ai-block-btn small';
    const modelSelect = document.createElement('select');
    modelSelect.className = 'ai-block-select';
    modelSelect.addEventListener('change', () => {
      modelInput.value = modelSelect.value;
    });

    modelBtn.addEventListener('click', async () => {
      setStatus('获取模型中...', 'info');
      modelBtn.disabled = true;
      try {
        const list = await fetchModels({
          apiBase: apiInput.value.trim(),
          apiKey: keyInput.value.trim()
        });
        modelSelect.innerHTML = '';
        list.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          modelSelect.appendChild(opt);
        });
        if (list[0]) modelInput.value = list[0];
        setStatus(`获取模型成功，共 ${list.length} 个`, 'success');
      } catch (err) {
        setStatus(err.message || '获取模型失败', 'error');
      } finally {
        modelBtn.disabled = false;
      }
    });

    modelWrap.appendChild(modelLabel);
    modelWrap.appendChild(modelInput);
    modelWrap.appendChild(modelBtn);
    modelWrap.appendChild(modelSelect);
    body.appendChild(modelWrap);

    const prompt = document.createElement('textarea');
    prompt.placeholder = '描述要生成的积木，例如：“当 Button1 被点击时，把 Label1.Text 设置为 Hello World”。';
    prompt.className = 'ai-block-textarea';
    state.promptEl = prompt;
    body.appendChild(row('需求', prompt));

    const askBtn = document.createElement('button');
    askBtn.textContent = '调用 AI 生成';
    askBtn.className = 'ai-block-btn primary';

    const clearCheckbox = document.createElement('input');
    clearCheckbox.type = 'checkbox';
    clearCheckbox.checked = false;
    state.clearCheckbox = clearCheckbox;
    const clearLabel = document.createElement('label');
    clearLabel.className = 'ai-block-checkbox';
    clearLabel.appendChild(clearCheckbox);
    const clearSpan = document.createElement('span');
    clearSpan.textContent = '替换当前工作区（先清空再导入）';
    clearLabel.appendChild(clearSpan);

    const output = document.createElement('textarea');
    output.className = 'ai-block-textarea code';
    output.placeholder = 'AI 返回的 JSON 或直接粘贴 Blockly XML';
    state.outputEl = output;

    const applyBtn = document.createElement('button');
    applyBtn.textContent = '应用到工作区';
    applyBtn.className = 'ai-block-btn success';

    const helper = document.createElement('div');
    helper.className = 'ai-block-helper';
    helper.innerHTML = [
      'AI 输出格式要求：',
      '<br/>{"blocksXml": "<xml ...>...</xml>"}',
      '<br/>支持直接粘贴 <xml>...</xml> 导入。'
    ].join('');

    askBtn.addEventListener('click', async () => {
      const apiBase = apiInput.value.trim();
      const apiKey = keyInput.value.trim();
      const model = modelInput.value.trim();
      const userPrompt = prompt.value.trim();
      if (!apiBase || !userPrompt) {
        setStatus('请填写 API 地址和需求描述。', 'error');
        return;
      }
      setStatus('请求 AI 中...', 'info');
      askBtn.disabled = true;
      try {
        const text = await askLLM({ apiBase, apiKey, model, userPrompt });
        const { xml, raw } = parseModelContent(text);
        output.value = raw || text || '';
        if (xml) {
          setStatus('AI 响应已解析，点击“应用到工作区”导入。', 'success');
        } else {
          setStatus('已收到响应，但未找到 XML，请检查输出。', 'warn');
        }
      } catch (err) {
        setStatus(err.message || 'AI 请求失败', 'error');
      } finally {
        askBtn.disabled = false;
      }
    });

    applyBtn.addEventListener('click', async () => {
      const text = output.value.trim();
      if (!text) {
        setStatus('没有可用的输出。', 'error');
        return;
      }
      const { xml } = parseModelContent(text);
      if (!xml) {
        setStatus('未找到可导入的 XML，请确认格式。', 'error');
        return;
      }
      try {
        const ws = await ensureWorkspace();
        applyXmlToWorkspace(xml, ws, clearCheckbox.checked);
        setStatus('导入成功！', 'success');
      } catch (err) {
        setStatus(err.message || '导入失败', 'error');
      }
    });

    body.appendChild(askBtn);
    body.appendChild(clearLabel);
    body.appendChild(helper);
    body.appendChild(output);
    body.appendChild(applyBtn);

    panel.appendChild(body);
    document.body.appendChild(panel);
  };

  const init = async () => {
    createPanel(null); // Show UI even if workspace not ready yet.
    try {
      const ws = await ensureWorkspace();
      setStatus('已连接到 Blockly 工作区', 'success');
      window.AIBlockInjector = {
        applyXml: (xml, clear) => applyXmlToWorkspace(xml, ws, clear),
        workspace: ws
      };
      log('AI Block Injector loaded.');
    } catch (err) {
      setStatus('未检测到工作区，请切换到 Blocks 页后重试或点击扩展图标再次注入。', 'error');
      log('AI Block Injector init failed', err);
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
