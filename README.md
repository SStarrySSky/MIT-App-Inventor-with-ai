# AI Block Injector for MIT App Inventor

一个浏览器扩展（Manifest V3），在 App Inventor 的 Blocks 工作区侧边添加“AI Block Injector”面板，调用 LLM API 生成 Blockly XML 并直接注入工作区。
## ✨核心功能
基于LLM的图形化积木生成器，让AI成为你的图形化编码助手
## ⏬安装
1. 在 Chrome 浏览器地址栏输入 chrome://extensions/，进入插件管理界面，打开「开发者模式」。
2. 将项目release中的zip文件夹下载并解压，将解压后的文件夹直接拖入
3. 打开 App Inventor Blocks 编辑页（如 https://ai2.appinventor.mit.edu/）， 右上角会出现浮动面板。若未出现，请手动启用插件。

## ⚙️api配置
本工具使用 https://aihubmix.com/ 推理时代模型api,请登录网站充值购买用额。购买完成后遵循网站引导创建api-key并复制

## 👉使用
1. 填写 刚刚创建的API（默认 https://aihubmix.com/v1/chat/completions），按需填写 Key 和模型。
2. 在“需求”中描述要生成的积木，点击“调用 AI 生成”。
3. 检查输出区，点击“应用到工作区”导入。可勾选“替换当前工作区”先清空再导入。



