# AI Block Injector for MIT App Inventor

一个浏览器扩展（Manifest V3），在 App Inventor 的 Blocks 工作区侧边添加“AI Block Injector”面板，调用 LLM API 生成 Blockly XML 并直接注入工作区。

## 安装（开发模式）
1. 打开 Chrome/Edge，进入扩展管理，开启“开发者模式”。
2. 选择“加载已解压的扩展程序”，指向本仓库的 `src` 目录。
3. 打开 App Inventor Blocks 编辑页（如 `https://ai2.appinventor.mit.edu/`），右上角会出现浮动面板。

## 使用
- 填写 API（默认 `https://aihubmix.com/v1/chat/completions`），按需填写 Key 和模型。
- 在“需求”中描述要生成的积木，点击“调用 AI 生成”。
- 面板将提示 AI 输出应为 JSON：`{"blocksXml": "<xml ...>...</xml>"}`；如 AI 回复包含 `<xml>...</xml>` 也会被识别。
- 检查输出区，点击“应用到工作区”导入。可勾选“替换当前工作区”先清空再导入。

## 主要实现
- `src/manifest.json`：扩展配置与匹配站点。
- `src/background.js`：代理跨域 fetch，避免 CORS。
- `src/content-script.js`：浮动面板 UI，AI 请求、响应解析与 Blockly 注入。
- `src/styles.css`：面板样式。
