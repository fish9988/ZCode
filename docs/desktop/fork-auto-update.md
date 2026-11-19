# Fork 构建的自动更新（GitHub Releases）

## 背景

上游正式客户端的自动更新走 ZCode 服务端 manifest 接口（见
[桌面端服务端 Manifest 自动更新](./auto-update-service-manifest.md)），发布授权由官方 HTTPS
入口决定。`packages/desktop/src/main/autoUpdater.ts` 在打包态把更新源 origin 收敛回官方域名，
并忽略 `ZCODE_UPDATE_FEED_URL` 等调试覆盖，因此 fork 产出的安装包无法从自己的仓库获取更新。

这个 fork 需要一条独立的更新通道：产物从 `github.com/<owner>/<repo>` 的 Releases 分发，
不依赖任何长期维护的自建服务，同时保证默认构建（`ZCODE_UPDATE_PROVIDER=manifest`）的上游行为
逐字不变。

## 构建期开关

全部由 `scripts/build-time-config.mjs` 解析，优先级沿用
[桌面构建期可选能力](./build-time-optional-capabilities.md)：构建进程环境变量 >
`config/private/build-defaults.json` > 内置默认值。

| 环境变量                              | 默认       | 说明                                                                 |
| ------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `ZCODE_UPDATE_PROVIDER`               | `manifest` | `manifest`（上游行为）/ `github`。其他取值在构建期直接失败。          |
| `ZCODE_UPDATE_GITHUB_REPO`            | 空         | `owner/repo`，仅在 `github` 模式下必填；格式非法时构建失败。          |
| `ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS` | 关闭       | `1`/`true`/`yes` 时允许安装无 Authenticode 签名的 Windows 更新包。    |
| `ZCODE_UPDATE_FORCE_GATE`             | 开启       | `0` 时跳过启动前的远端强制升级 gate（`/api/v1/client/configs`）。     |

`ZCODE_AUTO_UPDATE=1` 仍然是启用自动更新的前提，与 provider 选择互相独立：provider 只决定
「从哪里取更新」，不决定「是否检查更新」。

注入的 define：

```
__ZCODE_UPDATE_PROVIDER__            "manifest" | "github"
__ZCODE_UPDATE_GITHUB_OWNER__
__ZCODE_UPDATE_GITHUB_REPO__
__ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS__   boolean
__ZCODE_UPDATE_FORCE_GATE_ENABLED__       boolean
```

运行时代码只读 `@zcode/shared` 的 `env.ts` 常量（`ZCODE_UPDATE_PROVIDER`、
`ZCODE_UPDATE_GITHUB_OWNER`、`ZCODE_UPDATE_GITHUB_REPO`、
`ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS`、`ZCODE_UPDATE_FORCE_GATE_ENABLED`），不直接读 `process.env`。
未注入 define 的环境（测试、其他 bundle）得到 `manifest` / 空 / 空 / `false` / `true`。

## provider 分派

| 环节                      | `manifest`（默认）                                       | `github`                                                     |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `setFeedURL`              | 装配自定义 `ManifestUpdateProvider`                      | **不调用**，由 `electron-updater` 读 `resources/app-update.yml` |
| 更新源                    | `endpointOrigin` + `/api/v1/releases/electron/manifest`  | `github.com/<owner>/<repo>` 的 Release 资产                  |
| 打包态 origin allowlist   | 生效（非官方 origin 回落官方域名）                       | 不参与（没有自定义 provider）                                |
| `release` 通道            | 跟随 `receivePreviewUpdates`                             | 固定 stable，忽略 `receivePreviewUpdates`                    |
| `electron-builder.publish`| `{ provider: "generic", url: "http://localhost:8081" }` 占位 | `{ provider: "github", owner, repo, releaseType: "release" }` |

`github` 模式下 `detectUpdateChannel: false` 保持关闭：fork 只有一个通道，写入 channel 会让
electron-updater 去找 `latest-<channel>.yml`，而 electron-builder 只产出 `latest.yml`。

dev 调试通路（`ZCODE_AUTO_UPDATE_DEV`、`--zcode-auto-update-dev`、`ZCODE_UPDATE_FEED_URL`、
`--zcode-update-feed-url`）两种 provider 下都不变，仍然只在未打包运行时生效。`github` 模式下
`resolveUpdateFeedSource` 的返回值被忽略，日志会明确写出 provider，避免调试时误以为连的是本地源。

