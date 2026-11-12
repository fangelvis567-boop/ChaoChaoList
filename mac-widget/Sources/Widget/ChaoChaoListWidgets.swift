// =============================================================================
// 小组件本体（系统的 WidgetKit 小组件扩展）
// -----------------------------------------------------------------------------
// 系统在需要时启动它：读数据文件（WidgetDataStore），按 MatrixWidgetView 画出界面。
// 什么时候重新读：插件写出新数据后，会唤起宿主程序请系统刷新（见 Sources/App/HelperApp.swift）；
// 另外每 30 分钟兜底自己读一次。系统对刷新次数有限制，所以不保证每次改动都立刻显示。
// 运行在系统沙盒里：只被允许读 ~/Library/Application Support/ChaoChaoList/（见 Resources/Widget.entitlements）。
// =============================================================================
import WidgetKit
import SwiftUI

/// 一次显示的内容
struct MatrixEntry: TimelineEntry {
    let date: Date
    let state: State

    enum State {
        /// 正常：有数据
        case data(WidgetData)
        /// 读不到数据：显示一句说明
        case message(String)
    }
}

/// 给系统提供要显示的内容
struct MatrixProvider: TimelineProvider {
    /// 加载中占位（系统会自动打码）
    func placeholder(in context: Context) -> MatrixEntry {
        MatrixEntry(date: Date(), state: .data(.sample))
    }

    /// 「编辑小组件」里的预览：有真实数据就用真实的，没有就用示例
    func getSnapshot(in context: Context, completion: @escaping (MatrixEntry) -> Void) {
        completion(makeEntry(sampleIfMissing: true))
    }

    /// 桌面上显示的内容：只有一条，30 分钟后系统再来要一次
    func getTimeline(in context: Context, completion: @escaping (Timeline<MatrixEntry>) -> Void) {
        let entry = makeEntry(sampleIfMissing: false)
        let next = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func makeEntry(sampleIfMissing: Bool) -> MatrixEntry {
        let now = Date()
        switch WidgetDataStore.load() {
        case .ok(let d):
            return MatrixEntry(date: now, state: .data(d))
        case .missing:
            return sampleIfMissing
                ? MatrixEntry(date: now, state: .data(.sample))
                : MatrixEntry(date: now, state: .message("还没有数据\n打开 Obsidian 后会自动出现"))
        case .unreadable(let why):
            return MatrixEntry(date: now, state: .message("读不到任务数据\n\(why)"))
        case .unsupported(let v):
            return MatrixEntry(date: now, state: .message("数据格式是新版本（\(v)）\n请重新安装小组件程序"))
        }
    }
}

/// 小组件里实际显示的内容
struct MatrixEntryView: View {
    let entry: MatrixEntry

    var body: some View {
        switch entry.state {
        case .data(let d):
            if let m = d.matrix {
                MatrixWidgetView(data: m)
                    .widgetURL(d.openUrl["matrix"].flatMap { URL(string: $0) })
            } else {
                WidgetMessageView(text: "数据里没有四象限")
            }
        case .message(let text):
            WidgetMessageView(text: text)
        }
    }
}

/// 四象限小组件
struct MatrixWidget: Widget {
    let kind = "ChaoChaoListMatrix"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MatrixProvider()) { entry in
            MatrixEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(nsColor: .textBackgroundColor)
                }
        }
        .configurationDisplayName("四象限")
        .description("ChaoChaoList 的四象限视图，点一下打开 Obsidian")
        .supportedFamilies([.systemLarge])
    }
}

/// 本程序提供的全部小组件（以后月视图也加在这里）
@main
struct ChaoChaoListWidgets: WidgetBundle {
    var body: some Widget {
        MatrixWidget()
    }
}
