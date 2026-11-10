// 内嵌 Obsidian 编辑器（自用改版）
// ----------------------------------------------------------------------------
// 任务描述框里放的就是 Obsidian 写笔记时用的那个编辑器：实时预览、[[ 补全、
// 加粗 / 斜体等编辑快捷键、粘贴或拖入图片和文件，都和在笔记里一样。
// 粘贴图片时，S3 Image Uploader 这类监听「编辑器粘贴」事件的插件也会照常接管。
//
// 注意：Obsidian 没有公开「把编辑器嵌到别处」的接口。这里沿用 Kanban 插件（卡片编辑器）
// 的做法，借用 Obsidian 内部的编辑器类。以后 Obsidian 升级若改了内部结构，
// createEmbeddedEditor 会抛出错误，调用方（MarkdownField.vue）据此退回普通文本框，
// 描述照样能写、能保存。
//
// 在弹窗里用编辑器，要额外处理三件事（都在 createEmbeddedEditor 里）：
//   1. 「当前编辑器」：Obsidian 的编辑命令（加粗等）和其他插件（如 S3 上传）都作用于
//      workspace.activeEditor。编辑器获得焦点时把它指向我们，失去焦点时还原。
//   2. 快捷键：弹窗打开时，Obsidian 默认屏蔽所有全局快捷键。这里只放行「编辑器命令」
//      （加粗、斜体、插入链接、切换复选框……），关闭标签页、删除文件之类的全局命令照旧不响应。
//      另外放行「增强编辑」插件里经逐个核对的格式命令（名单见 enhancedEditingCommands.js）：
//      它们只认「当前打开的笔记」，执行的那一下临时把它换成描述框，执行完立刻换回。
//   3. Esc：编辑时按 Esc 先退出编辑（光标离开描述框），再按一次才关闭弹窗，
//      免得一下按掉、丢了刚写的描述。
import { Component, MarkdownView, Platform, Scope, TFile } from 'obsidian';
import { placeholder as cmPlaceholder } from '@codemirror/view';
import { ENHANCED_EDITING_COMMANDS } from './enhancedEditingCommands.js';

/** 借来的编辑器类（第一次用时取得，之后复用） */
let EditorClass = null;
/** 构造编辑器期间要用的占位提示（见 buildLocalExtensions 的说明） */
let pendingPlaceholder = '';

/**
 * 在弹窗里也照样不响应的编辑器命令：它们要么作用于整篇笔记（保存文件、改标题并更新全库链接），
 * 要么切换的是笔记窗口本身的状态，放在任务描述里用没有意义，甚至会误伤所在的笔记。
 */
const BLOCKED_COMMANDS = new Set([
  'editor:save-file',
  'editor:rename-heading',
  'editor:toggle-source',
  'editor:open-search',
  'editor:open-search-replace',
  'editor:focus-top',
  'editor:focus-bottom',
  'editor:focus-left',
  'editor:focus-right'
]);

/**
 * 取得 Obsidian 内部的编辑器类（只取一次）。
 * 取法与 Kanban 插件相同：临时建一个「嵌入笔记」的编辑视图（挂在不显示的 div 上），
 * 从它的编辑模式对象顺着原型链往上找两层，就是可滚动的 Markdown 编辑器类；找到后随即卸掉临时视图。
 * @param {App} app
 * @returns {Function} 继承自该编辑器类的 DadaEmbeddedEditor
 */
