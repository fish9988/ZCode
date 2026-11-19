import { modelMessageContentToText, type ModelMessageContent } from "@zcode/contracts";
import {
  isContextPrefixEntry,
  isRuntimeAttachmentEntry,
  type RuntimeMessageEntry,
} from "../agent/message-history.js";

/**
 * 移植自本地 Pi 扩展 `pi-dsh-compact`（基于 DSH `@deepseek-ai/dsh-compaction-basic`
 * + `compaction-tool-result-pruner` + Pi `<read-files>`/`<modified-files>` 双保险）：
 *
 * 1. 平时零开销：不改写日常请求、不破除 Prefix Cache，仅在触发压缩时运行。
 * 2. DSH 首尾工具裁剪：超 6,000 字符按 Unicode 码点保留头 4,096 + 尾 1,024 字符，保住日志末尾报错与退出码。
 * 3. 自动剥离 `<supermemory>...</supermemory>` 注入噪音。
 * 4. 序列化时忽略 thinking/reasoning 块，以独立无工具摘要请求发送 DSH 8 章节检查点模板，支持 `<compacted-summary>` 多代增量合并。
 * 5. 末尾自动追加去重排序后的 `<read-files>` 与 `<modified-files>` 双保险标签。
 */

export const DSH_PRUNE_THRESHOLD_CHARS = 6000;
export const DSH_PRUNE_HEAD_CHARS = 4096;
export const DSH_PRUNE_TAIL_CHARS = 1024;
export const DSH_PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";

export const DSH_SUMMARY_OPEN_TAG = "<compacted-summary>";
export const DSH_SUMMARY_CLOSE_TAG = "</compacted-summary>";

export const DSH_DEFAULT_SUMMARY_OUTPUT_TOKENS = 16_384;
export const DSH_MAX_SUMMARY_OUTPUT_TOKENS = 32_768;

export const DSH_SUMMARIZATION_SYSTEM_PROMPT =
  "You are a context summarization engine for an AI coding assistant. Your sole task is to condense the conversation into the exact structured checkpoint format requested. Do NOT continue the conversation, do NOT answer questions in the conversation, and do NOT call any tools.";

