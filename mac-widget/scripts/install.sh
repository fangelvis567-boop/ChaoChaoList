#!/usr/bin/env bash
# =============================================================================
# 编译并安装「ChaoChaoList 小组件」（Mac 桌面小组件的宿主程序 + 小组件扩展）
# -----------------------------------------------------------------------------
# 用法（在哪个目录运行都行）：
#   bash mac-widget/scripts/install.sh --dry-run   试运行：只检查环境、打印将要做什么，不改任何东西
#   bash mac-widget/scripts/install.sh             正式安装：编译、签名、装到 /Applications，向系统登记，在后台启动一次
#   bash mac-widget/scripts/install.sh --package   只打安装包：编译、签名后压缩成 mac-widget/build/ChaoChaoListWidgets.zip，
#                                                 不安装、不碰系统（发布脚本 scripts/release.sh 用它给另一台 Mac 准备安装包）
#   SIGN_ID="Apple Development: 名字 (团队号)" bash mac-widget/scripts/install.sh
#                                                 用开发者证书签名。不写 SIGN_ID 时用本机临时签名「-」，
#                                                 不需要 Apple ID；系统若不认临时签名的小组件，再改用证书
#
# 编出来的是「通用」程序：M 系列芯片（arm64）和 Intel 芯片（x86_64）的 Mac 都能用。要求 macOS 14 或更新。
#
# 它会读写什么：
#   读：mac-widget/Sources、mac-widget/Resources 里的源码、配置、程序图标（AppIcon.icns）和各语言的程序名（*.lproj）；
#       Xcode 自带的编译器（swiftc、lipo）和 macOS SDK
#   写：
#     1. mac-widget/build/：编译产物 ChaoChaoListWidgets.app（--package 时另有 ChaoChaoListWidgets.zip）；
#        build 目录已被 git 忽略，每次先清空它重新编译
#     （以下只在正式安装时）
#     2. /Applications/ChaoChaoListWidgets.app：
#        已经装过时，先结束正在运行的旧版小程序和小组件进程，把旧版整个移到
#        ~/Developer/dada-plugin-backups/<日期时间>-小组件旧版/ 里（不删除），再放入新版
#     3. 向系统登记新版：
#        lsregister —— 让系统认得 chaochaolist-widget:// 这种网址（插件用它请小程序刷新小组件）
#        pluginkit  —— 让「编辑小组件」里出现 ChaoChaoList 的小组件
#     4. 在后台启动一次小程序（open -g：不开窗口、不占 Dock），它会请系统刷新一次小组件
#   不碰：Obsidian 的库和插件、系统设置；不加登录项（之后由插件在任务变化时按需唤起它）
#
# 卸载：把 /Applications/ChaoChaoListWidgets.app 移到废纸篓即可（先在桌面上移除小组件）。
# =============================================================================
set -euo pipefail

DRY_RUN=0
PACKAGE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --package) PACKAGE=1 ;;
    *) echo "不认识的参数：$arg（只接受 --dry-run、--package）" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
fail() { printf '停下：%s\n' "$*" >&2; exit 1; }

# ---------- 路径与名字 ----------
HERE="$(cd "$(dirname "$0")/.." && pwd)"          # mac-widget 目录
BUILD="$HERE/build"                               # 编译产物目录
NAME="ChaoChaoListWidgets"                        # 宿主程序名（也是可执行文件名）
EXT_NAME="${NAME}Extension"                       # 小组件扩展名
APP="$BUILD/$NAME.app"
APPEX="$APP/Contents/PlugIns/$EXT_NAME.appex"
ZIP="$BUILD/$NAME.zip"                            # --package 的安装包（名字固定，发布页上的下载链接靠它）
DEST="/Applications/$NAME.app"                    # 安装位置（插件 services/widgetExport.js 按这个位置找它）
BACKUP_ROOT="$HOME/Developer/dada-plugin-backups" # 旧版移到这里
SIGN_ID="${SIGN_ID:--}"                           # 签名身份：「-」= 本机临时签名
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
WIDGET_ID="app.chaochaolist.widgets.extension"    # 小组件扩展的标识（与 Widget-Info.plist 一致）
ARCHS="arm64 x86_64"                              # 两种芯片都编，再合成一个通用程序
MIN_OS="14.0"                                     # 最低系统版本（与两个 Info.plist 的 LSMinimumSystemVersion 一致）

