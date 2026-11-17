# custom-appearance 模块契约

负责个人化外观定制与运行时样式注入，集中隔离以降低与上游同步时的代码冲突：

- `CustomAppearanceRuntime`：在 `Root` 挂载，同步主题配色变量、三端字体、壁纸层、聊天栏宽度与自定义 CSS，并提供 `Ctrl/Cmd+Shift+Alt+R` 安全模式快捷键。
- `CustomAppearanceSettings`：挂载于「设置 → 外观」，提供预设切换/导入导出、分区域调色、本机已安装字体扫描与中英双槽位配置、聊天宽度与阅读模式开关、自定义 CSS 编辑器。
- `ChatWidthResizeHandle`：挂载于 `ConversationTimeline`，提供半高防误触隐藏拖拽边界（150ms 悬停显形、对称调宽、双击还原）。
