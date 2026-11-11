<template>
  <!-- 描述输入框（自用改版），两种形态：
       1. 优先：内嵌 Obsidian 自带的编辑器（.tk-md-embed），实时预览、快捷键、粘贴图片都和写笔记一样；
       2. 后备：内嵌失败时（如 Obsidian 升级改了内部结构）退回普通文本框——平时显示排版后的
          Markdown（.tk-md-view），点一下进入编辑（.tk-md-input，显示原文），点别处恢复显示。 -->
  <div class="tk-md" :class="{ 'is-editing': showEditor, 'is-embed': mode === 'embed' }">
    <div v-show="mode !== 'plain'" ref="host" class="tk-md-embed"></div>
    <template v-if="mode === 'plain'">
      <textarea
        v-show="showEditor"
        ref="ta"
        class="tk-md-input"
        rows="3"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <div
        v-show="!showEditor"
        ref="view"
        class="tk-md-view markdown-rendered"
        tabindex="0"
        v-tooltip="editTip"
        @click="onViewClick"
        @keydown.enter.prevent="startEdit"
      ></div>
    </template>
  </div>
</template>

<script>
import { MarkdownRenderer, Component } from 'obsidian';
import { isImeKey } from '../composables/tasks-logic.js';
import { canEmbedEditor, createEmbeddedEditor } from '../ui/embeddedEditor.js';

// 列表行的开头：缩进 + 标记（- * + 或 1. 1)）+ 空格 + 可选的复选框
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

