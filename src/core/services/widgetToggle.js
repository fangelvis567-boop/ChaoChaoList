// ============================================================================
// 处理 Mac 桌面小组件上点圆圈发来的勾选（自用改版）
// ----------------------------------------------------------------------------
// 读：~/Library/Application Support/ChaoChaoList/requests/ 里的请求文件
//     （小组件程序写的，一条点击一个文件，格式和检查规则见 composables/widgetToggle.js）；
//     库里的任务（Tasks.loadAll，不按面板的筛选，免得筛掉了就找不到）。
// 写：照请求把任务勾上 / 取消勾选——和在面板里点圆圈走同一条路（Tasks.toggleComplete），
//     改的只是任务所在的那一行笔记；处理完（或判定作废）的请求文件删掉。
//     只处理写给本库的请求（按库名）；写给别的库的留着，让那个库自己处理。
// 找不到对应的任务（笔记改过或删了）时不改任何东西，弹一句提示。
//
// 什么时候处理：插件启动时处理一遍攒下的；之后盯着这个文件夹，有新文件就等 0.3 秒处理；另外每分钟兜底看一次。
// 只在 Mac 桌面版启动。任务改完以后，小组件的数据由 widgetExport.js 照常重新导出、通知小组件刷新。
// ============================================================================
import { Notice } from 'obsidian';
import { Tasks } from '../composables/useTasks.js';
import { widgetTitle } from '../composables/widgetSnapshot.js';
import { parseToggleRequest, findTaskForRequest } from '../composables/widgetToggle.js';
import { WidgetExportService } from './widgetExport.js';
import { t } from '../i18n/index.js';

/** 文件夹里有动静后等多久再处理（毫秒）：小组件程序写文件时会连着触发好几次 */
const DEBOUNCE_MS = 300;
/** 兜底：每隔多久主动看一次（毫秒），以防系统漏发文件变化的通知 */
const SAFETY_MS = 60 * 1000;

/** 取 Node 的内置模块（Obsidian 桌面版才有）；拿不到时返回 null */
function nodeModule(name) {
  try {
    const req = (typeof window !== 'undefined' && window.require) || null;
    return req ? req(name) : null;
  } catch (e) {
    return null;
  }
}

export class WidgetToggleService {
  constructor(plugin) {
    this.plugin = plugin;
    this.started = false;
    this.watcher = null;   // 盯文件夹的 fs.watch
    this.timer = null;     // 防抖计时器
    this.interval = null;  // 兜底计时器
    this.running = false;  // 正在处理
    this.again = false;    // 处理过程中又有新文件：处理完再来一次
  }

  /** 请求文件夹的位置（和 HelperApp.swift 里写的位置一致） */
  dir() {
    const path = nodeModule('path');
    const os = nodeModule('os');
    return path.join(os.homedir(), 'Library', 'Application Support', 'ChaoChaoList', 'requests');
  }

  start() {
    if (this.started || !WidgetExportService.supported()) return;
    const fs = nodeModule('fs');
    if (!fs) return;
    this.started = true;
    const dir = this.dir();
    // 文件夹不存在就先建好，才能盯着它；建不了也不要紧，兜底计时器照样会来看
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 忽略 */ }
    try { this.watcher = fs.watch(dir, () => this.schedule()); } catch (e) { this.watcher = null; }
    this.interval = window.setInterval(() => this.schedule(), SAFETY_MS);
    this.schedule();
  }

  stop() {
    this.started = false;
    if (this.watcher) { try { this.watcher.close(); } catch (e) { /* 忽略 */ } this.watcher = null; }
    if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
    if (this.interval) { window.clearInterval(this.interval); this.interval = null; }
  }

  schedule() {
    if (!this.started) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.run(); }, DEBOUNCE_MS);
  }

  async run() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      await this.processAll();
    } catch (e) {
      console.error('[ChaoChaoList] 处理小组件上的勾选失败', e);
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  }

  /** 把文件夹里写给本库的请求逐条处理掉 */
  async processAll() {
    const fs = nodeModule('fs');
    const path = nodeModule('path');
    const dir = this.dir();
    let names;
    try { names = await fs.promises.readdir(dir); } catch (e) { return; }
    // 文件名以点击时间开头，排个序就是点击的先后
    names = names.filter((n) => n.endsWith('.json')).sort();
    if (!names.length) return;
    const vault = this.plugin.app.vault.getName();
    let tasks = null;     // 用到时才读；改过一条以后重新读，保证下一条看到的是最新状态
    let changed = false;
    for (const name of names) {
      const file = path.join(dir, name);
      let text;
      try { text = await fs.promises.readFile(file, 'utf8'); } catch (e) { continue; } // 可能刚被另一个库处理掉了
      const r = parseToggleRequest(text);
      if (!r.ok) { await this.remove(file); continue; } // 内容不对或放太久：作废
      if (r.req.vault !== vault) continue;              // 写给别的库的：留着
      if (!tasks) tasks = await Tasks.loadAll({ unfiltered: true });
      const task = findTaskForRequest(tasks, r.req, widgetTitle);
      if (!task) {
        new Notice(t('app.widgetToggleMissing', { title: r.req.text }));
      } else if (!!task.completed !== r.req.done) {
        try {
          await Tasks.toggleComplete(task.guid, r.req.done);
          changed = true;
          tasks = null;
        } catch (e) {
          new Notice(t('app.widgetToggleFail', { title: r.req.text }) + (e && e.message || e));
        }
      }
      await this.remove(file);
    }
    // 面板开着的话刷新一下，让勾选马上显示出来
    if (changed) this.plugin.reloadOpenViews();
  }

  async remove(file) {
    try { await nodeModule('fs').promises.unlink(file); } catch (e) { /* 已经不在了 */ }
  }
}
