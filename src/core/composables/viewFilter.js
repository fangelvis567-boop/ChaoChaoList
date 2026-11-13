// ============================================================================
// 按标签筛选（自用改版）：所有视图只显示选中的人、选中的标签的任务
// ----------------------------------------------------------------------------
// 一次筛选有两部分：
//   谁的 —— 使用者标签（如 🌻、🥕），外加「没指定」（一个使用者标签都没带的任务）。至少选一个。
//   标签 —— 其余标签，可多选；一个都不选 = 不按标签限制。
// 一条任务要显示，得同时满足两条：
//   1. 是选中的人的（没带使用者标签的任务，要选了「没指定」才显示）；
//   2. 带任意一个选中的标签（没选标签时这一条自动通过）。
// 子任务不单独判断：主任务显示，它下面的子任务就一起显示。
//
// 使用者名单从两处来：插件设置里的「使用者名单」（存在 data.json），再加上「这台设备的使用者」
// （存在本机，见 deviceUser.js）。名单是空的 = 没人用「谁的」这一部分，所有任务在这一条上都算通过。
//
// 选了什么只存在本机、按库分开（app.saveLocalStorage）：两个人共用一个库，各看各的。
// 从没动过筛选时不存任何东西，每次按当时的名单现算默认值（只看这台设备的使用者 + 没指定）。
//
// 这个文件上半部分是纯函数（好做自动测试），下半部分才读写本机存储。
// 真正把任务筛掉的地方在 useTasks.js：面板、待办侧栏、桌面小组件读任务都经过那里，所以只加一处。
// ============================================================================
import { cleanTagName } from './tasks-logic.js';
import { getDeviceUserTag } from './deviceUser.js';
import { notifyWidgetPrefsChanged } from './viewPrefs.js';

// ---------- 纯函数 ----------

/**
 * 使用者名单：设置里填的名单在前，「这台设备的使用者」不在名单里时补在最后；去掉重复和不能当标签用的。
 * @param {string[]} settingTags 设置里的「使用者名单」
 * @param {string} deviceUser 这台设备的使用者标签（没设就是空串）
 * @returns {string[]} 例如 ['🌻', '🥕']
 */
export function buildUserList(settingTags, deviceUser) {
  const out = [];
  const add = (x) => {
    const name = cleanTagName(x);
    if (name && out.indexOf(name) < 0) out.push(name);
  };
  (Array.isArray(settingTags) ? settingTags : []).forEach(add);
  if (deviceUser) add(deviceUser);
  return out;
}

/**
 * 默认的筛选：只看这台设备的使用者 + 没指定，不按标签限制。
 * 没设「这台设备的使用者」时，名单里的人全选（等于什么都不挡）。
 * @param {string[]} users 使用者名单
 * @param {string} deviceUser 这台设备的使用者标签
 * @returns {{ users: string[], unassigned: boolean, tags: string[] }}
 */
export function defaultFilter(users, deviceUser) {
  const me = cleanTagName(deviceUser);
  return {
    users: (me && users.indexOf(me) >= 0) ? [me] : users.slice(),
    unassigned: true,
    tags: []
  };
}

/**
 * 把存下来的筛选整理成此刻能用的样子：
 *   - 没存过（或内容不对）→ 用默认的；
 *   - 选中的人里已经不在名单上的去掉，并按名单的顺序排；
 *   - 「谁的」一个都不剩（比如选中的人被从名单里删了）→ 这一部分退回默认；
 *   - 选中的标签去重，并去掉其实是使用者标签的。
 * @param {*} raw 本机存储里读出来的东西
 * @param {string[]} users 使用者名单
 * @param {string} deviceUser 这台设备的使用者标签
 * @returns {{ users: string[], unassigned: boolean, tags: string[] }}
 */
