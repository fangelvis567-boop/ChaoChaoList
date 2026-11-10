<template>
  <div class="subtasks">
    <ul v-if="items.length" class="sub-list">
      <li v-for="s in items" :key="s.guid" class="sub-item" :class="{ done: s.completed, cancel: s.cancelled }">
        <i class="sub-check" :class="[{ done: s.completed }, statusIcon(s)]" @click.stop="toggle(s, !s.completed)"></i>
        <!-- 点这一行 → 打开子任务自己的编辑窗口（描述 / 日期 / 优先级都在里面，改名也在里面改）。
             标题后面的小标记：优先级、日期或时间、是否有描述、它自己的子任务数（自用改版） -->
        <div class="sub-main" role="button" tabindex="0" v-tooltip="$t('app.openSubtaskTip')"
             @click="open(s, $event)" @keydown.enter.prevent="open(s, $event)">
          <span class="sub-sum" v-html="rich(s)"></span>
          <span v-if="s.priority" class="sub-tag sub-prio">{{ s.priority }}</span>
          <span v-if="dateLabel(s)" class="sub-tag"><i class="la la-calendar"></i>{{ dateLabel(s) }}</span>
          <span v-if="s.description" class="sub-tag" v-tooltip="$t('app.subHasDesc')"><i class="la la-align-left"></i></span>
          <span v-if="s.subtaskCount" class="sub-tag"><i class="la la-list-ul"></i>{{ s.subtaskCount }}</span>
        </div>
        <button class="sub-del" type="button" :title="$t('app.delSubtask')" @click.stop="remove(s)">×</button>
      </li>
    </ul>

    <div v-else-if="loading" class="sub-skel">
      <div v-for="n in 3" :key="n" class="sub-skel-row">
        <span class="sub-skel-box sk"></span>
        <span class="sub-skel-line sk"></span>
      </div>
    </div>

    <div v-else class="sub-empty">{{ $t('app.noSubtasks') }}</div>

    <div v-if="error" class="sub-err">{{ error }}</div>

    <div class="sub-add">
      <i class="la la-plus"></i>
      <input
        v-model="newSummary"
        type="text"
        class="sub-input"
        :placeholder="$t('app.addSubtask')"
        :disabled="adding"
        @keydown.enter="onAddEnter"
      />
    </div>
  </div>
</template>

<script>
import { Tasks } from '../composables/useTasks.js';
import { isImeKey, statusIcon, renderInlineHtml, dateText, timeText } from '../composables/tasks-logic.js';

export default {
  name: 'SubtaskList',
  // change：子任务有增删改，通知外层刷新；open：用户点了某个子任务，请外层打开它的编辑窗口
  emits: ['change', 'open'],
  props: {
    taskGuid: { type: String, required: true }
  },
  data() {
    return {
      items: [],
      loading: false,
      adding: false,
      error: '',
      newSummary: ''
    };
  },
  watch: {
    taskGuid() { this.load(); }
  },
  created() { this.load(); },
  methods: {
    // 状态图标：未完成 / 已完成 / 已取消（子任务在自己的窗口里也可以被取消）
    statusIcon(s) { return statusIcon(s); },
    // 标题：链接可点击、#标签显示成小标签（与各视图的任务标题一致）
    rich(s) { return renderInlineHtml(s && s.summary); },
    // 日期小标记：有日期显示「月/日」（带时刻则再加时间）；只有时间没有日期的，显示时间
    dateLabel(s) {
      if (s.dueAt) {
        const tm = s.dueAllDay ? '' : timeText(s);
        return dateText(s) + (tm ? ' ' + tm : '');
      }
      return s.time ? s.time + (s.timeEnd ? '-' + s.timeEnd : '') : '';
    },
    // 点子任务：交给外层（任务编辑窗口）打开它自己的编辑窗口；点的是标题里的链接则不拦截
    open(s, e) {
      if (e && e.target && e.target.closest && e.target.closest('a')) return;
      this.$emit('open', s);
    },
    /* ---------- 键盘：输入法组字期间的回车不算快捷键 ---------- */
    onAddEnter(e) {
      if (isImeKey(e)) return;
      this.add();
    },
    // 从文件重新读取子任务。外层在子任务窗口关闭后也会调用它（经 ref），以拿到最新的行号
    async load() {
      this.loading = true; this.error = '';
      try {
        this.items = await Tasks.listSubtasks(this.taskGuid);
      } catch (e) {
        this.error = this.$t('app.loadSubsFail') + (e && e.message || e);
        this.items = [];
      } finally {
        this.loading = false;
      }
    },
    async toggle(s, done) {
      try {
        await Tasks.toggleComplete(s.guid, done);
        s.completed = done;
        if (done) s.cancelled = false; // 勾选完成视为恢复，取消态一并清除（与数据层一致）
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.opFail') + (e && e.message || e);
      }
    },
    async add() {
      const summary = this.newSummary.trim();
      if (!summary || this.adding) return;
      this.adding = true; this.error = '';
      try {
        const created = await Tasks.createSubtask(this.taskGuid, { summary });
        this.items.push(created);
        this.newSummary = '';
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.addFail') + (e && e.message || e);
      } finally {
        this.adding = false;
      }
    },
    async remove(s) {
      try {
        await Tasks.deleteTask(s.guid);
        // 删掉一个子任务后，排在它后面的子任务在文件里的行号都变了，
        // 必须从文件重新读一遍，否则再点它们会操作到错误的行
        await this.load();
        this.$emit('change', this.items);
      } catch (e) {
        this.error = this.$t('app.delFail') + (e && e.message || e);
      }
    }
  }
};
</script>