# ---------- 1. 检查环境（只读）----------
command -v xcrun >/dev/null 2>&1 || fail "找不到 xcrun：需要先装 Xcode"
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" || fail "找不到 macOS SDK：请确认 Xcode 装好并打开过一次"
SWIFTC="$(xcrun --sdk macosx --find swiftc 2>/dev/null)" || fail "找不到 swiftc"
LIPO="$(xcrun --sdk macosx --find lipo 2>/dev/null)" || fail "找不到 lipo"
if [ "$PACKAGE" = 0 ]; then
  [ -x "$LSREGISTER" ] || fail "找不到系统的 lsregister：$LSREGISTER"
  command -v pluginkit >/dev/null 2>&1 || fail "找不到系统的 pluginkit"
fi
if [ "$SIGN_ID" != "-" ]; then
  security find-identity -v -p codesigning | grep -qF "$SIGN_ID" || fail "钥匙串里没有这个签名证书：$SIGN_ID"
fi
for f in Resources/App-Info.plist Resources/Widget-Info.plist Resources/Widget.entitlements \
         Resources/AppIcon.icns Resources/zh-Hans.lproj/InfoPlist.strings \
         Sources/App/HelperApp.swift Sources/Widget/ChaoChaoListWidgets.swift \
         Sources/Shared/WidgetData.swift Sources/Shared/MatrixWidgetView.swift Sources/Shared/MonthWidgetView.swift; do
  [ -f "$HERE/$f" ] || fail "缺少文件：mac-widget/$f"
done
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$HERE/Resources/App-Info.plist")"

say "编译器：$SWIFTC"
say "小组件程序版本：$VERSION；芯片：$ARCHS（通用程序）；签名：$([ "$SIGN_ID" = "-" ] && echo '本机临时签名（-）' || echo "$SIGN_ID")"
if [ "$PACKAGE" = 1 ]; then
  say "只打安装包：$ZIP（不安装）"
elif [ -e "$DEST" ]; then
  say "已装过：$DEST（安装时会先移到 $BACKUP_ROOT/<日期时间>-小组件旧版/）"
else
  say "还没装过：将新装到 $DEST"
fi

if [ "$DRY_RUN" = 1 ]; then
  say ""
  say "（试运行，什么都没改）正式运行时将依次："
  say "  - 清空并重建 $BUILD，按 $ARCHS 两种芯片各编一遍宿主程序和小组件扩展，合成通用程序，组装成 $NAME.app"
  say "  - 签名：先签小组件扩展（带 Resources/Widget.entitlements 里的沙盒权限），再签宿主程序"
  if [ "$PACKAGE" = 1 ]; then
    say "  - 压缩成 $ZIP，然后结束（不安装、不碰系统）"
    exit 0
  fi
  if [ -e "$DEST" ]; then
    say "  - 结束正在运行的旧版小程序，把旧版 $DEST 移到备份文件夹"
  fi
  say "  - 把新版复制到 $DEST，用 lsregister、pluginkit 向系统登记"
  say "  - 用 open -g 在后台启动一次小程序，然后检查系统有没有认出小组件"
  exit 0
fi