export function normalizeFilter(raw, users, deviceUser) {
  const def = defaultFilter(users, deviceUser);
  if (!raw || typeof raw !== 'object') return def;
  const strings = (arr) => (Array.isArray(arr) ? arr.map((x) => String(x == null ? '' : x)).filter(Boolean) : []);
  const picked = strings(raw.users);
  let sel = users.filter((u) => picked.indexOf(u) >= 0);
  let unassigned = raw.unassigned !== false;
  if (users.length && !sel.length && !unassigned) {
    sel = def.users;
    unassigned = def.unassigned;
  }
  const tags = [];
  for (const g of strings(raw.tags)) {
    if (users.indexOf(g) < 0 && tags.indexOf(g) < 0) tags.push(g);
  }
  return { users: sel, unassigned, tags };
}

/** 「谁的」这一部分此刻有没有在挡任务：名单是空的，或者名单里的人和「没指定」全选了，就是没在挡 */
function whoActive(f, users) {
  if (!users.length) return false;
  return !(f.unassigned && users.every((u) => f.users.indexOf(u) >= 0));
}

/**
 * 这个筛选此刻是不是真的在挡任务（按钮要不要高亮、要不要走筛选都看它）。
 * @returns {boolean}
 */
export function isFilterActive(f, users) {
  return f.tags.length > 0 || whoActive(f, users);
}

/** 标签算不算命中：选中父标签时，它下面的子标签（父/子）也算，和列表视图左边的标签筛选同一条规则 */
function tagHit(taskTags, sel) {
  return taskTags.some((x) => x === sel || x.indexOf(sel + '/') === 0);
}

/**
 * 生成「这条任务该不该显示」的判断函数。筛选没在挡任何东西时返回 null，调用的地方据此直接跳过。
 * 判断只看任务自己的标签（task.tags）；调用方只拿主任务来问，子任务跟着主任务走。
 * @param {{ users: string[], unassigned: boolean, tags: string[] }} f 整理过的筛选
 * @param {string[]} users 使用者名单
 * @returns {((task: { tags?: string[] }) => boolean) | null}
 */
export function makeMatcher(f, users) {
  if (!isFilterActive(f, users)) return null;
  const isUser = new Set(users);
  const picked = new Set(f.users);
  return (task) => {
    const tags = (task && Array.isArray(task.tags)) ? task.tags : [];
    if (users.length) {
      const owners = tags.filter((g) => isUser.has(g));
      // 带了使用者标签：其中至少一个被选中才行；一个都没带：要选了「没指定」才行
      if (owners.length ? !owners.some((g) => picked.has(g)) : !f.unassigned) return false;
    }
    if (f.tags.length && !f.tags.some((sel) => tagHit(tags, sel))) return false;
    return true;
  };
}

/**
 * 在「谁的」那一行点一下：点某个人就切换这个人，name 传 null 表示点的是「没指定」。
 * 这一下会让「谁的」一个都不剩时不生效，返回 null（界面据此提示「至少留一个」）。
 * @returns {{ users: string[], unassigned: boolean, tags: string[] } | null}
 */
export function toggleWho(f, name) {
  const next = { users: f.users.slice(), unassigned: f.unassigned, tags: f.tags.slice() };
  if (name == null) {
    next.unassigned = !f.unassigned;
  } else {
    const i = next.users.indexOf(name);
    if (i >= 0) next.users.splice(i, 1); else next.users.push(name);
  }
  if (!next.users.length && !next.unassigned) return null;
  return next;
}

/** 在「标签」那一行点一下某个标签：选中 ↔ 取消 */
export function toggleTag(f, tag) {
  const tags = f.tags.slice();
  const i = tags.indexOf(tag);
  if (i >= 0) tags.splice(i, 1); else tags.push(tag);
  return { users: f.users.slice(), unassigned: f.unassigned, tags };
}

/** 清掉选中的标签（「谁的」不动） */
export function clearTags(f) {
  return { users: f.users.slice(), unassigned: f.unassigned, tags: [] };
}

/**
 * 筛选按钮上显示的文字片段，例如 ['🌻', '没指定', '#家务']。筛选没在挡任何东西时返回空数组（按钮只显示图标）。
 * 「谁的」全选时不列人名，只列标签，免得按钮太长。
 * @param {string} unassignedLabel 「没指定」这三个字（由界面按当前语言传进来）
 * @returns {string[]}
 */