<style scoped>
.subtasks { margin-top: 0; }
.sub-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sub-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; }
.sub-check { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 18px; line-height: 26px; color: var(--ink-soft); cursor: pointer; margin-top: 3px; }
.sub-check.done { color: var(--gold); }
/* 可点击的主体：标题 + 小标记，一行放不下时自动换行 */
.sub-main { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; padding: 0 6px; margin: 0 -6px; border-radius: 6px; cursor: pointer; }
.sub-main:hover, .sub-main:focus-visible { background: var(--background-modifier-hover); outline: none; }
.sub-sum { min-width: 0; font-size: 15px; line-height: 26px; color: var(--ink); word-break: break-word; }
.sub-item.done .sub-sum, .sub-item.cancel .sub-sum { color: var(--ink-soft); text-decoration: line-through; }
/* 标题后面的小标记（优先级 / 日期 / 有描述 / 子任务数） */
.sub-tag { flex: none; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; line-height: 26px; color: var(--ink-soft); white-space: nowrap; }
.sub-tag i { font-size: 13px; }
.sub-prio { font-size: 13px; }
.sub-del { flex: none; width: 22px; height: 22px; border: none; background: transparent; color: var(--ink-soft); font-size: 16px; line-height: 22px; cursor: pointer; border-radius: 6px; opacity: 0; margin-top: 2px; }
.sub-item:hover .sub-del { opacity: 1; }
.sub-del:hover { color: var(--el-color-danger, var(--text-error)); background: var(--background-modifier-hover); }
.sub-empty { font-size: 13px; color: var(--ink-soft); padding: 4px 0 10px; }
.sub-skel { display: flex; flex-direction: column; gap: 12px; padding: 6px 0; }
.sub-skel-row { display: flex; align-items: center; gap: 10px; }
.sub-skel-box { flex: none; width: 20px; height: 20px; border-radius: 5px; }
.sub-skel-line { flex: 1 1 auto; height: 14px; border-radius: 7px; }
.sk { background: var(--background-secondary); animation: subsk 1.2s infinite; }
@keyframes subsk { 0% { opacity: .55; } 50% { opacity: 1; } 100% { opacity: .55; } }
.sub-err { color: var(--el-color-danger, var(--text-error)); font-size: 13px; margin-bottom: 8px; }
.sub-add { display: flex; align-items: center; gap: 10px; padding: 8px 0; color: var(--ink-soft); }
.sub-add i { font-size: 13px; }
.sub-input { flex: 1; min-width: 0; box-sizing: border-box; border: none; background: transparent; padding: 0; font: inherit; font-size: 14px; line-height: 26px; color: var(--ink); box-shadow: none; }
.sub-input::placeholder { color: var(--ink-soft); }
.sub-input:focus { outline: none; box-shadow: none; }
</style>
