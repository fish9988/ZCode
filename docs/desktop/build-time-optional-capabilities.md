# 桌面构建期可选能力

## 目标

三项能力由构建期配置决定是否启用，未配置时一律关闭：

| 能力 | 配置项 | 关闭时的行为 |
| --- | --- | --- |
| ARMS RUM 上报 | `ZCODE_ARMS_RUM_ENDPOINT` | 主进程与渲染进程的 ARMS SDK 以 `enable: false` 初始化，不产生上报 |
| 事件上报（数仓） | `ZCODE_TELEMETRY_REPORT_ENDPOINT` | 遥测事件在发送前直接返回 |
| 自动更新 | `ZCODE_AUTO_UPDATE`（`1`、`true`、`yes` 为启用） | 与 Preview 形态相同，不检查、不下载更新 |

自动更新的**更新源**是另一组开关，与上面的总开关互相独立：`ZCODE_AUTO_UPDATE` 决定是否检查更新，
`ZCODE_UPDATE_PROVIDER` 决定从哪里取更新。默认 `manifest` 走服务端 manifest 接口；`github` 走
`github.com/<owner>/<repo>` 的 Release 资产，用于 fork 自建分发。详见
[Fork 构建的自动更新](./fork-auto-update.md)。

这样同一份源码可以产出“默认不上报、不自动更新”的构建，也可以产出启用这些能力的正式构建，
不需要在源码里写死上报地址。

## 配置来源与优先级

1. 构建进程的环境变量。显式设置为空字符串表示关闭。
2. `config/private/build-defaults.json`。只存在于内部仓库，开源导出不包含。
3. 以上都没有时关闭。

## 所有者与数据流

```
环境变量 / config/private/build-defaults.json
        │ scripts/build-time-config.mjs（唯一解析入口）
        ▼
desktop tsup（main、host、preload）与 desktop vite（renderer）的 define
        │ __ZCODE_ARMS_RUM_ENDPOINT__ / __ZCODE_TELEMETRY_REPORT_ENDPOINT__ / __ZCODE_AUTO_UPDATE_ENABLED__
        │ / __ZCODE_UPDATE_PROVIDER__ 等更新源 define
        ▼
@zcode/shared env 常量 ── 运行时代码只读这些常量
```

- 未注入 define 的环境（测试、其他 bundle）得到关闭值；vitest 为测试注入固定的事件上报端点，以便验证上报链路。
- 自动更新在 Desktop Main 启动时判定：`ZCODE_PRODUCT_FLAVOR === "production" && ZCODE_AUTO_UPDATE_ENABLED`。
- 更新源在 `initAutoUpdater` 装配时按 `ZCODE_UPDATE_PROVIDER` 分派，不影响上面的启用判定。
- Agent 的 OTLP 遥测沿用既有机制，由打包环境的 `ZCODE_PACKAGED_AGENT_OTEL_*` 注入，不在本文件范围内。

## 验收

1. 内部仓库存在私有默认配置时，构建结果与改造前一致：ARMS、事件上报、自动更新均启用，地址不变。
2. 没有私有默认配置、也没有环境变量时，三项均关闭。
3. 环境变量优先于私有默认配置，显式空字符串可以关闭单项能力。
4. 更新源默认 `manifest`；设 `ZCODE_UPDATE_PROVIDER=github` 时走 fork Release，未同时提供
   `ZCODE_UPDATE_GITHUB_REPO` 会在构建期失败。
5. 类型检查、Lint 与相关单测通过。
