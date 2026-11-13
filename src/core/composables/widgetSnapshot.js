// ============================================================================
// Mac 桌面小组件的数据（自用改版）
// ----------------------------------------------------------------------------
// 把小组件要显示的内容算成一份普通数据。services/widgetExport.js 把它写成本机的 JSON 文件，
// Mac 上的「ChaoChaoList 小组件」程序（仓库 mac-widget/ 目录）读这个文件显示。
// 这里只做计算：不读写文件、不碰界面，方便自动测试。
//
// 一、四象限（buildMatrixWidget）。规则与面板的四象限视图（components/tasks/FourQuadrantView.vue）一致：
//   - 按优先级分进四格（见 matrixQuads.js），已取消的任务不算；
//   - 每格里待办在前，按到期时间从早到晚排，所以过期的排在最上面，没日期的放最后；
//     （面板里是按「已过期 / 今天 / 明天 / 以后各天 / 无日期」分组，组内按到期时间排，
//       连起来就是这个顺序）
//   - 关掉「隐藏已完成」时，已完成的接在待办后面，按完成时间从近到远；
//   - 主任务的子任务（没有折叠时）缩进一格列在主任务下面，开着「隐藏已完成」时不列做完的子任务；
//     子任务只跟着主任务走，不按自己的优先级分到别的格子；
//   - 标题去掉 #标签、链接只留文字（与月视图里任务标题的写法一致）。
//
// 二、月视图（buildMonthWidget）：这个月和下个月各一份月历（下个月留给月底之后、Obsidian 还没打开时用）。
//   规则与面板的月视图（components/tasks/TaskMonthView.vue）一致：
//   - 首列是设置里的「每周开始日」，前后用上个月、下个月的日子补满整周；
//   - 用带「↳ 副本」的任务表（子任务有自己的日期、又不落在主任务那几天时，在自己那天另放一份）；
//   - 跨天任务画成横跨几天的长条（每周各算一段，泳道排法同面板）；其余任务按天列出，
//     每天里未完成在前、做完的在后，同类按到期时间排；
//   - 开着「隐藏已完成」时不列做完、取消的；
//   - 颜色同面板（标签颜色优先，否则按配色方案取色）；
//   - 开着「显示农历与节假日」时，带上节气 / 节日名和法定节假日的「休 / 班」。
//   一格放几条、放不下的算进「+N」，由小组件按实际大小决定。
//
// 数据格式出现不兼容的改动（删字段、改字段含义）时：把 WIDGET_DATA_VERSION 加 1，
// 并同步修改 mac-widget/Sources/Shared/WidgetData.swift；只加新字段时不用改版本号（旧小组件会忽略新字段）。
// ============================================================================
import {
  priorityToLevel, plainInline, spansDays, layoutSpanBars, groupTasksByDay, itemColor,
  lunarTagText, holidayOf, todayKey, tagTokenRe
} from './tasks-logic.js';
import { hasSubtasks, visibleSubtasks, buildCalendarTasks } from './subtasks.js';
import { MATRIX_QUADS } from './matrixQuads.js';

/** 数据格式的版本号（小组件据此判断认不认识这份数据） */
export const WIDGET_DATA_VERSION = 1;

/** 每格最多写进多少行：小组件只显示放得下的那几行，多写一些留给以后更大的尺寸 */
export const MATRIX_MAX_ITEMS = 40;

/** 月历每天最多写进几条任务：小组件一格只放得下两三条，其余算进「+N」（chipTotal 记总数） */
export const MONTH_MAX_CHIPS = 6;

/**
 * 小组件里显示的任务标题：去掉 #标签，链接 [文字](地址) 只留文字，多余空白合并。
 * 去完什么都不剩时（比如整行只有标签），退回原文，免得出现空行。
 * @param {string} summary 任务行的标题原文
 * @returns {string}
 */
