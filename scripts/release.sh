#!/usr/bin/env bash
# =============================================================================
# 发布 Dada 自用改版到 GitHub，供安卓上的 BRAT 下载、更新
# -----------------------------------------------------------------------------
# 用法（在仓库根目录）：
#   bash scripts/release.sh --dry-run    试运行：只做检查、打印将要做什么，不改任何东西
#   bash scripts/release.sh              正式发布：当前版本还没发布过就直接发；发布过就把版本号末位 +1 再发
#   bash scripts/release.sh 1.1.0        正式发布：用指定的版本号（不能比当前小，格式 x.y.z）
#
# 它会读写什么：
#   读：仓库里的 manifest.json、package.json、package-lock.json、versions.json；git 状态；
#       GitHub 上已有的标签和发布版本（用 gh 只读查询）
#   写（只在正式发布时）：
#     1. 需要换版本号时：改上面四个文件里的版本号，提交一次「chore: 发布 x.y.z」并推送 main
#     2. 运行 node tests/run.mjs（测试）和 npm run build（构建）。
#        构建产物写进 dada-todo-list/ 目录——测试库的 Dada 插件目录软链到这里，会一起变成新版
#     3. 打标签 x.y.z 并推送到 GitHub
#     4. 在 GitHub 私有仓库里创建发布版本 x.y.z，附上 main.js、manifest.json、styles.css
#   不碰：任何 Obsidian 库。主库要装新版，仍按原来的流程：先备份插件目录，再复制这三个文件
#
# BRAT 的规则（据 BRAT 2.2.0 源码）：
#   - 只认 GitHub 的「发布版本」(Release)，不认普通提交；
#   - 发布版本里必须有 manifest.json 和 main.js，styles.css 可选；
#   - 标签名就是版本号（不带 v）；BRAT 按版本号比大小判断有没有新版，所以每次发布版本号都要变大。
# =============================================================================
set -euo pipefail

REPO_SLUG="fangelvis567-boop/ChaoChaoList"         # GitHub 上的私有仓库（2026-11-11 由 dada-todo-list-mod 改名）
BUILD_DIR="dada-todo-list"                         # 构建产物目录（vite.config.js 里的 OUT_DIR）
DRY_RUN=0
WANT_VERSION=""

# ---------- 读参数 ----------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    [0-9]*.[0-9]*.[0-9]*) WANT_VERSION="$arg" ;;
    *) echo "不认识的参数：$arg（只接受 --dry-run 和 x.y.z 形式的版本号）" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
fail() { printf '停下：%s\n' "$*" >&2; exit 1; }

# 不管从哪里运行，都切到仓库根目录
cd "$(git rev-parse --show-toplevel)"

# ---------- 1. 动手前的检查（都只读）----------
# 检查不通过时：正式运行直接停下；试运行只提示一声、接着往下看，好一次看全所有情况
guard() { if [ "$DRY_RUN" = 1 ]; then printf '提示（正式运行时会在这里停下）：%s\n' "$1"; else fail "$1"; fi; }
[ "$(git branch --show-current)" = "main" ] || guard "当前不在 main 分支"
[ -z "$(git status --porcelain)" ] || guard "仓库里有未提交的改动，先提交或撤销"
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] || guard "本地 main 和 GitHub 上的 main 不一致，先同步"
gh auth status >/dev/null 2>&1 || guard "gh 没有登录 GitHub"

CUR=$(node -p "require('./manifest.json').version")           # 当前版本号
MIN_APP=$(node -p "require('./manifest.json').minAppVersion")  # 要求的最低 Obsidian 版本（写进 versions.json）

# 标签是否已存在（本地或 GitHub 上任一处有就算）
tag_exists() {
  git rev-parse -q --verify "refs/tags/$1" >/dev/null && return 0
  [ -n "$(git ls-remote --tags origin "refs/tags/$1")" ]
}
# GitHub 上是否已有这个发布版本
release_exists() { gh release view "$1" -R "$REPO_SLUG" >/dev/null 2>&1; }

# ---------- 2. 定版本号 ----------
if [ -n "$WANT_VERSION" ]; then
  NEW="$WANT_VERSION"
elif ! tag_exists "$CUR" && ! release_exists "$CUR"; then
  NEW="$CUR"   # 当前版本还没发布过（比如第一次发布）：直接发这一版，不改版本号
else
  NEW=$(node -p "const v = '$CUR'.split('.').map(Number); v[2] += 1; v.join('.')")
