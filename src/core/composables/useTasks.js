// 任务纯函数（周计算 / 分组，与视图共用）+ 数据访问（指向插件 vault API）。
// 与网页版同名文件保持 API 形状一致，UI 层无需感知存储差异。
import { t } from '../i18n/index.js';
import {
  loadAll, loadChecklists, loadByList, loadByDate, getDetail,
  loadChecklistGroups, collectTags, editTags,
  createTask, createChecklistTask, updateTask, deleteTask, toggleTask, setChecklistStatus, createSubtask, listSubtasks,
  moveChecklistTask
} from '../api/tasks.js';

// ---------- 纯函数 ----------
import { getWeekStart } from './tasks-logic.js';
// 自用改版（按标签筛选）：面板读任务都经过下面的 api，筛选统一加在这里
import { getTaskMatcher, filterTopTasks, filterChecklistGroups } from './viewFilter.js';

export function startOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const ws = getWeekStart(); // 0=周日 … 6=周六
  const day = (date.getDay() - ws + 7) % 7; // 回退到本周起始日
  date.setDate(date.getDate() - day);
  return date;
}
export function weekDays(weekStart) {
  const arr = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    arr.push(d);
  }
  return arr;
}

// ---------- 数据访问（形状与网页版一致，但抛错形式统一为 Error） ----------
async function unwrap(p) {
  const r = await p;
  if (r.status >= 400 || r.body.ok === false) {
    const reason = r.body.reason || String(r.status);
    // bad_date 表示「有日期任务需要日记插件，但日记插件未启用」：给出明确引导而非裸错误码
    const msg = reason === 'bad_date' ? t('common.dailyDisabledHint') : (t('common.apiError') + reason);
    const err = new Error(msg);
    err.reason = reason;
    throw err;
  }
  return r.body;
}

// 自用改版（按标签筛选）：各视图、待办侧栏、Mac 桌面小组件读任务都走下面这四个函数，
// 所以「只显示选中的人、选中的标签的任务」统一加在这里，不用每个视图各筛一遍。
// 筛选没在挡任何东西时 getTaskMatcher() 返回 null，下面几处就原样返回，和没有这个功能时一样。
// 按 guid 找某一条任务（getDetail）、读子任务、收集全部标签不筛：那些是冲着具体任务去的。
const api = {
  // opts.unfiltered 为 true 时不筛（到点提醒用：提醒不跟着筛选走）
  async loadAll(opts) {
    const items = (await unwrap(loadAll())).items || [];
    return (opts && opts.unfiltered) ? items : filterTopTasks(items, getTaskMatcher());
  },
  // 清单卡片上的进度（total / done）也按筛选算，和右侧显示的任务对得上
  async loadChecklists() {
    const match = getTaskMatcher();
    return (await unwrap(loadChecklists(match ? { match } : undefined))).items || [];
  },
  async loadByList(listKey) {
    return filterTopTasks((await unwrap(loadByList(listKey))).items || [], getTaskMatcher());
  },
  async loadChecklistGroups(listKey) {
    return filterChecklistGroups(await unwrap(loadChecklistGroups(listKey)), getTaskMatcher());
  },
  // 自用改版：批量改标签（删除、改名、移进移出标签组）；opts.dryRun 只数会改多少条。返回 { tasks, files }
  async editTags(op, opts) { return await unwrap(editTags(op, opts)); },
  async loadByDate(dateKey) { return (await unwrap(loadByDate(dateKey))).items || []; },
  async getDetail(guid) {
    const items = await this.loadByDate(String(guid || '').split('#')[0]);
    // 先找顶层任务，找不到再到各任务的子任务里找（自用改版：各视图里也能直接点开子任务）
    return items.find((t) => t.guid === guid)
      || items.reduce((all, t) => all.concat(t.subtasks || []), []).find((t) => t.guid === guid)
      || null;
  },
  async createTask(task) { return (await unwrap(createTask(task))).task; },
  async createChecklistTask(listKey, groupTitle, task) {
    return (await unwrap(createChecklistTask(listKey, groupTitle, task))).task;
  },
  async updateTask(guid, patch) { return (await unwrap(updateTask(guid, patch))).task; },
  async deleteTask(guid) { await unwrap(deleteTask(guid)); },
  async toggleComplete(guid, done) { return (await unwrap(toggleTask(guid, done))).task; },
  async setChecklistStatus(guid, status) { return (await unwrap(setChecklistStatus(guid, status))).task; },
  async listSubtasks(parentGuid) { return (await unwrap(listSubtasks(parentGuid))).items || []; },
  async createSubtask(parentGuid, task) { return (await unwrap(createSubtask(parentGuid, task))).task; },
  async moveChecklistTask(listKey, guid, targetGroupTitle) { return await unwrap(moveChecklistTask(listKey, guid, targetGroupTitle)); },
  // 全库历史标签（按频次倒序）：编辑弹窗添加标签时的智能提示数据源（issue #22）
  async collectTags() { return await collectTags(); }
};

// 聚合命名空间导出，供组件以 Tasks.xxx 调用
export const Tasks = Object.assign({
  startOfWeek, weekDays
}, api);
