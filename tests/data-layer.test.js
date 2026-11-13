// 数据层自动测试：在内存里的假库上，把「读任务 / 改任务 / 写回文件」跑一遍，
// 逐字核对写出来的文件内容是否符合预期。
//
// 运行方式：在仓库根目录执行 `node tests/run.mjs`（由它负责打包并运行本文件）。
// 读写范围：只读仓库源码；所有「文件」都在内存里（tests/fake-vault.js），不碰任何真实笔记。
import {
  initTasksApi, loadAll, loadByDate, listSubtasks, loadChecklistGroups, loadChecklists,
  createTask, createChecklistTask, moveChecklistTask, updateTask, toggleTask, editTags
} from '../src/core/api/tasks.js';
import {
  parseTasks, serializeBlock, collectLineNos, splitDescription, descPreview,
  timeText, spansDays, moveToDay, shiftSpanToDay, tagMapper, rewriteTagsInText, cleanTagName,
  levelToPriorityEmoji, setTagColors, lunarTagText, holidayOf,
  withTag, splitSummary, composeSummary, colorOf, itemColor, setColorScheme, COLOR_SCHEMES,
  DEFAULT_COLOR_SCHEME, migrateColorScheme
} from '../src/core/composables/tasks-logic.js';
import {
  DEVICE_USER_KEY, initDeviceUser, getDeviceUserTag, setDeviceUserTag, defaultTaskTags
} from '../src/core/composables/deviceUser.js';
import {
  buildUserList, defaultFilter, normalizeFilter, isFilterActive, makeMatcher,
  toggleWho, toggleTag, clearTags, filterSummary,
  VIEW_FILTER_KEY, initViewFilter, getViewFilter, setViewFilter
} from '../src/core/composables/viewFilter.js';
import { Tasks } from '../src/core/composables/useTasks.js';
import {
  buildMatrixWidget, buildWidgetData, widgetTitle, buildMonthWidget, cssColorToHex
} from '../src/core/composables/widgetSnapshot.js';
import { ReminderService } from '../src/core/services/reminder.js';
import { buildCalendarTasks, subProgress, visibleSubtasks } from '../src/core/composables/subtasks.js';
import { buildChecklistRows } from '../src/core/composables/checklistRows.js';
import {
  formToDraft, draftToForm, draftError, quickPick, isQuickPicked, switchTab, chipInfo,
  addDays, daysBetween, nextHalfHour
} from '../src/core/composables/dateDraft.js';
import { makeVault } from './fake-vault.js';

// ---------- 极简测试框架 ----------

/** 登记的测试用例：[{ name, fn }] */
const cases = [];
/** 登记一个测试用例。fn 可以是异步函数；抛错即视为失败。 */
function test(name, fn) { cases.push({ name, fn }); }

