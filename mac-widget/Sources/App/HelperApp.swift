// =============================================================================
// 宿主程序 ChaoChaoListWidgets.app
// -----------------------------------------------------------------------------
// macOS 的小组件必须装在一个程序里，这个程序就是它的「宿主」。它不开窗口、不占 Dock、不在菜单栏显示
// （Info.plist 里 LSUIElement = true），只做两件事：
//   1. 收到 chaochaolist-widget://reload（插件写完新数据后用 `open -g` 发来）
//      → 请系统重新读取小组件数据（WidgetCenter.reloadAllTimelines）
//   2. 收到 obsidian://…（点小组件时，系统可能把地址交给宿主程序转发）
//      → 交给 Obsidian 打开；别的网址一律不处理
// 启动时也会请系统刷新一次。它不读写任何文件，也不联网。
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
            if url.host == "reload" { WidgetCenter.shared.reloadAllTimelines() }
        case "obsidian":
            NSWorkspace.shared.open(url)
        default:
            break
        }
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
