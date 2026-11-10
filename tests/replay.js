// 只读回放：拿库里现有的任务文件，分别用「改版之前」和「改版之后」的读写逻辑各走一遍，
// 对比两边的结果，确认新代码不会把已有的任务写成别的样子。
//
// 运行方式（在仓库根目录）：
//   node tests/run.mjs replay --vault <库的绝对路径> --folder <日记文件夹> [--file <库内路径>]...
// 读写范围：只「读」命令行指定的那些 .md 文件；不写任何文件，结果只打印到屏幕。
//           打印差异时会把文字替换成 x（只保留符号、数字和缩进），不把笔记内容原样输出。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as NEW from '../src/core/composables/tasks-logic.js';
// 'baseline-tasks-logic' 由 tests/run.mjs 指向「改版之前」的 tasks-logic.js（从 git 里取出的旧版本）
import * as OLD from 'baseline-tasks-logic';

// ---------- 读命令行参数 ----------

/**
 * 解析命令行参数。
 * @returns {{ vault: string, folders: string[], files: string[] }}
 */
function parseArgs(argv) {
  const out = { vault: '', folders: [], files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault') out.vault = argv[++i];
    else if (argv[i] === '--folder') out.folders.push(argv[++i]);
    else if (argv[i] === '--file') out.files.push(argv[++i]);
  }
  return out;
}

/** 递归列出某目录下所有 .md 文件（跳过以 . 开头的隐藏目录），返回相对库根的路径。 */
function listMarkdown(vault, rel) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(join(vault, rel), { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const child = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listMarkdown(vault, child));
    else if (/\.md$/i.test(e.name)) out.push(child);
  }
  return out;
}

// ---------- 与插件一致的小工具 ----------

/** 把文件全文拆成 frontmatter 和正文（与 src/core/api/tasks.js 的 splitDoc 相同）。 */
function splitDoc(raw) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw || '');
  if (!m) return { head: '', body: raw || '' };
  return { head: m[0], body: raw.slice(m[0].length) };
}