/** 断言两个值（按 JSON 展开后）完全相等，否则抛出带对比内容的错误。 */
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what || '值'}不符\n      期望: ${e}\n      实际: ${a}`);
}
/** 断言条件为真。 */
function ok(cond, what) { if (!cond) throw new Error(what || '断言失败'); }

// ---------- 小工具 ----------

/** 本地时间的毫秒时间戳（月份按日常写法 1–12）。 */
const ms = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
/** 三种文件开头的 frontmatter（与插件新建文件时写的一致）。 */
const HEAD_INBOX = '---\ntags:\n  - task\n---\n\n';
const HEAD_DAILY = '---\ntags:\n  - journal\n---\n\n';
const HEAD_LIST = '---\ntags:\n  - todoList\n---\n\n';
/** 取出接口返回里的任务记录；接口报错时直接抛出，方便定位。 */
function body(res) {
  if (res.status >= 400 || res.body.ok === false) throw new Error('接口报错: ' + JSON.stringify(res.body));
  return res.body;
}
/** 造一个假库并让数据层指向它。 */
function vaultWith(files, settings) {
  const v = makeVault(files, settings);
  initTasksApi(v.plugin);
  return v;
}

// ============================================================
// 一、描述按 Markdown 原文保存
// ============================================================

test('描述里的标题、多级列表、空行，读入后原样写回', () => {
  const src = [
    '- [ ] 间接经费 #财务 📅 2026-05-27',
    '\t## 报销材料',
    '\t1. 发票',
    '\t2. 合同',
    '\t   - 需盖章',
    '',
    '\t备注：**月底前**提交',
    '\t- [ ] 10000',
    '- [ ] 另一条'
  ];
  const { roots } = parseTasks(src.join('\n'));
  eq(roots.length, 2, '顶层任务数');
  eq(roots[0].descTexts, ['## 报销材料', '1. 发票', '2. 合同', '   - 需盖章', '', '备注：**月底前**提交'], '描述逐行');
  eq(roots[0].children.map((c) => c.summary), ['10000'], '子任务');
  eq(serializeBlock(roots[0], roots[0].indentStr), src.slice(0, 8), '写回的整块');
});

test('旧版用「缩进的 - 列表」存的描述：读成列表，写回一字不差（含嵌套）', () => {
  const src = ['- [ ] 任务', '\t- 备注一', '\t\t- 更细的备注'];
  const { roots } = parseTasks(src.join('\n'));
  eq(roots[0].descTexts, ['- 备注一', '\t- 更细的备注'], '描述逐行');
  eq(serializeBlock(roots[0], roots[0].indentStr), src, '写回的整块');
});

test('空行规则：夹在两行描述之间的算描述，描述块前后的不算', () => {
  const src = ['- [ ] A', '', '\t描述一', '', '', '\t描述二', '', '- [ ] B'];
  const { roots } = parseTasks(src.join('\n'));
  eq(roots[0].descTexts, ['描述一', '', '', '描述二'], '描述逐行');
  eq(collectLineNos(roots[0]), [0, 2, 3, 4, 5], 'A 占用的行号');
});

test('缩进不规整（任务用 Tab、描述用空格）时退回逐行去缩进，写回统一为一级缩进', () => {
  const { roots } = parseTasks('\t- [ ] X\n        混用空格缩进');
  eq(roots[0].descTexts, ['混用空格缩进'], '描述逐行');
  eq(serializeBlock(roots[0], roots[0].indentStr), ['\t- [ ] X', '\t\t混用空格缩进'], '写回的整块');
});

test('拆分描述：去首尾空行、保留中间空行、把 "- [ ]" 行挑出来', () => {
  eq(splitDescription('\n a \n- [ ] x\n\nb\n\n'), { lines: [' a', '', 'b'], tasks: [{ mark: ' ', text: 'x' }] }, '拆分结果');
});

test('清单视图的描述预览：只取第一行文字，去掉 Markdown 符号', () => {
  eq(descPreview('## **重点**：见 [[笔记|别名]]\n第二行'), '重点：见 别名', '预览');
  eq(descPreview('\n- 列表项里的 [链接](https://example.com)'), '列表项里的 链接', '预览');
});

test('在编辑窗口改描述：按 Markdown 原文写进文件，再读出来不走样', async () => {
  const v = vaultWith({ 'Inbox.md': HEAD_INBOX + '- [ ] A\n- [ ] B\n' });
  const a = body(await loadAll()).items.find((t) => t.summary === 'A');
  const text = '第一段\n\n- 列表\n  - 子项';
  body(await updateTask(a.guid, { description: text }));
  eq(v.read('Inbox.md'), HEAD_INBOX + '- [ ] A\n\t第一段\n\n\t- 列表\n\t  - 子项\n- [ ] B\n', '文件内容');
  const items = body(await loadAll()).items;
  eq(items.find((t) => t.summary === 'A').description, text, '读回的描述');
  eq(items.map((t) => t.summary), ['A', 'B'], 'B 仍是独立任务');
});

test('描述里写的 "- [ ]" 行存盘时变成子任务，其余行留在描述里', async () => {
  const v = vaultWith({ 'Inbox.md': HEAD_INBOX + '- [ ] A\n' });
  const a = body(await loadAll()).items[0];
  body(await updateTask(a.guid, { description: '说明\n- [ ] 第一步\n- [x] 第二步\n尾注' }));
  eq(v.read('Inbox.md'), HEAD_INBOX + '- [ ] A\n\t说明\n\t尾注\n\t- [ ] 第一步\n\t- [x] 第二步\n', '文件内容');
  const a2 = body(await loadAll()).items[0];
  eq(a2.description, '说明\n尾注', '描述');
  eq(body(await listSubtasks(a2.guid)).items.map((s) => [s.summary, s.completed]), [['第一步', false], ['第二步', true]], '子任务');
});

test('新建任务时带描述（含 "- [ ]" 行）：整块写入', async () => {
  const v = vaultWith({ 'Inbox.md': HEAD_INBOX });
  body(await createTask({ summary: '新任务', description: '**说明**\n- [ ] 子项' }));
  ok(v.read('Inbox.md').endsWith('- [ ] 新任务\n\t**说明**\n\t- [ ] 子项'), '文件结尾不符: ' + JSON.stringify(v.read('Inbox.md')));
});

test('原样回写（拖动改期等操作会把描述原样传回）：文件一个字符都不变', async () => {
  const text = HEAD_INBOX + [
    '- [ ] A 🔼 📅 2026-05-27',
    '\t## 标题',
    '\t1. 一',
    '\t   - 嵌套',
    '',
    '\t尾段',
    '\t- [ ] 子',
    '\t\t子的描述',
    '- [ ] B',
    '\t- 旧式描述一',
    '\t\t- 旧式嵌套',
    ''
  ].join('\n');
  const v = vaultWith({ 'Inbox.md': text });
  for (const name of ['A', 'B']) {
    const t = body(await loadAll()).items.find((x) => x.summary === name);
    body(await updateTask(t.guid, { summary: t.summary, description: t.description, priority: t.priority }));
    eq(v.read('Inbox.md'), text, `回写 ${name} 之后的文件`);
  }
});

// ============================================================
// 二、子任务有自己的描述、优先级和日期
// ============================================================

const DAILY = '日记/2026-05-27.md';
const DAILY_SRC = HEAD_DAILY + '- [ ] 间接经费 #财务\n\t- [ ] 10000\n\t- [ ] 20000\n';

test('日记里的子任务：没写日期就是没有日期，不继承所在日记的那一天', async () => {
  vaultWith({ [DAILY]: DAILY_SRC });
  const p = body(await loadByDate('2026-05-27')).items[0];
  eq(p.dueAt, ms(2026, 5, 27), '父任务的日期来自日记文件名');
  const subs = body(await listSubtasks(p.guid)).items;
  eq(subs.map((s) => [s.summary, s.dueAt, s.startAt]), [['10000', null, null], ['20000', null, null]], '子任务的日期');
});

test('给日记里的子任务设描述、优先级、日期：写在它自己那一行，留在父任务下面', async () => {
  const v = vaultWith({ [DAILY]: DAILY_SRC });
  const p = body(await loadByDate('2026-05-27')).items[0];
  const s1 = body(await listSubtasks(p.guid)).items[0];
  body(await updateTask(s1.guid, {
    summary: '10000', description: '给财务处\n**尽快**', priority: '🔺',
    dueAt: ms(2026, 5, 20), dueEndAt: null, startAt: undefined, dueAllDay: true
  }));
  eq(v.read(DAILY), HEAD_DAILY + [
    '- [ ] 间接经费 #财务',
    '\t- [ ] 10000 🔺 📅 2026-05-20',
    '\t\t给财务处',
    '\t\t**尽快**',
    '\t- [ ] 20000',
    ''
  ].join('\n'), '日记文件内容');
  eq(v.paths(), [DAILY], '没有因为子任务改日期而新建 / 搬动别的日记');

  const p2 = body(await loadByDate('2026-05-27')).items[0];
  eq([p2.summary, p2.dueAt, p2.subtaskCount], ['间接经费 #财务', ms(2026, 5, 27), 2], '父任务不受影响');
  const subs = body(await listSubtasks(p2.guid)).items;
  eq([subs[0].priority, subs[0].description, subs[0].dueAt, subs[0].dueAllDay],
    ['🔺', '给财务处\n**尽快**', ms(2026, 5, 20), true], '子任务一读回来的内容');
  eq([subs[1].summary, subs[1].dueAt, subs[1].description], ['20000', null, ''], '子任务二不受影响');

  // 再给它加上具体时刻：时间写在行首，日期仍在行内
  body(await updateTask(subs[0].guid, { dueAt: ms(2026, 5, 20, 9, 30), dueEndAt: null, startAt: undefined, dueAllDay: false }));
  ok(v.read(DAILY).includes('\n\t- [ ] 09:30 10000 🔺 📅 2026-05-20\n\t\t给财务处\n'), '带时刻的子任务行不符: ' + JSON.stringify(v.read(DAILY)));
  const s1b = body(await listSubtasks(p2.guid)).items[0];
  eq([s1b.dueAt, s1b.dueAllDay], [ms(2026, 5, 20, 9, 30), false], '带时刻的子任务日期');

  // 清掉日期：行内的 📅 消失，子任务仍在原处
  body(await updateTask(s1b.guid, { dueAt: null, dueEndAt: null, startAt: undefined, dueAllDay: true }));
  ok(v.read(DAILY).includes('\n\t- [ ] 10000 🔺\n\t\t给财务处\n'), '清掉日期后的子任务行不符: ' + JSON.stringify(v.read(DAILY)));
  eq(v.paths(), [DAILY], '仍然只有这一篇日记');
});

test('勾选子任务：只改它那一行，描述和兄弟任务原样', async () => {
  const src = HEAD_DAILY + '- [ ] 父\n\t- [ ] 子一 🔺 📅 2026-05-20\n\t\t子一的描述\n\t- [ ] 子二\n';
  const v = vaultWith({ [DAILY]: src });
  const p = body(await loadByDate('2026-05-27')).items[0];
  const s1 = body(await listSubtasks(p.guid)).items[0];
  body(await toggleTask(s1.guid, true));
  ok(/^- \[ \] 父\n\t- \[x\] 子一 🔺 📅 2026-05-20 ✅ \d{4}-\d{2}-\d{2}\n\t\t子一的描述\n\t- \[ \] 子二\n$/.test(v.read(DAILY).slice(HEAD_DAILY.length)),
    '勾选后的文件不符: ' + JSON.stringify(v.read(DAILY)));
});

test('回归：日记里的主任务改日期，仍然整块搬到那一天的日记（描述和子任务一起走）', async () => {
  const src = HEAD_DAILY + '- [ ] 父任务\n\t说明\n\t- [ ] 子 📅 2026-06-01\n\t\t子说明\n- [ ] 其他\n';
  const v = vaultWith({ [DAILY]: src });
  const p = body(await loadByDate('2026-05-27')).items.find((t) => t.summary === '父任务');
  body(await updateTask(p.guid, { dueAt: ms(2026, 5, 29), dueEndAt: null, startAt: undefined, dueAllDay: true }));
  eq(v.read(DAILY), HEAD_DAILY + '- [ ] 其他\n', '原日记只剩另一条任务');
  eq(v.read('日记/2026-05-29.md'), '---\ntags:\n  - journal\n---\n- [ ] 父任务\n\t说明\n\t- [ ] 子 📅 2026-06-01\n\t\t子说明', '目标日记里的整块');
  const moved = body(await loadByDate('2026-05-29')).items[0];
  eq([moved.summary, moved.description, moved.subtaskCount], ['父任务', '说明', 1], '搬过去后读回的父任务');
  const sub = body(await listSubtasks(moved.guid)).items[0];
  eq([sub.summary, sub.description, sub.dueAt], ['子', '子说明', ms(2026, 6, 1)], '搬过去后读回的子任务');
});

// 编辑窗口选「无日期」保存时传给数据层的日期字段（与 TaskEditorModal 的 buildDueAt / save 一致）
const NO_DATE = { dueAt: null, dueEndAt: null, startAt: '', dueAllDay: true };

test('编辑窗口选「无日期」：日记里的主任务整块搬到收件箱（描述、子任务一起走），行首时间一并去掉', async () => {
  const src = HEAD_DAILY + '- [ ] 10:00 写周报 🔼\n\t周报说明\n\t- [ ] 子 📅 2026-06-01\n- [ ] 其他\n';
  const v = vaultWith({ [DAILY]: src });
  const t = body(await loadByDate('2026-05-27')).items.find((x) => x.summary === '写周报');
  eq([t.dueAt, t.time], [ms(2026, 5, 27, 10, 0), '10:00'], '改之前：日期来自日记文件名，时间写在行首');
  body(await updateTask(t.guid, NO_DATE));
  eq(v.read(DAILY), HEAD_DAILY + '- [ ] 其他\n', '原日记只剩另一条任务');
  ok(v.read('Inbox.md').includes('- [ ] 写周报 🔼\n\t周报说明\n\t- [ ] 子 📅 2026-06-01'),
    '收件箱里的整块不符: ' + JSON.stringify(v.read('Inbox.md')));
  const moved = body(await loadAll()).items.find((x) => x.summary === '写周报');
  eq([moved.date, moved.dueAt, moved.time || '', moved.description, moved.subtaskCount],
    ['inbox', null, '', '周报说明', 1], '搬到收件箱后读回的任务');
});

test('编辑窗口选「无日期」：收件箱里的任务去掉行内日期和行首时间，仍留在收件箱', async () => {
  const INBOX = 'Inbox.md';
  const src = HEAD_INBOX + '- [ ] 09:00 买书 📅 2026-06-03\n- [ ] 其他\n';
  const v = vaultWith({ [INBOX]: src });
  const t = body(await loadAll()).items.find((x) => x.summary === '买书');
  eq([t.date, t.dueAt], ['inbox', ms(2026, 6, 3, 9, 0)], '改之前：收件箱里的任务带日期和时间');
  body(await updateTask(t.guid, NO_DATE));
  eq(v.read(INBOX), HEAD_INBOX + '- [ ] 买书\n- [ ] 其他\n', '收件箱文件内容');
  eq(v.paths(), [INBOX], '没有新建别的文件');
});

// ============================================================
// 三、清单视图
// ============================================================

const LIST = '清单/项目.md';
const LIST_KEY = 'cl:清单/项目';

test('清单排序：子任务始终跟在父任务后面，只和同一父任务下的兄弟比优先级', async () => {
  vaultWith({ [LIST]: HEAD_LIST + '### 组A\n- [ ] 父1\n\t- [ ] 子1b\n\t- [ ] 子1a 🔺\n- [ ] 父2 🔺\n\t- [ ] 子2a\n' });
  const g = body(await loadChecklistGroups(LIST_KEY));
  eq(g.groups.map((x) => x.title), ['组A'], '分组');
  eq(g.groups[0].tasks.map((t) => t.summary), ['父2', '子2a', '父1', '子1a', '子1b'], '组内顺序');
  eq(g.groups[0].tasks.map((t) => t.indent), [0, 1, 0, 1, 1], '层级');
  eq([g.total, g.done], [5, 0], '计数');
});

test('清单排序：标题之前的任务归入未分组，子任务跟着父任务', async () => {
  vaultWith({ [LIST]: HEAD_LIST + '- [ ] 散1\n\t- [x] 散1的子\n### 组A\n- [ ] 甲\n' });
  const g = body(await loadChecklistGroups(LIST_KEY));
  eq(g.groups.map((x) => [x.title, x.tasks.map((t) => t.summary)]), [['', ['散1', '散1的子']], ['组A', ['甲']]], '分组与顺序');
  eq([g.total, g.done], [3, 1], '计数');
});

test('清单页的层级：每条任务带上层级、父任务和直接子任务（空格缩进的子任务也算对）', async () => {
  vaultWith({ [LIST]: HEAD_LIST + '- [ ] 父 #科研\n    - [x] 子甲\n    - [ ] 子乙\n        - [ ] 孙\n- [ ] 另一条\n' });
  const ts = body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks;
  eq(ts.map((t) => [t.summary, t.depth]), [['父 #科研', 0], ['子甲', 1], ['子乙', 1], ['孙', 2], ['另一条', 0]], '顺序与层级');
  const [fu, jia, yi, sun, other] = ts;
  eq([fu.parentGuid, other.parentGuid], ['', ''], '主任务没有父任务');
  eq([jia.parentGuid === fu.guid, yi.parentGuid === fu.guid, sun.parentGuid === yi.guid], [true, true, true], '子任务指向自己的父任务');
  eq([jia.parentTitle, sun.parentTitle], ['父', '子乙'], '父任务标题（去掉 #标签）');
  eq([fu, yi, sun, other].map((t) => t.subtasks.map((s) => s.summary)), [['子甲', '子乙'], ['孙'], [], []], '直接子任务');
  eq(subProgress(fu), { done: 1, total: 2 }, '主任务的子任务进度');
});

// 清单页的任务行（checklistRows.js）用的小工具：按 [标题, 做完没有, 子任务] 搭一棵任务树，
// 返回「父在前、子紧随其后」的一维记录列表（和 loadChecklistGroups 给出的形状一样）
function clTree(spec) {
  const out = [];
  const make = (items, depth) => items.map(([summary, completed, kids]) => {
    const t = { guid: summary, summary, completed: !!completed, cancelled: false, depth, subtasks: [] };
    out.push(t);
    t.subtasks = make(kids || [], depth + 1);
    return t;
  });
  make(spec, 0);
  return out;
}

test('清单页的任务行：子任务紧跟主任务；做完的只在同一层里沉底，不和主任务分开', () => {
  const tasks = clTree([['甲', false, [['甲1', true], ['甲2', false]]], ['乙', true, [['乙1', false]]], ['丙', false]]);
  const r = buildChecklistRows(tasks, {});
  eq(r.rows.map((t) => t.summary), ['甲', '甲2', '甲1', '丙', '乙', '乙1'], '显示顺序');
  eq(r.count, 6, '组名旁的任务数');
});

test('清单页「隐藏已完成」：按主任务整块藏，整块都做完才藏；没做完的整块照常显示（做完的子任务也在）', () => {
  const tasks = clTree([
    ['甲', false, [['甲1', true]]],                 // 主任务没做完：做完的子任务照常显示（界面上划线）
    ['乙', true, [['乙1', false], ['乙2', true]]],  // 主任务做完、子任务没做完：整块都显示
    ['丙', true, [['丙1', true]]],                  // 整块都做完：藏起来
    ['丁', true]                                     // 没有子任务、已做完：藏起来
  ]);
  const r = buildChecklistRows(tasks, { hideDone: true });
  eq(r.rows.map((t) => t.summary), ['甲', '甲1', '乙', '乙1', '乙2'], '显示的行');
  eq(r.count, 2, '组名旁的任务数只算没做完的（甲、乙1）');
});

test('清单页收起主任务：它的子任务不列出来，组名旁的任务数不变', () => {
  const tasks = clTree([['甲', false, [['甲1', false, [['甲1a', false]]]]], ['乙', false]]);
  const r = buildChecklistRows(tasks, { isFolded: (t) => t.summary === '甲1' });
  eq(r.rows.map((t) => t.summary), ['甲', '甲1', '乙'], '显示的行');
  eq(r.count, 4, '组名旁的任务数');
});

test('在清单分组里新建任务时填的描述不再丢失', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '### 组A\n- [ ] 甲\n' });
  body(await createChecklistTask(LIST_KEY, '组A', { summary: '新任务', description: '说明一\n说明二' }));
  // 自用改版：新任务紧跟在「甲」后面（中间不再多一个空行），文件末尾原有的换行也保留
  eq(v.read(LIST), HEAD_LIST + '### 组A\n- [ ] 甲\n- [ ] 新任务\n\t说明一\n\t说明二\n', '清单文件内容');
  const g = body(await loadChecklistGroups(LIST_KEY));
  eq(g.groups[0].tasks.map((t) => [t.summary, t.description]), [['甲', ''], ['新任务', '说明一\n说明二']], '读回');
});

// ---------- 清单页里的日记（自用改版） ----------

const J10 = '日记/2026-11-10.md';
const J10_KEY = 'cl:日记/2026-11-10';
const J12 = '日记/2026-11-12.md';
/** 既是日记、又打了清单标记的笔记开头 */
const HEAD_DAILY_LIST = '---\ntags:\n  - journal\n  - todoList\n---\n\n';

test('日记打了清单标记：带 📅 的任务在日 / 周 / 月视图用的任务表里只出现一次', async () => {
  vaultWith({ [J12]: HEAD_DAILY_LIST + '- [ ] 甲 📅 2026-11-13\n- [ ] 乙\n' });
  const items = body(await loadAll()).items;
  eq(['甲', '乙'].map((s) => items.filter((t) => t.summary === s).length), [1, 1], '各出现几次');
  eq(items.find((t) => t.summary === '甲').date, '2026-11-12', '按日记读（记录里的日期是日记那天）');
});

test('清单页列出日记：默认就开，不用打标签；排在主题清单后面，按日期从新到旧', async () => {
  vaultWith({
    [LIST]: HEAD_LIST + '- [ ] 甲\n',
    [J10]: HEAD_DAILY + '- [x] 早\n- [ ] 晚\n',
    [J12]: HEAD_DAILY_LIST + '- [ ] 中\n'
  });
  const items = body(await loadChecklists()).items;
  eq(items.map((c) => [c.name, !!c.journal, c.date || '', c.done, c.total]),
    [['项目', false, '', 0, 1], ['2026-11-12', true, '2026-11-12', 0, 1], ['2026-11-10', true, '2026-11-10', 1, 2]],
    '左侧条目（名字、是否在日记组、日期、完成数、总数）');
});

test('关掉「清单页显示日记」：不列日记；打了清单标记的日记照旧列在清单里', async () => {
  vaultWith({
    [LIST]: HEAD_LIST + '- [ ] 甲\n',
    [J10]: HEAD_DAILY + '- [ ] 早\n',
    [J12]: HEAD_DAILY_LIST + '- [ ] 中\n'
  }, { checklistShowJournal: false });
  const items = body(await loadChecklists()).items;
  eq(items.map((c) => [c.name, !!c.journal, c.date || '']), [['2026-11-12', false, '2026-11-12'], ['项目', false, '']], '左侧条目');
});

test('在清单页打开日记：任务按日记算；改日期时整块搬到那天的日记，不写行尾 📅', async () => {
  const v = vaultWith({ [J10]: HEAD_DAILY + '### 科研\n- [ ] 读文献\n\t- [ ] 下载\n- [ ] 写摘要\n' });
  const g = body(await loadChecklistGroups(J10_KEY));
  eq(g.groups.map((x) => [x.title, x.tasks.map((t) => t.summary)]), [['科研', ['读文献', '下载', '写摘要']]], '分组');
  const t = g.groups[0].tasks[0];
  eq([t.date, t.dueAt, t.file], ['2026-11-10', ms(2026, 11, 10), J10], '读到的任务按日记算');
  body(await updateTask(t.guid, { dueAt: ms(2026, 11, 12), dueEndAt: null, startAt: undefined, dueAllDay: true }));
  eq(v.read(J10), HEAD_DAILY + '### 科研\n- [ ] 写摘要\n', '原日记');
  const moved = v.read(J12) || '';
  ok(moved.includes('- [ ] 读文献\n\t- [ ] 下载') && !moved.includes('📅'), '目标日记: ' + JSON.stringify(moved));
});

test('在清单页给日记的分组加任务：同一天插进该分组；换了日期进那天的日记；无日期进收件箱', async () => {
  const v = vaultWith({ [J10]: HEAD_DAILY + '### 科研\n- [ ] 读文献\n### 生活\n- [ ] 买菜\n' });
  const after = HEAD_DAILY + '### 科研\n- [ ] 读文献\n- [ ] 跑数据\n### 生活\n- [ ] 买菜\n';
  body(await createChecklistTask(J10_KEY, '科研', { summary: '跑数据', dueAt: ms(2026, 11, 10), dueAllDay: true }));
  eq(v.read(J10), after, '同一天：插进「科研」组，不写日期');
  body(await createChecklistTask(J10_KEY, '科研', { summary: '写摘要', dueAt: ms(2026, 11, 12), dueAllDay: true }));
  ok((v.read(J12) || '').includes('- [ ] 写摘要'), '换了日期：进 11-12 的日记');
  body(await createChecklistTask(J10_KEY, '生活', Object.assign({ summary: '买书' }, NO_DATE)));
  ok((v.read('Inbox.md') || '').includes('- [ ] 买书'), '无日期：进收件箱');
  eq(v.read(J10), after, '后两条都没留在原日记');
});

test('在清单页把日记里的任务拖到别的分组：在同一篇日记里整块挪过去', async () => {
  const v = vaultWith({ [J10]: HEAD_DAILY + '### 科研\n- [ ] 读文献\n\t- [ ] 下载\n### 生活\n- [ ] 买菜\n' });
  const t = body(await loadChecklistGroups(J10_KEY)).groups[0].tasks[0];
  body(await moveChecklistTask(J10_KEY, t.guid, '生活'));
  const g = body(await loadChecklistGroups(J10_KEY));
  eq(g.groups.map((x) => [x.title, x.tasks.map((s) => s.summary)]), [['科研', []], ['生活', ['买菜', '读文献', '下载']]], '拖动后的分组');
  eq(v.paths(), [J10], '没有新建别的文件');
});

// ============================================================
// 四、各视图显示子任务用到的数据
// ============================================================

const VIEW_SRC = HEAD_DAILY + [
  '- [ ] 父任务 #财务',
  '\t- [ ] 子一',
  '\t- [x] 子二 ✅ 2026-05-26',
  '\t- [-] 子三 ❌ 2026-05-26',
  '\t- [ ] 子四 📅 2026-05-29',
  '\t- [ ] 子五 📅 2026-05-27',
  '- [ ] 没有子任务的任务',
  ''
].join('\n');

test('读任务时，每条任务都带上它的直接子任务（含所属父任务的 guid 和标题）', async () => {
  vaultWith({ [DAILY]: VIEW_SRC });
  const items = body(await loadByDate('2026-05-27')).items;
  eq(items.map((t) => [t.summary, (t.subtasks || []).length]), [['父任务 #财务', 5], ['没有子任务的任务', 0]], '任务与子任务数');
  const p = items[0];
  eq(p.subtasks.map((s) => s.summary), ['子一', '子二', '子三', '子四', '子五'], '子任务顺序');
  eq(p.subtasks.every((s) => s.parentGuid === p.guid && s.parentTitle === '父任务'), true, '父任务信息');
  eq(p.subtasks.map((s) => s.dueAt), [null, null, null, ms(2026, 5, 29), ms(2026, 5, 27)], '子任务各自的日期');
});

test('进度只算没取消的子任务；「隐藏已完成」时去掉已完成和已取消的', async () => {
  vaultWith({ [DAILY]: VIEW_SRC });
  const p = body(await loadByDate('2026-05-27')).items[0];
  eq(subProgress(p), { done: 1, total: 4 }, '进度');
  eq(visibleSubtasks(p, true).map((s) => s.summary), ['子一', '子四', '子五'], '隐藏已完成后');
  eq(visibleSubtasks(p, false).length, 5, '不隐藏时');
});

test('日历用的任务表：只有日期落在父任务之外的子任务，才在自己那天另放一份 ↳ 副本', async () => {
  vaultWith({ [DAILY]: VIEW_SRC, 'Inbox.md': HEAD_INBOX + '- [ ] 收件箱父任务\n\t- [ ] 有日期的子任务 📅 2026-06-01\n\t- [ ] 没日期的子任务\n' });
  const all = body(await loadAll()).items;
  const cal = buildCalendarTasks(all);
  const echoes = cal.filter((t) => t.echo);
  // 子四（5/29，父任务在 5/27）、收件箱里有日期的子任务（父任务无日期）→ 有副本；
  // 子五（5/27，与父任务同一天）、没日期的子任务 → 没有
  eq(echoes.map((t) => t.summary).sort(), ['子四', '有日期的子任务'], '副本');
  eq(cal.length, all.length + 2, '总数 = 顶层任务 + 副本');
  const e = echoes.find((t) => t.summary === '子四');
  const orig = all[0].subtasks.find((s) => s.summary === '子四');
  eq([e.guid === orig.guid, e.parentTitle, e !== orig], [true, '父任务', true], '副本与原子任务同一 guid、是另一个对象');
});

test('跨日期的父任务：子任务日期落在跨度之内就不另放副本', () => {
  const parent = { guid: 'p', dueAt: ms(2026, 5, 30), startAt: ms(2026, 5, 26), dueAllDay: true, subtasks: [
    { guid: 'a', dueAt: ms(2026, 5, 28), dueAllDay: true },
    { guid: 'b', dueAt: ms(2026, 6, 2), dueAllDay: true }
  ] };
  eq(buildCalendarTasks([parent]).filter((t) => t.echo).map((t) => t.guid), ['b'], '副本');
});

test('在各视图里直接点开子任务：按 guid 能取到这条子任务的完整记录', async () => {
  vaultWith({ [DAILY]: VIEW_SRC });
  const sub = body(await loadByDate('2026-05-27')).items[0].subtasks[3];
  const { Tasks } = await import('../src/core/composables/useTasks.js');
  const got = await Tasks.getDetail(sub.guid);
  eq([got && got.summary, got && got.parentTitle], ['子四', '父任务'], '取到的记录');
});

// ============================================================
// 五、编辑窗口的日期面板（仿滴答清单，composables/dateDraft.js）
// ============================================================

test('日期面板：打开时从表单读出草稿，点确定换算回表单，五种形态都原样来回', () => {
  const cases5 = [
    [{ timeMode: 'allday', dueDate: '2026-11-10' }, { tab: 'date', date: '2026-11-10', start: '', end: '' }],
    [{ timeMode: 'single', dueDate: '2026-11-10', dueTime: '09:00' }, { tab: 'date', date: '2026-11-10', start: '09:00', end: '' }],
    [{ timeMode: 'range', dueDate: '2026-11-10', dueStart: '10:00', dueEnd: '16:00' }, { tab: 'date', date: '2026-11-10', start: '10:00', end: '16:00' }],
    [{ timeMode: 'crossdate', startDate: '2026-11-10', dueDate: '2026-11-14' }, { tab: 'span', spanStart: '2026-11-10', spanEnd: '2026-11-14' }],
    [{ timeMode: 'none', dueDate: '2026-11-10' }, { tab: 'date', date: '', start: '', end: '' }]
  ];
  for (const [form, want] of cases5) {
    const d = formToDraft(form);
    eq(Object.keys(want).map((k) => d[k]), Object.values(want), form.timeMode + ' 读出的草稿');
    const back = draftToForm(d);
    eq(back.timeMode, form.timeMode, form.timeMode + ' 换算回来的形态');
  }
  eq(draftToForm(formToDraft(cases5[2][0])), { startDate: '', dueDate: '2026-11-10', timeMode: 'range', dueTime: '10:00', dueStart: '10:00', dueEnd: '16:00' }, '时间段换算回来的字段');
  eq(draftToForm(formToDraft(cases5[3][0])), { timeMode: 'crossdate', startDate: '2026-11-10', dueDate: '2026-11-14', dueTime: '', dueStart: '', dueEnd: '' }, '跨日期换算回来的字段');
});

test('日期面板：时间不填是全天、只填开始是单个时间；只有时间没日期的子任务保持原样', () => {
  eq(draftToForm({ tab: 'date', date: '2026-11-10', start: '', end: '' }).timeMode, 'allday', '有日期没时间');
  eq(draftToForm({ tab: 'date', date: '', start: '', end: '' }).timeMode, 'none', '都没填');
  const timeOnly = draftToForm(formToDraft({ timeMode: 'single', dueDate: '', dueTime: '09:00' }));
  eq([timeOnly.timeMode, timeOnly.dueDate, timeOnly.dueTime], ['single', '', '09:00'], '只有时间（如「09:00 查房」）');
  eq(draftToForm({ tab: 'span', spanStart: '2026-11-10', spanEnd: '2026-11-10' }).timeMode, 'allday', '时间段的开始、结束是同一天 = 那天全天');
});

test('日期面板：结束早于开始时提示，不换算', () => {
  eq(draftError({ tab: 'date', date: '2026-11-10', start: '10:00', end: '09:30' }), 'editor.endAfterStart', '结束时间早于开始');
  eq(draftError({ tab: 'date', date: '2026-11-10', start: '10:00', end: '10:00' }), 'editor.endAfterStart', '结束时间等于开始');
  eq(draftError({ tab: 'span', spanStart: '2026-11-14', spanEnd: '2026-11-10' }), 'editor.endDateAfterStart', '结束日期早于开始');
  eq(draftError({ tab: 'date', date: '2026-11-10', start: '10:00', end: '' }), '', '只有开始时间没问题');
});

test('日期面板：快捷日期（今天、明天、7 天后、今晚）和按钮高亮，跨月跨年也对', () => {
  const T = '2026-11-28';
  eq(['today', 'tomorrow', 'week', 'tonight'].map((k) => quickPick(k, T)),
    [{ date: T }, { date: '2026-11-29' }, { date: '2026-12-05' }, { date: T, start: '20:00', end: '' }], '各快捷日期');
  eq([addDays('2026-12-31', 1), addDays('2026-03-01', -1), daysBetween('2026-11-10', '2026-11-14')], ['2027-01-01', '2026-02-28', 4], '加减天数');
  const tonight = { tab: 'date', date: T, start: '20:00', end: '' };
  eq(['today', 'tonight'].map((k) => isQuickPicked(k, tonight, T)), [false, true], '今天 20:00 只亮「今晚」');
  eq(isQuickPicked('today', { tab: 'date', date: T, start: '09:00', end: '' }, T), true, '今天 09:00 亮「今天」');
  eq([nextHalfHour(new Date(2026, 10, 11, 9, 12)), nextHalfHour(new Date(2026, 10, 11, 23, 50))], ['09:30', '23:30'], '添加时间的默认值');
});

test('日期面板：切到「时间段」从选中那天开始、默认到第二天；切回来日期还在', () => {
  const span = switchTab({ tab: 'date', date: '2026-11-10', start: '09:00', end: '', spanStart: '', spanEnd: '' }, 'span', '2026-11-11');
  eq([span.tab, span.spanStart, span.spanEnd], ['span', '2026-11-10', '2026-11-11'], '切到时间段');
  eq(switchTab(span, 'date', '2026-11-11').date, '2026-11-10', '切回日期');
  eq(switchTab({ tab: 'date', date: '', start: '', end: '', spanStart: '', spanEnd: '' }, 'span', '2026-11-11').spanStart, '2026-11-11', '没选日期就从今天开始');
});

test('日期胶囊：显示今天 / 明天、全天、时间段、跨日期、无日期', () => {
  const T = '2026-11-11';
  eq(chipInfo({ timeMode: 'allday', dueDate: T }, T), { kind: 'day', date: T, rel: 'today', time: '' }, '今天全天');
  eq(chipInfo({ timeMode: 'range', dueDate: '2026-11-12', dueStart: '10:00', dueEnd: '16:00' }, T).time, '10:00–16:00', '时间段');
  eq(chipInfo({ timeMode: 'single', dueDate: '2026-11-10', dueTime: '09:00' }, T).rel, 'yesterday', '昨天');
  eq(chipInfo({ timeMode: 'crossdate', startDate: '2026-11-10', dueDate: '2026-11-14' }, T), { kind: 'span', from: '2026-11-10', to: '2026-11-14', fromTime: '', toTime: '' }, '跨日期');
  eq(chipInfo({ timeMode: 'crossdate', startDate: '2026-11-12', dueDate: '2026-11-13', dueStart: '14:00', dueEnd: '10:00' }, T),
    { kind: 'span', from: '2026-11-12', to: '2026-11-13', fromTime: '14:00', toTime: '10:00' }, '跨日期带时间');
  eq(chipInfo({ timeMode: 'single', dueDate: '', dueTime: '09:00' }, T), { kind: 'time', time: '09:00' }, '只有时间');
  eq(chipInfo({ timeMode: 'none', dueDate: T }, T), { kind: 'none' }, '无日期');
});

// ============================================================
// 六、开始和截止是同一天时只写 📅（自用改版：原来只对子任务这样做）
// ============================================================

// 编辑窗口保存时传给数据层的日期字段（和 TaskEditorModal 的 buildDueAt 一样：没有开始日时 startAt 为 undefined）
const ALL_DAY = (d) => ({ dueAt: d, dueEndAt: null, startAt: undefined, dueAllDay: true });

test('清单里的主任务改日期：开始、截止是同一天时只写 📅，原来多出的同日 🛫 也去掉', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '- [ ] 甲 📅 2026-11-12\n- [ ] 乙 📅 2026-11-12 🛫 2026-11-12\n- [ ] 丙\n' });
  const task = async (name) => body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks.find((t) => t.summary === name);
  body(await updateTask((await task('甲')).guid, ALL_DAY(ms(2026, 11, 13))));
  body(await updateTask((await task('乙')).guid, ALL_DAY(ms(2026, 11, 12))));
  body(await updateTask((await task('丙')).guid, { dueAt: ms(2026, 11, 12, 9, 0), dueEndAt: null, startAt: undefined, dueAllDay: false }));
  eq(v.read(LIST), HEAD_LIST + '- [ ] 甲 📅 2026-11-13\n- [ ] 乙 📅 2026-11-12\n- [ ] 09:00 丙 📅 2026-11-12\n', '清单文件内容');
});

test('收件箱和新建的清单任务同样只写 📅；跨日期照旧写 📅 和 🛫', async () => {
  const INBOX = 'Inbox.md';
  const v = vaultWith({ [INBOX]: HEAD_INBOX + '- [ ] 买书\n', [LIST]: HEAD_LIST + '### 组A\n- [ ] 甲\n' });
  const book = body(await loadAll()).items.find((x) => x.summary === '买书');
  body(await updateTask(book.guid, ALL_DAY(ms(2026, 11, 12))));
  eq(v.read(INBOX), HEAD_INBOX + '- [ ] 买书 📅 2026-11-12\n', '收件箱');
  body(await createChecklistTask(LIST_KEY, '组A', { summary: '乙', dueAt: ms(2026, 11, 12), startAt: ms(2026, 11, 12), dueAllDay: true }));
  const jia = body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks.find((t) => t.summary === '甲');
  body(await updateTask(jia.guid, { dueAt: ms(2026, 11, 14), dueEndAt: null, startAt: ms(2026, 11, 12), dueAllDay: true }));
  eq(v.read(LIST), HEAD_LIST + '### 组A\n- [ ] 甲 📅 2026-11-14 🛫 2026-11-12\n- [ ] 乙 📅 2026-11-12\n', '清单文件内容');
});

// ============================================================
// 七、在清单分组末尾新建、移入任务：紧跟在这一组最后一行后面，不隔空行（自用改版）
// ============================================================

test('清单分组末尾新建任务：跳过组尾空行和文件结尾的换行，不再多出空行，也不贴到下一个标题上', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '- [ ] 散\n\n### 组A\n- [ ] 甲\n\n### 组B\n- [ ] 乙\n\n### 组C\n\n### 组D\n' });
  body(await createChecklistTask(LIST_KEY, '组A', { summary: '新A' }));
  body(await createChecklistTask(LIST_KEY, '组B', { summary: '新B' }));
  body(await createChecklistTask(LIST_KEY, '组C', { summary: '新C' }));
  body(await createChecklistTask(LIST_KEY, '组D', { summary: '新D' }));
  body(await createChecklistTask(LIST_KEY, '', { summary: '新散' }));
  eq(v.read(LIST), HEAD_LIST
    + '- [ ] 散\n- [ ] 新散\n\n### 组A\n- [ ] 甲\n- [ ] 新A\n\n### 组B\n- [ ] 乙\n- [ ] 新B\n\n### 组C\n- [ ] 新C\n\n### 组D\n- [ ] 新D\n',
  '清单文件内容');
  const g = body(await loadChecklistGroups(LIST_KEY));
  eq(g.groups.map((x) => [x.title, x.tasks.map((t) => t.summary)]),
    [['', ['散', '新散']], ['组A', ['甲', '新A']], ['组B', ['乙', '新B']], ['组C', ['新C']], ['组D', ['新D']]], '读回的分组');
});

test('把任务拖到最后一组：接在这一组最后一条后面，文件结尾的换行保留', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '### 组A\n- [ ] 甲\n\t- [ ] 甲的子\n\n### 组B\n- [ ] 乙\n' });
  const jia = body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks[0];
  body(await moveChecklistTask(LIST_KEY, jia.guid, '组B'));
  eq(v.read(LIST), HEAD_LIST + '### 组A\n\n### 组B\n- [ ] 乙\n- [ ] 甲\n\t- [ ] 甲的子\n', '清单文件内容');
});

// ============================================================
// 八、跨天又带时间的任务（如 11/12 14:00 到 11/13 10:00，自用改版）
// ============================================================

test('日期面板：时间段关掉全天后带上开始、结束时间；同一天的按那天的时间段处理', () => {
  const form = { timeMode: 'crossdate', startDate: '2026-11-12', dueDate: '2026-11-13', dueStart: '14:00', dueTime: '14:00', dueEnd: '10:00' };
  const d = formToDraft(form);
  eq([d.tab, d.date, d.spanAllDay, d.spanStartTime, d.spanEndTime], ['span', '2026-11-12', false, '14:00', '10:00'], '读出的草稿');
  eq(draftToForm(d), { timeMode: 'crossdate', startDate: '2026-11-12', dueDate: '2026-11-13', dueTime: '14:00', dueStart: '14:00', dueEnd: '10:00' }, '换算回来');
  eq(draftError(d), '', '跨了天，结束时刻比开始早没关系');
  eq(draftToForm(Object.assign({}, d, { spanAllDay: true })).dueStart, '', '开着全天就不带时间');
  const same = { tab: 'span', spanStart: '2026-11-12', spanEnd: '2026-11-12', spanAllDay: false, spanStartTime: '14:00', spanEndTime: '16:00' };
  eq([draftToForm(same).timeMode, draftToForm(Object.assign({}, same, { spanEndTime: '' })).timeMode], ['range', 'single'], '同一天：时间段 / 单个时间');
  eq(draftError(Object.assign({}, same, { spanEndTime: '13:00' })), 'editor.endAfterStart', '同一天结束早于开始要提示');
  const toSpan = switchTab({ tab: 'date', date: '2026-11-12', start: '09:00', end: '10:00', spanStart: '', spanEnd: '', spanAllDay: true, spanStartTime: '', spanEndTime: '' }, 'span', '2026-11-12');
  eq([toSpan.spanAllDay, toSpan.spanStartTime, toSpan.spanEndTime], [false, '09:00', '10:00'], '「日期」填的时间带到时间段');
  eq(switchTab(Object.assign({}, d, { start: '' }), 'date', '2026-11-12').start, '14:00', '时间段的开始时间带回「日期」');
});

test('跨天带时间的任务：日记里写成「14:00-10:00 … 📅 结束日」，读回的开始、结束时刻都对', async () => {
  const J12 = '日记/2026-11-12.md';
  const v = vaultWith({ [J12]: HEAD_DAILY + '- [ ] 出差\n- [ ] 其他\n' });
  const t0 = body(await loadByDate('2026-11-12')).items.find((x) => x.summary === '出差');
  body(await updateTask(t0.guid, { dueAt: ms(2026, 11, 13, 14, 0), dueEndAt: ms(2026, 11, 13, 10, 0), startAt: ms(2026, 11, 12, 14, 0), dueAllDay: false }));
  eq(v.read(J12), HEAD_DAILY + '- [ ] 14:00-10:00 出差 📅 2026-11-13\n- [ ] 其他\n', '日记文件内容');
  const t = body(await loadByDate('2026-11-12')).items.find((x) => x.summary === '出差');
  eq([t.startAt, t.dueEndAt, t.dueAllDay, spansDays(t), timeText(t)], [ms(2026, 11, 12, 14, 0), ms(2026, 11, 13, 10, 0), false, true, '14:00-10:00'], '读回的记录');
  body(await createTask({ summary: '新出差', dueAt: ms(2026, 11, 14, 9, 0), dueEndAt: ms(2026, 11, 14, 18, 0), startAt: ms(2026, 11, 12, 9, 0), dueAllDay: false }));
  ok(v.read(J12).includes('- [ ] 09:00-18:00 新出差 📅 2026-11-14'), '新建的跨天带时间任务: ' + JSON.stringify(v.read(J12)));
});

test('跨天带时间的任务：清单里写成「14:00-10:00 … 📅 结束日 🛫 开始日」', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '- [ ] 出差\n' });
  const t0 = body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks[0];
  body(await updateTask(t0.guid, { dueAt: ms(2026, 11, 13, 14, 0), dueEndAt: ms(2026, 11, 13, 10, 0), startAt: ms(2026, 11, 12, 14, 0), dueAllDay: false }));
  eq(v.read(LIST), HEAD_LIST + '- [ ] 14:00-10:00 出差 📅 2026-11-13 🛫 2026-11-12\n', '清单文件内容');
  const t = body(await loadChecklistGroups(LIST_KEY)).groups[0].tasks[0];
  eq([t.startAt, t.dueEndAt, timeText(t)], [ms(2026, 11, 12, 14, 0), ms(2026, 11, 13, 10, 0), '14:00-10:00'], '读回的记录');
});

test('跨天带时间的任务：在开始时刻提醒；拖动换日期时时分不变', () => {
  const span = { guid: 'g', dueAt: ms(2026, 11, 13, 0, 0), startAt: ms(2026, 11, 12, 14, 0), dueEndAt: ms(2026, 11, 13, 10, 0), dueAllDay: false };
  const svc = new ReminderService({ settings: {} });
  eq(svc.notifyAtOf(span, '2026-11-12'), ms(2026, 11, 12, 14, 0), '提醒时刻 = 开始时刻');
  eq(svc.notifyAtOf({ guid: 'h', dueAt: ms(2026, 11, 12, 9, 0), dueAllDay: false }, '2026-11-12'), ms(2026, 11, 12, 9, 0), '普通定时任务照旧');
  eq(moveToDay(ms(2026, 11, 12, 14, 30), '2026-11-15'), ms(2026, 11, 15, 14, 30), '一端换日期');
  eq(shiftSpanToDay(span, '2026-11-30'), { startAt: ms(2026, 11, 30, 14, 0), dueAt: ms(2026, 12, 1, 0, 0), dueEndAt: ms(2026, 12, 1, 10, 0) }, '整条挪到新的一天（跨月）');
  eq(timeText({ dueAt: ms(2026, 11, 13, 0, 0), startAt: ms(2026, 11, 12, 14, 0), dueAllDay: false }), '14:00', '没有结束时间只显示开始时间');
});

// ============================================================
// 九、标签管理：删除、改名、移进移出标签组（自用改版）
// ============================================================

test('改写标签的规则：只认 # 前面是空白或开头的；链接里的 # 不算；删掉时连前面的空格一起去掉', () => {
  const del = tagMapper({ kind: 'delete', from: '财务' });
  eq(rewriteTagsInText('报销 #财务 #财务2 [看#财务](https://x.com/#财务) 结尾', del),
    '报销 #财务2 [看#财务](https://x.com/#财务) 结尾', '删除');
  eq(rewriteTagsInText('#财务 开头', del), ' 开头', '开头的标签');
  const ren = tagMapper({ kind: 'rename', from: '科研', to: '研究' });
  eq(rewriteTagsInText('a #科研 #科研/论文 #科研论文', ren), 'a #研究 #研究/论文 #科研论文', '改名连同组里的子标签，不碰只是开头相同的');
  eq(rewriteTagsInText('a #甲 #乙', tagMapper({ kind: 'rename', from: '甲', to: '乙' })), 'a #乙', '改名后重复的只留一个');
  eq(rewriteTagsInText('a #科研/论文 #科研', tagMapper({ kind: 'dissolve', from: '科研' })), 'a #论文 #科研', '解散组：只去掉组名前缀');
  const same = 'a #乙 #乙';
  eq(rewriteTagsInText(same, tagMapper({ kind: 'delete', from: '丙' })) === same, true, '没有要改的原样返回');
  eq(['#科研 论文', '/a//b/', '123', 'a!b', ''].map(cleanTagName), ['科研-论文', 'a/b', '', '', ''], '整理输入的标签名');
});

test('批量删除标签：日记、收件箱、清单里的主任务和子任务一起改；描述、链接、相似标签不动；预览不写文件', async () => {
  const J12 = '日记/2026-11-12.md';
  const INBOX = 'Inbox.md';
  const daily = HEAD_DAILY + '- [ ] 写报告 #财务 #todo\n\t说明里提到 #财务 不改\n\t- [ ] 子任务 #财务\n- [ ] 其他 #财务2\n';
  const inbox = HEAD_INBOX + '- [ ] 买书 [链接](https://x.com/#财务) #财务\n';
  const list = HEAD_LIST + '- [ ] 甲 #财务/报销\n';
  const v = vaultWith({ [J12]: daily, [INBOX]: inbox, [LIST]: list });
  const op = { kind: 'delete', from: '财务' };
  eq(body(await editTags(op, { dryRun: true })), { ok: true, tasks: 3, files: 2 }, '预览：3 条任务、2 篇笔记（组里的 #财务/报销 不算）');
  eq([v.read(J12), v.read(INBOX)], [daily, inbox], '预览不改文件');
  eq(body(await editTags(op)), { ok: true, tasks: 3, files: 2 }, '执行');
  eq(v.read(J12), HEAD_DAILY + '- [ ] 写报告 #todo\n\t说明里提到 #财务 不改\n\t- [ ] 子任务\n- [ ] 其他 #财务2\n', '日记');
  eq(v.read(INBOX), HEAD_INBOX + '- [ ] 买书 [链接](https://x.com/#财务)\n', '收件箱');
  eq(v.read(LIST), list, '清单没有要改的');
});

test('标签组：移进组、给组改名、移出组、解散组，都按「#组/标签」改写任务行', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '- [ ] 甲 #论文 📅 2026-11-12\n- [ ] 乙 #实验\n' });
  const run = async (op) => body(await editTags(op));
  await run({ kind: 'rename', from: '论文', to: '科研/论文' });
  await run({ kind: 'rename', from: '实验', to: '科研/实验' });
  eq(v.read(LIST), HEAD_LIST + '- [ ] 甲 #科研/论文 📅 2026-11-12\n- [ ] 乙 #科研/实验\n', '移进「科研」组');
  await run({ kind: 'rename', from: '科研', to: '研究' });
  eq(v.read(LIST), HEAD_LIST + '- [ ] 甲 #研究/论文 📅 2026-11-12\n- [ ] 乙 #研究/实验\n', '给组改名');
  await run({ kind: 'rename', from: '研究/实验', to: '实验' });
  await run({ kind: 'dissolve', from: '研究' });
  eq(v.read(LIST), HEAD_LIST + '- [ ] 甲 #论文 📅 2026-11-12\n- [ ] 乙 #实验\n', '移出组、解散组');
});

// ============================================================
// 十、Mac 桌面小组件的数据（四象限）
// ============================================================

/** 测试用的界面文字：只认小组件用到的几个键，其余原样返回键名 */
const fakeT = (key, p) => {
  if (key === 'app.weekdaysShort') return ['一', '二', '三', '四', '五', '六', '日'];
  return ({
    'app.viewMatrix': '四象限', 'app.matrixEmpty': '暂无任务', 'app.widgetMore': '还有 {{n}} 条',
    'app.matrixTitleHigh': '重要且紧急', 'app.matrixTitleMedium': '重要不紧急',
    'app.matrixTitleLow': '紧急不重要', 'app.matrixTitleNone': '不重要不紧急',
    'app.rest': '休', 'app.work': '班'
  }[key] || key).replace('{{n}}', p && p.n);
};
/** 只取每格的行：[[文字, 缩进, 是否做完], …]，方便逐格比对 */
const quadLines = (m) => m.quadrants.map((q) => q.items.map((i) => [i.text, i.depth, i.done]));

test('四象限小组件：按优先级分格、按到期时间排；子任务缩进跟着主任务；隐藏已完成、折叠都和面板一致', async () => {
  const [H, M, L] = ['high', 'medium', 'low'].map(levelToPriorityEmoji);
  vaultWith({
    'Inbox.md': HEAD_INBOX
      + `- [ ] 没日期的高 #财务 ${H}\n`
      + `- [ ] 以后的高 ${H} 📅 2026-11-20\n`
      + `- [ ] 过期的高 [申请书](https://example.com/a) ${H} 📅 2026-11-01\n`
      + `- [x] 做完的高 ${H} 📅 2026-11-02 ✅ 2026-11-03\n`
      + `- [-] 取消的高 ${H}\n`
      + `- [ ] 中 ${M} 📅 2026-11-12\n\t- [ ] 子任务甲\n\t- [x] 子任务乙 ✅ 2026-11-10\n`
      + `- [ ] 低 ${L}\n`
      + '- [ ] 普通 📅 2026-11-13\n'
  });
  const tasks = body(await loadAll()).items;

  const m = buildMatrixWidget(tasks, { hideDone: true, t: fakeT });
  eq([m.title, m.emptyText, m.moreText], ['四象限', '暂无任务', '还有 {n} 条'], '标题和提示文字');
  eq(m.quadrants.map((q) => [q.level, q.title, q.color]), [
    ['high', '重要且紧急', '#e0584f'], ['medium', '重要不紧急', '#e0a93b'],
    ['low', '紧急不重要', '#4a90d2'], ['none', '不重要不紧急', '#4caf7d']
  ], '四格的顺序、标题、颜色');
  eq(quadLines(m), [
    [['过期的高 申请书', 0, false], ['以后的高', 0, false], ['没日期的高', 0, false]],
    [['中', 0, false], ['子任务甲', 1, false]],
    [['低', 0, false]],
    [['普通', 0, false]]
  ], '隐藏已完成：过期的在最上、没日期的在最后，标签去掉、链接留文字，做完的主任务和子任务都不列');
  eq(m.quadrants.map((q) => q.total), [3, 2, 1, 1], '每格的行数');

  const shown = buildMatrixWidget(tasks, { hideDone: false, t: fakeT });
  eq(quadLines(shown).slice(0, 2), [
    [['过期的高 申请书', 0, false], ['以后的高', 0, false], ['没日期的高', 0, false], ['做完的高', 0, true]],
    [['中', 0, false], ['子任务甲', 1, false], ['子任务乙', 1, true]]
  ], '显示已完成：做完的接在待办后面；取消的始终不算');

  const folded = buildMatrixWidget(tasks, { hideDone: true, t: fakeT, isFolded: (t) => t.summary === '中' });
  eq(quadLines(folded)[1], [['中', 0, false]], '折叠了子任务的主任务不列子任务');
});

