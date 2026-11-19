# 第三方供应商拉取模型列表（Fetch Remote Models）

## 背景

用户在设置页添加自定义 / 第三方 API 供应商（OpenAI Chat Completions、OpenAI Responses、Anthropic Messages）后，过去只能逐条手填模型 ID，无法像常见开源客户端（Cherry Studio、LobeChat、OpenCode 等）那样从服务端 `/models` 接口一键拉取并勾选导入可用模型。

## 开源标准方案设计

### 1. Host 侧网络请求边界

远程 `/models` 请求统一在桌面 Host 进程内的 `IProviderSettingsService.fetchRemoteModels` 中执行，通过 `HostApiNetworkTransport.fetch` 发出：

- 规避浏览器/Renderer 的 CORS 与混合内容限制（允许内网、局域网及裸 `http://host:port/v1` 端点）；
- 自动复用 ZCode 已配置的 HTTP 代理（`httpProxy` / `noProxy`）与自定义根证书（`caCertPath`）；
- 若用户刚在卡片输入框修改了 Base URL、API 格式或 API Key，UI 会先提交当前草稿并携带当前表单值发起请求，同时在 Host 侧按 `providerId` 补充已保存的 `api.headers` 与兜底密钥。

### 2. URL 规范化与候选地址生成

给定 `baseUrl` 与 `apiType`：

1. 去除首尾空白、末尾斜杠，以及用户误粘贴的尾段端点路径（`/chat/completions`、`/responses`、`/messages`、`/models`），校验协议必须为 `http:` 或 `https:`。
2. 当 `apiType === "anthropic-messages"`：
   - 沿用 `normalizeAnthropicBaseURL` 语义：若路径已以 `/v1` 结尾，首选 `${base}/models`；否则首选 `${base}/v1/models` 并把 `${base}/models` 作为 404/405 回退。
3. 当 `apiType === "openai-chat-completions"` 或 `"openai-responses"`：
   - 若路径为空或 `/`（如 `http://34.58.122.12:8317`），首选 `${base}/v1/models`，404/405 时回退 `${base}/models`。
   - 若路径非空（如 `http://34.58.122.12:8317/v1`、`https://open.bigmodel.cn/api/paas/v4`、`https://generativelanguage.googleapis.com/v1beta/openai`），首选 `${base}/models`，若路径未包含版本段且返回 404/405 再尝试 `${base}/v1/models`。

### 3. 按 API 格式严格分离鉴权头

部分兼容网关（如 CLIProxyAPI）会根据请求头中是否携带 `x-api-key` / `anthropic-version` 切换返回的模型 ID 格式：

- `anthropic-messages`：发送 `x-api-key`（若未在自定义 header 中显式指定）与 `anthropic-version: 2023-06-01`。
- `openai-chat-completions` / `openai-responses`：仅发送 `Authorization: Bearer <apiKey>`，绝不附带 Anthropic 专用请求头。

### 4. 响应体容错解析

支持业界主流返回结构并按 `id` 去重：

- `{ data: [...] }`（OpenAI、Anthropic、CLIProxyAPI、NewAPI、OneAPI、OpenRouter）
- `{ models: [...] }`（Gemini 原生风格 / Ollama / 部分代理；若仅提供 `models/xxx` 形式 `name` 则剥离 `models/` 前缀）
- 顶层数组 `[...]` 或字符串数组 `string[]`
- 可选提取 `display_name` / `owned_by` 与正整数 `contextWindow` / `maxOutputTokens` 仅作列表展示提示。

### 5. 批量导入与原子写入

`IProviderSettingsService.addPersonalModels(providerId, models)` 在单次 `ProviderConfigService.#updatePersonal` 事务中批量写入所有新模型 ID（跳过已存在的内置或个人模型），默认 `useRecommendedConfig = true` 与空 overlay `{}`，自动命中 `zcode-builtin.json` 的家族规则及 `".*"` 通配推荐配置，确保写入后立即可用于「测试连通性」和聊天对话。

## UI 交互

- `ProviderModelsSection` 在非官方账号卡片的「添加模型」旁新增「拉取模型」按钮（`TID_MODEL_PROVIDER_FETCH_MODELS_BUTTON`）。
- `FetchRemoteModelsDialog`（位于 `custom-appearance` 纳管模块）提供：
  - 实时搜索过滤（按模型 ID、显示名、`ownedBy`）
  - 全选 / 取消全选当前过滤结果中未添加的模型
  - 已添加模型标记为「已添加」并禁用重复勾选
  - 拉取失败时展示明确 HTTP/网络错误原因与重试按钮
  - 一键批量添加到当前供应商并刷新模型列表

## 验收标准

1. 使用 `http://34.58.122.12:8317/v1` + `080908` 实测：`openai-chat-completions` 拉取到 OpenAI 列表（包含 `gpt-5.6-luna`、`deepseek-v4.1-flash` 等 33 个模型）；`anthropic-messages` 拉取到 Anthropic 列表；均能正常解析且去重。
2. 批量调用 `addPersonalModels` 可将所选模型一次性写入个人配置且保留既有模型与顺序，不重复报错。
3. `pnpm typecheck`、`pnpm lint`、`pnpm run architecture:check -- --changed` 与新增单元测试全部通过。
