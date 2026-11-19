# 订阅 UI 总开关与默认模型设置项

## 背景

fork 里已经有两个与「官方套餐」相关的持久化开关：

- `officialPlansEnabled`：只过滤 **Model Selection View**（聊天模型选择器、默认模型、回退）。
- `defaultModelSelection` / `preferDefaultModelForNewTasks`：全局默认模型，已经端到端生效。

但订阅相关的用户界面只有一半受控：套餐卡片、额度条、「升级 / 续费」按钮、升级 webview、
设置里的 Coding Plan 用量页、侧边栏头像旁的套餐徽标、模型供应商导航里的 Z.ai / BigModel
套餐入口，在 `officialPlansEnabled=false` 时仍然全部可见。原因是这些界面读的是
**Provider Settings View**，而该视图从来没有被任何开关过滤过。

同时，默认模型的下拉框挂在模型供应商页的分区 headerSlot 里，没有进入设置搜索索引、
没有 data-testid，文案是硬编码中文，与设置页其他行的规范不一致。

## 两个开关的职责

| 设置项 | 语义 | 默认 |
| --- | --- | --- |
| `officialPlansEnabled` | 官方套餐的模型是否**可用**（进入模型选择、默认、回退） | `true` |
| `subscriptionUiEnabled` | 订阅/计费相关的界面是否**显示** | `true` |
| `defaultModelSelection` | 新建对话使用的全局默认模型；`null` 表示自动 | 未设置 |
| `preferDefaultModelForNewTasks` | 新对话是否优先于项目最近使用记忆 | `true` |

两个开关彼此独立，可以出现「套餐模型可用但不显示购买入口」和「显示套餐界面但模型不出现在
选择器里」两种组合。关闭 `subscriptionUiEnabled` 不清空 `officialPlansEnabled`，也不改动
用户已选中的模型。

## subscriptionUiEnabled=false 隐藏的范围

收口在两个位置，而不是逐处加 `if`：

1. **Provider Settings View 过滤**（`packages/services/src/model-provider/providerFacadeServices.ts`）。
   按 `isOfficialPlanProvider` 过滤 `providers`，并把 `providerOrder` 收敛到剩余 id。
   该过滤必须作用在**所有返回视图的路径**上：`getView`、`refresh`、每个 mutation 的返回值，
   以及 `onDidChange` 的投影。只过滤 `getView` 不够 —— UI 会把 mutation 返回值直接
   commit 进共享快照。

   由此自动消失的界面：模型供应商页的套餐状态卡 / 额度条 / 升级续费按钮 / 购买选择横幅、
   设置 → 用量的 Coding Plan 标签页与数据源、Start Plan 预览卡、composer 额度面板的权益来源。

2. **UI 侧无条件渲染点**（这些不读 providers，必须显式守卫）：
   - `CodingPlanUpgradeDialogProvider`：`openCodingPlanUpgrade` 直接返回 `false`，且不挂载弹窗。
     这是所有购买入口的唯一收口，包括模型卡片、composer、off-peak、自动化、营销弹窗。
   - `WorkspaceSidebarFooterUsageSummaryContent`：隐藏「升级 / 续费」菜单项。
   - `WorkspaceSidebarFooterPlanBadge`：隐藏套餐徽标。
   - `useModelProviderNavigation`：导航不再生成 `codingPlan` 与 Start Plan 条目。

关闭后仍然保留的行为：套餐 provider 的**账号状态**仍在 Provider Settings View 之外的
数据链路里（`account-provider-state`），登录/退出账号不受影响；模型是否可选仍只由
`officialPlansEnabled` 决定。

## 默认模型的设置项化

`DefaultModelAndOfficialPlanBar` 拆成规范设置行，落在「设置 → 模型设置」分区顶部：

| 行 | 控件 | 说明 |
| --- | --- | --- |
| `settings.defaultModel` | 模型 `Select` + 思考强度 `Select` | 写 `defaultModelSelection`；选「自动」写 `null` |
| `settings.preferDefaultModel` | `Switch` | 写 `preferDefaultModelForNewTasks`；仅在已设默认模型时显示 |
| `settings.officialPlans` | `Switch` | 写 `officialPlansEnabled`；关闭时若默认模型指向官方 provider 则一并清空 |
| `settings.subscriptionUi` | `Switch` | 写 `subscriptionUiEnabled` |

约束：

- 四行都用 `SettingsRow` 直接作为 `SettingsGroupCard` 的子元素（行间分隔线依赖
  `first:border-t-0`，不能包额外元素）。
- 模型与思考强度下拉用 `controlLayout="wide"`（默认 192px 控件列放不下 240px 的触发器）。
- 每一行都要在 `settingsSearchIndex.ts` 登记，并把同一 id 传给 `SettingsRow`。
- 文案走 `intl.formatMessage`，zh-CN / en-US 完整，ja-JP / ru-RU / ko-KR 回退英文。
- 关闭 `officialPlansEnabled` 时清空指向官方 provider 的默认模型这一段耦合保持不变。

## 持久化

字段加在三处，缺一不可：

- `packages/shared/src/protocol.ts`（`AppSettings`）
- `packages/shared/src/validationAppSettings.ts` 的 `appSettingsObjectSchema`（完整 schema；
  漏了会在 merge 后重新解析时被剥离，见该文件 `remoteStartupAutoReconnectEnabled` 的注释）
- `packages/shared/src/validationAppSettings.ts` 的 `appSettingsPatchSchema`

默认值语义统一为「缺失按 `true`」，即读取处用 `!== false` 判断，与 `officialPlansEnabled`
保持一致。

`packages/services/src/node.ts` 里需要同步新增：

- `subscriptionUiPolicy`（读 `subscriptionUiEnabled !== false`）
- 把该键加入 `officialPlansPolicy` 之外的两个 `onDidUpdate` 监听列表（provider 视图失效与
  默认模型来源失效），否则切换开关后 UI 不会重算。

## 验收

1. 默认构建 `subscriptionUiEnabled` 缺失时行为与改动前一致：套餐导航、卡片、升级按钮、
   用量页 Coding Plan 标签、侧边栏徽标全部可见。
2. 关闭后：上述界面全部消失；账号登录/退出、模型设置的其他行、自定义供应商完整不受影响。
3. 关闭后重启，`setting.json` 保留 `subscriptionUiEnabled: false`（不被 merge 剥离）。
4. 关闭 `officialPlansEnabled` 且默认模型指向官方 provider 时，默认模型被清空；默认模型
   行仍可见且可重新选择自定义供应商模型。
5. 设置搜索能搜到四行，点击后跳到模型设置分区并高亮对应行。
6. `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
