# ChaoChaoList 小组件（Mac 桌面）

把 ChaoChaoList 的视图做成 Mac 桌面小组件，样子参照滴答清单的小组件。只显示、不能勾选，点一下打开 Obsidian 里对应的视图。

目前有：**四象限**（大尺寸）。计划中：月视图。

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

装好后：桌面空白处右键 →「编辑小组件」→ 搜索 ChaoChaoList → 把「四象限」拖到桌面。

插件设置里的「Mac 桌面小组件」开关可以停掉导出（只在 Mac 桌面版显示）。在测试库里测完要把它关掉，否则测试库会用自己的数据覆盖主库的小组件数据。

## 开发时核对排版

`Sources/Preview/RenderPreview.swift` 能把界面画成 PNG，不用装进系统：

```bash
SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun swiftc -parse-as-library -target arm64-apple-macos14.0 -sdk "$SDK" -o /tmp/RenderPreview \
  mac-widget/Sources/Shared/*.swift mac-widget/Sources/Preview/*.swift
/tmp/RenderPreview ~/Library/Application\ Support/ChaoChaoList/widget-data.json /tmp/matrix.png 344 344
```

## 排查

- 小组件显示「还没有数据」：打开一次 Obsidian（主库），插件会写出数据文件。
- 内容没跟上：系统会限制小组件的刷新次数，等一会儿；或者看数据文件里的 `generatedAt`（写出时间）是不是最新。
- 查系统有没有认出小组件：`pluginkit -m -p com.apple.widgetkit-extension -i app.chaochaolist.widgets.extension`
