// 测试用的 obsidian 模块替身。
//
// 插件源码里写的是 `import { moment, TFile } from 'obsidian'`，而真正的 obsidian 模块
// 只存在于 Obsidian 应用内部，在命令行里（Node）拿不到。跑测试时由 tests/run.mjs 把
// 'obsidian' 这个名字指到本文件，只提供数据层用得到的两样东西：
//   - moment：日期库，直接用 node_modules 里的同名真库（Obsidian 内置的就是它）
//   - TFile ：Obsidian 里表示「一个文件」的类，这里只需要一个空壳，供 `instanceof TFile` 判断
import moment from 'moment';

export { moment };

/** Obsidian 文件对象的替身：只带数据层会读的两个字段。 */
export class TFile {
  constructor(path) {
    /** 库内相对路径，例如 '日记/2026-05-27.md' */
    this.path = path || '';
    /** 文件名（含扩展名），例如 '2026-05-27.md' */
    this.name = String(path || '').split('/').pop();
  }
}