# ---------- 2. 编译、组装 ----------
say "== 编译 =="
rm -rf "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APPEX/Contents/MacOS" "$BUILD/bin"
for arch in $ARCHS; do
  "$SWIFTC" -O -target "$arch-apple-macos$MIN_OS" -sdk "$SDK" -parse-as-library -module-name "$NAME" \
    -o "$BUILD/bin/$NAME-$arch" \
    "$HERE/Sources/App/HelperApp.swift"
  # 小组件扩展必须从系统的 NSExtensionMain 启动（Xcode 打包小组件时也是这样，用 -e 指定入口）；
  # 直接从 Swift 的 main 启动的话，系统一加载它就崩溃（ExtensionMain 没设好扩展类型），「编辑小组件」里列不出来
  "$SWIFTC" -O -target "$arch-apple-macos$MIN_OS" -sdk "$SDK" -parse-as-library -application-extension \
    -module-name "$EXT_NAME" -Xlinker -e -Xlinker _NSExtensionMain \
    -o "$BUILD/bin/$EXT_NAME-$arch" \
    "$HERE"/Sources/Shared/*.swift "$HERE"/Sources/Widget/*.swift
done
# 合成通用程序（两种芯片的代码放进同一个文件，系统按本机芯片挑着用）
APP_PARTS=(); EXT_PARTS=()
for arch in $ARCHS; do
  APP_PARTS+=("$BUILD/bin/$NAME-$arch")
  EXT_PARTS+=("$BUILD/bin/$EXT_NAME-$arch")
done
"$LIPO" -create "${APP_PARTS[@]}" -output "$APP/Contents/MacOS/$NAME"
"$LIPO" -create "${EXT_PARTS[@]}" -output "$APPEX/Contents/MacOS/$EXT_NAME"
rm -rf "$BUILD/bin"
cp "$HERE/Resources/App-Info.plist" "$APP/Contents/Info.plist"
cp "$HERE/Resources/Widget-Info.plist" "$APPEX/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
# 程序图标和各语言的程序名（「编辑小组件」里显示 ChaoChaoList，靠的是这些语言包）
mkdir -p "$APP/Contents/Resources"
cp "$HERE/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
for lproj in "$HERE"/Resources/*.lproj; do
  cp -R "$lproj" "$APP/Contents/Resources/"
done

# ---------- 3. 签名（先里后外）----------
say "== 签名 =="
codesign --force --sign "$SIGN_ID" --entitlements "$HERE/Resources/Widget.entitlements" "$APPEX"
codesign --force --sign "$SIGN_ID" "$APP"
codesign --verify --deep --strict "$APP"

# ---------- 只打安装包：压缩后结束 ----------
if [ "$PACKAGE" = 1 ]; then
  say "== 打包 =="
  # ditto 压缩会保留程序包的结构和签名（普通 zip 命令可能弄坏签名）
  ditto -c -k --keepParent "$APP" "$ZIP"
  say "安装包：$ZIP（$(stat -f %z "$ZIP") 字节，sha256 $(shasum -a 256 "$ZIP" | cut -d' ' -f1)）"
  exit 0
fi

# ---------- 4. 安装 ----------
say "== 安装 =="
if [ -e "$DEST" ]; then
  pkill -x "$NAME" 2>/dev/null || true   # 结束正在运行的旧版小程序（没在运行就跳过）
  # 也结束正在运行的旧版小组件进程：不结束的话，系统会一直找这个旧进程，
  # 拿不到新版的小组件清单（新加的小组件不出现），画图也会失败。系统需要时会自动启动新版
  pkill -x "$EXT_NAME" 2>/dev/null || true
  BK="$BACKUP_ROOT/$(date +%Y-%m-%d-%H%M%S)-小组件旧版"
  mkdir -p "$BK"
  mv "$DEST" "$BK/"
  say "旧版已移到：$BK"
fi
ditto "$APP" "$DEST"
"$LSREGISTER" -f "$DEST"
pluginkit -a "$DEST/Contents/PlugIns/$EXT_NAME.appex"
open -g "$DEST"

# ---------- 5. 核对 ----------
say "== 核对 =="
say "已装到：$DEST"
if pluginkit -m -p com.apple.widgetkit-extension -i "$WIDGET_ID" 2>/dev/null | grep -qF "$WIDGET_ID"; then
  say "系统已登记小组件：$(pluginkit -m -p com.apple.widgetkit-extension -i "$WIDGET_ID" | head -1 | sed 's/^ *//')"
else
  say "注意：系统里暂时查不到小组件 $WIDGET_ID（可能还在登记，稍后用下面这行再查）："
  say "  pluginkit -m -p com.apple.widgetkit-extension -i $WIDGET_ID"
fi
say "下一步：在桌面空白处右键 →「编辑小组件」，搜索 ChaoChaoList，把「四象限」「月视图」拖到桌面。"
