// =============================================================================
// 开发用：画「ChaoChaoList 小组件」的程序图标
// -----------------------------------------------------------------------------
// 用法：MakeIcon <输出文件夹，名字以 .iconset 结尾>
//   在输出文件夹里写出 macOS 图标要的 10 张 PNG（16–1024 像素），
//   再用系统自带的 iconutil 打包：iconutil -c icns <文件夹>.iconset -o mac-widget/Resources/AppIcon.icns
// 读：什么也不读；写：只写命令行给的那个文件夹。
// 图案：macOS 风格的圆角方形，蓝色渐变底，中间一个白色勾选框（与插件侧边栏的「勾选框」图标同一个意思）。
// 想换图案就改下面的 AppIconArt，重新生成 AppIcon.icns 后重装小组件程序（版本号加一）。
// =============================================================================
import AppKit
import SwiftUI

/// 图标的画法（按 1024×1024 的画布设计）
struct AppIconArt: View {
    var body: some View {
        ZStack {
            // 底板：macOS 图标的圆角方形，1024 画布里占 824×824，四周留出阴影的位置
            RoundedRectangle(cornerRadius: 186, style: .continuous)
                .fill(LinearGradient(colors: [Color(red: 0.38, green: 0.73, blue: 1.0),
                                              Color(red: 0.18, green: 0.42, blue: 0.90)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 824, height: 824)
                .shadow(color: .black.opacity(0.28), radius: 20, x: 0, y: 12)
            // 上半部一点高光，看起来更立体
            RoundedRectangle(cornerRadius: 186, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.22), .white.opacity(0)],
                                     startPoint: .top, endPoint: .center))
                .frame(width: 824, height: 824)
            // 勾选框
            RoundedRectangle(cornerRadius: 96, style: .continuous)
                .stroke(Color.white, lineWidth: 58)
                .frame(width: 456, height: 456)
            // 对勾
            CheckMarkShape()
                .stroke(Color.white, style: StrokeStyle(lineWidth: 74, lineCap: .round, lineJoin: .round))
        }
        .frame(width: 1024, height: 1024)
    }
}

/// 对勾：三个点连成的折线（坐标按 1024 画布）
struct CheckMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let k = rect.width / 1024
        var p = Path()
        p.move(to: CGPoint(x: 392 * k, y: 522 * k))
        p.addLine(to: CGPoint(x: 482 * k, y: 612 * k))
        p.addLine(to: CGPoint(x: 650 * k, y: 418 * k))
        return p
    }
}

@main
struct MakeIcon {
    @MainActor
    static func main() {
        let args = CommandLine.arguments
        guard args.count == 2, args[1].hasSuffix(".iconset") else {
            fail("用法：MakeIcon <输出文件夹，名字以 .iconset 结尾>")
        }
        let out = URL(fileURLWithPath: args[1])
        do {
            try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        } catch {
            fail("建不了文件夹：\(error.localizedDescription)")
        }
        let renderer = ImageRenderer(content: AppIconArt())
        renderer.scale = 1
        guard let big = renderer.cgImage else { fail("画图失败") }
        // macOS 图标要的尺寸：名字里的 @2x 表示同一尺寸的两倍清晰度
        let sizes: [(String, Int)] = [
            ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
            ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
            ("icon_512x512", 512), ("icon_512x512@2x", 1024)
        ]
        for (name, px) in sizes {
            guard let space = CGColorSpace(name: CGColorSpace.sRGB),
                  let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
                fail("建不了画布")
            }
            ctx.interpolationQuality = .high
            ctx.draw(big, in: CGRect(x: 0, y: 0, width: px, height: px))
            guard let img = ctx.makeImage(),
                  let png = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:]) else {
                fail("缩小 \(name) 失败")
            }
            do {
                try png.write(to: out.appendingPathComponent(name + ".png"))
            } catch {
                fail("写 \(name).png 失败：\(error.localizedDescription)")
            }
        }
    }

    static func fail(_ message: String) -> Never {
        FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
        exit(1)
    }
}
