// =============================================================================
// 开发用：把四象限小组件的界面画成 PNG 图片（不装进程序，也不碰系统）
// -----------------------------------------------------------------------------
// 用法：RenderPreview <数据文件.json> <输出.png> [宽] [高] [dark]
//   宽、高：小组件的尺寸（点），默认 344×344；最后写 dark 则按深色模式画。
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
        let args = CommandLine.arguments
        guard args.count >= 3 else {
            FileHandle.standardError.write("用法：RenderPreview <数据文件.json> <输出.png> [宽] [高] [dark]\n".data(using: .utf8)!)
            exit(2)
        }
        let width = args.count > 3 ? Double(args[3]) ?? 344 : 344
        let height = args.count > 4 ? Double(args[4]) ?? 344 : 344
        let dark = args.count > 5 && args[5] == "dark"

        let matrix: MatrixData
        switch WidgetDataStore.load(from: URL(fileURLWithPath: args[1])) {
        case .ok(let d):
            guard let m = d.matrix else { fail("数据里没有四象限") }
            matrix = m
        case .missing: fail("找不到数据文件")
        case .unreadable(let why): fail(why)
        case .unsupported(let v): fail("数据格式版本 \(v) 太新")
        }

        let view = MatrixWidgetView(data: matrix)
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
            try png.write(to: URL(fileURLWithPath: args[2]))
        } catch {
            fail("写图片失败：\(error.localizedDescription)")
        }
    }

    static func fail(_ message: String) -> Never {
        FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
        exit(1)
    }
}
