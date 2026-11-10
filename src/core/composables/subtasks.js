// 子任务在各视图中的显示（自用改版）：纯函数 + 折叠状态
// ----------------------------------------------------------------------------
// 任务记录里的 subtasks 是它的直接子任务（数据层 api/tasks.js 的 withSubtasks 附上）。
// 各视图按自己的疏密决定怎么显示：
//   - 列表、四象限：缩进显示在父任务下面，可折叠（折叠状态记在本机）；
//   - 日程、日视图：放进父任务的卡片 / 时间块里；
//   - 周视图、月视图：只在父任务上显示进度（如 1/3），鼠标停留时弹出清单。
// 另外，带自己日期的子任务若不落在父任务出现的日期上，会在自己那天另放一份「↳ 副本」
// （buildCalendarTasks），日历类视图（日 / 周 / 月 / 日程）用这份带副本的任务表。
import { reactive } from 'vue';
import { todayKey, spansDays } from './tasks-logic.js';

/** 是否有子任务 */
export function hasSubtasks(t) {
  return !!(t && Array.isArray(t.subtasks) && t.subtasks.length);
}

/** 子任务完成进度 { done, total }：已取消的子任务两边都不计 */
export function subProgress(t) {
  let done = 0;
  let total = 0;
  for (const s of (t && t.subtasks) || []) {
    if (s.cancelled) continue;
    total += 1;
    if (s.completed) done += 1;
  }
  return { done, total };
}

/** 要显示的子任务：开启「隐藏已完成」时去掉已完成、已取消的 */
export function visibleSubtasks(t, hideDone) {
  const list = (t && t.subtasks) || [];
  return hideDone ? list.filter((s) => !s.completed && !s.cancelled) : list;
}

/** 某任务在日历上出现的日期范围 [开始日键, 结束日键]（YYYY-MM-DD）；没有日期返回 null */
function dayRange(t) {
  if (!t || !t.dueAt) return null;
  const end = todayKey(Number(t.dueAt));
  const start = spansDays(t) ? todayKey(Number(t.startAt)) : end;
  return [start, end];
}

/**
 * 日历类视图（日 / 周 / 月 / 日程）用的任务表：顶层任务，外加子任务的「↳ 副本」。
 * 规则：子任务有自己的日期，且这个日期和父任务出现的日期没有交集（包括父任务没有日期）时，
 * 在子任务自己那天另放一份（echo: true）。父任务下面的那份照常保留。
 * 副本是子任务记录的浅拷贝，guid 相同，所以勾选、拖动改期、打开编辑都直接作用于这条子任务。
 * @param {Array} tasks 顶层任务记录（带 subtasks）
 * @returns {Array}
 */
export function buildCalendarTasks(tasks) {
  const out = [];
  for (const t of tasks || []) {
    out.push(t);
    const pr = dayRange(t);
    for (const s of t.subtasks || []) {
      const sr = dayRange(s);
      if (!sr) continue;
      if (pr && sr[0] <= pr[1] && sr[1] >= pr[0]) continue; // 父任务那几天就能看到它
      out.push(Object.assign({}, s, { echo: true }));
    }
  }
  return out;
}

/* ---------- 折叠状态（列表、四象限）：记在本机 localStorage，默认全部展开 ---------- */

const FOLD_STORE = 'dada:subFolded';
const FOLD_LIMIT = 500; // 只保留最近折叠的 500 个，避免无限增长

function loadFolded() {
  try {
    const arr = JSON.parse(window.localStorage.getItem(FOLD_STORE) || '[]');
    return Array.isArray(arr) ? arr.slice(-FOLD_LIMIT) : [];
  } catch (e) {
    return []; // 无 localStorage（如测试环境）或内容损坏：当作都没折叠
  }
}

const folded = reactive(new Set(loadFolded()));

function saveFolded() {
  try { window.localStorage.setItem(FOLD_STORE, JSON.stringify([...folded].slice(-FOLD_LIMIT))); } catch (e) { /* 忽略 */ }
}

/** 折叠状态的键：所在文件 + 任务行文字（不用 guid——增删行后行号会变，guid 跟着变） */
export function foldKey(t) {
  return ((t && (t.file || t.date)) || '') + '|' + ((t && t.summary) || '');
}

/** 该任务的子任务当前是否折叠 */
export function isSubFolded(t) {
  return folded.has(foldKey(t));
}

/** 切换折叠 / 展开 */
export function toggleSubFold(t) {
  const k = foldKey(t);
  if (folded.has(k)) folded.delete(k);
  else folded.add(k);
  saveFolded();
}
