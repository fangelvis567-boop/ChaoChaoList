// =============================================================================
// 宿主程序 ChaoChaoListWidgets.app
// -----------------------------------------------------------------------------
// macOS 的小组件必须装在一个程序里，这个程序就是它的「宿主」。它不开窗口、不占 Dock、不在菜单栏显示
// （Info.plist 里 LSUIElement = true），只做三件事：
//   1. 收到 chaochaolist-widget://reload（插件写完新数据后用 `open -g` 发来）
//      → 请系统重新读取小组件数据（WidgetCenter.reloadAllTimelines）
//   2. 收到 chaochaolist-widget://toggle?r=…（0.4.0 起：点四象限小组件里任务前面的圆圈时，系统交过来）
//      → 检查后把这条勾选请求写成 ~/Library/Application Support/ChaoChaoList/requests/ 里的一个小文件，
//        再请系统刷新小组件（小组件会先按点完的样子画）。Obsidian 里的插件看到文件后去改任务、删掉文件
//        （插件 services/widgetToggle.js）。请求的格式见 Sources/Shared/WidgetData.swift 的 ToggleRequest。
//   3. 收到 obsidian://…（点小组件时，系统可能把地址交给宿主程序转发）
//      → 交给 Obsidian 打开；别的网址一律不处理
// 启动时也会请系统刷新一次。除了上面那个请求文件夹，它不读写别的文件，也不联网。
// 不加登录项：插件每次写出新数据时会用 `open -g` 唤起它，所以开机后不必常驻。
// =============================================================================
import AppKit
import WidgetKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// 系统把网址交给本程序时调用（包括启动时带来的网址）
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { handle(url) }
    }

    private func handle(_ url: URL) {
        switch url.scheme?.lowercased() {
        case "chaochaolist-widget":
            if url.host == "reload" {
                WidgetCenter.shared.reloadAllTimelines()
            } else if url.host == "toggle" {
                if ToggleInbox.save(from: url) { WidgetCenter.shared.reloadAllTimelines() }
            }
        case "obsidian":
            NSWorkspace.shared.open(url)
        default:
            break
        }
    }
}

/// 一条勾选请求（和 Sources/Shared/WidgetData.swift 的 ToggleRequest、插件 composables/widgetToggle.js 的格式一致；
/// 宿主程序单独编译、用不到 Shared 里的代码，所以这里再写一份）
private struct ToggleRequestFile: Codable {
    var v: Int
    var vault: String
    var id: String
    var text: String
    var done: Bool
    var at: Double?
}

/// 把点圆圈发来的勾选请求写成文件
enum ToggleInbox {
    /// 请求文件夹：~/Library/Application Support/ChaoChaoList/requests/
    static var dirURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ChaoChaoList/requests", isDirectory: true)
    }

    /// 从 chaochaolist-widget://toggle?r=… 里取出请求，检查后写进文件夹；写成了返回 true，内容不对就什么也不做
    static func save(from url: URL) -> Bool {
        guard let r = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "r" })?.value,
              let raw = decodeBase64URL(r),
              var req = try? JSONDecoder().decode(ToggleRequestFile.self, from: raw),
              req.v == 1, !req.vault.isEmpty, !req.id.isEmpty,
              req.vault.count <= 500, req.id.count <= 2000, req.text.count <= 2000
        else { return false }
        let now = Date().timeIntervalSince1970 * 1000
        req.at = now
        guard let out = try? JSONEncoder().encode(req) else { return false }
        do {
            try FileManager.default.createDirectory(at: dirURL, withIntermediateDirectories: true)
            // 文件名以点击时间（毫秒，补足 13 位）开头：插件按文件名排序就是点击的先后；后面加一段随机串防重名
            let name = String(format: "%013.0f-", now) + UUID().uuidString + ".json"
            try out.write(to: dirURL.appendingPathComponent(name), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// base64url（- _ 代替 + /，没有末尾的 =）→ 原始字节
    private static func decodeBase64URL(_ s: String) -> Data? {
        var b64 = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        return Data(base64Encoded: b64)
    }
}

@main
struct HelperMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // 与 LSUIElement 一致：不出现在 Dock 和 ⌘Tab 里
        app.run()
    }
}
