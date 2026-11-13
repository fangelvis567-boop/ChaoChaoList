// ============================================================================
// Mac 小组件程序自动更新（自用改版）用到的纯函数：比版本、拼下载地址。
// 怎么用见 services/widgetAppUpdate.js；这里不依赖 Obsidian，方便自动测试。
// ============================================================================

/** 发布小组件安装包的 GitHub 仓库（和 scripts/release.sh 的 REPO_SLUG 一致） */
export const WIDGET_APP_REPO = 'fangelvis567-boop/ChaoChaoList';

/** 发布页上安装包的文件名（名字固定） */
export const WIDGET_ZIP_NAME = 'ChaoChaoListWidgets.zip';

/** 两个构建号（Info.plist 的 CFBundleVersion，纯数字）比大小：a 比 b 旧返回负数；不是数字返回 NaN */
export function compareBuild(a, b) {
  // 必须是纯数字的字符串（空串、带别的字符都不算；Number('') 会得到 0，不能用它判断）
  const isNum = (s) => /^\d+$/.test(String(s == null ? '' : s));
  if (!isNum(a) || !isNum(b)) return NaN;
  return Number(a) - Number(b);
}

/**
 * 要不要更新：装着的小组件程序比这版插件配套的旧，才更新。
 * 一样新、更新（比如手动装了更新的版本），或者读不出版本号，都不动——绝不往旧了换。
 * installed / want：{ version: '0.4.0', build: '6' }
 */
export function needsWidgetUpdate(installed, want) {
  if (!installed || !want) return false;
  const c = compareBuild(installed.build, want.build);
  return Number.isFinite(c) && c < 0;
}

/** 这版插件配套的小组件安装包的下载地址：和插件在同一个发布版本里 */
export function widgetZipUrl(pluginVersion, repo = WIDGET_APP_REPO) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(pluginVersion)}/${WIDGET_ZIP_NAME}`;
}