function resolveEditorClass(app) {
  if (EditorClass) return EditorClass;
  const registry = app && app.embedRegistry;
  const factory = registry && registry.embedByExtension && registry.embedByExtension.md;
  if (typeof factory !== 'function') throw new Error('embedRegistry.embedByExtension.md 不可用');
  const widget = factory({ app, containerEl: document.createElement('div'), state: {} }, null, '');
  let Base = null;
  try {
    widget.load();
    widget.editable = true;
    widget.showEditor();
    const inst = widget.editMode;
    if (!inst) throw new Error('取不到编辑模式对象');
    Base = Object.getPrototypeOf(Object.getPrototypeOf(inst)).constructor;
  } finally {
    widget.unload();
  }
  const proto = Base && Base.prototype;
  if (!proto || typeof proto.set !== 'function' || typeof proto.buildLocalExtensions !== 'function'
      || typeof proto.destroy !== 'function') {
    throw new Error('编辑器类的结构与预期不符');
  }

  EditorClass = class DadaEmbeddedEditor extends Base {
    // 编辑器的本地扩展：在 Obsidian 原有的基础上加一个「内容为空时的占位提示」。
    // Obsidian 会缓存这份扩展列表，第一次取用可能发生在构造过程中（那时还没法给实例赋值），
    // 所以占位文字先放在模块变量 pendingPlaceholder 里，构造完再记到实例上。
    buildLocalExtensions() {
      const ext = super.buildLocalExtensions();
      const ph = this.dadaPlaceholder != null ? this.dadaPlaceholder : pendingPlaceholder;
      if (ph) ext.push(cmPlaceholder(ph));
      return ext;
    }
    // 内容变化：先让 Obsidian 做它的事（通知其他插件「编辑器内容变了」），再把新内容交给调用方
    onUpdate(update, changed) {
      super.onUpdate(update, changed);
      if (update && update.docChanged && typeof this.dadaOnChange === 'function') {
        this.dadaOnChange(this.editor.getValue());
      }
    }
  };
  return EditorClass;
}

/**
 * 给编辑器用的 app 替身：读配置时把「行号」「折叠」关掉（描述框很小，用不上这些侧边栏），
 * 其余一切照原样转发给真正的 app。做法同 Kanban 插件。
 */
function editorApp(app) {
  const HIDE = ['showLineNumber', 'foldHeading', 'foldIndent'];
  return new Proxy(app, {
    get(target, prop, receiver) {
      if (prop !== 'vault') return Reflect.get(target, prop, receiver);
      return new Proxy(target.vault, {
        get(vault, key, r) {
          if (key !== 'config') return Reflect.get(vault, key, r);
          return new Proxy(vault.config, {
            get(cfg, name, rr) { return HIDE.includes(name) ? false : Reflect.get(cfg, name, rr); }
          });
        }
      });
    }
  });
}

/** 该命令能不能在描述框里用：必须是编辑器命令，且不在 BLOCKED_COMMANDS 里 */
function isEditorCommand(cmd) {
  if (!cmd || BLOCKED_COMMANDS.has(cmd.id)) return false;
  return typeof cmd.editorCallback === 'function' || typeof cmd.editorCheckCallback === 'function';
}

/**
 * 当前环境能否内嵌编辑器（只做轻量检查，真正能不能用以 createEmbeddedEditor 是否成功为准）。
 * @param {App|null} app
 */
export function canEmbedEditor(app) {
  const r = app && app.embedRegistry;
  return !!(r && r.embedByExtension && typeof r.embedByExtension.md === 'function');
}

/**
 * 在 host 元素里放一个 Obsidian 编辑器。
 * @param {App} app
 * @param {HTMLElement} host  放编辑器的容器
 * @param {Object} opts
 * @param {string}   [opts.value]        初始内容（Markdown 原文）
 * @param {string}   [opts.placeholder]  内容为空时的提示文字
 * @param {TFile}    [opts.file]         任务所在的笔记：解析 [[链接]] / 图片、保存附件、
 *                                       以及 S3 上传插件读取笔记设置时，都以它为准
 * @param {Scope}    [opts.parentScope]  所在弹窗的按键范围（Esc 关闭弹窗靠它）
 * @param {Function} [opts.onChange]     内容变化时调用，参数为新内容
 * @returns {{ getValue: () => string, setValue: (v: string) => void, focus: () => void, destroy: () => void }}
 */
