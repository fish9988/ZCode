import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createBuildTimeConfigDefines, resolveBuildTimeConfig } from "../build-time-config.mjs";

const dir = await mkdtemp(join(tmpdir(), "zcode-build-time-config-"));
after(() => rm(dir, { recursive: true, force: true }));

async function writeDefaults(name, content) {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

/** 更新源默认值与「保持上游行为」的其余开关；避免每个用例重复整段字面量。 */
const DEFAULT_UPDATE_SOURCE = {
  updateProvider: "manifest",
  updateGithubOwner: "",
  updateGithubRepo: "",
  updateAllowUnsignedWindows: false,
  updateForceGateEnabled: true,
};

test("没有私有默认配置也没有环境变量时三项能力都关闭", async () => {
  const config = await resolveBuildTimeConfig({}, { defaultsPath: join(dir, "missing.json") });
  assert.deepEqual(config, {
    armsRumEndpoint: "",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: false,
    ...DEFAULT_UPDATE_SOURCE,
  });
});

test("私有默认配置启用三项能力", async () => {
  const defaultsPath = await writeDefaults("defaults.json", {
    ZCODE_ARMS_RUM_ENDPOINT: " https://rum.example.com/x ",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    ZCODE_AUTO_UPDATE: "1",
  });
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), {
    armsRumEndpoint: "https://rum.example.com/x",
    telemetryReportEndpoint: "https://report.example.com/event",
    autoUpdateEnabled: true,
    ...DEFAULT_UPDATE_SOURCE,
  });
});

test("环境变量优先于私有默认配置，显式空字符串关闭单项能力", async () => {
  const defaultsPath = await writeDefaults("override.json", {
    ZCODE_ARMS_RUM_ENDPOINT: "https://rum.example.com/x",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    ZCODE_AUTO_UPDATE: "true",
  });
  const config = await resolveBuildTimeConfig(
    {
      ZCODE_ARMS_RUM_ENDPOINT: "",
      ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://other.example.com/event",
      ZCODE_AUTO_UPDATE: "0",
    },
    { defaultsPath },
  );
  assert.deepEqual(config, {
    armsRumEndpoint: "",
    telemetryReportEndpoint: "https://other.example.com/event",
    autoUpdateEnabled: false,
    ...DEFAULT_UPDATE_SOURCE,
  });
});

test("私有默认配置格式错误时直接报错，不静默关闭", async () => {
  const defaultsPath = await writeDefaults("broken.json", "[1]");
  await assert.rejects(resolveBuildTimeConfig({}, { defaultsPath }), /必须是 JSON 对象/);
});

test("github 更新源解析 owner/repo 并允许放宽签名与关闭强更 gate", async () => {
  const config = await resolveBuildTimeConfig({
    ZCODE_UPDATE_PROVIDER: "GitHub",
    ZCODE_UPDATE_GITHUB_REPO: "fish9988/ZCode",
    ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS: "1",
    ZCODE_UPDATE_FORCE_GATE: "0",
  });
  assert.equal(config.updateProvider, "github");
  assert.equal(config.updateGithubOwner, "fish9988");
  assert.equal(config.updateGithubRepo, "ZCode");
  assert.equal(config.updateAllowUnsignedWindows, true);
  assert.equal(config.updateForceGateEnabled, false);
});

test("github 源必须提供合法 owner/repo", async () => {
  await assert.rejects(
    resolveBuildTimeConfig({ ZCODE_UPDATE_PROVIDER: "github" }),
    /ZCODE_UPDATE_GITHUB_REPO is required/,
  );
  await assert.rejects(
    resolveBuildTimeConfig({
      ZCODE_UPDATE_PROVIDER: "github",
      ZCODE_UPDATE_GITHUB_REPO: "not-a-repo",
    }),
    /invalid ZCODE_UPDATE_GITHUB_REPO/,
  );
});

test("未知 provider 与非法强更取值不被静默接受", async () => {
  await assert.rejects(
    resolveBuildTimeConfig({ ZCODE_UPDATE_PROVIDER: "oss" }),
    /invalid ZCODE_UPDATE_PROVIDER/,
  );
  // 只有显式 0/false/no 才关闭 gate，其它拼写保持开启，避免误配置后失去强更保护。
  const config = await resolveBuildTimeConfig({ ZCODE_UPDATE_FORCE_GATE: "off" });
  assert.equal(config.updateForceGateEnabled, true);
});

test("define 以 JSON 字面量注入", () => {
  assert.deepEqual(
    createBuildTimeConfigDefines({
      armsRumEndpoint: "https://rum.example.com/x",
      telemetryReportEndpoint: "",
      autoUpdateEnabled: true,
      ...DEFAULT_UPDATE_SOURCE,
    }),
    {
      __ZCODE_ARMS_RUM_ENDPOINT__: '"https://rum.example.com/x"',
      __ZCODE_TELEMETRY_REPORT_ENDPOINT__: '""',
      __ZCODE_AUTO_UPDATE_ENABLED__: "true",
      __ZCODE_UPDATE_PROVIDER__: '"manifest"',
      __ZCODE_UPDATE_GITHUB_OWNER__: '""',
      __ZCODE_UPDATE_GITHUB_REPO__: '""',
      __ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS__: "false",
      __ZCODE_UPDATE_FORCE_GATE_ENABLED__: "true",
    },
  );
});