fi
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "版本号格式不对：$NEW（要 x.y.z）"
tag_exists "$NEW" && fail "标签 $NEW 已经存在"
release_exists "$NEW" && fail "发布版本 $NEW 已经存在"
# 新版本号不能比当前小（BRAT 按版本号比大小判断新旧）
node -e "
  const a = '$NEW'.split('.').map(Number), b = '$CUR'.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] > b[i]) process.exit(0); if (a[i] < b[i]) process.exit(1); }
" || fail "新版本号 $NEW 比当前的 $CUR 小"

# 发布说明：GitHub 上最近一个发布版本以来的提交标题；第一次发布时列出相对作者原版的全部提交。
# （按「最近的发布版本」找，而不是按标签名的样式找：仓库里还留着作者原版的 0.x 标签）
PREV_TAG=$(gh release list -R "$REPO_SLUG" --limit 1 --json tagName --jq '.[0].tagName // empty' 2>/dev/null || true)
if [ -n "$PREV_TAG" ]; then
  RANGE="$PREV_TAG..HEAD"
elif git rev-parse -q --verify upstream/main >/dev/null; then
  RANGE="upstream/main..HEAD"
else
  RANGE="-20"
fi
NOTES="自用改版 $NEW（供 BRAT 安装 / 更新）

$(git log --no-merges --format='- %s' $RANGE)"

say "当前版本：$CUR → 这次发布：$NEW"
say "发布说明："
say "$NOTES"
say ""

if [ "$DRY_RUN" = 1 ]; then
  say "（试运行，什么都没改）正式运行时将依次："
  if [ "$NEW" != "$CUR" ]; then
    say "  - 把 manifest.json、package.json、package-lock.json、versions.json 里的版本号改为 $NEW，提交「chore: 发布 $NEW」并推送 main"
  fi
  say "  - 运行测试 node tests/run.mjs，构建 npm run build"
  say "  - 打标签 $NEW 并推送到 GitHub"
  say "  - 在 $REPO_SLUG 创建发布版本 $NEW，附上 $BUILD_DIR/main.js、manifest.json、$BUILD_DIR/styles.css"
  exit 0
fi

# ---------- 3. 需要时改版本号（保持原文件的 2 空格缩进和结尾换行）----------
if [ "$NEW" != "$CUR" ]; then
  node - "$NEW" "$MIN_APP" <<'JS'
const fs = require('fs');
const [ver, minApp] = process.argv.slice(-2);
// 读 JSON → 改 → 按 2 空格缩进写回；原文件结尾有换行就保留换行
function edit(path, change) {
  const raw = fs.readFileSync(path, 'utf8');
  const obj = JSON.parse(raw);
  change(obj);
  fs.writeFileSync(path, JSON.stringify(obj, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
}
edit('manifest.json', (o) => { o.version = ver; });
edit('package.json', (o) => { o.version = ver; });
edit('package-lock.json', (o) => {
  o.version = ver;
  if (o.packages && o.packages['']) o.packages[''].version = ver;
});
edit('versions.json', (o) => { o[ver] = minApp; });   // 版本号 → 最低 Obsidian 版本的对照表
JS
fi

# ---------- 4. 测试、构建 ----------
node tests/run.mjs
npm run build
for f in main.js styles.css manifest.json; do
  [ -s "$BUILD_DIR/$f" ] || fail "构建产物缺少 $BUILD_DIR/$f"
done
cmp -s manifest.json "$BUILD_DIR/manifest.json" || fail "构建目录里的 manifest.json 和仓库根目录的不一致"

# ---------- 5. 提交版本号、打标签、推送 ----------
if [ "$NEW" != "$CUR" ]; then
  git add manifest.json package.json package-lock.json versions.json
  git commit -q -m "chore: 发布 $NEW" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git push -q origin main
fi
git tag "$NEW"
git push -q origin "refs/tags/$NEW"

# ---------- 6. 在 GitHub 上创建发布版本 ----------
gh release create "$NEW" -R "$REPO_SLUG" --verify-tag --title "$NEW" --notes "$NOTES" \
  "$BUILD_DIR/main.js" "manifest.json" "$BUILD_DIR/styles.css"

say ""
say "已发布 $NEW：$(gh release view "$NEW" -R "$REPO_SLUG" --json url --jq .url)"
say "提醒：主库要装这一版，仍按原流程先备份插件目录，再复制 main.js、styles.css、manifest.json。"
