// =============================================================================
// 四象限小组件的界面（大尺寸）
// -----------------------------------------------------------------------------
// 排版参照滴答清单的四象限小组件：顶上标题，下面 2×2 四格，格子之间细线分隔；
// 每格是彩色小标题 + 任务标题（子任务缩进一格），没有任务写「暂无任务」，放不下时最后一行写「还有 N 条」。
// 只显示、不能勾选；点小组件任意处打开 Obsidian 的四象限视图（地址由调用方用 widgetURL 设置）。
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
}

struct MatrixWidgetView: View {
    let data: MatrixData

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
            QuadrantCell(quad: data.quadrants[i], emptyText: data.emptyText, moreText: data.moreText)
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
                        LineRow(line: line)
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

/// 一行任务：子任务缩进一格；做完的（只在关掉「隐藏已完成」时出现）变灰并划线
struct LineRow: View {
    let line: TaskLine

    var body: some View {
        HStack(spacing: 0) {
            if line.depth > 0 {
                Color.clear.frame(width: MatrixMetrics.indent * CGFloat(line.depth), height: 1)
            }
            Text(line.text)
                .font(.system(size: MatrixMetrics.lineFont))
                .foregroundStyle(line.done ? .secondary : .primary)
                .strikethrough(line.done)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(height: MatrixMetrics.lineHeight, alignment: .leading)
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
