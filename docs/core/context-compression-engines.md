# 上下文压缩引擎架构（DSH-Compact 默认 + Billion-Context 内嵌 + 单模型有效窗口）

## 背景

1. **原版压缩痛点**：
   - ZCode 默认自动压缩仅在 `contextWindow - 21K - 13K`（100% 阈值）触发，对 1M 上下文模型要等到 ~966K 才压缩，远超多数模型 300K–500K 的高注意力甜点区；
   - 默认仅保留最近 1 轮（`PRESERVE_RECENT_ROUND_COUNT = 1`），压缩后容易丢失正在编辑的近期上下文；
   - 摘要请求遇到严格网关或思考模型返回空文本时，不会尝试移除系统提示词与工具定义后降级重试；
   - `features.compact` 未透传到 `AgentRuntimeConfig`，桌面端也没有压缩引擎与参数配置入口。
2. **目标**：
   - **默认压缩引擎升级为 `dsh-compact` 策略**（借鉴 `zixin947/dsh-compact`）：默认 75% 触发、保留最近约 20% 上下文（不拆散工具调用对）、空摘要无工具降级重试、有界溢出恢复、可选 `microcompact` 旧工具结果清理。
   - **原生内嵌 `billion-context`（`acp-kernel`）作为可选引擎**：设置页一键切换，无需外部代理进程与 MITM 证书；通过只读镜像 `vendor/acp-kernel/` 与 `pnpm run sync:acp-kernel` 保持与上游 `ranxianglei/billion-context` 可持续一键升级。
   - **分层有效上下文上限（Sweet-Spot Window）**：支持单模型 `effectiveContextWindow`（例如 1M 模型配置 300K 或 500K）和全局默认有效上限，对全部压缩引擎统一生效。

## 核心公式：有效压缩窗口

$$\text{effectiveWindow} = \min\big(\text{model.effectiveContextWindow} \;\text{??}\; \text{global.defaultEffectiveContextWindow} \;\text{??}\; \text{model.contextWindow},\; \text{model.contextWindow}\big)$$

- `model.contextWindow` 仍代表模型真实硬上限（用于最终请求安全校验与输出上限计算）；
- `effectiveWindow` 仅控制压缩引擎的触发与预算上限。

## 四种压缩模式（`ContextCompressionEngineMode`）

| 模式 | 说明 |
| --- | --- |
| `dsh-compact`（默认） | 在 `effectiveWindow * thresholdRatio`（默认 75%）触发自动压缩，按 token 预算倒推保留约 `effectiveWindow * retainRatio`（默认 20%，至少 1 轮、不拆工具对），空摘要移除 system + tools 重试一次，支持 `recoverOnOverflow` / `maxOverflowRetries` 与 `microcompactEnabled` |
| `billion-context` | 原生调用 `acp-kernel`（来自 `ranxianglei/billion-context/kernel`）：注入免审批内置工具 `compress`、`decompress`、`search_context`、`acp_status`，在发往模型前经 `processTurn` 投影折叠视图与临时 nudge，状态按 `branchGeneration` 持久化到 SQLite `session_entry`（`type = "runtime/acp_compression_state"`），自动跳过原生 `autoCompactIfNeeded` 防止双压缩 |
| `legacy` | 保留 ZCode 原版 100% 阈值（`effectiveWindow - 21K - 13K`）与固定保留最近 1 轮行为 |
| `disabled` | 禁用自动压缩与溢出压缩，仅保留手动 `/compact` |

## 上游 `billion-context`（`acp-kernel`）升级机制

- 镜像目录：`vendor/acp-kernel/`（原样镜像 `ranxianglei/billion-context/kernel/`，禁止直接修改内核源码）。
- 元数据文件：`vendor/acp-kernel/UPSTREAM_SYNC.json` 记录上游仓库、分支/tag、commit SHA 与 `acp-kernel` 版本。
- 一键同步命令：`pnpm run sync:acp-kernel`（脚本 `scripts/sync-acp-kernel.mjs`），拉取最新上游 `kernel/`、编译 `dist/` 并执行内核单测。
- ZCode 适配层：`apps/zcode-cli/packages/core/src/context-compression/`（在 `architecture-policy.yaml` 登记为 `managed: true` 模块 `cli-context-compression`），仅消费 `acp-kernel` 公开导出接口。

## 合规署名（MIT 附加条款）

依据 `ranxianglei/billion-context` 的 MIT 附加条款，设置页与本文档显式标注：本产品内置上下文压缩能力使用了 **billion-context**（`https://github.com/ranxianglei/billion-context`）与 **acp-kernel**（`https://github.com/ranxianglei/acp-kernel`），以及默认压缩策略借鉴了 **dsh-compact**（`https://github.com/zixin947/dsh-compact`）。