test('小组件数据：行数太多时截短但记下总数；点小组件打开的地址带库名、视图', () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({ summary: '任务' + (i + 1), dueAt: ms(2026, 11, 10 + i) }));
  const d = buildWidgetData(tasks, { vault: "我的 库'", hideDone: true, t: fakeT, maxItems: 3 });
  eq(d.version, 1, '数据格式版本');
  eq(d.openUrl.matrix, "obsidian://chaochao-list?vault=%E6%88%91%E7%9A%84%20%E5%BA%93'&view=matrix", '打开地址');
  const none = d.matrix.quadrants[3];
  eq([none.total, none.items.map((i) => i.text)], [5, ['任务1', '任务2', '任务3']], '只写前 3 行，总数仍是 5');
  eq([widgetTitle('读 [论文](https://x.y/z) #科研 '), widgetTitle('#只有标签')], ['读 论文', '#只有标签'], '标题的写法');
  eq(d.openUrl.day.endsWith('&view=day&date={date}') && d.openUrl.month.endsWith('&view=month&date={date}'), true, '日视图、月视图的打开地址');
});

test('颜色换算：CSS 颜色换成 #rrggbbaa，认不出的（如 var(--ink)）返回空串', () => {
  eq(['#4caf7d', '#abc', '#11223344', 'rgba(244, 67, 54, .18)', 'rgb(0,128,255)', 'var(--ink)', ''].map(cssColorToHex),
    ['#4caf7dff', '#aabbccff', '#11223344', '#f443362e', '#0080ffff', '', '']);
});

