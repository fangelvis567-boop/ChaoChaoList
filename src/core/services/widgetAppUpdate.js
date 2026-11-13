// ============================================================================
// 自动更新 Mac 小组件程序（自用改版）
// ----------------------------------------------------------------------------
// 为什么：插件靠 BRAT 在每台设备上自动更新，小组件程序（/Applications/ChaoChaoListWidgets.app）不会。
//   所以由插件顺手把它也换成配套的新版：BRAT 更新完插件，下次启动 Obsidian 时小组件程序就跟着更新。
//
// 什么时候做：插件启动后等 15 秒检查一次（不拖慢 Obsidian 启动）。只在 Mac 桌面版、设置里「自动更新小组件程序」
//   开着（默认开）、并且这台 Mac 已经装了小组件程序时才做——没装过的 Mac 什么也不做，不会多装一个程序。
//
// 怎么判断：发布时 scripts/release.sh 把这版配套的小组件程序版本号、构建号和安装包的 sha256 校验值写进了插件
//   （__CCL_WIDGET_APP__，见 vite.config.js）。装着的构建号比它小才更新；一样或更大都不动，绝不往旧了换。
//   平时自己构建的插件里没有这项信息，什么也不做。
//
// 读：/Applications/ChaoChaoListWidgets.app/Contents/Info.plist（用系统的 plutil 读版本号）；
//     从 GitHub 发布页下载这版插件同一个发布版本里的 ChaoChaoListWidgets.zip（不需要登录）。
// 写：~/Library/Application Support/ChaoChaoList/app-update/ 里的临时文件（下载的安装包、解压出来的程序，用完删掉；
//     一个 lock 文件，防止同一台 Mac 上开着的两个库同时更新）；
//     把旧版程序移到 app-update/old/（只留最近一份旧版），新版放进 /Applications；
//     再用系统的 lsregister、pluginkit 登记，用 open -g 在后台启动一次（和 mac-widget/scripts/install.sh 的做法一样）。
// 下载的安装包校验值对不上，就不装。新版放不进去时，把旧版放回原处。
// ============================================================================
import { Notice, requestUrl } from 'obsidian';
import { WidgetExportService } from './widgetExport.js';
import { needsWidgetUpdate, widgetZipUrl } from '../composables/widgetAppVersion.js';
import { t } from '../i18n/index.js';

/** 发布时写进来的「这版配套的小组件程序」：{ version, build, sha256 }；平时自己构建的是 null */
// eslint-disable-next-line no-undef
const WIDGET_APP = typeof __CCL_WIDGET_APP__ !== 'undefined' ? __CCL_WIDGET_APP__ : null;

const APP_PATH = '/Applications/ChaoChaoListWidgets.app';   // 和 install.sh、widgetExport.js 一致
const APP_NAME = 'ChaoChaoListWidgets';                      // 宿主程序的进程名
const EXT_NAME = 'ChaoChaoListWidgetsExtension';             // 小组件扩展的进程名
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
/** 启动后等多久再检查（毫秒） */
const START_DELAY_MS = 15 * 1000;
/** lock 文件放了多久算过期（毫秒）：上次更新到一半 Obsidian 被关掉时，不至于永远卡住 */
const LOCK_STALE_MS = 15 * 60 * 1000;

/** 取 Node 的内置模块（Obsidian 桌面版才有）；拿不到时返回 null */
function nodeModule(name) {
  try {
    const req = (typeof window !== 'undefined' && window.require) || null;
    return req ? req(name) : null;
  } catch (e) {
    return null;
  }
}

/** 运行一个系统命令（不经过 shell，参数原样传），返回它的输出；失败时抛错 */
function run(cmd, args) {
  const cp = nodeModule('child_process');
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, { timeout: 120 * 1000 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout || ''));
    });
  });
}

export class WidgetAppUpdateService {
  constructor(plugin) {
    this.plugin = plugin;
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (!WidgetExportService.supported()) return;
    this.timer = window.setTimeout(() => { this.timer = null; this.check(); }, START_DELAY_MS);
  }

  stop() {
    if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
  }

  /** 临时文件夹：~/Library/Application Support/ChaoChaoList/app-update/ */
  workDir() {
    const path = nodeModule('path');
    const os = nodeModule('os');
    return path.join(os.homedir(), 'Library', 'Application Support', 'ChaoChaoList', 'app-update');
  }

  /** 读某个程序包的版本号和构建号；读不出返回 null */
  async bundleInfo(appPath) {
    const plist = nodeModule('path').join(appPath, 'Contents', 'Info.plist');
    try {
      const version = (await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])).trim();
      const build = (await run('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist])).trim();
      return version && build ? { version, build } : null;
    } catch (e) {
      return null;
    }
  }

  /** 下载安装包，返回文件内容（Buffer）。单独成一个方法，测试时可以换成读本机文件 */
  async downloadZip(url) {
    const r = await requestUrl({ url, method: 'GET', throw: false });
    if (r.status !== 200) throw new Error('下载安装包失败（HTTP ' + r.status + '）');
    return Buffer.from(r.arrayBuffer);
  }