export const DSH_COMPACTION_INSTRUCTION = [
  "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  "",
  "## Primary Request and Intent",
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  "",
  "## Key Technical Concepts",
  "- [technologies, frameworks, patterns, and conventions in play]",
  "",
  "## Files and Code",
  "- [exact path: why it matters, key changes or snippets]",
  "",
  "## Errors and Fixes",
  "- [error: how it was resolved, plus any related user feedback]",
  "",
  "## Pending Jobs",
  "- [explicitly requested work not yet completed]",
  "",
  "## Current Work",
  "- [precisely what was in progress at this checkpoint]",
  "",
  "## Next Step",
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  "",
  "## Critical Context",
  "- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
  "",
  "Rules:",
  "- Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
  "- Capture user feedback and explicit instructions faithfully, especially corrections.",
  "- Do NOT mention this summarization request or that the context was compacted.",
  "- Output only the checkpoint text: do not call any tool or take any other action.",
  `- If the conversation already contains a ${DSH_SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join("\n");

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
const SUPERMEMORY_BLOCK_RE = /<supermemory>[\s\S]*?<\/supermemory>/gi;
const PRIOR_SUMMARY_HEADER_PREFIX =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";
const SYSTEM_REMINDER_FULL_RE = /^<system-reminder>[\s\S]*<\/system-reminder>$/i;

const READ_TOOL_NAMES = new Set(["read", "read_file", "fileread", "view_file", "viewfile"]);
const WRITE_TOOL_NAMES = new Set(["write", "write_file", "filewrite", "create_file", "createfile"]);
const EDIT_TOOL_NAMES = new Set([
  "edit",
  "edit_file",
  "fileedit",
  "multiedit",
  "multi_edit",
  "notebookedit",
  "notebook_edit",
  "replace_in_file",
  "str_replace_editor",
]);

export interface DshFileOperations {
  readonly read: Set<string>;
  readonly written: Set<string>;
  readonly edited: Set<string>;
}

export interface DshFileLists {
  readonly readFiles: string[];
  readonly modifiedFiles: string[];
}

export interface DshCompactSummaryRequest {
  readonly messages: [
    { readonly role: "system"; readonly content: string },
    { readonly role: "user"; readonly content: string },
  ];
  readonly fileLists: DshFileLists;
  readonly priorSummary?: string;
  readonly serializedConversation: string;
}

/**
 * 按 Unicode 码点执行 DSH 头+尾裁剪，绝不劈裂 UTF-16 代理对。
 */
export function pruneToolResultText(
  text: string,
  thresholdChars = DSH_PRUNE_THRESHOLD_CHARS,
  headChars = DSH_PRUNE_HEAD_CHARS,
  tailChars = DSH_PRUNE_TAIL_CHARS,
): string {
  if (text.length <= thresholdChars) return text;
  const codePoints = Array.from(text);
  if (codePoints.length <= thresholdChars) return text;
  const safeHead = Math.max(0, headChars);
  const safeTail = Math.max(0, tailChars);
  const head = codePoints.slice(0, safeHead).join("");
  const tail = safeTail > 0 ? codePoints.slice(codePoints.length - safeTail).join("") : "";
  return `${head}${DSH_PRUNE_MARKER}${tail}`;
}

/**
 * 剥离用户消息中由 Supermemory 等记忆插件附加的 `<supermemory>...</supermemory>` 背景块。
 */
export function stripSupermemoryBlocks(text: string): string {
  return text.replace(SUPERMEMORY_BLOCK_RE, "").trim();
}

function extractVisibleText(content: ModelMessageContent, stripMemory: boolean): string {
  // modelMessageContentToText 会跳过 reasoning/thinking 块，与 pi-dsh-compact 忽略 thinking 保持一致。
  const raw = modelMessageContentToText(content);
  return stripMemory ? stripSupermemoryBlocks(raw) : raw.trim();
}

function formatToolCallArgs(input: unknown): string {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>)
      .map(([k, v]) => {
        let serialized: string;
        try {
          serialized = JSON.stringify(v);
        } catch {
          serialized = String(v);
        }
        return `${k}=${serialized}`;
      })
      .join(", ");
  }
  if (input === undefined) return "";
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function stripPriorSummaryWrapper(text: string): string {
  let body = text.trim();
  const explicitMatch = body.match(/<compacted-summary>([\s\S]*?)<\/compacted-summary>/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }
  if (body.startsWith(PRIOR_SUMMARY_HEADER_PREFIX)) {
    body = body.slice(PRIOR_SUMMARY_HEADER_PREFIX.length).trim();
  }
  // 去掉 ZCode buildCompactSummaryMessage 追加的尾部续聊指令，避免旧续聊提示污染新一轮检查点。
  const trailerMarkers = [
    "\nContinue the conversation from where it left off without asking the user any further questions.",
    "\n\nThe messages after this summary are the most recent messages from before compaction",
    "\n\nIf you need specific details from before compaction",
    "\n\nYour REPL VM state has been cleared as part of this compaction",
  ];
  for (const marker of trailerMarkers) {
    const idx = body.indexOf(marker);
    if (idx >= 0) {
      body = body.slice(0, idx).trim();
    }
  }
  return body.trim();
}

function isPriorCompactSummaryEntry(entry: RuntimeMessageEntry): boolean {
  if (isRuntimeAttachmentEntry(entry)) return false;
  if (entry.metadata?.compactBoundary) return true;
  if (entry.message.role !== "user") return false;
  const text = modelMessageContentToText(entry.message.content).trimStart();
  return (
    text.startsWith(PRIOR_SUMMARY_HEADER_PREFIX) ||
    text.startsWith(DSH_SUMMARY_OPEN_TAG)
  );
}

/**
 * 将待压缩的 RuntimeMessageEntry 序列化为带 DSH 首尾裁剪的结构化纯文本对话（忽略 thinking 块）。
 */
export function serializeRuntimeEntriesForDshCompact(
  entries: readonly RuntimeMessageEntry[],
  options: { readonly skipEntry?: RuntimeMessageEntry } = {},
): string {
  const parts: string[] = [];

  for (const entry of entries) {
    if (entry === options.skipEntry) continue;
    if (isContextPrefixEntry(entry)) continue;
    if (isRuntimeAttachmentEntry(entry)) continue;

    const msg = entry.message;
    if (msg.role === "user") {
      const text = extractVisibleText(msg.content, true);
      if (!text || SYSTEM_REMINDER_FULL_RE.test(text)) continue;
      parts.push(`[User]: ${text}`);
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractVisibleText(msg.content, false);
      if (text) {
        parts.push(`[Assistant]: ${text}`);
      }
      if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        const calls = msg.toolCalls.map((tc) => `${tc.name}(${formatToolCallArgs(tc.input)})`);
        parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
      }
      continue;
    }

    if (msg.role === "tool") {
      const text = extractVisibleText(msg.content, false);
      if (!text) continue;
      const toolLabel = typeof msg.toolName === "string" && msg.toolName ? ` (${msg.toolName})` : "";
      const errorLabel = msg.isError ? " [ERROR]" : "";
      parts.push(`[Tool result${toolLabel}${errorLabel}]: ${pruneToolResultText(text)}`);
    }
  }

  return parts.join("\n\n");
}

function extractPathFromToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "filePath", "notebook_path", "target_file"]) {
    const val = rec[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

function collectApplyPatchPaths(input: unknown, written: Set<string>, edited: Set<string>): void {
  const raw =
    typeof input === "string"
      ? input
      : input && typeof input === "object"
        ? String((input as Record<string, unknown>).patch ?? (input as Record<string, unknown>).input ?? "")
        : "";
  if (!raw) return;
  for (const line of raw.split(/\r?\n/)) {
    const addMatch = line.match(/^\*\*\*\s+Add File:\s*(.+)$/);
    if (addMatch?.[1]?.trim()) {
      written.add(addMatch[1].trim());
      continue;
    }
    const updateMatch = line.match(/^\*\*\*\s+(?:Update|Delete) File:\s*(.+)$/);
    if (updateMatch?.[1]?.trim()) {
      edited.add(updateMatch[1].trim());
    }
  }
}

function parseTagPaths(text: string, tag: "read-files" | "modified-files", target: Set<string>): void {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of text.matchAll(re)) {
    const body = match[1] ?? "";
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) target.add(trimmed);
    }
  }
}

/**
 * 收集被压缩历史中的文件读写集合（并沿袭上一代 `<read-files>` / `<modified-files>` 记录）。
 */
export function collectFileOperationsFromRuntimeEntries(
  entries: readonly RuntimeMessageEntry[],
  priorSummaryText?: string,
): DshFileOperations {
  const read = new Set<string>();
  const written = new Set<string>();
  const edited = new Set<string>();

  if (priorSummaryText) {
    parseTagPaths(priorSummaryText, "read-files", read);
    parseTagPaths(priorSummaryText, "modified-files", edited);
  }

  for (const entry of entries) {
    if (isRuntimeAttachmentEntry(entry)) continue;
    if (entry.message.role !== "assistant" || !Array.isArray(entry.message.toolCalls)) continue;

    for (const tc of entry.message.toolCalls) {
      const normalized = tc.name.trim().toLowerCase();
      if (normalized === "apply_patch" || normalized === "applypatch") {
        collectApplyPatchPaths(tc.input, written, edited);
        continue;
      }
      const filePath = extractPathFromToolInput(tc.input);
      if (!filePath) continue;
      if (READ_TOOL_NAMES.has(normalized)) {
        read.add(filePath);
      } else if (WRITE_TOOL_NAMES.has(normalized)) {
        written.add(filePath);
      } else if (EDIT_TOOL_NAMES.has(normalized)) {
        edited.add(filePath);
      }
    }
  }

  return { read, written, edited };
}

export function computeDshFileLists(fileOps: {
  readonly read?: ReadonlySet<string>;
  readonly written?: ReadonlySet<string>;
  readonly edited?: ReadonlySet<string>;
}): DshFileLists {
  const edited = fileOps.edited ?? new Set<string>();
  const written = fileOps.written ?? new Set<string>();
  const read = fileOps.read ?? new Set<string>();
  const modified = new Set<string>([...edited, ...written]);
  const readFiles = [...read].filter((f) => !modified.has(f) && !IMAGE_FILE_RE.test(f)).sort();
  const modifiedFiles = [...modified].sort();
  return { readFiles, modifiedFiles };
}

export function formatDshFileOperations(
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

export function appendDshFileOperationsToSummary(summary: string, fileLists: DshFileLists): string {
  const trimmed = summary.trim();
  if (!trimmed) return trimmed;
  const needRead = fileLists.readFiles.length > 0 && !/<read-files>/i.test(trimmed);
  const needMod = fileLists.modifiedFiles.length > 0 && !/<modified-files>/i.test(trimmed);
  const suffix = formatDshFileOperations(
    needRead ? fileLists.readFiles : [],
    needMod ? fileLists.modifiedFiles : [],
  );
  return suffix ? `${trimmed}${suffix}` : trimmed;
}

/**
 * 构造 `pi-dsh-compact` 风格的独立无工具压缩请求（System + 单条 User 文本）。
 */
export function buildDshCompactSummaryRequest(input: {
  readonly entriesForSummary: readonly RuntimeMessageEntry[];
  readonly customInstructions?: string;
}): DshCompactSummaryRequest {
  const priorEntry = input.entriesForSummary.find(isPriorCompactSummaryEntry);
  const priorSummaryRaw =
    priorEntry && !isRuntimeAttachmentEntry(priorEntry)
      ? modelMessageContentToText(priorEntry.message.content)
      : undefined;
  const priorSummary = priorSummaryRaw ? stripPriorSummaryWrapper(priorSummaryRaw) : undefined;

  const serializedConversation = serializeRuntimeEntriesForDshCompact(input.entriesForSummary, {
    skipEntry: priorEntry,
  });

  const chunks: string[] = [];
  if (priorSummary) {
    chunks.push(`${DSH_SUMMARY_OPEN_TAG}\n${priorSummary}\n${DSH_SUMMARY_CLOSE_TAG}`);
  }
  if (serializedConversation) {
    chunks.push(`<conversation>\n${serializedConversation}\n</conversation>`);
  }
  let instruction = DSH_COMPACTION_INSTRUCTION;
  if (input.customInstructions?.trim()) {
    instruction += `\n\nAdditional user focus: ${input.customInstructions.trim()}`;
  }
  chunks.push(instruction);

  const fileOps = collectFileOperationsFromRuntimeEntries(input.entriesForSummary, priorSummaryRaw);
  const fileLists = computeDshFileLists(fileOps);

  return {
    messages: [
      { role: "system", content: DSH_SUMMARIZATION_SYSTEM_PROMPT },
      { role: "user", content: chunks.join("\n\n") },
    ],
    fileLists,
    ...(priorSummary ? { priorSummary } : {}),
    serializedConversation,
  };
}

/**
 * 对应 `pi-dsh-compact` 的摘要输出上限策略：`min(modelMaxTokens || 16384, 32768)`。
 */
export function resolveDshSummaryMaxOutputTokens(modelMaxOutputTokens: number | undefined): number {
  const base =
    typeof modelMaxOutputTokens === "number" &&
    Number.isFinite(modelMaxOutputTokens) &&
    modelMaxOutputTokens > 0
      ? Math.floor(modelMaxOutputTokens)
      : DSH_DEFAULT_SUMMARY_OUTPUT_TOKENS;
  return Math.min(base, DSH_MAX_SUMMARY_OUTPUT_TOKENS);
}
