import { accessSync, constants as fsConstants } from "node:fs";
import { win32 } from "node:path";
import type { IntegratedTerminalShellOption } from "@zcode/shared";

type ExecutableCheck = (path: string) => boolean;

const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
] as const;

export function listIntegratedTerminalShellOptions(options: {
  env: NodeJS.ProcessEnv;
  isExecutable?: ExecutableCheck;
  platform: NodeJS.Platform;
}): IntegratedTerminalShellOption[] {
  if (options.platform !== "win32") {
    return [];
  }

  const shellOptions: IntegratedTerminalShellOption[] = [];

  const pwsh = resolveWindowsPwsh(options.env, options.isExecutable);
  if (pwsh) {
    shellOptions.push({
      dialect: "powershell",
      id: `powershell:${pwsh.path}`,
      label: "PowerShell 7",
      path: pwsh.path,
      source: pwsh.source,
    });
  }

  const winPowershell = resolveWindowsPowerShell(options.env, options.isExecutable);
  if (winPowershell) {
    shellOptions.push({
      dialect: "powershell",
      id: `powershell:${winPowershell.path}`,
      label: "Windows PowerShell",
      path: winPowershell.path,
      source: winPowershell.source,
    });
  }

  const gitBash = resolveWindowsGitBash(options.env, options.isExecutable);
  if (gitBash) {
    shellOptions.push({
      dialect: "git-bash",
      id: `git-bash:${gitBash.path}`,
      label: "Git Bash",
      path: gitBash.path,
      source: gitBash.source,
    });
  }

  shellOptions.push(createCommandPromptOption(options.env));

  return shellOptions;
}

function createCommandPromptOption(env: NodeJS.ProcessEnv): IntegratedTerminalShellOption {
  const path = getWindowsEnvValue(env, "ComSpec")?.trim() || "cmd.exe";
  return {
    dialect: "cmd",
    id: `cmd:${path}`,
    label: "CMD",
    path,
    source: "system",
  };
}

function resolveWindowsPwsh(
  env: NodeJS.ProcessEnv,
  isExecutable?: ExecutableCheck,
): { path: string; source: "system" | "path" } | undefined {
  const localAppData = getWindowsEnvValue(env, "LOCALAPPDATA")?.trim();
  const programFiles = getWindowsEnvValue(env, "ProgramFiles")?.trim() || "C:\\Program Files";
  const programFilesX86 =
    getWindowsEnvValue(env, "ProgramFiles(x86)")?.trim() || "C:\\Program Files (x86)";
  const fixedCandidates = [
    win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    win32.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
    ...(localAppData ? [win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe")] : []),
  ];

  for (const candidate of fixedCandidates) {
    if (isExecutableCandidate(candidate, isExecutable)) {
      return { path: candidate, source: "system" };
    }
  }

  const fromPath = windowsExecutableCandidates("pwsh", env).find((candidate) =>
    isExecutableCandidate(candidate, isExecutable),
  );
  return fromPath ? { path: fromPath, source: "path" } : undefined;
}

function resolveWindowsPowerShell(
  env: NodeJS.ProcessEnv,
  isExecutable?: ExecutableCheck,
): { path: string; source: "system" | "path" } | undefined {
  const systemRoot = getWindowsEnvValue(env, "SystemRoot")?.trim() || "C:\\Windows";
  const systemPath = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (isExecutableCandidate(systemPath, isExecutable)) {
    return { path: systemPath, source: "system" };
  }

  const fromPath = windowsExecutableCandidates("powershell", env).find((candidate) =>
    isExecutableCandidate(candidate, isExecutable),
  );
  return fromPath ? { path: fromPath, source: "path" } : undefined;
}

function resolveWindowsGitBash(
  env: NodeJS.ProcessEnv,
  isExecutable?: ExecutableCheck,
): { path: string; source: "system" | "path" } | undefined {
  for (const candidate of WINDOWS_GIT_BASH_PATHS) {
    if (isExecutableCandidate(candidate, isExecutable)) {
      return { path: candidate, source: "system" };
    }
  }

  const gitExe = windowsExecutableCandidates("git", env).find((candidate) =>
    isExecutableCandidate(candidate, isExecutable),
  );
  if (!gitExe) {
    return undefined;
  }

  const inferred = inferWindowsGitBashPathsFromGitExe(gitExe).find((candidate) =>
    isExecutableCandidate(candidate, isExecutable),
  );
  return inferred ? { path: inferred, source: "path" } : undefined;
}

function inferWindowsGitBashPathsFromGitExe(gitExe: string): string[] {
  const gitDir = win32.dirname(gitExe);
  return [
    win32.normalize(win32.join(gitDir, "..", "bin", "bash.exe")),
    win32.normalize(win32.join(gitDir, "..", "..", "bin", "bash.exe")),
  ];
}

function windowsExecutableCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (/[\\/]/.test(command)) {
    return [command];
  }

  const pathValue = getWindowsEnvValue(env, "PATH");
  if (!pathValue) {
    return [command];
  }

  const extensions = windowsExecutableExtensions(env);
  return pathValue
    .split(win32.delimiter)
    .filter((entry) => entry.trim().length > 0)
    .flatMap((entry) => extensions.map((extension) => win32.join(entry, `${command}${extension}`)));
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const rawExtensions = getWindowsEnvValue(env, "PATHEXT")?.split(win32.delimiter) ?? [
    ".COM",
    ".EXE",
    ".BAT",
    ".CMD",
  ];
  const normalized = rawExtensions
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0);
  return normalized.includes(".exe") ? normalized : [".exe", ...normalized];
}

function getWindowsEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const lowerKey = key.toLowerCase();
  const match = Object.keys(env).find((envKey) => envKey.toLowerCase() === lowerKey);
  return match ? env[match] : undefined;
}

function isExecutableCandidate(path: string, isExecutable?: ExecutableCheck): boolean {
  if (isExecutable) {
    return isExecutable(path);
  }

  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
