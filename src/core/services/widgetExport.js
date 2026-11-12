// ============================================================================
// Mac 桌面小组件的数据导出（自用改版）
// ----------------------------------------------------------------------------
// 做什么：任务有变化时，把小组件要显示的内容（目前是四象限，算法见 composables/widgetSnapshot.js）
//   写到本机文件，再请 Mac 上的「ChaoChaoList 小组件」程序通知系统刷新小组件。
//
// 读：库里的任务（Tasks.loadAll，和面板同一套读法）；本机的界面偏好（「隐藏已完成」、子任务折叠）。
// 写：只写一个文件 ~/Library/Application Support/ChaoChaoList/widget-data.json
//     （先写同目录的 .tmp 临时文件再改名替换，小组件不会读到写了一半的内容）。
//     这个文件在库外面：不会被同步到别的设备，也不会出现在笔记列表里。
// 通知：/Applications/ChaoChaoListWidgets.app 存在时，执行 `open -g chaochaolist-widget://reload`
//     （-g：不把它切到前台；它没有窗口，也不占 Dock）。没装这个程序就跳过，不报错。
//
// 什么时候算一次：插件启动后；库里文件有改动、新建、删除、改名后（等 1.5 秒，连续改动只算一次）；
//   在面板里切换「隐藏已完成」或折叠 / 展开子任务后；另外每 10 分钟兜底一次。
//   算出来的内容和上次一样时不写文件、也不通知，省得小组件白白刷新（系统对刷新次数有限制）。
//
// 只在 Mac 桌面版启动：手机、平板、Windows、Linux 上什么也不做。设置里可以关掉（widgetExport）。
// ============================================================================
import { Platform } from 'obsidian';
import { Tasks } from '../composables/useTasks.js';
import { getTaskViewPref, PREFS_EVENT } from '../composables/viewPrefs.js';
import { isSubFolded } from '../composables/subtasks.js';
import { buildWidgetData } from '../composables/widgetSnapshot.js';
import { t } from '../i18n/index.js';

/** 改动后等多久再算（毫秒）：连续改动只算一次 */
const DEBOUNCE_MS = 1500;
/** 兜底：每隔多久重算一次（毫秒）。内容没变时不写文件 */
const SAFETY_MS = 10 * 60 * 1000;
/** 小组件程序的安装位置（与 mac-widget/scripts/install.sh 一致） */
const HELPER_APP = '/Applications/ChaoChaoListWidgets.app';
/** 请小组件程序刷新的网址（小组件程序在自己的 Info.plist 里登记了 chaochaolist-widget 这个网址类型） */
const RELOAD_URL = 'chaochaolist-widget://reload';

/** 取 Node 的内置模块（Obsidian 桌面版才有）；拿不到时返回 null */
function nodeModule(name) {
  try {
    const req = (typeof window !== 'undefined' && window.require) || null;
    return req ? req(name) : null;
  } catch (e) {
    return null;
  }
}

export class WidgetExportService {
  constructor(plugin) {
    this.plugin = plugin;
    this.started = false;
    this.timer = null;        // 防抖计时器
    this.interval = null;     // 兜底计时器
    this.refs = [];           // 已注册的库事件，停止时逐个注销
    this.running = false;     // 正在算 / 写
    this.again = false;       // 算的过程中又有改动：算完再来一次
    this.lastBody = '';       // 上次写出的内容（不含生成时间），用来判断有没有变化
    this.helperFailed = false; // 通知小组件程序失败过：本次运行不再尝试
    this.onPrefs = () => this.schedule();
  }

  /** 当前环境能不能用：Mac 桌面版、能取到 Node 的文件模块 */
  static supported() {
    return !!(Platform.isMacOS && Platform.isDesktopApp && nodeModule('fs'));
  }

  /** 数据文件所在文件夹与文件路径 */
  paths() {
    const path = nodeModule('path');
    const os = nodeModule('os');
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'ChaoChaoList');
    return { dir, file: path.join(dir, 'widget-data.json') };
  }

  /** 开始监听（设置关掉或环境不支持时什么也不做；重复调用无副作用） */
  start() {
    if (this.started || !WidgetExportService.supported()) return;
    if (this.plugin.settings.widgetExport === false) return;
    this.started = true;
    const { vault, metadataCache, workspace } = this.plugin.app;
    const kick = () => this.schedule();
    this.refs = [
      [vault, vault.on('modify', kick)],
      [vault, vault.on('create', kick)],
      [vault, vault.on('delete', kick)],
      [vault, vault.on('rename', kick)],
      [metadataCache, metadataCache.on('changed', kick)]
    ];
    window.addEventListener(PREFS_EVENT, this.onPrefs);
    this.interval = window.setInterval(kick, SAFETY_MS);
    // 库加载完再算第一次（启动时库里的文件还没索引完，太早算会少任务）
    workspace.onLayoutReady(kick);
  }

  /** 停止监听（插件卸载、设置里关掉时调用）。已写出的文件保留不删 */
  stop() {
    if (!this.started) return;
    this.started = false;
    for (const [src, ref] of this.refs) {
      try { src.offref(ref); } catch (e) { /* 忽略 */ }
    }
    this.refs = [];
    window.removeEventListener(PREFS_EVENT, this.onPrefs);
    if (this.interval) { window.clearInterval(this.interval); this.interval = null; }
    if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
  }

  /** 安排一次计算（防抖） */
  schedule() {
    if (!this.started) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.run(); }, DEBOUNCE_MS);
  }

  /** 算一次；正在算时只记下「算完再来一次」，不并发 */
  async run() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      await this.exportNow();
    } catch (e) {
      console.warn('[ChaoChaoList] 小组件数据导出失败：', e);
    } finally {
      this.running = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  }

  /**
   * 立即算一次并在内容有变化时写文件、通知小组件程序。
   * @returns {Promise<boolean>} 这次是否写了文件
   */
  async exportNow() {
    const fs = nodeModule('fs');
    if (!fs) return false;
    const tasks = (await Tasks.loadAll()) || [];
    const data = buildWidgetData(tasks, {
      vault: this.plugin.app.vault.getName(),
      hideDone: getTaskViewPref().hideDone,
      isFolded: isSubFolded,
      t
    });
    const body = JSON.stringify(data);
    if (body === this.lastBody) return false;
    const { dir, file } = this.paths();
    const text = JSON.stringify(Object.assign({ generatedAt: Date.now() }, data), null, 1);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, text, 'utf8');
    await fs.promises.rename(tmp, file);
    this.lastBody = body;
    this.notifyHelper();
    return true;
  }

  /** 请小组件程序刷新（没装就跳过；失败过一次后本次运行不再尝试） */
  notifyHelper() {
    if (this.helperFailed) return;
    const fs = nodeModule('fs');
    const cp = nodeModule('child_process');
    if (!fs || !cp || !fs.existsSync(HELPER_APP)) return;
    cp.execFile('/usr/bin/open', ['-g', RELOAD_URL], (err) => {
      if (err) {
        this.helperFailed = true;
        console.warn('[ChaoChaoList] 通知小组件程序刷新失败：', err && err.message);
      }
    });
  }
}