## Windows 签名策略

上游在打包态强制校验待安装包的 Authenticode 签名（安装前复查 + `NsisUpdater`
的 `verifyUpdateCodeSignature` 覆盖），并要求签名状态为 `Valid` 且 subject 非空。fork 没有
代码签名证书，这条规则会让更新永远停在下载完成、无法安装。

`ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS` 打开后的判定：

| `SignatureStatus`          | 行为                                   |
| -------------------------- | -------------------------------------- |
| `Valid`（0）               | 放行                                   |
| `NotSigned`（2）           | 放行，记 `warn`（fork 无证书）         |
| `UnknownError`（1）        | 放行，记 `warn`                        |
| `HashMismatch`（3）        | 拒绝                                   |
| `NotTrusted`（4）          | 拒绝                                   |

完整性仍由 `latest.yml` 的 sha512 校验保证，这一条不放宽。上面的放宽只在开关打开时生效；
默认构建继续走原有严格判定。

## 强制升级 gate

`maybeBlockStartupForForceUpdate` 在主窗口创建前请求 `/api/v1/client/configs`，读取
`forceUpdate.minimalVersion`。fork 的版本号落后于线上 release，会把安装包直接启动即退出。
`ZCODE_UPDATE_FORCE_GATE=0` 时跳过整个请求，并记一条 `[force-update] 已按构建开关跳过` 日志。
网络失败本来就是 fail-open，这一项只针对「能连上官方接口但版本落后」的情况。

## 发布产物

`github` 模式下每次发版必须上传到同一个 Release：

| 平台        | 必传资产                                          |
| ----------- | ------------------------------------------------- |
| Windows     | `*.exe`、`*.exe.blockmap`、`latest.yml`           |
| macOS       | `*.zip`（Squirrel 必需）、`*.zip.blockmap`、`latest-mac.yml`；`*.dmg` 供人工安装 |
| Linux       | 对应安装格式（`*.AppImage` / `*.deb` / `*.rpm`）+ `latest-linux.yml` |

`latest.yml` 由 electron-builder 生成，包含 `version`、`files[].sha512` 与 `path`，
`electron-updater` 的 GitHub provider 依赖它解析版本与下载地址；缺 `sha512` 会在下载阶段失败。

版本号必须单调递增。当前基线是 `3.18.2`，发新版前先 bump（`pnpm release` 或手改根
`package.json`），否则客户端判定「无更新」。

## 打包与发布

```powershell
$env:ZCODE_ENV="production"
$env:ZCODE_AUTO_UPDATE="1"
$env:ZCODE_UPDATE_PROVIDER="github"
$env:ZCODE_UPDATE_GITHUB_REPO="fish9988/ZCode"
$env:ZCODE_UPDATE_ALLOW_UNSIGNED_WINDOWS="1"
$env:ZCODE_UPDATE_FORCE_GATE="0"
pnpm bundle:desktop -- win x64
```

产物在 `packages/desktop/dist/`。`bundle.mjs` 不接收 `--publish`，也不读任何 CI token，
发布是显式动作：

```powershell
gh release create v3.18.3 --repo fish9988/ZCode `
  packages/desktop/dist/*.exe `
  packages/desktop/dist/*.exe.blockmap `
  packages/desktop/dist/latest.yml
```

## 验收

1. 默认构建不变：不设 `ZCODE_UPDATE_PROVIDER` 时 `pnpm typecheck`、`pnpm lint` 通过，
   `node packages/desktop/scripts/auto-update-source-security-smoke.mjs` 与 `--nsis` 变体的
   8 个场景全部 PASS（含 origin allowlist 与签名断言）。
2. 产物断言：以 `ZCODE_UPDATE_PROVIDER=github` 打包后，
   `dist/win-unpacked/resources/app-update.yml` 含 `provider: github`、`owner`、`repo`，
   且不含 `localhost:8081`。
3. 端到端：装 `3.18.2` 包 → 发布 `v3.18.3` Release → 「帮助 → 检查更新」发现新版本、
   下载完成、安装后版本变为 `3.18.3`。无签名包在开关为 `1` 时可安装，并留下
   `warn` 日志；开关为 `0` 时安装被拒绝。
4. 强制升级 gate：`ZCODE_UPDATE_FORCE_GATE=0` 的构建在落后版本下仍能进入主界面，
   日志出现跳过说明。
