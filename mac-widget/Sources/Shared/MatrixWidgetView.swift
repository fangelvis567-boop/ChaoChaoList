// =============================================================================
// 四象限小组件的界面（大尺寸）
// -----------------------------------------------------------------------------
// 排版参照滴答清单的四象限小组件：顶上标题，下面 2×2 四格，格子之间细线分隔；
// 每格是彩色小标题 + 任务标题（子任务缩进一格），没有任务写「暂无任务」，放不下时最后一行写「还有 N 条」。
// 0.4.0 起每条任务前面有个圆圈（颜色跟这一格的主色走，做完是绿色对勾）：点圆圈 = 勾上 / 取消勾选
//   （链接见 WidgetData.swift 的 ToggleLink，流程写在那里）；点别处仍是打开 Obsidian 的四象限视图
//   （地址由调用方用 widgetURL 设置）。
// 这个文件同时被小组件和预览工具（Sources/Preview）使用，所以不依赖 WidgetKit。
// =============================================================================
import SwiftUI

/// 行高与字号（单位：点）。行高固定，才能算出一格放得下几行
enum MatrixMetrics {
    static let titleFont: CGFloat = 13
    static let headerFont: CGFloat = 11
    static let lineFont: CGFloat = 12
    static let headerHeight: CGFloat = 18
    static let lineHeight: CGFloat = 17
    static let indent: CGFloat = 12
    /// 任务前面圆圈的大小（子任务小一号）和它占的宽度（宽一点好点中）
    static let checkSize: CGFloat = 11.5
    static let subCheckSize: CGFloat = 10
    static let checkWidth: CGFloat = 16
}

/// 做完的任务前面那个对勾的颜色（和插件里的「已完成」同色：tokens.css 的 --c-done）
let matrixDoneColor = Color(hex: "#52B434")

struct MatrixWidgetView: View {
    let data: MatrixData
    /// 哪个库（点圆圈时写进请求）；预览工具里不传，圆圈就只显示、不能点
    var vault: String = ""
    /// 已经点了、插件还没处理的勾选：任务编号 → 要变成的状态（见 WidgetData.swift 的 PendingToggles）
    var pending: [String: Bool] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(data.title)
                .font(.system(size: MatrixMetrics.titleFont, weight: .semibold))
                .foregroundStyle(Color.accentColor)
            Divider()
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    cell(0)
                    Divider()
                    cell(1)
                }
                Divider()
                HStack(spacing: 0) {
                    cell(2)
                    Divider()
                    cell(3)
                }
            }
        }
    }

    /// 第 i 格（数据不足四格时补一个空格子，免得排版错乱）
    @ViewBuilder
    private func cell(_ i: Int) -> some View {
        if i < data.quadrants.count {
            QuadrantCell(quad: data.quadrants[i], emptyText: data.emptyText, moreText: data.moreText,
                         vault: vault, pending: pending)
        } else {
            Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// 四象限里的一格
struct QuadrantCell: View {
    let quad: Quadrant
    let emptyText: String
    let moreText: String
    var vault: String = ""
    var pending: [String: Bool] = [:]

    var body: some View {
        GeometryReader { geo in
            let rows = max(1, Int((geo.size.height - MatrixMetrics.headerHeight - 6) / MatrixMetrics.lineHeight))
            let plan = layout(rows: rows)
            VStack(alignment: .leading, spacing: 0) {
                Text(quad.title)
                    .font(.system(size: MatrixMetrics.headerFont, weight: .semibold))
                    .foregroundStyle(Color(hex: quad.color))
                    .lineLimit(1)
                    .frame(height: MatrixMetrics.headerHeight, alignment: .leading)
                if quad.total == 0 {
                    Spacer(minLength: 0)
                    Text(emptyText)
                        .font(.system(size: MatrixMetrics.headerFont))
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(plan.lines.enumerated()), id: \.offset) { _, line in
                        LineRow(line: line, color: Color(hex: quad.color), vault: vault, pending: pending)
                    }
                    if plan.more > 0 {
                        Text(moreText.replacingOccurrences(of: "{n}", with: String(plan.more)))
                            .font(.system(size: MatrixMetrics.headerFont))
                            .foregroundStyle(.secondary)
                            .frame(height: MatrixMetrics.lineHeight, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 6)
            .padding(.top, 2)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
    }

    /// 放得下 rows 行时显示哪些行、最后「还有几条」。
    /// 全部放得下就全显示；放不下就留出最后一行写「还有 N 条」。
    private func layout(rows: Int) -> (lines: [TaskLine], more: Int) {
        let total = max(quad.total, quad.items.count)
        if total <= rows && quad.items.count == total { return (quad.items, 0) }
        let keep = max(0, min(rows - 1, quad.items.count))
        return (Array(quad.items.prefix(keep)), total - keep)
    }
}

/// 一行任务：圆圈 + 标题；子任务缩进一格；做完的（只在关掉「隐藏已完成」时出现）变灰并划线。
/// 刚点过、插件还没处理的，先按点完的样子画（pending）。
struct LineRow: View {
    let line: TaskLine
    /// 这一格的主色：没做完的圆圈用它
    var color: Color = .secondary
    var vault: String = ""
    var pending: [String: Bool] = [:]

    var body: some View {
        // 现在该画成什么状态：有还没处理的点击就按点击的来
        let done = line.id.flatMap { pending[$0] } ?? line.done
        HStack(spacing: 0) {
            if line.depth > 0 {
                Color.clear.frame(width: MatrixMetrics.indent * CGFloat(line.depth), height: 1)
            }
            check(done: done)
            Text(line.text)
                .font(.system(size: MatrixMetrics.lineFont))
                .foregroundStyle(done ? .secondary : .primary)
                .strikethrough(done)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(height: MatrixMetrics.lineHeight, alignment: .leading)
    }

    /// 圆圈：没做完是这一格主色的空心圈，做完是绿色对勾；能点时整块是一个链接（点了变成相反的状态）
    @ViewBuilder
    private func check(done: Bool) -> some View {
        let icon = Image(systemName: done ? "checkmark.circle.fill" : "circle")
            .font(.system(size: line.depth > 0 ? MatrixMetrics.subCheckSize : MatrixMetrics.checkSize))
            .foregroundStyle(done ? matrixDoneColor : color)
            .frame(width: MatrixMetrics.checkWidth, height: MatrixMetrics.lineHeight, alignment: .leading)
            .contentShape(Rectangle())
        if let url = ToggleLink.url(vault: vault, line: line, done: !done) {
            Link(destination: url) { icon }
        } else {
            icon
        }
    }
}

/// 读不到数据时显示的一段说明
struct WidgetMessageView: View {
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Text("ChaoChaoList")
                .font(.system(size: MatrixMetrics.titleFont, weight: .semibold))
                .foregroundStyle(Color.accentColor)
            Text(text)
                .font(.system(size: MatrixMetrics.lineFont))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
