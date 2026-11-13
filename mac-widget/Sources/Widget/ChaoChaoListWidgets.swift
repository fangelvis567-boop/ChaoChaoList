// =============================================================================
// 小组件本体（系统的 WidgetKit 小组件扩展）：四象限、月视图
// -----------------------------------------------------------------------------
// 系统在需要时启动它：读数据文件（WidgetDataStore），按 MatrixWidgetView / MonthWidgetView 画出界面。
// 什么时候重新读：插件写出新数据后，会唤起宿主程序请系统刷新（见 Sources/App/HelperApp.swift）；
// 另外每 30 分钟兜底自己读一次；每天零点还有一条，让月视图的「今天」自己换到新的一天。
// 系统对刷新次数有限制，所以不保证每次改动都立刻显示。
// 运行在系统沙盒里：只被允许读 ~/Library/Application Support/ChaoChaoList/（见 Resources/Widget.entitlements）。
// =============================================================================
import WidgetKit
import SwiftUI

/// 一次显示的内容（两个小组件共用）
struct DataEntry: TimelineEntry {
    /// 这条内容从什么时候开始显示；月视图用它判断「今天」
    let date: Date
    let state: State
    /// 已经点了、插件还没处理的勾选（四象限用；见 WidgetData.swift 的 PendingToggles）
    var pending: [String: Bool] = [:]

    enum State {
        /// 正常：有数据
        case data(WidgetData)
        /// 读不到数据：显示一句说明
        case message(String)
    }
}

/// 给系统提供要显示的内容（两个小组件共用：同一份数据文件）
struct DataProvider: TimelineProvider {
    /// 加载中占位（系统会自动打码）
    func placeholder(in context: Context) -> DataEntry {
        DataEntry(date: Date(), state: .data(.sample))
    }

    /// 「编辑小组件」里的预览：有真实数据就用真实的，没有就用示例
    func getSnapshot(in context: Context, completion: @escaping (DataEntry) -> Void) {
        completion(DataEntry(date: Date(), state: readState(sampleIfMissing: true)))
    }

    /// 桌面上显示的内容：现在一条、今晚零点一条（换「今天」），30 分钟后系统再来要
    func getTimeline(in context: Context, completion: @escaping (Timeline<DataEntry>) -> Void) {
        let now = Date()
        let state = readState(sampleIfMissing: false)
        // 点过圆圈、插件还没处理的：先按点完的样子画，点了马上有反应
        var pending: [String: Bool] = [:]
        if case .data(let d) = state { pending = PendingToggles.load(vault: d.vault) }
        let cal = Calendar.current
        let midnight = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now.addingTimeInterval(86400)
        let entries = [DataEntry(date: now, state: state, pending: pending), DataEntry(date: midnight, state: state, pending: pending)]
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func readState(sampleIfMissing: Bool) -> DataEntry.State {
        switch WidgetDataStore.load() {
        case .ok(let d):
            return .data(d)
        case .missing:
            return sampleIfMissing ? .data(.sample) : .message("还没有数据\n打开 Obsidian 后会自动出现")
        case .unreadable(let why):
            return .message("读不到任务数据\n\(why)")
        case .unsupported(let v):
            return .message("数据格式是新版本（\(v)）\n请重新安装小组件程序")
        }
    }
}

// MARK: - 四象限

/// 四象限小组件里实际显示的内容
struct MatrixEntryView: View {
    let entry: DataEntry

    var body: some View {
        switch entry.state {
        case .data(let d):
            if let m = d.matrix {
                MatrixWidgetView(data: m, vault: d.vault, pending: entry.pending)
                    .widgetURL(d.url("matrix"))
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
        StaticConfiguration(kind: kind, provider: DataProvider()) { entry in
            MatrixEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(nsColor: .textBackgroundColor)
                }
        }
        .configurationDisplayName("四象限")
        .description("ChaoChaoList 的四象限视图：点任务前面的圆圈勾选，点别处打开 Obsidian")
        .supportedFamilies([.systemLarge])
    }
}

// MARK: - 月视图

/// 月视图小组件里实际显示的内容
struct MonthEntryView: View {
    let entry: DataEntry

    var body: some View {
        switch entry.state {
        case .data(let d):
            let today = MonthDates.dayKey(entry.date)
            // 示例数据（还没有真实数据时，generatedAt 为空）用示例月历；
            // 真实数据里没有月视图 = 插件还是旧版，提示更新，不拿示例冒充真实任务
            if let month = d.month ?? (d.generatedAt == nil ? MonthWidgetData.sample(today: entry.date) : nil) {
                if let grid = MonthDates.grid(for: entry.date, in: month) {
                    MonthWidgetView(data: month, grid: grid, todayKey: today,
                                    monthURL: d.url("month", date: today),
                                    dayURL: { d.url("day", date: $0) })
                        .widgetURL(d.url("month", date: today))
                } else {
                    WidgetMessageView(text: "月历数据过期了\n打开 Obsidian 后会自动更新")
                }
            } else {
                WidgetMessageView(text: "数据里还没有月视图\n请把 Obsidian 里的 ChaoChaoList 更新到最新版")
            }
        case .message(let text):
            WidgetMessageView(text: text)
        }
    }
}

/// 月视图小组件
struct MonthWidget: Widget {
    let kind = "ChaoChaoListMonth"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DataProvider()) { entry in
            MonthEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(nsColor: .textBackgroundColor)
                }
        }
        .configurationDisplayName("月视图")
        .description("ChaoChaoList 的月视图，点某一天打开那天的日视图")
        .supportedFamilies([.systemLarge])
    }
}

/// 本程序提供的全部小组件
@main
struct ChaoChaoListWidgets: WidgetBundle {
    var body: some Widget {
        MatrixWidget()
        MonthWidget()
    }
}
