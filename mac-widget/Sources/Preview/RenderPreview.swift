// =============================================================================
// 开发用：把小组件的界面画成 PNG 图片（不装进程序，也不碰系统）
// -----------------------------------------------------------------------------
// 用法：RenderPreview <数据文件.json> <输出.png> [--kind matrix|month] [--size 宽x高] [--today YYYY-MM-DD] [--dark]
//   --kind  ：画哪个小组件，默认 matrix（四象限）；month = 月视图
//   --size  ：小组件的尺寸（点），默认 344x344
//   --today ：月视图按哪天当「今天」，默认今天
//   --dark  ：按深色模式画
// 读：命令行给的数据文件；写：命令行给的那一张 PNG。
// 画出来的图和桌面上的真实小组件大致相同（系统给小组件留的边距、字体渲染会略有差别），
// 用来在装进系统之前先核对排版。
// =============================================================================
import AppKit
import SwiftUI

@main
struct RenderPreview {
    @MainActor
    static func main() {
        var args = Array(CommandLine.arguments.dropFirst())
        guard args.count >= 2 else {
            fail("用法：RenderPreview <数据文件.json> <输出.png> [--kind matrix|month] [--size 宽x高] [--today YYYY-MM-DD] [--dark]")
        }
        let dataPath = args.removeFirst()
        let outPath = args.removeFirst()
        var kind = "matrix", width = 344.0, height = 344.0, dark = false
        var today = Date()
        while !args.isEmpty {
            let a = args.removeFirst()
            switch a {
            case "--kind": kind = args.isEmpty ? kind : args.removeFirst()
            case "--size":
                let p = (args.isEmpty ? "" : args.removeFirst()).split(separator: "x").compactMap { Double($0) }
                if p.count == 2 { width = p[0]; height = p[1] }
            case "--today":
                let p = (args.isEmpty ? "" : args.removeFirst()).split(separator: "-").compactMap { Int($0) }
                if p.count == 3, let d = Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) {
                    today = d
                }
            case "--dark": dark = true
            default: fail("不认识的参数：\(a)")
            }
        }

        let data: WidgetData
        switch WidgetDataStore.load(from: URL(fileURLWithPath: dataPath)) {
        case .ok(let d): data = d
        case .missing: fail("找不到数据文件")
        case .unreadable(let why): fail(why)
        case .unsupported(let v): fail("数据格式版本 \(v) 太新")
        }

        let content: AnyView
        switch kind {
        case "month":
            guard let m = data.month else { fail("数据里没有月视图") }
            guard let grid = MonthDates.grid(for: today, in: m) else { fail("数据里没有 \(MonthDates.monthKey(today)) 这个月") }
            content = AnyView(MonthWidgetView(data: m, grid: grid, todayKey: MonthDates.dayKey(today),
                                              monthURL: nil, dayURL: { _ in nil }))
        default:
            guard let m = data.matrix else { fail("数据里没有四象限") }
            content = AnyView(MatrixWidgetView(data: m))
        }

        let view = content
            .padding(16) // 系统给小组件内容留的边距（约 16 点）
            .frame(width: width, height: height)
            .background(dark ? Color(white: 0.17) : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, dark ? .dark : .light)

        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            fail("画图失败")
        }
        do {
            try png.write(to: URL(fileURLWithPath: outPath))
        } catch {
            fail("写图片失败：\(error.localizedDescription)")
        }
    }

    static func fail(_ message: String) -> Never {
        FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
        exit(1)
    }
}
