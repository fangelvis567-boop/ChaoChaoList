// =============================================================================
// 月视图小组件的界面（大尺寸）
// -----------------------------------------------------------------------------
// 排版参照滴答清单的「日历月视图」小组件：顶上月份名，下面一行周几，再下面每周一行、每天一格。
// 每格顶上是日期（今天画成实心圆）、节气 / 节日名、「休 / 班」小标，放不下的任务数写成「+N」；
// 下面按「道」放任务：跨天任务是横跨几天的长条（先放），单日任务填进当天空着的道。
// 一格放几道由格子的实际高度决定（通常 2–3 道）。颜色、顺序、要不要列做完的，都由插件算好（见插件
// src/core/composables/widgetSnapshot.js 的 buildMonthWidget），这里只负责摆放。
// 点某一天打开 Obsidian 里那天的日视图；点月份名打开月视图。
// 这个文件同时被小组件和预览工具（Sources/Preview）使用，所以不依赖 WidgetKit。
// =============================================================================
import SwiftUI

/// 尺寸与字号（单位：点）
enum MonthMetrics {
    static let titleFont: CGFloat = 14
    static let weekdayFont: CGFloat = 9.5
    static let dayFont: CGFloat = 10.5
    static let tagFont: CGFloat = 7.5
    static let moreFont: CGFloat = 8
    static let itemFont: CGFloat = 8.5
    /// 每格顶上日期那一行的高度
    static let headerHeight: CGFloat = 15
    /// 每道任务的高度（含上下空隙）
    static let laneHeight: CGFloat = 13
    /// 今天的圆圈直径
    static let todayDot: CGFloat = 14
    /// 节假日、节气的颜色（与插件的休 / 班、节气同色系）
    static let restColor = Color(hex: "#4caf7d")
    static let workColor = Color(hex: "#e0584f")
    static let tagColor = Color(hex: "#e0584f")
}

/// 日期工具
enum MonthDates {
    /// 某个时刻所在的那天：YYYY-MM-DD（本机时区）
    static func dayKey(_ date: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// 某个时刻所在的月份：YYYY-MM
    static func monthKey(_ date: Date) -> String { String(dayKey(date).prefix(7)) }

    /// 从数据里挑出 today 所在月份的月历；没有（数据太旧）时返回 nil
    static func grid(for today: Date, in data: MonthWidgetData) -> MonthGrid? {
        let key = monthKey(today)
        return data.months.first { $0.key == key }
    }
}

/// 一周里摆好位置的一条任务
struct PlacedMonthItem {
    let item: MonthItem
    /// 从第几列开始（0–6）、占几列
    let col: Int
    let span: Int
    /// 第几道
    let lane: Int
    let contStart: Bool
    let contEnd: Bool
    /// 不是本月的日子：淡一点显示
    let dim: Bool
}

/// 把一周的长条和单日任务摆进 lanes 道里，算出每天还有几条没放下（「+N」）
enum MonthWeekLayout {
    static func plan(_ week: MonthWeek, lanes: Int) -> (items: [PlacedMonthItem], overflow: [Int]) {
        let lanes = max(0, lanes)
        let n = min(7, week.days.count)
        var occupied = Array(repeating: Array(repeating: false, count: lanes), count: 7)
        var overflow = Array(repeating: 0, count: 7)
        var items: [PlacedMonthItem] = []
        // 1. 跨天长条：泳道由插件排好（与面板一致），放得下的道才画，放不下的计入那几天的「+N」
        for b in week.bars {
            let s = max(0, min(6, b.start))
            let e = max(s, min(6, b.end))
            if b.lane >= 0 && b.lane < lanes {
                for c in s...e { occupied[c][b.lane] = true }
                items.append(PlacedMonthItem(item: b.item, col: s, span: e - s + 1, lane: b.lane,
                                             contStart: b.contStart, contEnd: b.contEnd, dim: false))
            } else {
                for c in s...e { overflow[c] += 1 }
            }
        }
        // 2. 单日任务：按顺序填进当天空着的道
        for c in 0..<n {
            let d = week.days[c]
            var next = 0
            for lane in 0..<lanes where !occupied[c][lane] {
                if next >= d.chips.count { break }
                items.append(PlacedMonthItem(item: d.chips[next], col: c, span: 1, lane: lane,
                                             contStart: false, contEnd: false, dim: d.other))
                occupied[c][lane] = true
                next += 1
            }
            overflow[c] += max(0, d.chipTotal - next)
        }
        return (items, overflow)
    }
}

/// 月视图小组件
struct MonthWidgetView: View {
    let data: MonthWidgetData
    let grid: MonthGrid
    /// 今天（YYYY-MM-DD）：画圆圈用
    let todayKey: String
    /// 点月份名打开的地址
    let monthURL: URL?
    /// 点某一天打开的地址
    let dayURL: (String) -> URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            linked(monthURL) {
                Text(grid.title)
                    .font(.system(size: MonthMetrics.titleFont, weight: .semibold))
                    .foregroundStyle(.primary)
            }
            HStack(spacing: 0) {
                ForEach(Array(data.weekdays.enumerated()), id: \.offset) { _, w in
                    Text(w)
                        .font(.system(size: MonthMetrics.weekdayFont, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(grid.weeks.enumerated()), id: \.offset) { _, week in
                    Rectangle().fill(Color(nsColor: .separatorColor)).frame(height: 0.5)
                    MonthWeekRow(week: week, todayKey: todayKey, restText: data.restText,
                                 workText: data.workText, dayURL: dayURL)
                }
            }
        }
    }
}

/// 有地址就包一层 Link（点了打开），没有就原样显示
@ViewBuilder
func linked<Content: View>(_ url: URL?, @ViewBuilder _ content: () -> Content) -> some View {
    if let url {
        Link(destination: url) { content() }
    } else {
        content()
    }
}

/// 月历里的一周
struct MonthWeekRow: View {
    let week: MonthWeek
    let todayKey: String
    let restText: String
    let workText: String
    let dayURL: (String) -> URL?