export function filterSummary(f, users, unassignedLabel) {
  const parts = [];
  if (whoActive(f, users)) {
    parts.push(...f.users);
    if (f.unassigned) parts.push(unassignedLabel);
  }
  for (const g of f.tags) parts.push('#' + g);
  return parts;
}

/**
 * 筛一批主任务：留下通过的（子任务挂在主任务的 subtasks 里，跟着主任务走）。match 为 null 时原样返回。
 * @param {Array} tasks 数据层读出的主任务
 * @param {Function|null} match makeMatcher 的结果
 * @returns {Array}
 */
export function filterTopTasks(tasks, match) {
  const list = tasks || [];
  return match ? list.filter(match) : list;
}

/**
 * 筛清单页的分组数据（数据层 loadChecklistGroups 的结果）。
 * 每组的任务是「主任务在前、它的子任务紧随其后」的一维列表（depth 为 0 的是主任务）：
 * 主任务没通过，它后面跟着的子任务一起去掉。顺带按留下来的重算总数和完成数。
 * @param {{ groups: Array<{ title: string, tasks: Array }>, total: number, done: number }} body
 * @param {Function|null} match makeMatcher 的结果；为 null 时原样返回
 * @returns {Object} 和传进来的同一个形状
 */
export function filterChecklistGroups(body, match) {
  if (!match || !body || !Array.isArray(body.groups)) return body;
  let total = 0;
  let done = 0;
  const groups = body.groups.map((g) => {
    let keep = false;
    const tasks = (g.tasks || []).filter((t) => {
      if (!t.depth) keep = match(t); // 遇到主任务：重新判断；后面跟着的子任务沿用这个结果
      return keep;
    });
    total += tasks.length;
    done += tasks.filter((t) => t.completed && !t.cancelled).length;
    return Object.assign({}, g, { tasks });
  });
  return Object.assign({}, body, { groups, total, done });
}

// ---------- 读写本机存储 ----------

/** 本机存储里的键名（Obsidian 会自动在前面拼上这个库的编号，不同的库互不影响） */
export const VIEW_FILTER_KEY = 'chaochao-list-view-filter';

/** 插件对象；启动时由 initViewFilter 交进来（要用它的 app 读写本机存储，用它的 settings 读使用者名单） */
let pluginRef = null;

/**
 * 插件启动时调用一次。
 * @param {Object|null} plugin 插件对象
 */
export function initViewFilter(plugin) {
  pluginRef = plugin || null;
}

/** 此刻的使用者名单（设置里的名单 + 这台设备的使用者） */
export function currentUsers() {
  const settings = pluginRef && pluginRef.settings;
  return buildUserList(settings && settings.userTags, getDeviceUserTag());
}

/** 此刻生效的筛选（没存过就是默认的） */
export function getViewFilter() {
  let raw = null;
  try {
    const app = pluginRef && pluginRef.app;
    if (app && typeof app.loadLocalStorage === 'function') raw = app.loadLocalStorage(VIEW_FILTER_KEY);
  } catch (e) {
    raw = null; // 读不出来：当作没存过
  }
  return normalizeFilter(raw, currentUsers(), getDeviceUserTag());
}

/**
 * 存下新的筛选，并通知桌面小组件重算（它显示的内容跟着面板走）。
 * @param {Object} next 新的筛选（会先整理一遍）
 * @returns {{ users: string[], unassigned: boolean, tags: string[] }} 整理后、真正生效的筛选
 */
export function setViewFilter(next) {
  const f = normalizeFilter(next, currentUsers(), getDeviceUserTag());
  try {
    const app = pluginRef && pluginRef.app;
    if (app && typeof app.saveLocalStorage === 'function') app.saveLocalStorage(VIEW_FILTER_KEY, f);
  } catch (e) { /* 存不下来：这次的选择只在本次运行里有效 */ }
  notifyWidgetPrefsChanged();
  return f;
}

/** 按此刻的筛选生成判断函数；筛选没在挡任何东西时返回 null */
export function getTaskMatcher() {
  return makeMatcher(getViewFilter(), currentUsers());
}
