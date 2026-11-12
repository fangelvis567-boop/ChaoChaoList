// ============================================================================
// Mac 桌面小组件的数据（自用改版）
// ----------------------------------------------------------------------------
// 把小组件要显示的内容算成一份普通数据。services/widgetExport.js 把它写成本机的 JSON 文件，
// Mac 上的「ChaoChaoList 小组件」程序（仓库 mac-widget/ 目录）读这个文件显示。
// 这里只做计算：不读写文件、不碰界面，方便自动测试。
//
// 目前只有「四象限」。规则与面板的四象限视图（components/tasks/FourQuadrantView.vue）一致：
//   - 按优先级分进四格（见 matrixQuads.js），已取消的任务不算；
//   - 每格里待办在前，按到期时间从早到晚排，所以过期的排在最上面，没日期的放最后；
//     （面板里是按「已过期 / 今天 / 明天 / 以后各天 / 无日期」分组，组内按到期时间排，
//       连起来就是这个顺序）
//   - 关掉「隐藏已完成」时，已完成的接在待办后面，按完成时间从近到远；
//   - 主任务的子任务（没有折叠时）缩进一格列在主任务下面，开着「隐藏已完成」时不列做完的子任务；
//     子任务只跟着主任务走，不按自己的优先级分到别的格子；
//   - 标题去掉 #标签、链接只留文字（与月视图里任务标题的写法一致）。
//
// 数据格式变了（增删字段、改含义）时：把 WIDGET_DATA_VERSION 加 1，
// 并同步修改 mac-widget/Sources/Shared/WidgetData.swift。
// ============================================================================
import { priorityToLevel, plainInline } from './tasks-logic.js';
import { hasSubtasks, visibleSubtasks } from './subtasks.js';
import { MATRIX_QUADS } from './matrixQuads.js';

/** 数据格式的版本号（小组件据此判断认不认识这份数据） */
export const WIDGET_DATA_VERSION = 1;

/** 每格最多写进多少行：小组件只显示放得下的那几行，多写一些留给以后更大的尺寸 */
export const MATRIX_MAX_ITEMS = 40;

/**
 * 小组件里显示的任务标题：去掉 #标签，链接 [文字](地址) 只留文字，多余空白合并。
 * 去完什么都不剩时（比如整行只有标签），退回原文，免得出现空行。
 * @param {string} summary 任务行的标题原文
 * @returns {string}
 */
export function widgetTitle(summary) {
  const text = plainInline(summary)
    .replace(/(^|[\s(（])#[\p{L}\p{N}_\-/]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text || String(summary == null ? '' : summary).trim();
}

/** 排序用的到期时间：没有日期的当作无穷大，排在最后 */
function dueOf(t) {
  const v = Number(t && t.dueAt);
  return Number.isFinite(v) && v > 0 ? v : Infinity;
}

/**
 * 四象限小组件的内容。
 * @param {Array} tasks 数据层 Tasks.loadAll() 读出的顶层任务（子任务挂在各自的 subtasks 里）
 * @param {Object} [opts]
 * @param {boolean} [opts.hideDone=true] 面板的「隐藏已完成」是否开着
 * @param {(t:Object)=>boolean} [opts.isFolded] 这条主任务的子任务是否被折叠（折叠了就不列子任务）
 * @param {(key:string, params?:Object)=>string} [opts.t] 取界面文字（随插件语言）
 * @param {number} [opts.maxItems] 每格最多写多少行（默认 MATRIX_MAX_ITEMS）
 * @returns {{ title: string, emptyText: string, moreText: string,
 *            quadrants: Array<{ level: string, title: string, color: string, total: number,
 *                               items: Array<{ text: string, depth: number, done: boolean }> }> }}
 *   quadrants：四格，顺序为左上、右上、左下、右下；
 *   total：这一格一共有多少行（含子任务行），items 可能因 maxItems 截短，小组件用 total 算「还有 N 条」；
 *   moreText：「还有 {n} 条」这样的文字，{n} 由小组件换成具体数字。
 */
export function buildMatrixWidget(tasks, opts = {}) {
  const hideDone = opts.hideDone !== false;
  const isFolded = typeof opts.isFolded === 'function' ? opts.isFolded : () => false;
  const tr = typeof opts.t === 'function' ? opts.t : (k) => k;
  const maxItems = opts.maxItems > 0 ? opts.maxItems : MATRIX_MAX_ITEMS;

  // 一遍分类：优先级档位 → { 待办, 已完成 }
  const buckets = {};
  for (const q of MATRIX_QUADS) buckets[q.level] = { pending: [], done: [] };
  for (const t of tasks || []) {
    if (!t || t.cancelled) continue;
    const b = buckets[priorityToLevel(t.priority) || 'none'] || buckets.none;
    (t.completed ? b.done : b.pending).push(t);
  }

  const quadrants = MATRIX_QUADS.map((q) => {
    const b = buckets[q.level];
    // 两种排序都是「稳定排序」：时间相同的保持读出来的先后
    const pending = b.pending.slice().sort((a, c) => (dueOf(a) - dueOf(c)) || 0);
    const done = hideDone ? [] : b.done.slice().sort((a, c) => (c.completedAt || 0) - (a.completedAt || 0));
    const lines = [];
    for (const t of pending.concat(done)) {
      lines.push({ text: widgetTitle(t.summary), depth: 0, done: !!t.completed });
      if (hasSubtasks(t) && !isFolded(t)) {
        for (const s of visibleSubtasks(t, hideDone)) {
          lines.push({ text: widgetTitle(s.summary), depth: 1, done: !!(s.completed || s.cancelled) });
        }
      }
    }
    return { level: q.level, title: tr(q.titleKey), color: q.color, total: lines.length, items: lines.slice(0, maxItems) };
  });

  return {
    title: tr('app.viewMatrix'),
    emptyText: tr('app.matrixEmpty'),
    moreText: tr('app.widgetMore', { n: '{n}' }),
    quadrants
  };
}

/**
 * 写进 widget-data.json 的整份数据（不含生成时间，生成时间由导出时补上）。
 * @param {Array} tasks 同 buildMatrixWidget
 * @param {Object} [opts] buildMatrixWidget 的参数，另加 vault（库名：点小组件时打开哪个库）
 * @returns {{ version: number, vault: string, openUrl: { matrix: string }, matrix: Object }}
 *   openUrl：点小组件时打开的地址（obsidian://chaochao-list?vault=…&view=…，由插件的 openFromUri 处理）
 */
export function buildWidgetData(tasks, opts = {}) {
  const vault = String(opts.vault || '');
  const base = 'obsidian://chaochao-list?vault=' + encodeURIComponent(vault);
  return {
    version: WIDGET_DATA_VERSION,
    vault,
    openUrl: { matrix: base + '&view=matrix' },
    matrix: buildMatrixWidget(tasks, opts)
  };
}