test('月视图小组件：两个月的月历按每周开始日排；跨天长条、按天的任务、↳ 副本、标签颜色、隐藏已完成都和面板一致', async () => {
  vaultWith({
    [DAILY.replace('2026-05-27', '2026-11-12')]: HEAD_DAILY + '- [ ] 日记任务\n- [x] 做完的 ✅ 2026-11-12\n- [ ] 跨三天 📅 2026-11-14\n',
    'Inbox.md': HEAD_INBOX + '- [ ] 收件箱带日期 #财务 📅 2026-11-03\n- [ ] 主任务 📅 2026-11-05\n\t- [ ] 子任务另一天 📅 2026-11-20\n'
  });
  setTagColors({ 财务: '#4caf7d' });
  try {
    const tasks = body(await loadAll()).items;
    const opts = { t: fakeT, now: new Date(2026, 10, 12), weekStart: 1, hideDone: true, showLunar: true, lang: 'zh-cn' };
    const w = buildMonthWidget(tasks, opts);
    eq([w.weekdays.join(''), w.restText, w.workText], ['一二三四五六日', '休', '班'], '表头周几和休 / 班');
    eq(w.months.map((m) => [m.key, m.title, m.weeks.length]), [['2026-11', '十一月', 6], ['2026-12', '十二月', 5]], '这个月和下个月');
    const nov = w.months[0];
    const keysOf = (wk) => wk.days.map((d) => d.key.slice(5));
    eq([keysOf(nov.weeks[0]), nov.weeks[0].days.map((d) => d.other)], [
      ['10-26', '10-27', '10-28', '10-29', '10-30', '10-31', '11-01'], [true, true, true, true, true, true, false]
    ], '第一周从周一开始，用上个月的日子补齐');
    eq(keysOf(nov.weeks[5]), ['11-30', '12-01', '12-02', '12-03', '12-04', '12-05', '12-06'], '最后一周用下个月补齐');

    const day = (key) => nov.weeks.flatMap((wk) => wk.days).find((d) => d.key === key);
    const texts = (d) => d.chips.map((c) => (c.done ? '√' : '') + c.text);
    eq([texts(day('2026-11-12')), day('2026-11-12').chipTotal], [['日记任务'], 1], '隐藏已完成：做完的不列；跨天任务不算进单日');
    eq(nov.weeks[2].bars.map((b) => [b.text, b.start, b.end, b.lane, b.contStart, b.contEnd]), [['跨三天', 3, 5, 0, false, false]], '跨天长条：周四到周六');
    eq([texts(day('2026-11-05')), texts(day('2026-11-20'))], [['主任务'], ['↳ 子任务另一天']], '子任务在自己那天另放一份 ↳ 副本');
    const fin = day('2026-11-03').chips[0];
    // 1.1.0 起默认配色是琉璃，标签色的浅底跟着淡到 .16（0x29）；原来的 .28 是 0x47
    eq([fin.text, fin.bg, fin.fg], ['收件箱带日期', '#4caf7d29', ''], '标签颜色当底色（与面板同一透明度），文字用默认色');
    ok(/^#[0-9a-f]{8}$/.test(day('2026-11-05').chips[0].bg), '没设标签颜色的按配色方案取色');

    const all = nov.weeks.flatMap((wk) => wk.days);
    ok(all.every((d) => d.tag === lunarTagText(new Date(d.key + 'T00:00:00'))), '节气 / 节日名与面板一致');
    ok(all.every((d) => { const h = holidayOf(d.key); return d.holiday === (h ? (h.rest ? 'rest' : 'work') : ''); }), '休 / 班与面板一致');

    const shown = buildMonthWidget(tasks, Object.assign({}, opts, { hideDone: false }));
    eq(texts(shown.months[0].weeks[2].days[3]), ['日记任务', '√做完的'], '显示已完成：做完的排在后面');
    const noLunar = buildMonthWidget(tasks, Object.assign({}, opts, { showLunar: false }));
    ok(noLunar.months[0].weeks.flatMap((wk) => wk.days).every((d) => d.tag === '' && d.holiday === ''), '关掉农历与节假日后都不带');
    const sun = buildMonthWidget(tasks, Object.assign({}, opts, { weekStart: 0 }));
    eq([sun.weekdays.join(''), sun.months[0].weeks[0].days[0].key, sun.months[0].weeks.length], ['日一二三四五六', '2026-11-01', 5], '每周从周日开始');
  } finally {
    setTagColors({});
  }
});

// ============================================================
// 十一、表情符号标签，和「这台设备的使用者」（两个人共用一个库，自用改版）
// ============================================================

test('表情符号标签：#🌻 #🥕 和文字标签一样被认出来；标题里本来就有的表情符号不算标签', async () => {
  vaultWith({ 'Inbox.md': HEAD_INBOX
    + '- [ ] 09:00 买🥕 #家务 #🌻 🔺 📅 2026-11-13\n'
    + '- [ ] 交水费 #🥕\n'
    + '- [ ] 一起的 #🌻 #🥕 🔕\n'
    + '- [ ] 各种 #谁/🌻 #❤️ #👍🏽 #🇨🇳 #⭐⭐⭐ #a🌻b\n'
    + '- [ ] 手写紧贴 #家务🔕\n'
    + '- [ ] 打卡 #✅ #🌻🔁 every day\n' });
  const items = body(await loadAll()).items;
  const of = (name) => items.find((x) => x.summary.indexOf(name) === 0);
  const buy = of('买🥕');
  eq([buy.summary, buy.tags, buy.priority, buy.dueAt, buy.time], ['买🥕 #家务 #🌻', ['家务', '🌻'], '🔺', ms(2026, 11, 13, 9, 0), '09:00'],
    '标签、优先级、日期、时间各归各位');
  eq(of('交水费').tags, ['🥕'], '只有一个表情符号标签');
  eq([of('一起的').tags, of('一起的').remind], [['🌻', '🥕'], false], '两个人的都带；🔕 仍是「不提醒」');
  eq(of('各种').tags, ['谁/🌻', '❤️', '👍🏽', '🇨🇳', '⭐⭐⭐', 'a🌻b'], '标签组里的、带修饰符的、国旗、连着几个的、夹在文字里的');
  eq([of('手写紧贴').tags, of('手写紧贴').remind], [['家务'], false], '标签后面紧贴着 🔕：标签读到它为止，🔕 仍是「不提醒」');
  eq(of('打卡').tags, ['🌻'], '任务标记用的符号不算标签名：#✅ 不是标签，#🌻 读到 🔁 为止');

  eq(splitSummary('买🥕 #家务 #🌻'), { title: '买🥕', links: [], tags: ['家务', '🌻'], muted: false }, '编辑窗口拆标题：标签拿走，标题里的 🥕 留着');
  eq(composeSummary('买🥕', [], ['家务', '🌻']), '买🥕 #家务 #🌻', '编辑窗口拼回去');
  eq(widgetTitle('买🥕 #家务 #🌻'), '买🥕', '小组件里不显示标签');
});

test('表情符号标签的名字：能用表情符号，不能用任务行里有固定含义的符号（📅 ✅ 🔺 🔁 🔕 等）', () => {
  eq(['🌻', '#🥕', '谁/🌻', '❤️', 'a🌻b', '⭐⭐⭐', '🌻 🥕'].map(cleanTagName),
    ['🌻', '🥕', '谁/🌻', '❤️', 'a🌻b', '⭐⭐⭐', '🌻-🥕'], '合格的（空格换成 -）');
  eq(['✅', '📅', '➕', '🛫', '⏳', '❌', '🔺', '⏫', '🔼', '🔽', '⏬', '🔁', '🔕', '家务🔼', '🌻，'].map(cleanTagName),
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], '不合格的：任务标记用的符号、中文标点');
  const ren = tagMapper({ kind: 'rename', from: '🌻', to: '🥕' });
  eq(rewriteTagsInText('买菜 #🌻 #🌻菜 #谁/🌻', ren), '买菜 #🥕 #🌻菜 #谁/🌻', '改名：只改这一个标签，不碰名字只是开头相同的');
  eq(rewriteTagsInText('买菜 #🌻 #家务', tagMapper({ kind: 'delete', from: '🌻' })), '买菜 #家务', '删除');
});

