# ChaoChaoList 小组件（Mac 桌面）

把 ChaoChaoList 的视图做成 Mac 桌面小组件，样子参照滴答清单的小组件。只显示、不能勾选，点一下打开 Obsidian 里对应的视图。

目前有（都是大尺寸）：
- **四象限**：点任意处打开四象限视图。
- **月视图**：这个月的月历，跨天任务画成长条，一格放不下的写「+N」；点某一天打开那天的日视图，点月份名打开月视图。插件同时导出下个月，所以月底之后即使 Obsidian 没开，小组件也能换到新的月份；每天零点「今天」的圆圈自己换到新的一天。

## 它由三部分组成

| 部分 | 在哪 | 做什么 |
|---|---|---|
| 插件里的导出 | `src/core/services/widgetExport.js`、`src/core/composables/widgetSnapshot.js` | 任务有变化时，把小组件要显示的内容写到 `~/Library/Application Support/ChaoChaoList/widget-data.json`，再用 `open -g chaochaolist-widget://reload` 请宿主程序刷新 |
| 宿主程序 | `Sources/App/HelperApp.swift` → `/Applications/ChaoChaoListWidgets.app` | 没有窗口、不占 Dock。收到刷新请求就通知系统重新读小组件数据；点小组件时把 `obsidian://` 地址转给 Obsidian |
| 小组件扩展 | `Sources/Widget/`、`Sources/Shared/` | 系统需要时运行，读上面那个 JSON 文件画出界面。运行在沙盒里，只能读 `~/Library/Application Support/ChaoChaoList/` |

数据格式在插件的 `widgetSnapshot.js` 和这里的 `Sources/Shared/WidgetData.swift` 两处定义，改一边必须同步改另一边，并把版本号加 1。

## 安装 / 更新

```bash
bash mac-widget/scripts/install.sh --dry-run   # 先试运行，看它要做什么
bash mac-widget/scripts/install.sh             # 正式安装（再次运行 = 更新，旧版会移到备份文件夹）
```

需要已装 Xcode。默认用本机临时签名（不需要 Apple ID）；如果系统不认，就在 Xcode 里登录 Apple ID、建好「Apple Development」证书，再用 `SIGN_ID="Apple Development: …" bash mac-widget/scripts/install.sh` 安装。

装好后：桌面空白处右键 →「编辑小组件」→ 搜索 ChaoChaoList → 把「四象限」「月视图」拖到桌面。

改了小组件程序后：把 `Resources/App-Info.plist`、`Resources/Widget-Info.plist` 的版本号一起加大，再运行安装脚本（系统按版本号判断要不要重新读取小组件）。不要用 `plutil -replace` 改这两个文件，它会删掉里面的中文注释。

插件设置里的「Mac 桌面小组件」开关可以停掉导出（只在 Mac 桌面版显示）。在测试库里测完要把它关掉，否则测试库会用自己的数据覆盖主库的小组件数据。

## 开发时核对排版

`Sources/Preview/RenderPreview.swift` 能把界面画成 PNG，不用装进系统：

```bash
SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun swiftc -parse-as-library -target arm64-apple-macos14.0 -sdk "$SDK" -o /tmp/RenderPreview \
  mac-widget/Sources/Shared/*.swift mac-widget/Sources/Preview/*.swift
/tmp/RenderPreview ~/Library/Application\ Support/ChaoChaoList/widget-data.json /tmp/matrix.png
/tmp/RenderPreview ~/Library/Application\ Support/ChaoChaoList/widget-data.json /tmp/month.png --kind month --today 2026-11-12 --dark
```

可选参数：`--kind matrix|month`（默认四象限）、`--size 宽x高`（默认 344x344）、`--today YYYY-MM-DD`（月视图按哪天当今天）、`--dark`（深色模式）。

要看测试库会导出什么、又不想覆盖主库写出的数据文件，可以在测试库里调用插件的 `widgetExport.buildData()`（只算不写）。

## 程序名和图标

- 「编辑小组件」、访达里显示的程序名来自 `Resources/*.lproj/InfoPlist.strings`（ChaoChaoList）。要生效，`App-Info.plist` 里的 `CFBundleName`、`CFBundleDisplayName` 必须和程序文件名 `ChaoChaoListWidgets` 一致，并打开 `LSHasLocalizedDisplayName`（滴答清单也是这样做的）。
- 图标 `Resources/AppIcon.icns` 由 `Sources/Icon/MakeIcon.swift` 画出。改图案后重新生成：

```bash
SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun swiftc -parse-as-library -target arm64-apple-macos14.0 -sdk "$SDK" -o /tmp/MakeIcon mac-widget/Sources/Icon/MakeIcon.swift
/tmp/MakeIcon /tmp/AppIcon.iconset && iconutil -c icns /tmp/AppIcon.iconset -o mac-widget/Resources/AppIcon.icns
```

然后把两个 Info.plist 的版本号加一，重新运行安装脚本。

## 排查

- 小组件显示「还没有数据」：打开一次 Obsidian（主库），插件会写出数据文件。
- 内容没跟上：系统会限制小组件的刷新次数，等一会儿；或者看数据文件里的 `generatedAt`（写出时间）是不是最新。
- 查系统有没有认出小组件：`pluginkit -m -p com.apple.widgetkit-extension -i app.chaochaolist.widgets.extension`
- 「编辑小组件」里找不到：先看 `~/Library/Logs/DiagnosticReports/ChaoChaoListWidgetsExtension-*.ips` 有没有崩溃报告。查系统日志要写 `/usr/bin/log show …`（zsh 里 `log` 是别的命令）。
- 月视图显示「数据里还没有月视图」：Obsidian 里的插件还是旧版，更新插件即可。
- 装了新版，新加的小组件却没出现、已有的变成灰色占位：多半是旧版的小组件进程还在跑，系统一直找它。安装脚本会自动结束它；手动处理用 `pkill -x ChaoChaoListWidgetsExtension`，再重新打开「编辑小组件」。