    var body: some View {
        GeometryReader { geo in
            let cw = geo.size.width / 7
            let lanes = Int((geo.size.height - MonthMetrics.headerHeight - 1) / MonthMetrics.laneHeight)
            let plan = MonthWeekLayout.plan(week, lanes: lanes)
            ZStack(alignment: .topLeading) {
                // 每天一格：底色（今天淡淡一层）、顶上的日期行；整格可点
                ForEach(Array(week.days.prefix(7).enumerated()), id: \.offset) { c, day in
                    linked(dayURL(day.key)) {
                        MonthDayCell(day: day, isToday: day.key == todayKey, overflow: plan.overflow[c],
                                     restText: restText, workText: workText)
                            .frame(width: cw, height: geo.size.height, alignment: .top)
                    }
                    .offset(x: CGFloat(c) * cw)
                }
                // 竖线分隔每一天
                ForEach(1..<7, id: \.self) { c in
                    Rectangle().fill(Color(nsColor: .separatorColor).opacity(0.6))
                        .frame(width: 0.5, height: geo.size.height)
                        .offset(x: CGFloat(c) * cw)
                }
                // 任务：长条和单日任务；点了打开它所在（长条：开始那天）的日视图
                ForEach(Array(plan.items.enumerated()), id: \.offset) { _, p in
                    linked(dayURL(week.days[min(p.col, week.days.count - 1)].key)) {
                        MonthItemView(item: p.item, contStart: p.contStart, contEnd: p.contEnd)
                            .frame(width: max(0, CGFloat(p.span) * cw - 2), height: MonthMetrics.laneHeight - 1.5)
                    }
                    .opacity(p.dim ? 0.45 : 1)
                    .offset(x: CGFloat(p.col) * cw + 1,
                            y: MonthMetrics.headerHeight + CGFloat(p.lane) * MonthMetrics.laneHeight)
                }
            }
        }
    }
}

/// 一天的格子：日期行（日期、休 / 班、节气或节日、「+N」）
struct MonthDayCell: View {
    let day: MonthDay
    let isToday: Bool
    let overflow: Int
    let restText: String
    let workText: String

    var body: some View {
        VStack(spacing: 0) {
            // 节气 / 节日名放得下才显示；放不下（比如同时有「休」和「+N」）就整个省掉，不显示成「…」
            ViewThatFits(in: .horizontal) {
                headerRow(showTag: true)
                headerRow(showTag: false)
            }
            .padding(.horizontal, 2)
            .frame(height: MonthMetrics.headerHeight)
            .opacity(day.other ? 0.6 : 1)
            Spacer(minLength: 0)
        }
        .background(isToday ? Color.accentColor.opacity(0.07) : Color.clear)
        .contentShape(Rectangle())
    }

    /// 日期行：日期（今天画实心圆）、休 / 班、节气或节日名（showTag 时）、靠右的「+N」
    private func headerRow(showTag: Bool) -> some View {
        HStack(spacing: 1.5) {
            ZStack {
                if isToday {
                    Circle().fill(Color.accentColor)
                        .frame(width: MonthMetrics.todayDot, height: MonthMetrics.todayDot)
                }
                Text(String(day.day))
                    .font(.system(size: MonthMetrics.dayFont, weight: isToday ? .bold : .medium))
                    .monospacedDigit()
                    .foregroundStyle(isToday ? AnyShapeStyle(Color.white)
                                     : (day.other ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.primary)))
                    .lineLimit(1)
                    .fixedSize()
            }
            .frame(minWidth: MonthMetrics.todayDot)
            if !day.holiday.isEmpty {
                Text(day.holiday == "rest" ? restText : workText)
                    .font(.system(size: 6.5, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 1.5)
                    .background(Capsule().fill(day.holiday == "rest" ? MonthMetrics.restColor : MonthMetrics.workColor))
                    .fixedSize()
            }
            if showTag && !day.tag.isEmpty {
                Text(day.tag)
                    .font(.system(size: MonthMetrics.tagFont))
                    .foregroundStyle(MonthMetrics.tagColor)
                    .lineLimit(1)
                    .fixedSize()
            }
            Spacer(minLength: 0)
            if overflow > 0 {
                Text("+\(overflow)")
                    .font(.system(size: MonthMetrics.moreFont, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Color.accentColor)
                    .fixedSize()
            }
        }
    }
}

/// 一条任务（长条或单日）：浅色底 + 一行字，放不下直接裁掉（像滴答那样不加省略号，多留一个字）
struct MonthItemView: View {
    let item: MonthItem
    let contStart: Bool
    let contEnd: Bool

    var body: some View {
        let r: CGFloat = 3
        let shape = UnevenRoundedRectangle(topLeadingRadius: contStart ? 0 : r, bottomLeadingRadius: contStart ? 0 : r,
                                           bottomTrailingRadius: contEnd ? 0 : r, topTrailingRadius: contEnd ? 0 : r,
                                           style: .continuous)
        GeometryReader { g in
            Text(item.text)
                .font(.system(size: MonthMetrics.itemFont))
                .foregroundStyle(item.fg.isEmpty ? AnyShapeStyle(.primary) : AnyShapeStyle(Color(hex: item.fg)))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 2.5)
                .frame(width: g.size.width, height: g.size.height, alignment: .leading)
                .clipped()
        }
        .background(shape.fill(item.bg.isEmpty ? Color.secondary.opacity(0.15) : Color(hex: item.bg)))
        .clipShape(shape)
        .opacity(item.done ? 0.5 : 1)
    }
}