export function createEmbeddedEditor(app, host, opts = {}) {
  const Cls = resolveEditorClass(app);
  const ws = app.workspace;
  const file = opts.file instanceof TFile ? opts.file : null;

  // 「编辑器的主人」：Obsidian 和其他插件通过它知道这个编辑器属于哪篇笔记、编辑器对象是哪个。
  // 字段参照 Kanban 插件；save / requestSave 留空，描述只随任务一起保存，不单独写笔记文件。
  let ed = null;
  const owner = {
    app,
    file,
    get path() { return file ? file.path : ''; },
    get editor() { return ed ? ed.editor : null; },
    editMode: null,
    hoverPopover: null,
    scroll: 0,
    getMode: () => 'source',
    onMarkdownScroll: () => {},
    showSearch: () => {},
    toggleMode: () => {},
    save: async () => {},
    requestSave: () => {}
  };

  pendingPlaceholder = opts.placeholder || '';
  try {
    ed = new Cls(editorApp(app), host, owner);
  } finally {
    pendingPlaceholder = '';
  }
  ed.dadaPlaceholder = opts.placeholder || '';
  ed.dadaOnChange = opts.onChange;
  owner.editMode = ed;

  // 编辑器本身是 Obsidian 的「组件」，要挂在一个已加载的组件下面才会启用它的事件监听
  const root = new Component();
  root.load();
  root.addChild(ed);
  ed.set(opts.value || '', true);

  /* ---------- 按键范围：编辑器获得焦点时压到最上层，失去焦点时撤下 ---------- */
  const scope = new Scope(opts.parentScope || null);
  // Esc：先退出编辑（光标离开描述框）；此时按键范围撤下，再按 Esc 才轮到弹窗关闭
  scope.register([], 'Escape', () => {
    if (ed && ed.editor && typeof ed.editor.blur === 'function') ed.editor.blur();
    else if (host.ownerDocument.activeElement) host.ownerDocument.activeElement.blur();
    return false;
  });
  // Tab / Shift+Tab 留给编辑器（列表缩进），不让外层把它当成「切换到下一个输入框」
  scope.register([], 'Tab', () => undefined);
  scope.register(['Shift'], 'Tab', () => undefined);
  // 「增强编辑」的命令：执行的那一下，让「当前打开的笔记」（getActiveViewOfType(MarkdownView)）
  // 临时指向描述框，执行完立刻换回。替身对象只带编辑器、所属笔记这几样，
  // 没有保存之类的方法——万一有别的代码在这一瞬间拿到它并想写文件，会直接出错而不会误写。
  const runOnThisEditor = (cmd) => {
    const stand = { app, file, editor: ed.editor, getMode: () => 'source' };
    const hadOwn = Object.prototype.hasOwnProperty.call(ws, 'getActiveViewOfType');
    const prevFn = ws.getActiveViewOfType;
    const patched = function (type) { return type === MarkdownView ? stand : prevFn.call(this, type); };
    ws.getActiveViewOfType = patched;
    ws.activeEditor = owner;
    try {
      return app.commands.executeCommand(cmd);
    } finally {
      // 只在仍是我们装的替换时才还原（期间若有别的插件也改了它，不去覆盖）
      if (ws.getActiveViewOfType === patched) {
        if (hadOwn) ws.getActiveViewOfType = prevFn;
        else delete ws.getActiveViewOfType;
      }
    }
  };
  // 其余按键：若是某个「编辑器命令」的快捷键，就对本编辑器执行该命令。
  // 匹配方式照搬 Obsidian 自己的快捷键分发（hotkeyManager.onTrigger），只是多了一道筛选
  const hm = app.hotkeyManager;
  const KeymapCls = app.keymap && app.keymap.constructor;
  if (hm && typeof hm.bake === 'function' && KeymapCls && typeof KeymapCls.isMatch === 'function'
      && app.commands && typeof app.commands.findCommand === 'function'
      && typeof app.commands.executeCommand === 'function') {
    scope.register(null, null, (evt, ctx) => {
      hm.bake();
      const keys = hm.bakedHotkeys || [];
      const ids = hm.bakedIds || [];
      for (let i = 0; i < keys.length; i++) {
        if (!KeymapCls.isMatch(keys[i], ctx)) continue;
        const cmd = app.commands.findCommand(ids[i]);
        if (!cmd || (evt.repeat && !cmd.repeatable)) continue;
        if (isEditorCommand(cmd)) {
          ws.activeEditor = owner;
          if (app.commands.executeCommand(cmd)) return false; // 已执行：吃掉这次按键
        } else if (ENHANCED_EDITING_COMMANDS.has(cmd.id)) {
          if (runOnThisEditor(cmd)) return false;
        }
      }
      return undefined; // 不是编辑器命令的快捷键：照常交给编辑器处理（打字、方向键等）
    });
  }

  /* ---------- 焦点：进入时把「当前编辑器」指向自己，离开时还原 ---------- */
  let focused = false;
  let scopePushed = false;
  let prevActive = null;
  // 手机端：屏幕上方的编辑工具栏（加粗、列表等按钮）跟着「当前编辑器」走，切换后要通知它刷新
  const updateMobileToolbar = () => {
    try { if (Platform.isMobile && app.mobileToolbar) app.mobileToolbar.update(); } catch (e) { /* 忽略 */ }
  };
  const claim = () => {
    if (!focused) {
      focused = true;
      if (ws.activeEditor !== owner) prevActive = ws.activeEditor;
    }
    if (!scopePushed) { app.keymap.pushScope(scope); scopePushed = true; }
    ws.activeEditor = owner;
    // Obsidian 在焦点变化后可能又把「当前编辑器」改回别处，稍后再确认一次（Kanban 也这样做）
    setTimeout(() => { if (focused) { ws.activeEditor = owner; updateMobileToolbar(); } }, 0);
  };
  const release = () => {
    focused = false;
    if (scopePushed) { app.keymap.popScope(scope); scopePushed = false; }
    if (ws.activeEditor === owner) ws.activeEditor = prevActive || null;
    prevActive = null;
    updateMobileToolbar();
  };
  const onFocusIn = () => claim();
  const onFocusOut = (e) => {
    const to = e.relatedTarget;
    if (to && host.contains(to)) return; // 焦点仍在编辑器内部（如表格单元格），不算离开
    release();
  };
  // 不先点进描述框、直接把文件拖进来：同样先认领，让上传插件拿到正确的笔记，然后把光标放进来
  const onDrop = () => {
    claim();
    setTimeout(() => { if (ed && ed.editor) ed.editor.focus(); }, 0);
  };
  // 点描述框里文字下方的空白处：把光标放到末尾（编辑区本身只有文字那么高）
  const onMouseDown = (e) => {
    const t = e.target;
    if (!ed || !ed.editor || (t && t.closest && t.closest('.cm-content'))) return;
    // 点在描述框自己的滚动条上：照常拖动滚动条，不去动光标
    if (t === host && e.offsetX >= host.clientWidth) return;
    e.preventDefault();
    ed.editor.focus();
    const last = ed.editor.lastLine();
    ed.editor.setCursor({ line: last, ch: ed.editor.getLine(last).length });
  };
  host.addEventListener('focusin', onFocusIn);
  host.addEventListener('focusout', onFocusOut);
  host.addEventListener('drop', onDrop, true);
  host.addEventListener('mousedown', onMouseDown);

  let destroyed = false;
  return {
    getValue() { return ed && ed.editor ? ed.editor.getValue() : ''; },
    setValue(v) {
      const text = String(v == null ? '' : v);
      if (ed && ed.editor && ed.editor.getValue() !== text) ed.editor.setValue(text);
    },
    focus() { if (ed && ed.editor) ed.editor.focus(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
      host.removeEventListener('drop', onDrop, true);
      host.removeEventListener('mousedown', onMouseDown);
      release();
      try { root.unload(); } catch (e) { console.warn('[dada-todo-list] 卸载内嵌编辑器组件出错:', e); }
      // 组件卸载不会销毁编辑器本身（CodeMirror 视图、建议弹窗等），要单独销毁
      try { ed.destroy(); } catch (e) { console.warn('[dada-todo-list] 销毁内嵌编辑器出错:', e); }
      host.replaceChildren();
      ed = null;
    }
  };
}
