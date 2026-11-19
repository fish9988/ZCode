import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 桌面构建期可选能力的唯一解析入口：ARMS RUM 上报、事件上报、自动更新及其更新源。
 * 优先级：构建进程环境变量 > config/private/build-defaults.json（仅内部仓库存在）> 关闭。
 * 规则见 docs/desktop/build-time-optional-capabilities.md 与 docs/desktop/fork-auto-update.md。
 */
export const PRIVATE_BUILD_DEFAULTS_PATH = resolve(
  import.meta.dirname,
  "../config/private/build-defaults.json",
);

const ENABLED_VALUES = new Set(["1", "true", "yes"]);
const DISABLED_VALUES = new Set(["0", "false", "no"]);

/** 更新源：默认沿用服务端 manifest；`github` 用于 fork 自建分发（见 docs/desktop/fork-auto-update.md）。 */
export const UPDATE_PROVIDER_MANIFEST = "manifest";
export const UPDATE_PROVIDER_GITHUB = "github";
const UPDATE_PROVIDERS = new Set([UPDATE_PROVIDER_MANIFEST, UPDATE_PROVIDER_GITHUB]);

function resolveUpdateProvider(rawValue) {
  const value = rawValue.trim().toLowerCase() || UPDATE_PROVIDER_MANIFEST;
  if (!UPDATE_PROVIDERS.has(value)) {
    throw new Error(
      `invalid ZCODE_UPDATE_PROVIDER=${rawValue}; expected ${[...UPDATE_PROVIDERS].join(" or ")}`,
    );
  }
  return value;
}

/**
 * `owner/repo` 必须能在构建期完整解析，否则产物里的 app-update.yml 会指向一个无效仓库，
 * 客户端只会在运行时反复刷新失败。
 */
function resolveUpdateGithubRepository(rawValue, { required }) {
  const value = rawValue.trim();
  if (!value) {
    if (required) {
      throw new Error("ZCODE_UPDATE_GITHUB_REPO is required when ZCODE_UPDATE_PROVIDER=github");
    }
    return { owner: "", repo: "" };
  }

  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u);
  if (!match) {
    throw new Error(`invalid ZCODE_UPDATE_GITHUB_REPO=${rawValue}; expected owner/repo`);
  }
  return { owner: match[1], repo: match[2].replace(/\.git$/u, "") };
}

async function readPrivateDefaults(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`构建期私有默认配置必须是 JSON 对象：${path}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function pickValue(env, defaults, key) {
  // 环境变量显式设置（包括空字符串）时优先，空字符串表示关闭该项能力
  if (typeof env[key] === "string") return env[key].trim();
  const value = defaults[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveBuildTimeConfig(
  env = process.env,
  { defaultsPath = PRIVATE_BUILD_DEFAULTS_PATH } = {},
) {
  const defaults = await readPrivateDefaults(defaultsPath);
  const updateProvider = resolveUpdateProvider(pickValue(env, defaults, "ZCODE_UPDATE_PROVIDER"));
  const updateGithubRepository = resolveUpdateGithubRepository(
    pickValue(env, defaults, "ZCODE_UPDATE_GITHUB_REPO"),
    { required: updateProvider === UPDATE_PROVIDER_GITHUB },
  );
  return {
    armsRumEndpoint: pickValue(env, defaults, "ZCODE_ARMS_RUM_ENDPOINT"),
    telemetryReportEndpoint: pickValue(env, defaults, "ZCODE_TELEMETRY_REPORT_ENDPOINT"),
    autoUpdateEnabled: ENABLED_VALUES.has(
      pickValue(env, defaults, "ZCODE_AUTO_UPDATE").toLowerCase(),
    ),
    updateProvider,
    updateGithubOwner: updateGithubRepository.owner,
    updateGithubRepo: updateGithubRepository.repo,
    // fork 没有代码签名证书，需要显式打开才能安装无签名更新包；默认保持上游的强制签名校验。
    updateAllowUnsignedWindows: ENABLED_VALUES.has(
      pickValue(env, defaults, "ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS").toLowerCase(),
    ),
    // 强制升级 gate 默认开启；只有显式 0/false/no 才关闭，避免空字符串被误读成关闭。
    updateForceGateEnabled: !DISABLED_VALUES.has(
      pickValue(env, defaults, "ZCODE_UPDATE_FORCE_GATE").toLowerCase(),
    ),
  };
}

export function createBuildTimeConfigDefines(config) {
  return {
    __ZCODE_ARMS_RUM_ENDPOINT__: JSON.stringify(config.armsRumEndpoint),
    __ZCODE_TELEMETRY_REPORT_ENDPOINT__: JSON.stringify(config.telemetryReportEndpoint),
    __ZCODE_AUTO_UPDATE_ENABLED__: JSON.stringify(config.autoUpdateEnabled),
    __ZCODE_UPDATE_PROVIDER__: JSON.stringify(config.updateProvider),
    __ZCODE_UPDATE_GITHUB_OWNER__: JSON.stringify(config.updateGithubOwner),
    __ZCODE_UPDATE_GITHUB_REPO__: JSON.stringify(config.updateGithubRepo),
    __ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS__: JSON.stringify(config.updateAllowUnsignedWindows),
    __ZCODE_UPDATE_FORCE_GATE_ENABLED__: JSON.stringify(config.updateForceGateEnabled),
  };
}
