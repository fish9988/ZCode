import {
  baseIdOf,
  buildCompressSystemPrompt,
  isRenderedSummaryMessage,
  isSummaryMessageId,
  renderNudgeText,
  type CoreMessage,
  type NudgeDecision,
} from "acp-kernel";
import {
  cloneRuntimeMessageEntry,
  isContextPrefixEntry,
  isRuntimeAttachmentEntry,
  type RuntimeMessageEntry,
  type RuntimeMessageMessageEntry,
} from "../agent/message-history.js";
import { modelMessageContentToText } from "@zcode/contracts";

export interface EntryCoreMapping {
  readonly prefixEntries: RuntimeMessageEntry[];
  readonly bodyEntries: RuntimeMessageEntry[];
  readonly coreMessages: CoreMessage[];
  readonly entryByBaseId: Map<string, RuntimeMessageEntry>;
}

const ACP_SYSTEM_PROMPT_MARKER = "ACP TAGS";
const ACP_TAG_PREFIX_RE = /^(<acp\b[^>]*>[^<]*<\/acp>\s*)/u;

function sanitizeBaseId(raw: string): string {
  // acp-kernel 的 baseIdOf(id) 按首个 '#' 截断子块后缀，因此基础 ID 本身不得包含 '#'。
  return raw.replace(/#/gu, "_");
}

function stableBaseIdForEntry(entry: RuntimeMessageEntry, index: number): string {
  if (!isRuntimeAttachmentEntry(entry)) {
    const groupKey = entry.compactGroupKey?.trim();
    if (groupKey) return sanitizeBaseId(groupKey);
    const toolCallId = entry.message.toolCallId?.trim();
    if (toolCallId) return sanitizeBaseId(`tc_res_${toolCallId}`);
    const firstCallId = entry.message.toolCalls?.[0]?.id?.trim();
    if (firstCallId) return sanitizeBaseId(`tc_call_${firstCallId}`);
  }
  return `rt_entry_${index}`;
}

function hasMeaningfulAssistantContent(
  content: RuntimeMessageMessageEntry["message"]["content"],
): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (Array.isArray(content)) {
    return content.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.text.trim().length > 0;
      }
      return true;
    });
  }
  return false;
}

function entryText(entry: RuntimeMessageEntry): string {
  if (isRuntimeAttachmentEntry(entry)) {
    return typeof entry.content === "string" ? entry.content : modelMessageContentToText(entry.content);
  }
  return modelMessageContentToText(entry.message.content);
}

/**
 * 将 ZCode 运行时消息队列拆分为前缀（system）与可压缩正文，并映射为 acp-kernel CoreMessage[]。
 * 使用 sourceMessageId 作为稳定 ID，保证跨 turn 引用编号（mNNNNN）不漂移。
 */
export function runtimeEntriesToCoreMessages(
  entries: readonly RuntimeMessageEntry[],
): EntryCoreMapping {
  const prefixEntries: RuntimeMessageEntry[] = [];
  const bodyEntries: RuntimeMessageEntry[] = [];
  const coreMessages: CoreMessage[] = [];
  const entryByBaseId = new Map<string, RuntimeMessageEntry>();
  const usedBaseIds = new Map<string, number>();

  let inLeadingPrefix = true;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (inLeadingPrefix && isContextPrefixEntry(entry)) {
      prefixEntries.push(entry);
      continue;
    }
    inLeadingPrefix = false;
    bodyEntries.push(entry);

    const rawBase = stableBaseIdForEntry(entry, i);
    const seenCount = usedBaseIds.get(rawBase) ?? 0;
    usedBaseIds.set(rawBase, seenCount + 1);
    const baseId = seenCount === 0 ? rawBase : `${rawBase}~${seenCount}`;
    entryByBaseId.set(baseId, entry);

    if (isRuntimeAttachmentEntry(entry)) {
      coreMessages.push({
        id: baseId,
        role: "user",
        contentType: "text",
        text: entryText(entry),
      });
      continue;
    }

    const msg = entry.message;
    if (msg.role === "system") {
      coreMessages.push({
        id: baseId,
        role: "system",
        contentType: "text",
        text: entryText(entry),
      });
      continue;
    }

    if (msg.role === "tool") {
      coreMessages.push({
        id: baseId,
        role: "tool",
        contentType: "tool-result",
        text: entryText(entry),
        toolName: msg.toolName,
        toolCallId: msg.toolCallId,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const text = entryText(entry);
      const toolCalls = msg.toolCalls ?? [];
      if (text || toolCalls.length === 0) {
        coreMessages.push({
          id: baseId,
          role: "assistant",
          contentType: "text",
          text,
        });
      }
      for (let tcIndex = 0; tcIndex < toolCalls.length; tcIndex += 1) {
        const tc = toolCalls[tcIndex]!;
        const argsText =
          typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input ?? {});
        coreMessages.push({
          id: tcIndex === 0 && !text ? baseId : `${baseId}#tc_${tcIndex}`,
          role: "assistant",
          contentType: "tool-call",
          toolName: tc.name,
          toolCallId: tc.id,
          text: `${tc.name}(${argsText})`,
        });
      }
      continue;
    }

    coreMessages.push({
      id: baseId,
      role: "user",
      contentType: "text",
      text: entryText(entry),
    });
  }

  return { prefixEntries, bodyEntries, coreMessages, entryByBaseId };
}