test('给标题补上使用者标签（快速添加框用）：已经带着就不重复，没设使用者就原样', () => {
  eq(withTag('买菜', '🌻'), '买菜 #🌻', '没有标签的');
  eq(withTag('买菜 #家务', '#🌻'), '买菜 #家务 #🌻', '已有别的标签：加在后面（标签名带 # 也行）');
  eq(withTag('买菜 #🌻 #家务', '🌻'), '买菜 #🌻 #家务', '已经带着：不重复加');
  eq(withTag('买🥕', '🥕'), '买🥕 #🥕', '标题里的表情符号不算已经带了标签');
  eq(withTag('看 [#🌻](https://x.com/#🌻)', '🌻'), '看 [#🌻](https://x.com/#🌻) #🌻', '链接里的 # 不算');
  eq([withTag('买菜', ''), withTag('  买菜  ', null)], ['买菜', '买菜'], '没设使用者：标题原样（去掉首尾空格）');
});

/** 假的 Obsidian app：只有「本机存储」两个接口，内容放在内存里（store）。 */
function fakeApp() {
  const store = new Map();
  return {
    store,
    loadLocalStorage(key) { return store.has(key) ? store.get(key) : null; },
    saveLocalStorage(key, value) { if (value == null) store.delete(key); else store.set(key, value); }
  };
}