/** 由文件路径推断插件给它的「键」：文件名里有日期 → 该日期（日记）；否则当作清单。 */
function keyOf(rel, inboxRel) {
  if (rel === inboxRel) return 'inbox';
  const m = /(\d{4})[-._](\d{2})[-._](\d{2})/.exec(rel.split('/').pop());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : 'cl:' + rel.replace(/\.md$/i, '');
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 把文字打码：字母和汉字一律换成 x，符号、数字、缩进保留（Tab 显示为 →）。 */
const mask = (s) => String(s).replace(/\t/g, '→').replace(/\p{L}/gu, 'x');

/** 节点的「形状」：除描述以外，解析出来的全部字段（用于比较新旧解析是否一致）。 */
function shape(n) {
  return [n.lineNo, n.indentStr, n.completed, n.cancelMark, n.summary, n.time, n.timeEnd, n.priority,
    n.due, n.start, n.scheduled, n.created, n.done, n.cancelled, n.recurrence, n.children.length];
}
/** 这块任务（含后代）里有没有描述行。 */
function blockHasDesc(n) {
  return (n.descTexts || []).length > 0 || (n.children || []).some(blockHasDesc);
}
/** 去掉若干字段后的任务记录（用于比较新旧记录）。 */
function recordWithout(rec, keys) {
  const o = Object.assign({}, rec);
  for (const k of keys) delete o[k];
  return o;
}

// ---------- 主流程 ----------

const args = parseArgs(process.argv.slice(2));
if (!args.vault) {
  console.error('用法: node tests/run.mjs replay --vault <库的绝对路径> --folder <日记文件夹> [--file <库内路径>]...');
  process.exit(2);
}
const inboxRel = args.files[0] || '';
const rels = [...new Set([...args.folders.flatMap((f) => listMarkdown(args.vault, f)), ...args.files])];

/** 各项计数 */
const stat = {
  files: 0, filesWithTasks: 0, blocks: 0, blocksWithDesc: 0,
  shapeDiff: 0,            // 新旧解析出的任务不一致（应为 0）
  noDescDiff: 0,           // 不带描述的任务块，新旧写出来不一样（应为 0）
  rootRecordDiff: 0,       // 顶层任务的记录除描述外有差异（应为 0）
  subRecordDiff: 0,        // 子任务的记录除描述、日期外有差异（应为 0）
  unstable: 0,             // 新代码写出来的内容再读一遍、再写一遍，结果变了（应为 0）
  newKeepsSource: 0,       // 新代码重写后与原文完全相同的任务块数
  oldKeepsSource: 0,       // 旧代码重写后与原文完全相同的任务块数
  newVsOld: 0,             // 新旧代码写出来不一样的任务块数（只应出现在带描述的块上）
  subDateChanged: 0,       // 日期判定发生变化的子任务数（预期内：子任务不再继承日记的日期）
  descTextChanged: 0       // 描述文本读出来与旧版不同的任务数（预期内：不再剥掉行首的 "- "）
};
/** 需要展示的例子（打码后） */
const samples = { bad: [], changed: [], normalized: [] };

for (const rel of rels) {
  let raw;
  try { raw = readFileSync(join(args.vault, rel), 'utf8'); } catch (e) { continue; }
  stat.files += 1;
  const { body } = splitDoc(raw);
  const pn = NEW.parseTasks(body);
  const po = OLD.parseTasks(body);
  const fn = NEW.flattenTasks(pn.roots);
  const fo = OLD.flattenTasks(po.roots);
  if (!fn.length && !fo.length) continue;
  stat.filesWithTasks += 1;
  const key = keyOf(rel, inboxRel);
  const rootSet = new Set(pn.roots);

  if (!same(fn.map(shape), fo.map(shape))) {
    stat.shapeDiff += 1;
    samples.bad.push(`[解析结果不一致] ${mask(rel)}`);
    continue;
  }

  fn.forEach((nn, i) => {
    const no = fo[i];
    stat.blocks += 1;
    const hasDesc = blockHasDesc(nn) || blockHasDesc(no);
    if (hasDesc) stat.blocksWithDesc += 1;

    const srcNew = NEW.collectLineNos(nn).map((k) => pn.lines[k]);
    const srcOld = OLD.collectLineNos(no).map((k) => po.lines[k]);
    const outNew = NEW.serializeBlock(nn, nn.indentStr);
    const outOld = OLD.serializeBlock(no, no.indentStr);

    if (same(outNew, srcNew)) stat.newKeepsSource += 1;
    else if (same(outNew, outOld) && samples.normalized.length < 8) {
      // 新旧版本写法相同、但都与原文不同：作者原有的「规范化」行为（如符号顺序、多余空格），记几个例子备查
      samples.normalized.push(`${mask(rel)} 第 ${nn.lineNo + 1} 行\n    原文: ${mask(srcNew.join(' ⏎ '))}\n    写回: ${mask(outNew.join(' ⏎ '))}`);
    }
    if (same(outOld, srcOld)) stat.oldKeepsSource += 1;
    if (!same(outNew, outOld)) {
      stat.newVsOld += 1;
      if (!hasDesc) {
        stat.noDescDiff += 1;
        samples.bad.push(`[无描述的任务块写法不同] ${mask(rel)} 第 ${nn.lineNo + 1} 行\n    旧: ${mask(outOld.join(' ⏎ '))}\n    新: ${mask(outNew.join(' ⏎ '))}`);
      } else if (samples.changed.length < 8) {
        samples.changed.push(`${mask(rel)} 第 ${nn.lineNo + 1} 行\n    原文: ${mask(srcNew.join(' ⏎ '))}\n    旧版写回: ${mask(outOld.join(' ⏎ '))}\n    新版写回: ${mask(outNew.join(' ⏎ '))}`);
      }
    }

    // 稳定性：新代码写出来的块，再读、再写，必须和第一次写的一样
    const again = NEW.parseTasks(outNew.join('\n'));
    const outAgain = again.roots.length === 1 ? NEW.serializeBlock(again.roots[0], again.roots[0].indentStr) : null;
    if (!same(outAgain, outNew)) {
      stat.unstable += 1;
      samples.bad.push(`[重写不稳定] ${mask(rel)} 第 ${nn.lineNo + 1} 行\n    第一次: ${mask(outNew.join(' ⏎ '))}\n    第二次: ${mask((outAgain || ['(解析出的顶层任务数不是 1)']).join(' ⏎ '))}`);
    }

    // 记录层面：界面拿到的任务信息
    const rn = NEW.toRecord(key, nn);
    const ro = OLD.toRecord(key, no);
    if (rn.description !== ro.description) stat.descTextChanged += 1;
    if (rootSet.has(nn)) {
      if (!same(recordWithout(rn, ['description']), recordWithout(ro, ['description']))) {
        stat.rootRecordDiff += 1;
        samples.bad.push(`[顶层任务记录不同] ${mask(rel)} 第 ${nn.lineNo + 1} 行`);
      }
    } else {
      const skip = ['description', 'dueAt', 'startAt', 'dueEndAt'];
      if (!same(recordWithout(rn, skip), recordWithout(ro, skip))) {
        stat.subRecordDiff += 1;
        samples.bad.push(`[子任务记录不同] ${mask(rel)} 第 ${nn.lineNo + 1} 行`);
      }
      if (rn.dueAt !== ro.dueAt || rn.startAt !== ro.startAt) stat.subDateChanged += 1;
    }
  });
}

console.log(`读取文件 ${stat.files} 个，其中含任务的 ${stat.filesWithTasks} 个；任务块共 ${stat.blocks} 个，带描述的 ${stat.blocksWithDesc} 个。`);
console.log('');
console.log('必须为 0 的五项：');
console.log(`  新旧解析出的任务不一致的文件      ${stat.shapeDiff}`);
console.log(`  无描述的任务块，新旧写法不同      ${stat.noDescDiff}`);
console.log(`  顶层任务记录（除描述外）不同      ${stat.rootRecordDiff}`);
console.log(`  子任务记录（除描述、日期外）不同  ${stat.subRecordDiff}`);
console.log(`  新代码重写结果不稳定              ${stat.unstable}`);
console.log('');
console.log('供参考：');
console.log(`  重写后与原文完全相同的任务块：新版 ${stat.newKeepsSource} / 旧版 ${stat.oldKeepsSource}（共 ${stat.blocks}）`);
console.log(`  新旧写法不同的任务块（都带描述）  ${stat.newVsOld}`);
console.log(`  描述文本读出来与旧版不同的任务    ${stat.descTextChanged}`);
console.log(`  日期判定变化的子任务（不再继承日记日期） ${stat.subDateChanged}`);

if (samples.normalized.length) {
  console.log('\n新旧版本都会改写的例子（作者原有的规范化行为，文字已打码）：');
  for (const s of samples.normalized) console.log('  - ' + s);
}
if (samples.changed.length) {
  console.log('\n新旧写法不同的例子（文字已打码）：');
  for (const s of samples.changed) console.log('  - ' + s);
}
if (samples.bad.length) {
  console.log('\n需要处理的问题（文字已打码）：');
  for (const s of samples.bad.slice(0, 20)) console.log('  - ' + s);
}
const failed = stat.shapeDiff + stat.noDescDiff + stat.rootRecordDiff + stat.subRecordDiff + stat.unstable;
console.log(failed ? '\n结论：有不符合预期的差异，见上。' : '\n结论：通过。');
process.exitCode = failed ? 1 : 0;
