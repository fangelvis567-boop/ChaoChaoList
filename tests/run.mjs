#!/usr/bin/env node
/**
 * 测试入口。
 *
 * 用法（都在仓库根目录执行）：
 *   node tests/run.mjs
 *       跑数据层自动测试（tests/data-layer.test.js）：在内存里的假库上读写任务，逐字核对结果。
 *   node tests/run.mjs replay --vault <库的绝对路径> --folder <日记文件夹> [--file <库内路径>]...
 *       只读回放（tests/replay.js）：用库里现有的任务文件对比「改版前」「改版后」的读写结果。
 *       第一个 --file 视为收件箱文件。
 *
 * 为什么要先「打包」再运行：
 *   插件源码依赖 Obsidian 应用内部才有的 'obsidian' 模块，还直接 import 了 .json 文件，
 *   命令行里的 Node 不能直接加载。这里用 esbuild（项目构建工具 vite 自带）把测试和被测源码
 *   打成一个文件，并把 'obsidian' 换成 tests/stubs/obsidian.js 这个替身，再交给 Node 运行。
 *
 * 读写范围：
 *   读：仓库里的源码；回放时另外只读命令行指定的那些笔记文件。
 *   写：只写 node_modules/.cache/dada-tests/ 下的临时文件（打包结果、从 git 取出的旧版源码）。
 *       不改库里的任何文件，也不改仓库里受版本管理的文件。
 *
 * 环境变量：
 *   DADA_BASELINE  回放时用哪个 git 版本当「改版前」，默认 upstream/main（作者的原版）。
 */
import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 临时文件目录（在 node_modules 里，本来就不受版本管理） */
const cache = resolve(root, 'node_modules/.cache/dada-tests');
mkdirSync(cache, { recursive: true });

/**
 * 把一个入口文件连同它依赖的源码打成单个可由 Node 直接运行的文件。
 * @param {string} entry       入口文件（相对仓库根）
 * @param {string} outName     输出文件名（放在临时目录里）
 * @param {Object} extraAlias  额外的「模块名 → 文件」替换表
 * @returns {Promise<string>}  输出文件的绝对路径
 */
async function bundle(entry, outName, extraAlias = {}) {
  const outfile = resolve(cache, outName);
  await build({
    entryPoints: [resolve(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'error',
    alias: Object.assign({ obsidian: resolve(root, 'tests/stubs/obsidian.js') }, extraAlias)
  });
  return outfile;
}

/** 用当前的 Node 运行打包好的文件，输出直接显示在屏幕上；返回退出码。 */
function run(file, args = []) {
  const r = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  return r.status == null ? 1 : r.status;
}

const mode = process.argv[2] === 'replay' ? 'replay' : 'unit';

if (mode === 'unit') {
  console.log('数据层自动测试（内存假库，不碰真实笔记）\n');
  process.exit(run(await bundle('tests/data-layer.test.js', 'unit.cjs')));
} else {
  // 取出「改版前」的 tasks-logic.js 作为对照
  const ref = process.env.DADA_BASELINE || 'upstream/main';
  let baseline;
  try {
    baseline = execFileSync('git', ['show', `${ref}:src/core/composables/tasks-logic.js`], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    console.error(`取不到对照版本 ${ref} 的源码：${e.message}`);
    process.exit(2);
  }
  // 旧文件被放到了临时目录，原来的相对路径 '../i18n/index.js' 对不上了，改成绝对路径
  baseline = baseline.replace(/'\.\.\/i18n\/index\.js'/g, JSON.stringify(resolve(root, 'src/core/i18n/index.js')));
  const baselineFile = resolve(cache, 'baseline-tasks-logic.js');
  writeFileSync(baselineFile, baseline);

  console.log(`只读回放（对照版本：${ref}）\n`);
  const file = await bundle('tests/replay.js', 'replay.cjs', { 'baseline-tasks-logic': baselineFile });
  process.exit(run(file, process.argv.slice(3)));
}