test('这台设备的使用者：存在本机存储里；留空 = 清掉；不能当标签用的名字不保存', () => {
  const app = fakeApp();
  initDeviceUser(app);
  try {
    eq([getDeviceUserTag(), defaultTaskTags()], ['', []], '没设置：新建任务不自动加标签');
    eq(setDeviceUserTag(' #🌻 '), { ok: true, tag: '🌻' }, '去掉 # 和首尾空格后存下');
    eq([app.store.get(DEVICE_USER_KEY), getDeviceUserTag(), defaultTaskTags()], ['🌻', '🌻', ['🌻']], '存的是标签名；新建任务预先带上它');
    eq(setDeviceUserTag('✅'), { ok: false, tag: '🌻' }, '任务标记用的符号不能当使用者：不保存，原来的不变');
    eq(setDeviceUserTag('a!b'), { ok: false, tag: '🌻' }, '带标点的名字：不保存');
    eq(setDeviceUserTag('谁/🥕'), { ok: true, tag: '谁/🥕' }, '可以放在标签组里');
    eq(setDeviceUserTag('  '), { ok: true, tag: '' }, '留空 = 清掉');
    eq([app.store.has(DEVICE_USER_KEY), defaultTaskTags()], [false, []], '清掉后本机存储里不留这一项');
    app.store.set(DEVICE_USER_KEY, '📅');
    eq(getDeviceUserTag(), '', '存的内容不能当标签用（被别处改坏）：当作没设置');
  } finally {
    initDeviceUser(null);
  }
  eq([getDeviceUserTag(), setDeviceUserTag('🌻').ok], ['', false], '没有 app（如本测试环境）：读到空，保存不成功，也不报错');
});

