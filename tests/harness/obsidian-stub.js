// 浏览器演示页用的 obsidian 模块替身（比 tests/stubs/obsidian.js 多了界面相关的部分）。
//
// 用途：不装进 Obsidian，先在普通浏览器里把「任务编辑窗口」跑起来点一遍，
// 检查界面逻辑有没有低级错误。这里只模拟编辑窗口用得到的那几样 Obsidian 能力，
// 排版、主题等细节与真实 Obsidian 不同，最终效果仍以装进 Obsidian 后为准。

// moment 和 TFile 必须与假库（tests/fake-vault.js）用同一份，
// 否则数据层的 `instanceof TFile` 判断会对不上
export { moment, TFile } from '../stubs/obsidian.js';

// ---------- Obsidian 给所有网页元素额外加的几个便捷方法 ----------
const P = HTMLElement.prototype;
/** 把 createDiv('类名') / createDiv({ cls, text }) 两种写法统一成选项对象 */
const opt = (o) => (typeof o === 'string' ? { cls: o } : (o || {}));
if (!P.addClass) {
  P.addClass = function (...c) { this.classList.add(...c); };
  P.removeClass = function (...c) { this.classList.remove(...c); };
  P.empty = function () { this.replaceChildren(); };
  P.setText = function (t) { this.textContent = t; };
  P.createEl = function (tag, o) {
    const el = document.createElement(tag);
    const { cls, text } = opt(o);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    this.appendChild(el);
    return el;
  };
  P.createDiv = function (o) { return this.createEl('div', o); };
  P.createSpan = function (o) { return this.createEl('span', o); };
}

// ---------- 用不到实际功能、只需要「存在」的几样 ----------
export class Notice { constructor(msg) { console.log('[Notice]', msg); } }
export class Setting {}
export class Component { load() {} unload() {} }
/** 悬浮提示：演示页里简单地写进 aria-label 属性 */
export function setTooltip(el, text) {
  if (text) el.setAttribute('aria-label', text);
  else el.removeAttribute('aria-label');
}

// ---------- 弹窗外壳：结构和类名仿照 Obsidian 的原生弹窗 ----------
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'modal-container';
    const bg = this.containerEl.createDiv('modal-bg');
    bg.addEventListener('click', () => this.close());
    this.modalEl = this.containerEl.createDiv('modal');
    this.contentEl = this.modalEl.createDiv('modal-content');
  }
  open() { document.body.appendChild(this.containerEl); this.onOpen(); }
  close() { this.onClose(); this.containerEl.remove(); }
  onOpen() {}
  onClose() {}
}

// ---------- 极简 Markdown 排版：只为在演示页里看出「排版后」和「原文」的区别 ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 行内：加粗、双链 */
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m0, to, alias) => `<a class="internal-link" data-href="${to}">${alias || to}</a>`);
export const MarkdownRenderer = {
  /** 与真实接口同名同参：把 markdown 排版后放进 el */
  async render(app, markdown, el) {
    const out = [];
    let list = '';
    const closeList = () => { if (list) { out.push(`</${list}>`); list = ''; } };
    for (const raw of String(markdown).split('\n')) {
      const h = /^(#{1,6})\s+(.*)$/.exec(raw);
      const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
      if (li) {
        const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
        if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
        out.push(`<li>${inline(li[2])}</li>`);
        continue;
      }
      closeList();
      if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      else if (raw.trim()) out.push(`<p>${inline(raw)}</p>`);
    }
    closeList();
    el.innerHTML = out.join('');
  }
};
