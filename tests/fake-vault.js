// 内存里的假库：让数据层（src/core/api/tasks.js）以为自己在读写一个 Obsidian 库，
// 实际上所有「文件」都只是内存里的一张表，测试结束即消失，不碰磁盘上的任何笔记。
import { TFile } from './stubs/obsidian.js';

/**
 * 造一个假的插件对象（带假库）。
 *
 * @param {Object<string,string>} files  初始文件：{ '库内路径': '文件全文' }
 * @param {Object} [settings]            覆盖默认的插件设置
 * @returns {{ plugin: Object, read: (path: string) => (string|undefined), paths: () => string[] }}
 *   plugin：交给 initTasksApi() 的插件对象；
 *   read  ：读出某个假文件此刻的全文（不存在返回 undefined）；
 *   paths ：当前所有假文件的路径。
 */
export function makeVault(files = {}, settings = {}) {
  /** 路径 → 全文 */
  const store = new Map(Object.entries(files));
  /** 已「创建」的文件夹路径 */
  const folders = new Set();

  const vault = {
    // 按路径取文件 / 文件夹对象；不存在返回 null（与 Obsidian 行为一致）
    getAbstractFileByPath(path) {
      if (store.has(path)) return new TFile(path);
      if (folders.has(path)) return { path, children: [] };
      return null;
    },
    async cachedRead(file) { return store.get(file.path); },
    async modify(file, doc) { store.set(file.path, doc); },
    async create(path, doc) {
      if (store.has(path)) throw new Error('File already exists');
      store.set(path, doc);
      return new TFile(path);
    },
    async createFolder(path) { folders.add(path); },
    getMarkdownFiles() {
      return [...store.keys()].filter((p) => /\.md$/i.test(p)).map((p) => new TFile(p));
    }
  };

  // 元数据缓存替身：数据层用它读 frontmatter 里的 tags 来识别「清单文件」。
  // 这里只解析测试用得到的最简形式：
  //   ---
  //   tags:
  //     - todoList
  //   ---
  const metadataCache = {
    getFileCache(file) {
      const raw = store.get(file.path) || '';
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      if (!fm) return null;
      const tags = [];
      let inTags = false;
      for (const line of fm[1].split(/\r?\n/)) {
        if (/^tags:\s*$/.test(line)) { inTags = true; continue; }
        const item = /^\s+-\s+(.+?)\s*$/.exec(line);
        if (inTags && item) { tags.push(item[1]); continue; }
        inTags = false;
      }
      return { frontmatter: { tags } };
    }
  };

  const plugin = {
    app: {
      vault,
      metadataCache,
      // 核心「日记」插件与 Periodic Notes 都当作没装：数据层会退回用下面的 journalFolder 设置
      internalPlugins: {},
      plugins: { getPlugin() { return null; } }
    },
    settings: Object.assign({
      inboxFile: 'Inbox.md',
      journalFolder: '日记',
      journalLooseMatch: true,
      checklistTags: ['todoList'],
      dailyLoadWindow: 'all',
      addDoneDateMarker: true,
      showScheduled: false
    }, settings)
  };

  return {
    plugin,
    read: (path) => store.get(path),
    paths: () => [...store.keys()]
  };
}
