// 浏览器演示页的入口：在内存假库上打开「任务编辑窗口」，左侧实时显示假库里那篇笔记的原文，
// 这样在界面上每做一步操作，都能看到文件被写成了什么样。
//
// 启动方式见 tests/harness/vite.config.js 顶部的说明。只读源码、不碰任何真实笔记。
import '../../src/core/styles/tokens.css';
import '../../src/core/styles/task-modal.css';
import 'line-awesome/dist/line-awesome/css/line-awesome.min.css';
import { moment } from 'obsidian';
import { initI18n } from '../../src/core/i18n/index.js';
import { initTasksApi } from '../../src/core/api/tasks.js';
import { Tasks } from '../../src/core/composables/useTasks.js';
import { VueModal } from '../../src/core/ui/VueModal.js';
import TaskEditorModal from '../../src/core/components/TaskEditorModal.vue';
import { makeVault } from '../fake-vault.js';

/** 假库里唯一的一篇日记：一个主任务，带两个子任务，其中一个已有优先级、日期和描述 */
const NOTE = '日记/2026-05-27.md';
const vault = makeVault({
  [NOTE]: '---\ntags:\n  - journal\n---\n\n- [ ] 间接经费 #财务\n\t- [ ] 10000\n\t- [ ] 20000 🔼 📅 2026-05-30\n\t\t给**财务处**\n'
});
const app = vault.plugin.app;
// 编辑窗口会用到的两样 Obsidian 能力，演示页里给最简单的替身
app.vault.getConfig = () => 'zh';                                        // 界面语言：中文
app.workspace = { openLinkText: (...a) => console.log('[打开双链]', ...a) };
window.moment = moment;

/** 把假库里那篇笔记的当前原文显示到页面左侧（Tab 用 → 标出，便于看清缩进） */
function showFile() {
  document.getElementById('file').textContent = (vault.read(NOTE) || '').replace(/\t/g, '→   ');
}

/** 打开主任务的编辑窗口 */
async function openEditor() {
  const items = await Tasks.loadByDate('2026-05-27');
  new VueModal(app, TaskEditorModal, {
    open: true,
    task: items[0],
    plugin: vault.plugin,
    onSaved: showFile,
    onDeleted: showFile,
    onSubtasksChanged: showFile
  }).open();
}

await initI18n(app);
initTasksApi(vault.plugin);
document.getElementById('open').addEventListener('click', openEditor);
// 供调试：在浏览器控制台里可以直接读假库
window.__vault = vault;
showFile();
openEditor();