  /**
   * 检查一次，需要就更新。want 默认是发布时写进插件的那份信息（测试时可以传别的）。
   * 返回 { status, ... }：off / no-info / not-installed / unknown-installed / up-to-date / busy / updated / failed
   */
  async check(want = WIDGET_APP) {
    if (this.busy) return { status: 'busy' };
    if (this.plugin.settings && this.plugin.settings.widgetAutoUpdate === false) return { status: 'off' };
    if (!want || !want.sha256 || !want.build) return { status: 'no-info' };
    const fs = nodeModule('fs');
    if (!fs || !fs.existsSync(APP_PATH)) return { status: 'not-installed' };
    const installed = await this.bundleInfo(APP_PATH);
    if (!installed) return { status: 'unknown-installed' };
    if (!needsWidgetUpdate(installed, want)) return { status: 'up-to-date', installed };
    this.busy = true;
    try {
      return await this.updateTo(want, installed);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.error('[ChaoChaoList] 自动更新小组件程序失败', e);
      new Notice(t('app.widgetAppUpdateFail') + msg);
      return { status: 'failed', error: msg };
    } finally {
      this.busy = false;
    }
  }

  /** 下载、核对、替换、登记 */
  async updateTo(want, installed) {
    const fs = nodeModule('fs');
    const path = nodeModule('path');
    const crypto = nodeModule('crypto');
    const work = this.workDir();
    await fs.promises.mkdir(work, { recursive: true });

    // 同一台 Mac 上开着两个库时，两边的插件都会来检查：用 lock 文件保证只有一边在更新
    const lock = path.join(work, 'lock');
    try {
      const st = fs.statSync(lock);
      if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return { status: 'busy' };
      fs.unlinkSync(lock); // 过期的 lock：上次更新到一半被打断了
    } catch (e) { /* 没有 lock，正常 */ }
    try { fs.writeFileSync(lock, String(Date.now()), { flag: 'wx' }); } catch (e) { return { status: 'busy' }; }

    const zip = path.join(work, 'ChaoChaoListWidgets.zip');
    const unzipped = path.join(work, 'unzipped');
    try {
      // 1. 下载并核对校验值
      const buf = await this.downloadZip(widgetZipUrl(this.plugin.manifest.version));
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha !== want.sha256) throw new Error(t('app.widgetAppBadHash'));
      await fs.promises.writeFile(zip, buf);

      // 2. 解压（ditto 能保留程序包的结构和签名），核对里面确实是要装的那一版
      await fs.promises.rm(unzipped, { recursive: true, force: true });
      await run('ditto', ['-x', '-k', zip, unzipped]);
      const fresh = path.join(unzipped, APP_NAME + '.app');
      const got = await this.bundleInfo(fresh);
      if (!got || got.build !== String(want.build)) throw new Error('安装包里的程序版本不对');

      // 3. 结束正在运行的旧版（宿主程序和小组件扩展；没在运行就跳过）
      await run('pkill', ['-x', APP_NAME]).catch(() => {});
      await run('pkill', ['-x', EXT_NAME]).catch(() => {});

      // 4. 旧版移到 app-update/old/（只留最近一份），新版放进 /Applications；放不进去就把旧版放回去
      const oldDir = path.join(work, 'old');
      await fs.promises.rm(oldDir, { recursive: true, force: true });
      await fs.promises.mkdir(oldDir, { recursive: true });
      const oldApp = path.join(oldDir, APP_NAME + '.app');
      await fs.promises.rename(APP_PATH, oldApp);
      try {
        await run('ditto', [fresh, APP_PATH]);
      } catch (e) {
        await fs.promises.rm(APP_PATH, { recursive: true, force: true }).catch(() => {});
        await fs.promises.rename(oldApp, APP_PATH);
        throw e;
      }

      // 5. 向系统登记（网址类型、小组件），在后台启动一次，它会请系统刷新小组件
      await run('xattr', ['-dr', 'com.apple.quarantine', APP_PATH]).catch(() => {});
      await run(LSREGISTER, ['-f', APP_PATH]).catch(() => {});
      await run('pluginkit', ['-a', path.join(APP_PATH, 'Contents', 'PlugIns', EXT_NAME + '.appex')]).catch(() => {});
      await run('open', ['-g', APP_PATH]).catch(() => {});

      new Notice(t('app.widgetAppUpdated', { from: installed.version, to: want.version }));
      return { status: 'updated', from: installed, to: { version: want.version, build: String(want.build) } };
    } finally {
      await fs.promises.rm(zip, { force: true }).catch(() => {});
      await fs.promises.rm(unzipped, { recursive: true, force: true }).catch(() => {});
      try { fs.unlinkSync(lock); } catch (e) { /* 忽略 */ }
    }
  }
}