test('带使用者标签新建任务：写进笔记的那一行带 #🌻，读回来能按标签上色', async () => {
  const v = vaultWith({ 'Inbox.md': HEAD_INBOX });
  const app = fakeApp();
  initDeviceUser(app);
  try {
    setDeviceUserTag('🌻');
    // 快速添加框：标题后面补上使用者标签
    body(await createTask({ summary: withTag('买菜', getDeviceUserTag()) }));
    // 编辑窗口：空白表单的标签栏预先放好使用者标签，保存时和标题拼在一起
    body(await createTask({ summary: composeSummary('交水费', [], defaultTaskTags().concat(['家务'])) }));
    eq(v.read('Inbox.md').split('\n').filter((line) => line.indexOf('- [ ]') === 0), ['- [ ] 买菜 #🌻', '- [ ] 交水费 #🌻 #家务'],
      '写进收件箱的两行任务');
    setTagColors({ '🌻': '#f5c518', '家务': '#4caf7d' });
    const items = body(await loadAll()).items;
    eq(items.map((x) => [x.tags, colorOf(x).fg]), [[['🌻'], '#f5c518'], [['🌻', '家务'], '#f5c518']], '任务块颜色跟着排在前面的使用者标签走');
  } finally {
    setTagColors({});
    initDeviceUser(null);
  }
});

// ============================================================
// 十二、按标签筛选：所有视图只显示选中的人、选中的标签的任务（自用改版）
// ============================================================

test('使用者名单和默认筛选：名单 = 设置里填的 + 这台设备的使用者；默认只看这台设备的使用者和「没指定」', () => {
  eq(buildUserList(['🌻', '#🥕', '🌻', 'a!b', ''], '🥕'), ['🌻', '🥕'], '去重、去掉 #、去掉不能当标签用的');
  eq(buildUserList([], '🌻'), ['🌻'], '名单没填：这台设备的使用者自己算一个');
  eq(buildUserList(['🥕'], '🌻'), ['🥕', '🌻'], '这台设备的使用者不在名单里：补在最后');
  eq(buildUserList(null, ''), [], '都没填：没有「谁的」这一部分');
  eq(defaultFilter(['🌻', '🥕'], '🌻'), { users: ['🌻'], unassigned: true, tags: [] }, '默认');
  eq(defaultFilter(['🌻', '🥕'], ''), { users: ['🌻', '🥕'], unassigned: true, tags: [] }, '没设这台设备的使用者：名单里的人全选');
});

test('整理存下来的筛选：没存过用默认；不在名单上的人、重复的标签去掉；「谁的」一个不剩就退回默认', () => {
  const U = ['🌻', '🥕'];
  eq(normalizeFilter(null, U, '🌻'), { users: ['🌻'], unassigned: true, tags: [] }, '没存过');
  eq(normalizeFilter({ users: ['🥕', '🌻', '👻'], unassigned: false, tags: ['家务', '🌻', '家务', ''] }, U, '🌻'),
    { users: ['🌻', '🥕'], unassigned: false, tags: ['家务'] }, '人按名单顺序排，去掉不在名单上的；标签去重、去掉其实是使用者的');
  eq(normalizeFilter({ users: ['👻'], unassigned: false, tags: [] }, U, '🥕'), { users: ['🥕'], unassigned: true, tags: [] },
    '选中的人已经不在名单上、又没选「没指定」：退回默认');
  eq(normalizeFilter({ users: [], unassigned: true, tags: [] }, U, '🌻'), { users: [], unassigned: true, tags: [] }, '只看「没指定」是可以的');
  eq(normalizeFilter({ users: ['🌻'], tags: ['x'] }, [], ''), { users: [], unassigned: true, tags: ['x'] }, '名单是空的：只剩标签');
});

test('筛选规则：是选中的人的（没带使用者标签的算「没指定」），并且带任意一个选中的标签', () => {
  const U = ['🌻', '🥕'];
  const T = (...tags) => ({ tags });
  // 七条任务依次是：我的 / 她的 / 两人的 / 什么标签都没有 / 只带家务 / 我的家务 / 她的科研论文
  const pool = [T('🌻'), T('🥕'), T('🌻', '🥕'), T(), T('家务'), T('🌻', '家务'), T('🥕', '科研/论文')];
  const show = (f, users = U) => { const m = makeMatcher(f, users); return pool.map((t) => (m ? m(t) : true)); };
  eq(show({ users: ['🌻'], unassigned: true, tags: [] }), [true, false, true, true, true, true, false], '默认：我的 + 没指定的');
  eq(show({ users: ['🌻'], unassigned: false, tags: [] }), [true, false, true, false, false, true, false], '点掉「没指定」：只剩带我标签的');
  eq(show({ users: ['🥕'], unassigned: false, tags: [] }), [false, true, true, false, false, false, true], '只看她的（两人都带的也算）');
  eq(show({ users: [], unassigned: true, tags: [] }), [false, false, false, true, true, false, false], '只看没指定的');
  eq(show({ users: ['🌻', '🥕'], unassigned: true, tags: ['家务', '科研'] }), [false, false, false, false, true, true, true],
    '不限人，带家务或科研的（选父标签「科研」，子标签「科研/论文」也算）');
  eq(show({ users: ['🌻'], unassigned: true, tags: ['家务'] }), [false, false, false, false, true, true, false], '我的和没指定的里面，带家务的');
  eq(makeMatcher({ users: ['🌻', '🥕'], unassigned: true, tags: [] }, U), null, '人全选、没选标签：什么都不挡，不用筛');
  eq(show({ users: [], unassigned: true, tags: ['家务'] }, []), [false, false, false, false, true, true, false], '没有使用者名单：只按标签');
  eq(makeMatcher({ users: [], unassigned: true, tags: [] }, []), null, '没有名单也没选标签：不用筛');
});

