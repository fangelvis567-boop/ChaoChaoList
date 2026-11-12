// 数据层自动测试：在内存里的假库上，把「读任务 / 改任务 / 写回文件」跑一遍，
// 逐字核对写出来的文件内容是否符合预期。
//
// 运行方式：在仓库根目录执行 `node tests/run.mjs`（由它负责打包并运行本文件）。
// 读写范围：只读仓库源码；所有「文件」都在内存里（tests/fake-vault.js），不碰任何真实笔记。
import {
  initTasksApi, loadAll, loadByDate, listSubtasks, loadChecklistGroups, loadChecklists,
  createTask, createChecklistTask, moveChecklistTask, updateTask, toggleTask
} from '../src/core/api/tasks.js';
import {
  parseTasks, serializeBlock, collectLineNos, splitDescription, descPreview
} from '../src/core/composables/tasks-logic.js';
import { buildCalendarTasks, subProgress, visibleSubtasks } from '../src/core/composables/subtasks.js';
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

test('在清单分组里新建任务时填的描述不再丢失', async () => {
  const v = vaultWith({ [LIST]: HEAD_LIST + '### 组A\n- [ ] 甲\n' });
  body(await createChecklistTask(LIST_KEY, '组A', { summary: '新任务', description: '说明一\n说明二' }));
  ok(v.read(LIST).endsWith('- [ ] 新任务\n\t说明一\n\t说明二'), '文件结尾不符: ' + JSON.stringify(v.read(LIST)));
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
