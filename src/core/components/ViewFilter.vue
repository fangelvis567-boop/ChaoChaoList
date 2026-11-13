<template>
  <!-- 按标签筛选（自用改版）：顶栏上的筛选按钮 + 点开的小面板。
       面板分两行：「谁的」（使用者标签 + 没指定，至少留一个）和「标签」（其余标签，可多选）。
       选了什么由父级（TasksApp）保管并存到本机，这里只负责显示和把点击后的新结果交回去（change 事件）。
       面板挂到 <body> 下：任务视图容器启用了 container 查询，fixed 定位在里面会被限制在容器内（和子任务浮层同理）。 -->
  <button ref="btn" class="tk-btn tk-vfilter-btn" :class="{ on: active, ico: !label }" type="button"
          v-tooltip="$t('app.filterTip')" @click="toggle">
    <i class="la la-filter"></i><span v-if="label" class="tk-vfilter-label">{{ label }}</span>
  </button>
  <teleport :to="host || 'body'">
    <div v-if="open" ref="pop" class="tk-vfilter-pop" :style="pos">
      <!-- 谁的：使用者名单是空的（没人用这个功能）时整行不显示 -->
      <div v-if="users.length" class="tk-vfilter-row">
        <span class="tk-vfilter-h">{{ $t('app.filterWho') }}</span>
        <div class="tk-vfilter-chips">
          <button v-for="u in users" :key="u" type="button" class="tk-vfilter-chip"
                  :class="{ on: filter.users.indexOf(u) >= 0 }" :aria-pressed="filter.users.indexOf(u) >= 0"
                  @click="pickWho(u)">{{ u }}</button>
          <button type="button" class="tk-vfilter-chip" :class="{ on: filter.unassigned }"
                  :aria-pressed="filter.unassigned" @click="pickWho(null)">{{ $t('app.filterUnassigned') }}</button>
        </div>
      </div>
      <!-- 标签：全库任务里出现过的标签，可多选；一个都不选 = 不按标签限制 -->
      <div class="tk-vfilter-row">
        <span class="tk-vfilter-h">{{ $t('app.filterTags') }}</span>
        <div class="tk-vfilter-chips">
          <button v-for="g in tagChoices" :key="g" type="button" class="tk-vfilter-chip"
                  :class="{ on: filter.tags.indexOf(g) >= 0 }" :aria-pressed="filter.tags.indexOf(g) >= 0"
                  @click="pickTag(g)">#{{ g }}</button>
          <span v-if="!tagChoices.length" class="tk-vfilter-empty">{{ $t('app.filterNoTags') }}</span>
        </div>
      </div>
      <div class="tk-vfilter-foot">
        <!-- 想把「谁的」最后一个也点掉时，这行字变红提醒一下 -->
        <span class="tk-vfilter-hint" :class="{ warn: needOne }">{{ users.length ? $t('app.filterNeedOne') : '' }}</span>
        <button v-if="filter.tags.length" type="button" class="tk-vfilter-clear" @click="resetTags">{{ $t('app.filterClearTags') }}</button>
      </div>
    </div>
  </teleport>
</template>

<script>
import { Tasks } from '../composables/useTasks.js';
import { isFilterActive, filterSummary, toggleWho, toggleTag, clearTags } from '../composables/viewFilter.js';

const WIDTH = 320;      // 面板最宽多少（px）；窗口更窄时跟着缩
const LABEL_PARTS = 3;  // 按钮上最多写几项，其余写成「+N」