export default {
  name: 'MarkdownField',
  props: {
    // 描述的 Markdown 原文（v-model）
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    // Obsidian 的 app 对象：渲染 Markdown、打开双链时要用
    app: { type: Object, default: null },
    // 任务所在笔记的路径：解析双链、图片等相对引用时以它为起点
    sourcePath: { type: String, default: '' },
    // 任务所在的笔记（TFile）：内嵌编辑器据此解析链接、保存粘贴的附件，S3 上传插件据此读取笔记设置
    file: { type: Object, default: null },
    // 鼠标停在排版结果上时的提示文字
    editTip: { type: String, default: '' }
  },
  // update:modelValue：内容变了；mode：告诉外层用的是哪种形态（'embed' 内嵌编辑器 / 'plain' 普通文本框）
  emits: ['update:modelValue', 'mode'],
  // 所在的 Obsidian 弹窗（由 VueModal 提供）：内嵌编辑器借它的按键范围，让 Esc 仍能关闭弹窗
  inject: { obsidianModal: { default: null } },
  data() {
    return {
      // 是否处于编辑状态（仅普通文本框形态用：输入框获得焦点）
      editing: false,
      // 当前形态：'pending' 准备内嵌编辑器 / 'embed' 内嵌成功 / 'plain' 普通文本框
      mode: canEmbedEditor(this.app) ? 'pending' : 'plain'
    };
  },
  computed: {
    hasText() { return !!String(this.modelValue || '').trim(); },
    // 显示输入框的两种情况：正在编辑，或者还没有任何内容
    showEditor() { return this.editing || !this.hasText; }
  },
  watch: {
    modelValue(v) {
      if (this.mode === 'embed') {
        // 外层改了内容（如重置表单）才需要同步进编辑器；编辑器自己发出的改动，内容本就一致
        if (this._ed) this._ed.setValue(v || '');
        return;
      }
      if (this.mode !== 'plain') return;
      if (this.showEditor) this.$nextTick(this.fit);
      else this.render();
    },
    showEditor(v) {
      if (this.mode !== 'plain') return;
      if (v) this.$nextTick(this.fit);
      else this.render();
    }
  },
  mounted() {
    this._doc = this.$el.ownerDocument;
    if (this.mode === 'pending') this.initEmbed();
    if (this.mode === 'plain') this.initPlain();
    this.$emit('mode', this.mode);
  },
  beforeUnmount() {
    if (this._ed) { this._ed.destroy(); this._ed = null; }
    if (this._onDown) {
      this._doc.removeEventListener('pointerdown', this._onDown, true);
      this._doc.removeEventListener('pointerup', this._onUp, true);
      this._doc.removeEventListener('pointercancel', this._onUp, true);
    }
    this._renderSeq = -1; // 让还没完成的渲染结果作废
    if (this._renderComp) { this._renderComp.unload(); this._renderComp = null; }
  },
  methods: {
    /* ---------- 形态一：内嵌 Obsidian 编辑器 ---------- */
    initEmbed() {
      try {
        this._ed = createEmbeddedEditor(this.app, this.$refs.host, {
          value: this.modelValue || '',
          placeholder: this.placeholder,
          file: this.file,
          parentScope: this.obsidianModal ? this.obsidianModal.scope : null,
          onChange: (v) => { if (v !== this.modelValue) this.$emit('update:modelValue', v); }
        });
        this.mode = 'embed';
      } catch (e) {
        // 内嵌失败（多半是 Obsidian 升级改了内部结构）：退回普通文本框，描述照样能写、能保存
        console.warn('[ChaoChaoList] 无法内嵌 Obsidian 编辑器，改用普通文本框:', e);
        this._ed = null;
        if (this.$refs.host) this.$refs.host.replaceChildren(); // 清掉可能建了一半的编辑器
        this.mode = 'plain';
      }
    },

    /* ---------- 形态二（后备）：普通文本框 + 排版结果 ---------- */
    initPlain() {
      // 记录鼠标 / 触摸是否正按着：见 onBlur 的说明
      this._onDown = () => { this._pointerDown = true; };
      this._onUp = () => {
        this._pointerDown = false;
        if (this._exitOnUp) {
          this._exitOnUp = false;
          // 等这次点击的后续事件（click）都处理完，再切回显示状态
          setTimeout(() => this.leaveIfBlurred(), 0);
        }
      };
      this._doc.addEventListener('pointerdown', this._onDown, true);
      this._doc.addEventListener('pointerup', this._onUp, true);
      this._doc.addEventListener('pointercancel', this._onUp, true);
      // 文本框和排版结果是 v-if 渲染的，等它们出现在页面上再量高度 / 排版
      this.$nextTick(() => { if (this.showEditor) this.fit(); else this.render(); });
    },
    /* ---------- 显示状态：用 Obsidian 自己的渲染器排版 ---------- */
    async render() {
      const el = this.$refs.view;
      if (!el) return;
      const text = String(this.modelValue || '');
      const seq = (this._renderSeq = (this._renderSeq || 0) + 1);
      // 每次渲染放进一个新的容器，渲染完成再整体替换旧内容，
      // 避免连续多次渲染（异步）时新旧内容交错或重复出现
      const holder = this._doc.createElement('div');
      holder.className = 'tk-md-body';
      holder.hidden = true;
      el.appendChild(holder);
      // Obsidian 要求渲染结果挂在一个「组件」上，用来在不再需要时清理（如内嵌内容的监听）
      const comp = new Component();
      comp.load();
      try {
        if (this.app && MarkdownRenderer && typeof MarkdownRenderer.render === 'function') {
          await MarkdownRenderer.render(this.app, text, holder, this.sourcePath || '', comp);
        } else {
          holder.textContent = text;
        }
      } catch (e) {
        // 渲染失败不影响使用：退回显示纯文本
        console.warn('[ChaoChaoList] 描述渲染失败，改为显示原文:', e);
        holder.textContent = text;
      }
      if (seq !== this._renderSeq) {
        // 渲染期间内容又变了（或组件已卸载）：丢弃这次的结果
        holder.remove();
        comp.unload();
        return;
      }
      for (const child of Array.from(el.children)) if (child !== holder) child.remove();
      holder.hidden = false;
      if (this._renderComp) this._renderComp.unload();
      this._renderComp = comp;
    },
    // 点排版结果：点到链接就打开链接，否则进入编辑
    onViewClick(e) {
      const target = e.target && e.target.closest ? e.target : null;
      const link = target && target.closest('a');
      if (link) {
        if (link.classList.contains('internal-link')) {
          // 双链：在新标签页打开对应笔记（弹窗保持不动，关掉弹窗就能看到）
          e.preventDefault();
          const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
          if (href && this.app) this.app.workspace.openLinkText(href, this.sourcePath || '', true);
        } else if (link.classList.contains('tag')) {
          e.preventDefault(); // 标签不做跳转
        }
        // 外部链接不拦截：交给 Obsidian 默认行为，在浏览器里打开
        return;
      }
      if (target && target.closest('button')) return; // 代码块的复制按钮等
      if (target && target.matches('input[type="checkbox"]')) e.preventDefault(); // 排版结果只读，不让勾选
      // 正在拖选文字（准备复制）时不进入编辑
      const sel = this._doc.getSelection ? this._doc.getSelection() : null;
      if (sel && !sel.isCollapsed && this.$refs.view && this.$refs.view.contains(sel.anchorNode)) return;
      this.startEdit();
    },
    startEdit() {
      if (this.disabled) return;
      this.editing = true;
      this.$nextTick(() => {
        const ta = this.$refs.ta;
        if (!ta) return;
        this.fit();
        ta.focus();
        const n = ta.value.length;
        ta.setSelectionRange(n, n); // 光标放到末尾
      });
    },

    /* ---------- 编辑状态 ---------- */
    onFocus() { this.editing = true; },
    // 失去焦点 → 切回显示状态。
    // 但如果是「用鼠标点了别处」造成的（比如点保存按钮），要等这次点击结束再切：
    // 输入框和排版结果高度不同，立刻切换会让下面的按钮移位，导致这一下点空。
    onBlur() {
      if (this._pointerDown) { this._exitOnUp = true; return; }
      this.editing = false;
    },
    leaveIfBlurred() {
      const ta = this.$refs.ta;
      if (ta && this._doc && this._doc.activeElement === ta) return; // 点的还是输入框自己
      this.editing = false;
    },
    onInput(e) {
      this.$emit('update:modelValue', e.target.value);
      this.$nextTick(this.fit);
    },
    // 让输入框的高度跟着内容走：最矮 3 行，最高约三分之一屏，再多就在框内滚动。
    // 高度必须用带 important 的行内样式来设：有的主题（如 Blue Topaz）用 !important
    // 把弹窗里所有多行输入框定成一个很高的固定值，只有这样才能压过它。
    fit() {
      const ta = this.$refs.ta;
      if (!ta || ta.offsetParent === null) return; // 隐藏时量不出高度
      const win = ta.ownerDocument.defaultView || window;
      ta.style.setProperty('height', 'auto', 'important');
      const base = ta.offsetHeight;                    // rows=3 对应的自然高度（含边框）
      const border = ta.offsetHeight - ta.clientHeight; // 上下边框
      const max = Math.max(base, Math.round(win.innerHeight * 0.36));
      const need = ta.scrollHeight + border;
      ta.style.setProperty('height', Math.min(Math.max(base, need), max) + 'px', 'important');
      ta.style.overflowY = need > max ? 'auto' : 'hidden';
    },
    onKeydown(e) {
      // 输入法正在选字、或按着 Ctrl / ⌘ / Alt 的组合键，都不处理
      if (isImeKey(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const ta = e.target;
      if (e.key === 'Tab') {
        if (this.indentLines(ta, e.shiftKey)) e.preventDefault();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        if (this.continueList(ta)) e.preventDefault();
      }
    },
    // 用新文字替换输入框里 [from, to) 这一段，并尽量保留撤销历史（⌘Z 能撤回）
    replaceRange(ta, from, to, text) {
      ta.focus();
      ta.setSelectionRange(from, to);
      let done = false;
      try {
        done = text
          ? ta.ownerDocument.execCommand('insertText', false, text)
          : (from === to || ta.ownerDocument.execCommand('delete'));
      } catch (e) { done = false; }
      if (!done) {
        // 极少数环境不支持上面的命令：直接改值，并手动通知「内容变了」
        ta.setRangeText(text, from, to, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    // Tab / Shift+Tab：光标或选区落在列表行上时，把这些行缩进 / 取消缩进一级。
    // 不在列表行上时返回 false，Tab 仍是原来的「跳到下一个输入框」。
    indentLines(ta, outdent) {
      const v = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const from = v.lastIndexOf('\n', s - 1) + 1; // 选区首行的行首
      let to = v.indexOf('\n', e);                 // 选区末行的行尾
      if (to < 0) to = v.length;
      const block = v.slice(from, to);
      const lines = block.split('\n');
      if (!lines.some((l) => LIST_RE.test(l))) return false;
      const text = lines
        .map((l) => (outdent ? l.replace(/^(\t| {1,4})/, '') : (l ? '\t' + l : l)))
        .join('\n');
      if (text === block) return true; // 已经没有可取消的缩进：只吃掉这次按键
      this.replaceRange(ta, from, to, text);
      if (s === e) {
        const pos = Math.max(from, s + (text.length - block.length));
        ta.setSelectionRange(pos, pos);
      } else {
        ta.setSelectionRange(from, from + text.length);
      }
      return true;
    },
    // 回车：在列表行末尾按回车自动续上下一项（编号加一、复选框变回未勾选）；
    // 在空的列表项上按回车则结束列表。不在列表行上时返回 false，回车照常换行。
    continueList(ta) {
      const v = ta.value;
      const s = ta.selectionStart;
      if (s !== ta.selectionEnd) return false;
      const from = v.lastIndexOf('\n', s - 1) + 1;
      let to = v.indexOf('\n', s);
      if (to < 0) to = v.length;
      const line = v.slice(from, to);
      const m = LIST_RE.exec(line);
      if (!m || s < from + m[0].length) return false; // 不是列表行，或光标还在标记里面
      if (!line.slice(m[0].length).trim()) {
        this.replaceRange(ta, from, to, '');
        return true;
      }
      let marker = m[2];
      const num = /^(\d+)([.)])$/.exec(marker);
      if (num) marker = (Number(num[1]) + 1) + num[2];
      this.replaceRange(ta, s, s, '\n' + m[1] + marker + m[3] + (m[4] ? '[ ] ' : ''));
      return true;
    }
  }
};
</script>

<style>
/* 不用 scoped：排版结果是 Obsidian 渲染器插进来的节点，scoped 样式管不到它们。
   类名统一以 tk-md 开头，不会影响别处。 */
.tk-md { display: flex; flex-direction: column; min-width: 0; }

/* ---------- 形态一：内嵌 Obsidian 编辑器 ----------
   外框与其他输入框一致；默认约 3 行高，内容多了自动长高，到三分之一屏后在框内滚动。
   Obsidian 编辑器原本是为整页笔记设计的（页边距、限制行宽、底部留白），这里统统收紧。 */
.tk-md-embed {
  --file-margins: 0;
  --file-line-width: 100%;
  box-sizing: border-box; min-height: 5.6em; max-height: 36vh; overflow-y: auto;
  border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
  padding: 6px 10px; font-size: 15px; line-height: 1.5; cursor: text;
}
.tk-md-embed:focus-within { border-color: var(--gold); }
.tk-md-embed .markdown-source-view.mod-cm6 { height: auto; font-size: inherit; }
.tk-md-embed .markdown-source-view.mod-cm6 .cm-editor { height: auto; }
.tk-md-embed .markdown-source-view.mod-cm6 .cm-scroller { padding: 0; overflow: visible; }
.tk-md-embed .markdown-source-view.mod-cm6 .cm-sizer {
  max-width: none; margin: 0; padding: 0; min-height: 0;
}
.tk-md-embed .markdown-source-view.mod-cm6 .cm-content { padding: 0; min-height: 4.2em; }
.tk-md-embed .markdown-source-view.mod-cm6 .cm-line { padding-left: 0; padding-right: 0; }
.tk-md-embed .cm-gutters, .tk-md-embed .inline-title, .tk-md-embed .embedded-backlinks { display: none; }
.tk-md-embed .cm-placeholder { color: var(--text-faint); }

/* 输入框：默认 3 行高（由 rows 决定），不让手动拖拽改高度（高度由 fit() 跟随内容调整） */
.tk-md textarea.tk-md-input {
  display: block; width: 100%; box-sizing: border-box;
  height: auto; resize: none; line-height: 1.5; tab-size: 4;
}
/* 压过主题对弹窗内 textarea 的固定高度（主题用了 !important，这里用更具体的选择器 + !important）；
   fit() 再用行内样式按内容精确设高 */
.modal-container .modal-content .tk-md textarea.tk-md-input { height: auto !important; }

/* 排版结果：外观与输入框一致，内容多了在框内滚动 */
.tk-md-view {
  box-sizing: border-box; min-height: 38px; max-height: 36vh; overflow: auto;
  border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px;
  font-size: 14px; line-height: 1.5; color: var(--ink); background: var(--panel);
  cursor: text; word-break: break-word;
}
.tk-md-view:hover, .tk-md-view:focus { border-color: var(--gold); outline: none; }
/* 收紧段落、列表、标题的上下间距，让描述在小框里显得紧凑 */
.tk-md-view .tk-md-body > :first-child { margin-top: 0; }
.tk-md-view .tk-md-body > :last-child { margin-bottom: 0; }
.tk-md-view p, .tk-md-view ul, .tk-md-view ol, .tk-md-view blockquote, .tk-md-view pre, .tk-md-view table { margin-top: 0; margin-bottom: .45em; }
.tk-md-view ul, .tk-md-view ol { padding-inline-start: 1.5em; }
.tk-md-view h1, .tk-md-view h2, .tk-md-view h3, .tk-md-view h4, .tk-md-view h5, .tk-md-view h6 {
  font-size: 1.05em; line-height: 1.4; margin: .5em 0 .3em;
}
.tk-md-view h1 { font-size: 1.25em; }
.tk-md-view h2 { font-size: 1.15em; }
</style>
