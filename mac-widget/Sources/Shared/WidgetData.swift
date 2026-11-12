// =============================================================================
// 小组件读的数据（与插件 src/core/composables/widgetSnapshot.js 写出的格式一一对应）
// -----------------------------------------------------------------------------
// 数据文件：~/Library/Application Support/ChaoChaoList/widget-data.json
//   由 Obsidian 里的 ChaoChaoList 插件在任务变化时写出（services/widgetExport.js）。
// 插件那边改了数据格式（WIDGET_DATA_VERSION 加 1）时，这里要同步改，并把 supportedVersion 改成新版本号。
// =============================================================================
import Foundation
import SwiftUI

/// 整份数据
struct WidgetData: Decodable, Sendable {
    /// 数据格式版本
    let version: Int
    /// 插件写出这份数据的时间（毫秒时间戳），排查「小组件是不是旧的」时看它
    let generatedAt: Double?
    /// 库名（点小组件时打开这个库）
    let vault: String
    /// 点小组件时打开的地址：键是视图（目前只有 matrix），值是 obsidian://chaochao-list?vault=…&view=…
    let openUrl: [String: String]
    /// 四象限的内容
    let matrix: MatrixData?
}

/// 四象限
struct MatrixData: Decodable, Sendable {
    /// 小组件标题（「四象限」，随插件语言）
    let title: String
    /// 某一格没有任务时显示的文字（「暂无任务」）
    let emptyText: String
    /// 放不下时最后一行的文字（「还有 {n} 条」，{n} 换成数字）
    let moreText: String
    /// 四格，顺序为左上、右上、左下、右下
    let quadrants: [Quadrant]
}

/// 四象限里的一格
struct Quadrant: Decodable, Sendable, Identifiable {
    /// 优先级档位：high / medium / low / none
    let level: String
    /// 格子标题（「重要且紧急」等）
    let title: String
    /// 标题颜色（#rrggbb）
    let color: String
    /// 这一格一共有多少行（含子任务行）；items 可能被插件截短，用它算「还有 N 条」
    let total: Int
    /// 要显示的行（已按插件里的顺序排好）
    let items: [TaskLine]
    var id: String { level }
}

/// 一行任务
struct TaskLine: Decodable, Sendable, Hashable {
    /// 标题（已去掉 #标签）
    let text: String
    /// 0 = 主任务，1 = 子任务（缩进一格）
    let depth: Int
    /// 是否已完成（只有关掉「隐藏已完成」时才会出现做完的）
    let done: Bool
}

/// 读数据文件
enum WidgetDataStore {
    /// 本程序认得的最高数据格式版本（插件的 WIDGET_DATA_VERSION）
    static let supportedVersion = 1

    /// 真实的用户主目录。小组件运行在系统沙盒里，NSHomeDirectory() 返回的是沙盒容器而不是 /Users/你，
    /// 所以从系统的用户表里取。
    static var realHome: String {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            return String(cString: dir)
        }
        return NSHomeDirectory()
    }

    /// 数据文件的位置
    static var fileURL: URL {
        URL(fileURLWithPath: realHome)
            .appendingPathComponent("Library/Application Support/ChaoChaoList/widget-data.json")
    }

    /// 读取结果
    enum LoadResult: Sendable {
        /// 读到了
        case ok(WidgetData)
        /// 文件还不存在（插件还没写过）
        case missing
        /// 读不了或内容坏了（附原因）
        case unreadable(String)
        /// 数据格式比本程序新（附版本号）
        case unsupported(Int)
    }

    /// 读一次数据文件
    static func load(from url: URL = fileURL) -> LoadResult {
        let raw: Data
        do {
            raw = try Data(contentsOf: url)
        } catch let e as CocoaError where e.code == .fileReadNoSuchFile {
            return .missing
        } catch let e as CocoaError where e.code == .fileReadNoPermission {
            return .unreadable("没有权限读取数据文件")
        } catch {
            return .unreadable(error.localizedDescription)
        }
        do {
            let d = try JSONDecoder().decode(WidgetData.self, from: raw)
            if d.version > supportedVersion { return .unsupported(d.version) }
            return .ok(d)
        } catch {
            return .unreadable("数据文件内容不对：\(error.localizedDescription)")
        }
    }
}

extension WidgetData {
    /// 示例数据：在「编辑小组件」里预览、还没有真实数据时显示
    static let sample = WidgetData(
        version: 1, generatedAt: nil, vault: "", openUrl: [:],
        matrix: MatrixData(
            title: "四象限", emptyText: "暂无任务", moreText: "还有 {n} 条",
            quadrants: [
                Quadrant(level: "high", title: "重要且紧急", color: "#e0584f", total: 2, items: [
                    TaskLine(text: "提交基金申请书", depth: 0, done: false),
                    TaskLine(text: "核对预算表", depth: 1, done: false)
                ]),
                Quadrant(level: "medium", title: "重要不紧急", color: "#e0a93b", total: 1, items: [
                    TaskLine(text: "整理文献笔记", depth: 0, done: false)
                ]),
                Quadrant(level: "low", title: "紧急不重要", color: "#4a90d2", total: 0, items: []),
                Quadrant(level: "none", title: "不重要不紧急", color: "#4caf7d", total: 2, items: [
                    TaskLine(text: "听力精听", depth: 0, done: false),
                    TaskLine(text: "单词 201-400", depth: 0, done: false)
                ])
            ]
        )
    )
}

extension Color {
    /// 由 #rrggbb 生成颜色；写错时退回灰色
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        var v: UInt64 = 0
        guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else {
            self = .gray
            return
        }
        self.init(.sRGB,
                  red: Double((v >> 16) & 0xff) / 255,
                  green: Double((v >> 8) & 0xff) / 255,
                  blue: Double(v & 0xff) / 255,
                  opacity: 1)
    }
}