export default {
  name: 'ViewFilter',
  props: {
    // 当前的筛选：{ users: 选中的人, unassigned: 是否含「没指定」, tags: 选中的标签 }
    filter: { type: Object, required: true },
    // 使用者名单（设置里的名单 + 这台设备的使用者）；空数组 = 没有「谁的」这一行
    users: { type: Array, default: () => [] }
  },
  emits: ['change'],
  data() {
    return {
      open: false,
      host: null,     // 面板挂到哪个 <body> 下：按钮所在窗口的（面板拖到独立窗口里时不是主窗口）
      pos: {},        // 面板的位置和宽度
      allTags: [],    // 全库任务里出现过的标签名（打开面板时现读，按用得多少排）
      needOne: false  // 刚才试图把「谁的」最后一个点掉
    };
  },
  computed: {
    // 筛选此刻是不是真的在挡任务：是就把按钮点亮
    active() { return isFilterActive(this.filter, this.users); },
    // 按钮上的文字，如「🌻 · 没指定」「🌻 · 没指定 · #家务 +1」；没在筛时为空（只显示图标）
    label() {
      const parts = filterSummary(this.filter, this.users, this.$t('app.filterUnassigned'));
      if (!parts.length) return '';
      const head = parts.slice(0, LABEL_PARTS).join(' · ');
      return parts.length > LABEL_PARTS ? head + ' +' + (parts.length - LABEL_PARTS) : head;
    },
    // 「标签」一行列哪些：出现过的标签去掉使用者标签；已经选中、但库里现在没有任务再用的也留着，不然没法取消
    tagChoices() {
      const out = this.allTags.filter((g) => this.users.indexOf(g) < 0);
      for (const g of this.filter.tags) if (out.indexOf(g) < 0) out.push(g);
      return out;
    }
  },
  beforeUnmount() {
    clearTimeout(this._warnTimer);
    this.unbind();
  },
  methods: {
    async toggle() {
      if (this.open) { this.close(); return; }
      const btn = this.$refs.btn;
      this.host = (btn && btn.ownerDocument && btn.ownerDocument.body) || null;
      this.place();
      this.open = true;
      this.bind();
      // 标签名单每次打开现读：别处新加、删掉的标签马上能反映出来
      try { this.allTags = ((await Tasks.collectTags()) || []).map((x) => x.name); }
      catch (e) { this.allTags = []; }
    },
    close() {
      this.open = false;
      this.needOne = false;
      this.unbind();
    },
    // 面板放在按钮正下方、右边对齐按钮；左右都不超出窗口
    place() {
      const btn = this.$refs.btn;
      if (!btn) return;
      const win = (btn.ownerDocument && btn.ownerDocument.defaultView) || window;
      const r = btn.getBoundingClientRect();
      const width = Math.min(WIDTH, win.innerWidth - 16);
      const left = Math.max(8, Math.min(r.right - width, win.innerWidth - width - 8));
      this.pos = {
        top: (r.bottom + 6) + 'px',
        left: left + 'px',
        width: width + 'px',
        maxHeight: Math.max(160, win.innerHeight - r.bottom - 16) + 'px'
      };
    },
    // 打开期间：点面板和按钮以外的地方、按 Esc、改窗口大小，都收起面板
    bind() {
      const btn = this.$refs.btn;
      const doc = (btn && btn.ownerDocument) || document;
      const win = doc.defaultView || window;
      this._doc = doc;
      this._win = win;
      this._onDown = (e) => {
        const pop = this.$refs.pop;
        if ((pop && pop.contains(e.target)) || (this.$refs.btn && this.$refs.btn.contains(e.target))) return;
        this.close();
      };
      this._onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        this.close();
      };
      this._onResize = () => this.close();
      doc.addEventListener('mousedown', this._onDown, true);
      doc.addEventListener('touchstart', this._onDown, true);
      doc.addEventListener('keydown', this._onKey, true);
      win.addEventListener('resize', this._onResize);
    },
    unbind() {
      if (!this._doc) return;
      this._doc.removeEventListener('mousedown', this._onDown, true);
      this._doc.removeEventListener('touchstart', this._onDown, true);
      this._doc.removeEventListener('keydown', this._onKey, true);
      this._win.removeEventListener('resize', this._onResize);
      this._doc = null;
      this._win = null;
    },
    // 点「谁的」里的某个人（name 为 null = 点的是「没指定」）。最后一个点不掉：提示一下，不改筛选
    pickWho(name) {
      const next = toggleWho(this.filter, name);
      if (!next) {
        this.needOne = true;
        clearTimeout(this._warnTimer);
        this._warnTimer = setTimeout(() => { this.needOne = false; }, 1800);
        return;
      }
      this.needOne = false;
      this.$emit('change', next);
    },
    pickTag(tag) { this.$emit('change', toggleTag(this.filter, tag)); },
    resetTags() { this.$emit('change', clearTags(this.filter)); }
  }
};
</script>

<!-- 非 scoped：面板挂在 <body> 下，不在组件的作用域里；类名都带 tk-vfilter 前缀，不会碰到别处。
     颜色令牌（--ink、--line、--gold 等）要在 styles/tokens.css 里给 .tk-vfilter-pop 单独声明，否则解析不到。 -->
<style>
/* 按钮上的文字：太长就截断，免得把顶栏撑开 */
.task-app button.tk-btn .tk-vfilter-label { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tk-vfilter-pop {
  position: fixed; z-index: var(--layer-popover, 40); box-sizing: border-box; overflow-y: auto;
  padding: 12px 14px 10px; border-radius: 12px;
  background: var(--background-primary); border: 1px solid var(--background-modifier-border);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .14);
  font-size: 13px; color: var(--ink);
}
.tk-vfilter-row { display: flex; align-items: flex-start; gap: 10px; }
.tk-vfilter-row + .tk-vfilter-row { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.tk-vfilter-h { flex: none; width: 34px; line-height: 26px; font-size: 12px; color: var(--ink-soft); }
.tk-vfilter-chips { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; }
/* 胶囊按钮：自己画，盖掉 Obsidian 对原生 button 的全局样式 */
.tk-vfilter-pop button.tk-vfilter-chip {
  appearance: none; -webkit-appearance: none; box-shadow: none; box-sizing: border-box; margin: 0;
  height: 26px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--line); background: transparent; color: var(--ink-soft);
  font-family: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.tk-vfilter-pop button.tk-vfilter-chip:hover { background: var(--gold-bg); color: var(--ink); }
.tk-vfilter-pop button.tk-vfilter-chip:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
.tk-vfilter-pop button.tk-vfilter-chip.on { background: var(--gold); color: var(--text-on-accent); border-color: transparent; }
.tk-vfilter-empty { line-height: 26px; font-size: 12px; color: var(--ink-soft); }
.tk-vfilter-foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; min-height: 18px; }
.tk-vfilter-hint { flex: 1 1 auto; font-size: 12px; color: var(--ink-soft); transition: color .15s ease; }
.tk-vfilter-hint.warn { color: var(--c-cancel); }
.tk-vfilter-pop button.tk-vfilter-clear {
  appearance: none; -webkit-appearance: none; box-shadow: none; margin: 0; padding: 0 2px; height: auto;
  border: none; background: transparent; color: var(--gold);
  font-family: inherit; font-size: 12px; cursor: pointer;
}
.tk-vfilter-pop button.tk-vfilter-clear:hover { text-decoration: underline; }
</style>
