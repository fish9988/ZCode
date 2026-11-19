#!/usr/bin/env node
/**
 * 从上游 ranxianglei/billion-context 同步只读 kernel/ 镜像到 vendor/acp-kernel/。
 * 用法：
 *   pnpm run sync:acp-kernel                # 同步 master 最新提交
 *   pnpm run sync:acp-kernel -- --ref v0.1.216
 *   pnpm run sync:acp-kernel -- --skip-test
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const UPSTREAM_REPO = "ranxianglei/billion-context";
const repoRoot = resolve(import.meta.dirname, "..");
const targetDir = resolve(repoRoot, "vendor", "acp-kernel");

function parseArgs(argv) {
  let ref = "master";
  let skipTest = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref" && argv[i + 1]) {
      ref = argv[++i];
    } else if (arg === "--skip-test") {
      skipTest = true;
    }
  }
  return { ref, skipTest };
}

function resolveGithubToken() {
  const fromEnv = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function resolveUpstreamCommit(ref, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zcode-sync-acp-kernel",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${encodeURIComponent(ref)}`,
      { headers },
    );
    if (response.ok) {
      const info = await response.json();
      return {
        commitSha: info.sha,
        commitDate: info.commit?.committer?.date ?? new Date().toISOString(),
      };
    }
  } catch {
    // 回退 git ls-remote，避免匿名 GitHub API 限流。
  }
  const out = execFileSync(
    "git",
    ["ls-remote", `https://github.com/${UPSTREAM_REPO}.git`, ref, `refs/heads/${ref}`, `refs/tags/${ref}`],
    { encoding: "utf8" },
  ).trim();
  const firstLine = out.split(/\r?\n/u).find(Boolean);
  const sha = firstLine?.split(/\s+/u)[0];
  if (!sha || !/^[0-9a-f]{40}$/iu.test(sha)) {
    throw new Error(`Unable to resolve ${UPSTREAM_REPO}@${ref} via GitHub API or git ls-remote`);
  }
  return { commitSha: sha, commitDate: new Date().toISOString() };
}

async function main() {
  const { ref, skipTest } = parseArgs(process.argv.slice(2));
  const token = resolveGithubToken();
  console.log(`[sync:acp-kernel] resolving ${UPSTREAM_REPO}@${ref} ...`);
  const { commitSha, commitDate } = await resolveUpstreamCommit(ref, token);
  console.log(`[sync:acp-kernel] commit=${commitSha.slice(0, 12)} date=${commitDate}`);

  const workDir = mkdtempSync(join(tmpdir(), "zcode-acp-kernel-sync-"));
  const tarballPath = join(workDir, "upstream.tar.gz");
  const extractDir = join(workDir, "extracted");
  mkdirSync(extractDir, { recursive: true });

  try {
    const tarballUrl = `https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/${commitSha}`;
    console.log(`[sync:acp-kernel] downloading ${tarballUrl} ...`);
    const res = await fetch(tarballUrl, {
      headers: { "User-Agent": "zcode-sync-acp-kernel" },
    });
    if (!res.ok) {
      throw new Error(`Failed to download tarball: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(tarballPath, buffer);

    const archiveRoot = `billion-context-${commitSha}`;
    execFileSync(
      "tar",
      [
        "-xzf",
        tarballPath,
        "-C",
        extractDir,
        "--strip-components=1",
        `${archiveRoot}/kernel`,
        `${archiveRoot}/LICENSE`,
      ],
      { stdio: "inherit" },
    );

    const upstreamKernelDir = join(extractDir, "kernel");
    if (!existsSync(join(upstreamKernelDir, "package.json"))) {
      throw new Error("Upstream archive missing kernel/package.json");
    }

    const upstreamPkg = JSON.parse(readFileSync(join(upstreamKernelDir, "package.json"), "utf8"));
    const upstreamLicense = existsSync(join(extractDir, "LICENSE"))
      ? readFileSync(join(extractDir, "LICENSE"), "utf8")
      : null;

    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });

    for (const rel of ["src", "tests", "tsconfig.json", "README.md", "DESIGN.md", "PROVENANCE.md"]) {
      const from = join(upstreamKernelDir, rel);
      if (existsSync(from)) {
        cpSync(from, join(targetDir, rel), { recursive: true });
      }
    }
    if (upstreamLicense) {
      writeFileSync(join(targetDir, "LICENSE"), upstreamLicense, "utf8");
    } else if (existsSync(join(upstreamKernelDir, "LICENSE"))) {
      cpSync(join(upstreamKernelDir, "LICENSE"), join(targetDir, "LICENSE"));
    }

    // 保留纯零运行时依赖与标准导出，使 tsc 构建直接产出 dist/*.js + dist/*.d.ts（兼容 pnpm workspace + esbuild）。
    const syncedPackageJson = {
      name: upstreamPkg.name ?? "acp-kernel",
      version: upstreamPkg.version,
      private: true,
      description: upstreamPkg.description,
      license: upstreamPkg.license ?? "MIT",
      author: upstreamPkg.author ?? "ranxianglei",
      type: "module",
      homepage: upstreamPkg.homepage,
      repository: upstreamPkg.repository,
      main: "./dist/index.js",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: upstreamPkg.exports ?? {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      },
      sideEffects: false,
      scripts: {
        clean: "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
        build: "tsc -p tsconfig.build.json",
        typecheck: "tsc --noEmit",
        test: "node --import tsx --test tests/*.test.ts",
      },
      engines: upstreamPkg.engines ?? { node: ">=20" },
    };
    writeFileSync(
      join(targetDir, "package.json"),
      `${JSON.stringify(syncedPackageJson, null, 2)}\n`,
      "utf8",
    );

    const buildTsconfig = {
      extends: "./tsconfig.json",
      compilerOptions: {
        outDir: "./dist",
        rootDir: "./src",
        declaration: true,
        declarationMap: true,
        emitDeclarationOnly: false,
        noEmit: false,
        skipLibCheck: true,
        types: ["node"],
        typeRoots: ["../../node_modules/@types"],
      },
      include: ["src/**/*"],
      exclude: ["tests", "dist", "node_modules"],
    };
    writeFileSync(
      join(targetDir, "tsconfig.build.json"),
      `${JSON.stringify(buildTsconfig, null, 2)}\n`,
      "utf8",
    );

    const syncMeta = {
      upstreamRepo: UPSTREAM_REPO,
      requestedRef: ref,
      commitSha,
      commitDate,
      kernelVersion: upstreamPkg.version,
      syncedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(targetDir, "UPSTREAM_SYNC.json"),
      `${JSON.stringify(syncMeta, null, 2)}\n`,
      "utf8",
    );

    console.log(`[sync:acp-kernel] building vendor/acp-kernel@${upstreamPkg.version} ...`);
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "tsc", "-p", join(targetDir, "tsconfig.build.json")],
      { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" },
    );

    if (!skipTest) {
      console.log("[sync:acp-kernel] running upstream acp-kernel unit tests ...");
      const tsxBin = resolve(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
      execFileSync(
        process.execPath,
        [tsxBin, "--test", "tests/*.test.ts"],
        { cwd: targetDir, stdio: "inherit" },
      );
    }

    console.log(
      `[sync:acp-kernel] done: acp-kernel@${upstreamPkg.version} (${commitSha.slice(0, 12)})`,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(`[sync:acp-kernel] failed:`, error);
  process.exit(1);
});