export function widgetTitle(summary) {
  const text = plainInline(summary)
    .replace(tagTokenRe(), '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text || String(summary == null ? '' : summary).trim();
}

/**
 * CSS 颜色 → #rrggbbaa（小组件只认这种写法）。
 * 认得：#rgb、#rrggbb、#rrggbbaa、rgb(…)、rgba(…)；认不出的（如 var(--ink)）返回 ''，表示「用默认文字色」。
 * @param {string} css
 * @returns {string}
 */
export function cssColorToHex(css) {
  const s = String(css || '').trim().toLowerCase();
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] + 'ff';
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return '#' + m[1] + 'ff';
  m = /^#([0-9a-f]{8})$/.exec(s);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)(%?)\s*)?\)$/.exec(s);
  if (m) {
    const a = m[4] == null ? 1 : (m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return '#' + hex2(m[1]) + hex2(m[2]) + hex2(m[3]) + hex2(a * 255);
  }
  return '';
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
 * @param {(key:string, params?:Object)=>any} [opts.t] 取界面文字（随插件语言）
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
    // id（自用改版）：任务编号，小组件上点圆圈勾选时靠它找回这条任务（见 composables/widgetToggle.js）
    for (const t of pending.concat(done)) {
      lines.push({ text: widgetTitle(t.summary), depth: 0, done: !!t.completed, id: t.guid || '' });
      if (hasSubtasks(t) && !isFolded(t)) {
        for (const s of visibleSubtasks(t, hideDone)) {
          lines.push({ text: widgetTitle(s.summary), depth: 1, done: !!(s.completed || s.cancelled), id: s.guid || '' });
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

/** 月历里的一条任务：标题（「↳ 副本」前面加 ↳）、底色、文字色（'' = 默认）、是否做完 / 取消 */
function monthItem(t) {
  const c = itemColor(t) || {};
  return {
    text: (t.echo ? '↳ ' : '') + widgetTitle(t.summary),
    bg: cssColorToHex(c.background),
    fg: cssColorToHex(c.color),
    done: !!(t.completed || t.cancelled)
  };
}

/** 月份名（「十一月」「November」），跟随插件语言 */
function monthTitle(year, month, lang) {
  try {
    return new Intl.DateTimeFormat(lang || 'zh-CN', { month: 'long' }).format(new Date(year, month - 1, 1));
  } catch (e) {
    return month + '月';
  }
}

/**
 * 某个月的月历。
 * @param {Array} calendarTasks 带「↳ 副本」的任务表（buildCalendarTasks 的结果）
 * @param {number} year 年
 * @param {number} month 月（1–12）
 * @param {Object} opts
 * @param {boolean} [opts.hideDone=true] 「隐藏已完成」
 * @param {number} [opts.weekStart=1] 每周开始日：0=周日 … 6=周六
 * @param {boolean} [opts.showLunar=true] 「显示农历与节假日」
 * @param {string} [opts.lang] 界面语言（月份名用）
 * @param {Object} [opts.byDay] 已算好的按天分组（groupTasksByDay 的结果），不给就现算
 * @returns {{ key: string, year: number, month: number, title: string,
 *            weeks: Array<{ days: Array, bars: Array }> }}
 *   days[i]：{ key, day, other（不是本月）, holiday（'rest' 休 / 'work' 班 / ''）, tag（节气或节日名）,
 *              chipTotal（当天单日任务总数）, chips（前 MONTH_MAX_CHIPS 条）}
 *   bars[i]：跨天长条 { text, bg, fg, done, start, end（列号 0–6）, lane（泳道）, contStart, contEnd（前 / 后接着别的周）}
 */
export function buildMonthGrid(calendarTasks, year, month, opts = {}) {
  const hideDone = opts.hideDone !== false;
  const weekStart = Number.isInteger(opts.weekStart) ? opts.weekStart : 1;
  const showLunar = opts.showLunar !== false;
  const visible = (list) => (hideDone ? list.filter((t) => !t.completed && !t.cancelled) : list);
  const byDay = opts.byDay || groupTasksByDay(calendarTasks);
  const spanTasks = visible(calendarTasks || []).filter((t) => spansDays(t));

  // 日期格：与 TaskMonthView.vue 的 monthCells 相同
  const first = new Date(year, month - 1, 1);
  const dim = new Date(year, month, 0).getDate();
  const startOffset = (first.getDay() - weekStart + 7) % 7;
  const cells = [];
  for (let i = startOffset; i > 0; i--) cells.push({ date: new Date(year, month - 1, 1 - i), other: true });
  for (let d = 1; d <= dim; d++) cells.push({ date: new Date(year, month - 1, d), other: false });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), other: true });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    const wk = cells.slice(i, i + 7);
    const keys = wk.map((c) => todayKey(c.date.getTime()));
    const { bars } = layoutSpanBars(keys, spanTasks);
    weeks.push({
      days: wk.map((c, j) => {
        const key = keys[j];
        const h = showLunar ? holidayOf(key) : null;
        const chips = visible(byDay[key] || []).filter((t) => !spansDays(t));
        return {
          key,
          day: c.date.getDate(),
          other: !!c.other,
          holiday: h ? (h.rest ? 'rest' : 'work') : '',
          tag: showLunar ? lunarTagText(c.date) : '',
          chipTotal: chips.length,
          chips: chips.slice(0, MONTH_MAX_CHIPS).map(monthItem)
        };
      }),
      bars: bars.map((b) => Object.assign(monthItem(b.t), {
        start: b.startIdx, end: b.endIdx, lane: b.lane, contStart: !!b.contStart, contEnd: !!b.contEnd
      }))
    });
  }
  const mm = month < 10 ? '0' + month : String(month);
  return { key: year + '-' + mm, year, month, title: monthTitle(year, month, opts.lang), weeks };
}

/**
 * 月视图小组件的内容：这个月和下个月的月历，外加表头的周几和「休 / 班」文字。
 * @param {Array} tasks 同 buildMatrixWidget
 * @param {Object} [opts] buildMonthGrid 的参数，另加 now（以哪天算「这个月」，默认现在）、t（取界面文字）
 * @returns {{ weekdays: string[], restText: string, workText: string, months: Array }}
 */
export function buildMonthWidget(tasks, opts = {}) {
  const tr = typeof opts.t === 'function' ? opts.t : (k) => k;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const weekStart = Number.isInteger(opts.weekStart) ? opts.weekStart : 1;
  const calendarTasks = buildCalendarTasks(tasks || []);
  const byDay = groupTasksByDay(calendarTasks);
  const months = [0, 1].map((k) => {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    return buildMonthGrid(calendarTasks, d.getFullYear(), d.getMonth() + 1, Object.assign({}, opts, { weekStart, byDay }));
  });
  // 周几：语言资源里是周一在前（一 … 日），按每周开始日转一下（与 TasksApp 的 weekdayLabels 一致）
  const arr = tr('app.weekdaysShort', { returnObjects: true });
  let weekdays = Array.isArray(arr) && arr.length === 7 ? arr.slice() : ['一', '二', '三', '四', '五', '六', '日'];
  const idx = (weekStart + 6) % 7;
  weekdays = weekdays.slice(idx).concat(weekdays.slice(0, idx));
  return { weekdays, restText: tr('app.rest'), workText: tr('app.work'), months };
}

/**
 * 写进 widget-data.json 的整份数据（不含生成时间，生成时间由导出时补上）。
 * @param {Array} tasks 同 buildMatrixWidget
 * @param {Object} [opts] buildMatrixWidget / buildMonthWidget 的参数，另加 vault（库名：点小组件时打开哪个库）
 * @returns {{ version: number, vault: string, openUrl: Object, matrix: Object, month: Object }}
 *   openUrl：点小组件时打开的地址（由插件的 openFromUri 处理）。
 *     matrix：四象限；month：月视图（{date} 换成那个月任意一天 YYYY-MM-DD）；day：日视图（{date} 换成那一天）
 */
export function buildWidgetData(tasks, opts = {}) {
  const vault = String(opts.vault || '');
  const base = 'obsidian://chaochao-list?vault=' + encodeURIComponent(vault);
  return {
    version: WIDGET_DATA_VERSION,
    vault,
    openUrl: {
      matrix: base + '&view=matrix',
      month: base + '&view=month&date={date}',
      day: base + '&view=day&date={date}'
    },
    matrix: buildMatrixWidget(tasks, opts),
    month: buildMonthWidget(tasks, opts)
  };
}
