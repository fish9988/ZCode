# 第三方模型思考强度适配（Pi 风格多档位、自定义名称与协议映射）

## 背景

ZCode 底层通过 `optionSpecs.reasoningLevel`（`values: readonly string[]` + 受限 CEL `map: string`）驱动任意档位数与任意请求体 JSON Merge Patch，聊天工具栏滑杆（`ComposerModelMenu`）与切换控件（`ThoughtLevelCycleControl`）也原生支持任意 N 档。

然而在以下两个场景中配置门槛过高且容易失效：

1. **第三方模型拉取导入**：仅写入空 overlay，未命中 `zcode-builtin.json` 全局规则的模型（如 Gemini 2.5/3/4、Claude 4/4.5/4.6、GPT-5/5.1/5.2/5.5/6-luna/6.1-terra、o1/o3/o4、DeepSeek R1/V3.2 等）退化为 2 档 `["disabled", "enabled"]` + 4 字段通发 CEL，且丢失 `/models` 返回的上下文窗口、最大输出与服务端推理元数据。
2. **模型配置弹窗**：只提供原始标签与手写 CEL 文本框，缺乏对 3 档 / 5 档 / 7 档、空洞子集（如 `off / high / max`）、自定义档位名与上游协议字段映射的可视化编辑能力。

同时 `zcode-builtin.json` 会随远端 CDN 同步更新或校验内容一致性，因此思考强度适配不得通过修改 `zcode-builtin.json` 实现，而应通过纯规则推断与可视化配置编译为标准 `optionSpecs.reasoningLevel.{values, map}` 写入个人层配置。

## 设计（借鉴 `pi-mono` `thinkingLevelMap` + `thinkingFormat`）

### 1. 标准 7 档阶梯、空洞与自定义档位名

- 标准阶梯 `CANONICAL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]`。
- 支持 1–7 档任意子集（允许空洞，例如 3 档 `low/medium/high` 或 `off/high/max`；5 档 `none/low/medium/high/xhigh`；7 档全量）以及任意自定义档位名（如 `adaptive`、`auto`、`instant`、`turbo`、`deep`、`disabled`、`enabled` 等），严格按数组顺序从低到高。
- 每个档位条目显式区分**界面档位 ID（`id`）**与**协议发送动作（`action` + `wireValue` / `budgetTokens`）**：
  - `value`：发送指定上游字符串（默认同 `id`，可改为模型/网关要求的任意名字，如 `off → "none"`、`xhigh → "max"`、`high → "turbo"`）
  - `budget`：发送整数 `budget_tokens`（或 `thinking_budget`）
  - `enabled` / `disabled`：协议开关态
  - `omit`：输出空对象 `{}`，请求体不附带任何思考参数

### 2. 协议格式（`ThinkingFormat`）

| Format | 关闭/关闭动作 (`disabled`) | 激活/值动作 (`value` / `budget` / `enabled`) |
| --- | --- | --- |
| `openai` | `{"reasoning_effort": "none"}` | `{"reasoning_effort": <wire>}` |
| `openai-responses` | `{"reasoning": {"effort": "none"}}` | `{"reasoning": {"effort": <wire>}}` |
| `openrouter` | `{"reasoning": {"enabled": false}}` | `{"reasoning": {"effort": <wire>}}` |
| `anthropic-adaptive` | `{"thinking": {"type": "disabled"}}` | `{"thinking": {"type": "adaptive"}, "output_config": {"effort": <wire>}}` |
| `anthropic-budget` | `{"thinking": {"type": "disabled"}}` | `{"thinking": {"type": "enabled", "budget_tokens": <N>}}` |
| `deepseek` | `{"thinking": {"type": "disabled"}}` | `{"thinking": {"type": "enabled"}, "reasoning_effort": <wire>}` |
| `zai` | `{"thinking": {"type": "disabled"}}` | `{"thinking": {"type": "enabled"}}` |
| `qwen` | `{"enable_thinking": false}` | `{"enable_thinking": true}`（带预算时附加 `thinking_budget`） |
| `qwen-chat-template` | `{"chat_template_kwargs": {"enable_thinking": false}}` | `{"chat_template_kwargs": {"enable_thinking": true}}` |
| `noop` | `{}` | `{}` |
| `custom-cel` | 保留原样受限 CEL 表达式 | 保留原样受限 CEL 表达式 |

所有 `omit` 档位统一输出 `{}`。

### 3. 无损双向转换与求值反编译

- `compileThinkingProfileToOptionSpec(profile)` 输出合法受限 CEL，保证经 `compileModelOptionMap(map, "reasoningLevel")` 校验通过。
- `parseOptionSpecToThinkingProfile(values, map, apiType)` 直接调用 `compileModelOptionMap` 对每个 `value` 求值，根据真实输出的 JSON Patch 反向还原 `format` 与逐档 `wireValue`/`budgetTokens`/`omit`；无法归类的复杂 CEL 自动回落到 `custom-cel` 保持零信息损失。

### 4. 服务端元数据解析与智能推断

- `parseRemoteModelsPayload` 额外解析 `supported_reasoning_effort` / `reasoning_efforts` / `reasoning_levels` / `thinking_levels` / `supported_parameters` / `reasoning` / `supports_reasoning`。
- `inferThinkingProfileForModel({ modelId, apiType, baseUrl, remoteEntry })` 按优先级推断：
  1. 服务端显式返回的 `reasoningLevels`
  2. 非思考/生图/向量/语音模型 → 1 档 `["off"]` + `noop`
  3. 主流模型家族规则（OpenAI o1/o3/o4/GPT-5/6、Anthropic Claude 3.7/4/4.5/4.6/5、Google Gemini 2.5/3/4、DeepSeek V3/V4/R1、Qwen 3/3.8、Grok 3/4.6/4.7、GLM 4.5–5.3、Kimi K2/K3、MiniMax M3.1；如 `gemini-4-neon-xhigh` 命中 Gemini 4 家族，默认提供 `low/medium/high/xhigh` 4 档而非锁死单档）
  4. 其余带强度后缀的代理模型（`*-xhigh`、`*-high`、`*-medium`、`*-low`、`*-minimal`）→ 视为不传参数时的默认强度，按后缀推断多档位，并允许在导入弹窗或模型编辑页随时自定义
  5. 未命中时保持 ZCode 内置推荐规则（不强制写入个人覆盖）。

### 5. UI 与跨模型钳制

- `ThinkingLevelProfileEditor`（`packages/ui/src/custom-appearance/`）：快捷档位预设（1/2/3/4/5/6/7 档）、协议格式选择、Pi 7 档快选条、可排序逐档映射表（含自定义档位名）及折叠式高级 CEL 编辑器。
- `FetchRemoteModelsDialog`：展示每个拉取模型的推断思考档位与上下文/输出上限，支持全局导入策略与单模型档位预设覆盖，批量提交完整 `BatchAddPersonalModelInput[]`。
- `DefaultModelAndOfficialPlanBar`：使用 `thoughtLevelLabelId` 本地化思考强度名称，并在切换默认模型时通过 `clampReasoningLevel` 按 7 档语义阶梯平滑钳制。
