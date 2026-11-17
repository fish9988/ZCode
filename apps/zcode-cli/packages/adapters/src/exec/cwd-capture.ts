import { mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitBashPathToWindowsPath,
  type ExecutionCommand,
  type ExecutionRequest,
  type ExecutionShellDialect,
  windowsPathToGitBashPath,
} from "@zcode/contracts";

export interface CwdCapturePlan {
  command: ExecutionCommand;
  cwdFilePath?: string;
}

export function createCwdCapturePlan(
  request: ExecutionRequest,
  options: {
    dialect: ExecutionShellDialect;
    platform: NodeJS.Platform;
  },
): CwdCapturePlan {
  if (request.captureCwdAfterSuccess !== true || request.command.mode !== "shell") {
    return { command: request.command };
  }

  const cwdCaptureDir = tmpdir();
  mkdirSync(cwdCaptureDir, { recursive: true });
  const cwdFilePath = join(cwdCaptureDir, `zcode-${crypto.randomUUID()}-cwd`);

  // 每次 Bash 仍启动新 shell；成功后只把最终 pwd -P 写回主进程，不能持久化 env/alias/function。
  // 默认 shell、hooks、background command 不走这个分支，避免改变其它执行面。
  const wrappedCommand =
    options.dialect === "cmd"
      ? createWindowsCmdCwdCaptureCommand(request.command.command, cwdFilePath)
      : options.dialect === "powershell"
        ? createPowerShellCwdCaptureCommand(request.command.command, cwdFilePath)
        : createPosixCwdCaptureCommand(
            request.command.command,
            options.dialect === "git-bash" ? windowsPathToGitBashPath(cwdFilePath) : cwdFilePath,
          );

  return {
    command: {
      ...request.command,
      command: wrappedCommand,
    },
    cwdFilePath,
  };
}

function createPosixCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    "__zcode_status=$?",
    `if [ "$__zcode_status" -eq 0 ]; then pwd -P > ${shellQuote(cwdFilePath)}; fi`,
    'exit "$__zcode_status"',
  ].join("\n");
}

function createWindowsCmdCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    'set "__zcode_status=%ERRORLEVEL%"',
    `if "%__zcode_status%"=="0" cd > ${cmdQuote(cwdFilePath)}`,
    "exit /b %__zcode_status%",
  ].join("\r\n");
}

function createPowerShellCwdCaptureCommand(command: string, cwdFilePath: string): string {
  const escapedPath = cwdFilePath.replaceAll("'", "''");
  return [
    "$global:LASTEXITCODE = 0",
    "$__zcode_user_ok = $true",
    "try {",
    command,
    "  $__zcode_user_ok = $?",
    "} catch {",
    "  [Console]::Error.WriteLine($_.ToString())",
    "  $__zcode_user_ok = $false",
    "  if ($LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }",
    "} finally {",
    "  $__zcode_exit = if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } elseif ($__zcode_user_ok) { 0 } else { 1 }",
    "  if ($__zcode_exit -eq 0) {",
    `    [System.IO.File]::WriteAllText('${escapedPath}', (Get-Location).Path, [System.Text.UTF8Encoding]::new($false))`,
    "  }",
    "}",
    "exit $__zcode_exit",
  ].join("\n");
}

export function readCapturedCwd(
  cwdFilePath: string | undefined,
  options: { dialect: ExecutionShellDialect },
): string | undefined {
  if (!cwdFilePath) return undefined;
  try {
    const value = readFileSync(cwdFilePath, "utf8").replace(/\r?\n$/u, "");
    if (!value) return undefined;
    const hostValue = normalizeCapturedCwdForHost(value, options.dialect);
    const stats = statSync(hostValue);
    if (!stats.isDirectory()) return undefined;
    return realpathSync(hostValue);
  } catch {
    return undefined;
  } finally {
    try {
      unlinkSync(cwdFilePath);
    } catch {
      // cwd 捕获只影响内部会话状态，清理失败不能影响工具结果。
    }
  }
}

export function normalizeCapturedCwdForHost(
  value: string,
  dialect: ExecutionShellDialect,
): string {
  return dialect === "git-bash" ? gitBashPathToWindowsPath(value) : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
