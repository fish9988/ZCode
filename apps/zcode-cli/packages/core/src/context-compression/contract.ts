import type { Model, SessionEntryInfo, SessionId, SessionStorePort } from "@zcode/contracts";
import type { RuntimeMessageEntry } from "../agent/message-history.js";
import type { AutoCompactPolicyConfig } from "../compact/policy.js";

export const SESSION_ENTRY_ACP_COMPRESSION_STATE = "runtime/acp_compression_state" as const;

export const ACP_CONTEXT_TOOL_NAMES = [
  "compress",
  "decompress",
  "search_context",
  "acp_status",
] as const;

export interface AcpCompressToolResult {
  readonly ok: boolean;
  readonly blocksCreated: number;
  readonly tokensCompressed: number;
  readonly summaryText: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface AcpDecompressToolResult {
  readonly ok: boolean;
  readonly blockId: string;
  readonly mode: "inline" | "file";
  readonly filePath?: string;
  readonly content: string;
  readonly messageCount: number;
  readonly error?: string;
}

export interface AcpSearchContextToolResult {
  readonly ok: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly summaryText: string;
}

export interface AcpStatusToolResult {
  readonly ok: boolean;
  readonly report: string;
}

/** 供内置 ACP 工具（compress / decompress / search_context / acp_status）调用的会话级上下文压缩端口。 */
export interface AcpContextCompressionPort {
  executeCompress(input: unknown, toolCallId?: string): Promise<AcpCompressToolResult>;
  executeDecompress(input: {
    readonly blockId: string;
    readonly toFile?: boolean;
    readonly full?: boolean;
  }): Promise<AcpDecompressToolResult>;
  executeSearchContext(input: {
    readonly query: string;
    readonly limit?: number;
  }): Promise<AcpSearchContextToolResult>;
  executeStatus(input: {
    readonly scope?: "compressed" | "uncompressed";
    readonly view?: "ranges" | "messages";
    readonly tool?: string;
    readonly sort?: "size" | "time" | "tool" | "age";
    readonly limit?: number;
  }): Promise<AcpStatusToolResult>;
}

export interface AcpPrepareTurnInput {
  readonly entries: readonly RuntimeMessageEntry[];
  readonly model: Model;
  readonly compactConfig?: AutoCompactPolicyConfig;
  readonly tokenCount: number;
  readonly tokenCountSource?: "usage" | "estimate";
}

export interface AcpPrepareTurnResult {
  readonly entries: RuntimeMessageEntry[];
  readonly nudgeInjected: boolean;
  readonly activeBlockCount: number;
}

export interface AcpSessionController extends AcpContextCompressionPort {
  isEnabled(): boolean;
  loadFromStore(sessionStore: SessionStorePort | undefined, branchGeneration: number): Promise<void>;
  resetForRewind(sessionStore: SessionStorePort | undefined, branchGeneration: number): Promise<void>;
  buildForkEntry(forkedSessionId: SessionId): SessionEntryInfo | null;
  prepareTurnEntries(
    input: AcpPrepareTurnInput,
    sessionStore?: SessionStorePort,
  ): Promise<AcpPrepareTurnResult>;
}