test('筛选面板里的点击：「谁的」最后一个点不掉；标签可多选；按钮上显示选了什么', () => {
  const U = ['🌻', '🥕'];
  const f = { users: ['🌻'], unassigned: true, tags: [] };
  eq(toggleWho(f, '🥕'), { users: ['🌻', '🥕'], unassigned: true, tags: [] }, '加上她');
  eq(toggleWho(f, null), { users: ['🌻'], unassigned: false, tags: [] }, '点掉「没指定」');
  eq(toggleWho({ users: ['🌻'], unassigned: false, tags: [] }, '🌻'), null, '只剩一个人时点不掉');
  eq(toggleWho({ users: [], unassigned: true, tags: [] }, null), null, '只剩「没指定」时也点不掉');
  eq(f, { users: ['🌻'], unassigned: true, tags: [] }, '点击不改原来那份筛选');
  eq(toggleTag(toggleTag(f, '家务'), '科研').tags, ['家务', '科研'], '标签可以选多个');
  eq(toggleTag({ users: [], unassigned: true, tags: ['家务'] }, '家务').tags, [], '再点一下取消');
  eq(clearTags({ users: ['🌻'], unassigned: false, tags: ['a', 'b'] }), { users: ['🌻'], unassigned: false, tags: [] }, '清除标签不动「谁的」');
  eq(filterSummary(f, U, '没指定'), ['🌻', '没指定'], '按钮文字：选中的人 + 没指定');
  eq(filterSummary({ users: U, unassigned: true, tags: ['家务'] }, U, '没指定'), ['#家务'], '人全选时只列标签');
  eq([filterSummary({ users: U, unassigned: true, tags: [] }, U, '没指定'), isFilterActive({ users: U, unassigned: true, tags: [] }, U)],
    [[], false], '什么都不挡：按钮不带字、不点亮');
  eq(isFilterActive(f, ['🌻']), false, '名单里只有自己、又选着「没指定」：其实没在挡');
});

test('按标签筛选接到取数那一层：全部任务、某个清单、清单分组、清单进度都按筛选来；子任务跟着主任务；提醒照旧读全部', async () => {
  const J12 = '日记/2026-11-12.md';
  const v = vaultWith({
    'Inbox.md': HEAD_INBOX + '- [ ] 我的 #🌻\n\t- [ ] 我的子任务\n- [ ] 她的 #🥕\n\t- [ ] 她的子任务 #🌻\n- [ ] 没标记的\n',
    [J12]: HEAD_DAILY + '- [ ] 她的日记任务 #🥕\n- [x] 我做完的 #🌻 #家务\n',
    [LIST]: HEAD_LIST + '- [ ] 清单里我的 #🌻\n\t- [x] 清单子任务\n### 采购\n- [ ] 清单里她的 #🥕 📅 2026-11-13\n\t- [ ] 她的清单子任务\n- [x] 清单里没标记的\n'
  }, { userTags: ['🌻', '🥕'], checklistShowJournal: false });
  const app = Object.assign(v.plugin.app, fakeApp());
  initDeviceUser(app);
  initViewFilter(v.plugin);
  try {
    setDeviceUserTag('🌻');
    const names = (items) => items.map((t) => splitSummary(t.summary).title).sort();
    const groupNames = (g) => g.groups.map((x) => [x.title, x.tasks.map((t) => splitSummary(t.summary).title)]);
    const progress = async () => (await Tasks.loadChecklists()).map((c) => [c.name, c.done, c.total]);

    // —— 没动过筛选：默认只看我的和没指定的 ——
    eq([getViewFilter(), app.store.has(VIEW_FILTER_KEY)], [{ users: ['🌻'], unassigned: true, tags: [] }, false], '默认筛选现算，不往本机存东西');
    const mine = await Tasks.loadAll();
    eq(names(mine), ['我做完的', '我的', '没标记的'], '全部任务：她的不显示（哪怕她的子任务带着我的标签）');
    eq(mine.find((t) => t.summary.indexOf('我的') === 0).subtasks.map((s) => s.summary), ['我的子任务'], '主任务显示，子任务跟着显示');
    eq(names(await Tasks.loadAll({ unfiltered: true })), ['她的', '她的日记任务', '我做完的', '我的', '没标记的', '清单里她的'], '提醒用的读法：不筛');
    eq(names(await Tasks.loadByList(LIST_KEY)), ['清单里我的', '清单里没标记的'], '列表视图里选中某个清单');
    const g1 = await Tasks.loadChecklistGroups(LIST_KEY);
    eq([groupNames(g1), g1.done, g1.total], [[['', ['清单里我的', '清单子任务']], ['采购', ['清单里没标记的']]], 2, 3],
      '清单页：她的主任务连同下面的子任务一起去掉，总数和完成数跟着重算');
    eq(await progress(), [['项目', 2, 3]], '清单卡片上的进度和右侧对得上');

    // —— 只看她的 ——
    eq(setViewFilter({ users: ['🥕'], unassigned: false, tags: [] }), { users: ['🥕'], unassigned: false, tags: [] }, '改筛选');
    eq(app.store.get(VIEW_FILTER_KEY), { users: ['🥕'], unassigned: false, tags: [] }, '存在本机');
    eq(names(await Tasks.loadAll()), ['她的', '她的日记任务', '清单里她的'], '全部任务：只剩她的');
    eq([groupNames(await Tasks.loadChecklistGroups(LIST_KEY)), await progress()],
      [[['', []], ['采购', ['清单里她的', '她的清单子任务']]], [['项目', 0, 2]]], '清单页和进度');

    // —— 我的 + 没指定，再加一个标签 ——
    setViewFilter({ users: ['🌻'], unassigned: true, tags: ['家务'] });
    eq(names(await Tasks.loadAll()), ['我做完的'], '只剩带「家务」的');

    // —— 不限人、不限标签：和没有筛选一样 ——
    setViewFilter({ users: ['🌻', '🥕'], unassigned: true, tags: [] });
    eq([(await Tasks.loadAll()).length, await progress()], [6, [['项目', 2, 5]]], '全部显示');
    eq(body(await loadChecklists()).items.map((c) => [c.done, c.total]), [[2, 5]], '数据层不带筛选时进度照旧');
  } finally {
    initDeviceUser(null);
    initViewFilter(null);
  }
});

// ---------- 十三、琉璃配色（自用改版） ----------

test('琉璃配色：八种颜色、红黄蓝绿和四象限同色，小圆圈取本色，标签色跟着变淡', () => {
  const arr = COLOR_SCHEMES.liuli;
  eq(arr.length, 8, '八种颜色');
  eq(arr.every((c) => /^rgba\(\d+, \d+, \d+, \.16\)$/.test(c.bg) && /^#[0-9a-f]{6}$/.test(c.fg)), true, '每种都是很浅的底色 + 本色');
  const fgs = arr.map((c) => c.fg);
  eq(['#e0584f', '#e0a93b', '#4a90d2', '#4caf7d'].every((x) => fgs.includes(x)), true, '红黄蓝绿和四象限的颜色一样');
  try {
    setTagColors({});
    setColorScheme('liuli');
    const t = { summary: '写周报', tags: [] };
    const c = colorOf(t);
    eq(arr.includes(c), true, '没设标签色时，按标题从琉璃里取色');
    eq(itemColor(t), { background: c.bg, color: 'var(--ink)', '--tk-dot': c.fg }, '浅底色、正常深色文字、小圆圈用本色');
    setTagColors({ 论文: '#2aa198' });
    eq(colorOf({ summary: 'x', tags: ['论文'] }), { bg: 'rgba(42,161,152,0.16)', fg: '#2aa198' }, '设了标签色的任务，底色跟着琉璃淡到 .16');
    setColorScheme('morandi');
    eq(colorOf({ summary: 'x', tags: ['论文'] }).bg, 'rgba(42,161,152,0.28)', '其他方案的标签色仍是原来的 .28');
    const u = { summary: '买菜', tags: [] };
    eq(itemColor(u)['--tk-dot'], colorOf(u).fg, '其他方案的小圆圈同样取本色');
  } finally {
    setTagColors({});
    setColorScheme(DEFAULT_COLOR_SCHEME);
  }
});

test('琉璃是默认配色：每台设备第一次读设置时统一换成琉璃一次，之后照自己选的来', () => {
  eq(DEFAULT_COLOR_SCHEME, 'liuli', '默认配色是琉璃');
  // 还没换过的设备：不管原来是哪套，都换成琉璃，并要求存盘（把标记留下）
  eq(migrateColorScheme({ colorScheme: 'morandi' }), { colorScheme: 'liuli', liuliMigrated: true, changed: true }, '原来是莫兰迪的换成琉璃');
  eq(migrateColorScheme({ colorScheme: 'default' }), { colorScheme: 'liuli', liuliMigrated: true, changed: true }, '原来是经典的也换');
  eq(migrateColorScheme({}), { colorScheme: 'liuli', liuliMigrated: true, changed: true }, '第一次装插件（设置为空）');
  eq(migrateColorScheme(null), { colorScheme: 'liuli', liuliMigrated: true, changed: true }, '读不到设置时一样');
  // 换过以后：照设置里存的来，不再改
  eq(migrateColorScheme({ colorScheme: 'jelly', liuliMigrated: true }), { colorScheme: 'jelly', liuliMigrated: true, changed: false }, '换过以后自己选了果冻，就一直是果冻');
  eq(migrateColorScheme({ colorScheme: 'liuli', liuliMigrated: true }), { colorScheme: 'liuli', liuliMigrated: true, changed: false }, '换过以后仍是琉璃，不用再存');
  eq(migrateColorScheme({ liuliMigrated: true }), { colorScheme: 'liuli', liuliMigrated: true, changed: false }, '有标记但没存配色时用默认');
  // 认不出的配色值退回琉璃
  try {
    setColorScheme('不存在的配色');
    eq(COLOR_SCHEMES.liuli.includes(colorOf({ summary: '写周报', tags: [] })), true, '认不出的配色值退回琉璃');
  } finally {
    setColorScheme(DEFAULT_COLOR_SCHEME);
  }
});

// ---------- 逐个运行并汇总 ----------

async function main() {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log('  通过  ' + c.name);
    } catch (e) {
      failed += 1;
      console.log('  失败  ' + c.name + '\n      ' + (e && e.message || e));
    }
  }
  console.log(`\n共 ${cases.length} 项，通过 ${cases.length - failed} 项，失败 ${failed} 项`);
  process.exitCode = failed ? 1 : 0;
}
main();