function attachAcpTagToEntry(entry: RuntimeMessageEntry, renderedText: string | undefined): RuntimeMessageEntry {
  if (!renderedText) return entry;
  const tagMatch = renderedText.match(ACP_TAG_PREFIX_RE);
  if (!tagMatch) return entry;
  const tagPrefix = tagMatch[1]!;

  if (isRuntimeAttachmentEntry(entry)) {
    if (typeof entry.content === "string") {
      if (entry.content.startsWith(tagPrefix)) return entry;
      return { ...entry, content: `${tagPrefix}${entry.content}` };
    }
    return entry;
  }

  const msg = entry.message;
  if (msg.role === "assistant") {
    // 不在 assistant 文本中注入 <acp> 标签，避免模型在输出中复读标签。
    return entry;
  }
  if (typeof msg.content === "string") {
    if (msg.content.startsWith(tagPrefix)) return entry;
    return {
      ...entry,
      message: { ...msg, content: `${tagPrefix}${msg.content}` },
    };
  }
  if (Array.isArray(msg.content)) {
    const firstTextIndex = msg.content.findIndex((part) => part.type === "text");
    if (firstTextIndex >= 0) {
      const part = msg.content[firstTextIndex]!;
      if (part.type === "text" && !part.text.startsWith(tagPrefix)) {
        const nextContent = [...msg.content];
        nextContent[firstTextIndex] = { ...part, text: `${tagPrefix}${part.text}` };
        return { ...entry, message: { ...msg, content: nextContent } };
      }
      return entry;
    }
    return {
      ...entry,
      message: {
        ...msg,
        content: [{ type: "text", text: tagPrefix.trimEnd() }, ...msg.content],
      },
    };
  }
  return entry;
}

function ensureAcpSystemPrompt(prefixEntries: readonly RuntimeMessageEntry[]): RuntimeMessageEntry[] {
  const cloned = prefixEntries.map(cloneRuntimeMessageEntry);
  const alreadyPresent = cloned.some((entry) => entryText(entry).includes(ACP_SYSTEM_PROMPT_MARKER));
  if (alreadyPresent) return cloned;
  const systemText = buildCompressSystemPrompt();
  const acpSystemEntry: RuntimeMessageMessageEntry = {
    message: {
      role: "system",
      content: systemText,
    },
    metadata: {
      source: "context_prefix",
    },
  };
  return [...cloned, acpSystemEntry];
}

/**
 * 将 acp-kernel `processTurn` 输出的折叠消息流 + 可选 nudge 还原为 ZCode `RuntimeMessageEntry[]`。
 * 原始未折叠条目完整保留 toolCalls、媒体附件和元信息，折叠段转为合成摘要消息。
 */
