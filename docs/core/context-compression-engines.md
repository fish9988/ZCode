# 上下文压缩引擎架构（pi-dsh-compact 默认 + Billion-Context 内嵌 + 单模型有效窗口）

## 背景

1. **原版压缩痛点**：
   - ZCode 默认自动压缩仅在 `contextWindow - 21K - 13K`（100% 阈值）触发，对 1M 上下文模型要等到 ~966K 才压缩，远超多数模型 300K–500K 的高注意力甜点区；
   - 默认仅保留最近 1 轮（`PRESERVE_RECENT_ROUND_COUNT = 1`），压缩后容易丢失正在编辑的近期上下文；
   - 原版摘要请求直接附带完整 Agent system prompt、全量工具 schema 与未裁剪的冗长工具日志，容易触发工具误调用或丢失长日志末尾的报错信息；
   - `features.compact` 未透传到 `AgentRuntimeConfig`，桌面端也没有压缩引擎与参数配置入口。
2. **目标**：
   - **默认压缩引擎升级为 `dsh-compact`（移植自本地 Pi 扩展 `pi-dsh-compact`，融合 `@deepseek-ai/dsh-compaction-basic` + `compaction-tool-result-pruner` + Pi 文件追踪双保险）**：
     - **平时零开销**：不改写日常对话请求、不注册额外工具、100% 保持 Prefix Cache 稳定，仅在触发压缩时运行；
     - **默认 60% 触发线**（可配置 30%–95%），保留最近约 20% 完整轮次且不拆散工具调用对；
     - **DSH 首尾工具输出裁剪**：超过 6,000 字符按 Unicode 码点保留**头 4,096 + 尾 1,024** 字符（`[... tool result middle pruned ...]`），保住日志末尾报错与退出码，绝不劈裂 UTF-16 代理对；
     - **自动剥离 `<supermemory>...</supermemory>` 噪音**：防止记忆注入块污染检查点摘要；
     - **独立无工具摘要请求**：序列化时忽略 thinking/reasoning 块，使用独立 `DSH_SUMMARIZATION_SYSTEM_PROMPT` 与 32,768 输出上限，严格拦截 `length` 截断、工具调用与空摘要；
     - **DSH 8 章节工程检查点模板 + `<read-files>` / `<modified-files>` 双保险**：固定 8 节（`Primary Request and Intent`、`Key Technical Concepts`、`Files and Code`、`Errors and Fixes`、`Pending Jobs`、`Current Work`、`Next Step`、`Critical Context`），支持 `<compacted-summary>` 多代增量合并与累计文件清单追记。
   - **原生内嵌 `billion-context`（`acp-kernel`）作为可选引擎**：设置页一键切换，无需外部代理进程与 MITM 证书；通过只读镜像 `vendor/acp-kernel/` 与 `pnpm run sync:acp-kernel` 保持与上游 `ranxianglei/billion-context` 可持续一键升级。
   - **分层有效上下文上限（Sweet-Spot Window）**：支持单模型 `effectiveContextWindow`（例如 1M 模型配置 300K 或 500K）和全局默认有效上限，对全部压缩引擎统一生效。

## 核心公式：有效压缩窗口

$$\text{effectiveWindow} = \min\big(\text{model.effectiveContextWindow} \;\text{??}\; \text{global.defaultEffectiveContextWindow} \;\text{??}\; \text{model.contextWindow},\; \text{model.contextWindow}\big)$$

- `model.contextWindow` 仍代表模型真实硬上限（用于最终请求安全校验与输出上限计算）；
- `effectiveWindow` 仅控制压缩引擎的触发与预算上限。

## 四种压缩模式（`ContextCompressionEngineMode`）

| 模式 | 说明 |
| --- | --- |
| `dsh-compact`（默认） | 移植自 `pi-dsh-compact`：平时零开销、默认在 `effectiveWindow * 60%`（可配 30%–95%）触发，保留约 20% 近期完整轮次；序列化时执行头 4,096 + 尾 1,024 工具裁剪与 `<supermemory>` 剥离，以无工具独立请求输出 DSH 8 章节检查点并追加 `<read-files>` / `<modified-files>` 双保险，支持 `<compacted-summary>` 多代增量合并、`recoverOnOverflow` 与可选 `microcompactEnabled` |
| `billion-context` | 原生调用 `acp-kernel`（来自 `ranxianglei/billion-context/kernel`）：注入免审批内置工具 `compress`、`decompress`、`search_context`、`acp_status`，在发往模型前经 `processTurn` 投影折叠视图与临时 nudge，状态按 `branchGeneration` 持久化到 SQLite `session_entry`（`type = "runtime/acp_compression_state"`），自动跳过原生 `autoCompactIfNeeded` 防止双压缩；桥接层使用 `#tc_N` 子 ID 对齐 `baseIdOf()` 语义，并在还原时保证 `toolCalls` 与 `tool-result` 严格成对（过滤悬空调用与孤儿结果） |
| `legacy` | 保留 ZCode 原版 100% 阈值（`effectiveWindow - 21K - 13K`）、固定保留最近 1 轮与原版摘要提示词行为 |
| `disabled` | 禁用自动压缩与溢出压缩，仅保留手动 `/compact` |

## 上游 `billion-context`（`acp-kernel`）升级机制

- 镜像目录：`vendor/acp-kernel/`（原样镜像 `ranxianglei/billion-context/kernel/`，禁止直接修改内核源码）。
- 元数据文件：`vendor/acp-kernel/UPSTREAM_SYNC.json` 记录上游仓库、分支/tag、commit SHA 与 `acp-kernel` 版本。
- 一键同步命令：`pnpm run sync:acp-kernel`（脚本 `scripts/sync-acp-kernel.mjs`），拉取最新上游 `kernel/`、编译 `dist/` 并执行内核单测。
- ZCode 适配层：`apps/zcode-cli/packages/core/src/context-compression/`（在 `architecture-policy.yaml` 登记为 `managed: true` 模块 `cli-context-compression`），仅消费 `acp-kernel` 公开导出接口。

## 合规署名（MIT 附加条款）

依据 `ranxianglei/billion-context` 的 MIT 附加条款，设置页与本文档显式标注：本产品内置上下文压缩能力使用了 **billion-context**（`https://github.com/ranxianglei/billion-context`）与 **acp-kernel**（`https://github.com/ranxianglei/acp-kernel`）；默认 `dsh-compact` 引擎移植自作者自研的 Pi 扩展 **pi-dsh-compact**（融合 DSH 8 章节检查点模板、头 4,096 + 尾 1,024 工具裁剪与 Pi 文件列表追踪双保险）。