export function coreMessagesToRuntimeEntries(input: {
  readonly mapping: EntryCoreMapping;
  readonly renderedMessages: readonly CoreMessage[];
  readonly nudge?: NudgeDecision;
  readonly protocol?: "anthropic" | "openai" | "responses";
}): { readonly entries: RuntimeMessageEntry[]; readonly nudgeInjected: boolean } {
  const result: RuntimeMessageEntry[] = ensureAcpSystemPrompt(input.mapping.prefixEntries);
  const emittedBaseIds = new Set<string>();
  const emittedToolCallIds = new Set<string>();

  // 预扫描 renderedMessages，找出“工具调用与后续工具结果双双保留”的 toolCallId 集合，
  // 防止同批并行调用（如 compress + Bash + Read）发生局部隐藏/折叠时重发出悬空 toolCall 或孤儿 tool-result。
  const seenCallIds = new Set<string>();
  const pairedToolCallIds = new Set<string>();
  for (const coreMsg of input.renderedMessages) {
    if (isSummaryMessageId(coreMsg.id) || isRenderedSummaryMessage(coreMsg)) continue;
    const baseId = baseIdOf(coreMsg.id);
    const original = input.mapping.entryByBaseId.get(baseId);
    if (!original || isRuntimeAttachmentEntry(original)) continue;
    const toolCallId = coreMsg.toolCallId?.trim();
    if (!toolCallId) continue;
    if (coreMsg.contentType === "tool-call" && original.message.role === "assistant") {
      seenCallIds.add(toolCallId);
    } else if (
      coreMsg.contentType === "tool-result" &&
      original.message.role === "tool" &&
      seenCallIds.has(toolCallId)
    ) {
      pairedToolCallIds.add(toolCallId);
    }
  }

  for (const coreMsg of input.renderedMessages) {
    if (isSummaryMessageId(coreMsg.id) || isRenderedSummaryMessage(coreMsg)) {
      const summaryEntry: RuntimeMessageMessageEntry = {
        message: {
          role: "user",
          content: coreMsg.text ?? "",
        },
        metadata: {
          source: "legacy_synthetic",
        },
      };
      result.push(summaryEntry);
      continue;
    }

    const baseId = baseIdOf(coreMsg.id);
    if (emittedBaseIds.has(baseId)) continue;
    const original = input.mapping.entryByBaseId.get(baseId);
    if (original) {
      emittedBaseIds.add(baseId);
      const cloned = cloneRuntimeMessageEntry(original);
      if (!isRuntimeAttachmentEntry(cloned)) {
        if (cloned.message.role === "tool") {
          const toolCallId = cloned.message.toolCallId?.trim();
          if (toolCallId && !emittedToolCallIds.has(toolCallId)) {
            continue;
          }
        } else if (cloned.message.role === "assistant" && cloned.message.toolCalls?.length) {
          const keptToolCalls = cloned.message.toolCalls.filter((tc) =>
            pairedToolCallIds.has(tc.id.trim()),
          );
          if (keptToolCalls.length > 0) {
            cloned.message.toolCalls = keptToolCalls;
            for (const tc of keptToolCalls) {
              const id = tc.id.trim();
              if (id) emittedToolCallIds.add(id);
            }
          } else {
            delete cloned.message.toolCalls;
            if (!hasMeaningfulAssistantContent(cloned.message.content)) {
              continue;
            }
          }
        }
      }
      result.push(attachAcpTagToEntry(cloned, coreMsg.text));
      continue;
    }

    // 兜底：若 kernel 注入了合成提示或非原始条目，仅透传文本消息，避免未匹配的工具块降级为纯文本。
    if (
      coreMsg.contentType !== "tool-call" &&
      coreMsg.contentType !== "tool-result" &&
      (coreMsg.role === "system" || coreMsg.role === "user" || coreMsg.role === "assistant")
    ) {
      result.push({
        message: {
          role: coreMsg.role,
          content: coreMsg.text ?? "",
        },
        metadata: { source: "legacy_synthetic" },
      });
    }
  }

  let nudgeInjected = false;
  if (input.nudge?.shouldInject) {
    const rendered = renderNudgeText(input.nudge, undefined, undefined, input.protocol);
    if (rendered.text.trim()) {
      result.push({
        message: {
          role: "user",
          content: rendered.text,
        },
        metadata: {
          source: "legacy_synthetic",
        },
      });
      nudgeInjected = true;
    }
  }

  return { entries: result, nudgeInjected };
}
