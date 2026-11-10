<template>
  <!-- 子任务清单（自用改版）：缩进的一列子任务，左侧一条细引导线。
       列表、四象限、日程卡片、日视图的任务块，以及周 / 月视图的悬停浮层共用。
       点一行 = 打开这条子任务的编辑窗口（按住 Ctrl/⌘ 则跳到它在笔记里的位置）；点圆圈 = 勾选；右键 = 任务菜单。
       动作统一交给 TasksApp 经 provide 注入的 dadaSub 处理，各视图不必逐层转发事件。 -->
  <div class="tk-subl" :class="{ 'is-compact': compact }" @click.stop @dblclick.stop>
    <div v-for="s in shown" :key="s.guid" class="tk-subl-row"
         :class="{ done: s.completed || s.cancelled, cancel: s.cancelled }"
         @click.stop="open(s, $event)" @contextmenu.stop.prevent="ctxMenu(s, $event)">
      <i class="tk-subl-check" :class="statusIcon(s)" @click.stop.prevent="toggle(s)"></i>
      <span v-if="s.priority" class="tk-subl-prio">{{ s.priority }}</span>
      <span class="tk-subl-sum" v-html="rich(s)" @click="onRichClick"></span>
      <span v-if="when(s)" class="tk-subl-meta"><i class="la la-calendar"></i>{{ when(s) }}</span>
      <i v-if="s.description" class="la la-align-left tk-subl-meta" v-tooltip="$t('app.subHasDesc')"></i>
      <span v-if="s.subtaskCount" class="tk-subl-meta"><i class="la la-list-ul"></i>{{ s.subtaskCount }}</span>
    </div>
    <div v-if="hidden > 0" class="tk-subl-more">{{ $t('app.subMore', { n: hidden }) }}</div>
  </div>
</template>

<script>
import { statusIcon, renderInlineHtml, dateText, timeText } from '../../composables/tasks-logic.js';

export default {
  name: 'SubtaskLines',
  // TasksApp 提供的子任务动作；在别处单独使用时为空，各动作安全地什么也不做
  inject: { dadaSub: { default: null } },
  props: {
    // 要显示的子任务记录
    subtasks: { type: Array, default: () => [] },
    // 「隐藏已完成」：去掉已完成、已取消的子任务
    hideDone: { type: Boolean, default: false },
    // 最多显示几条（0 = 全部）；超出时末尾显示「还有 N 条子任务」
    max: { type: Number, default: 0 },
    // 紧凑排版（日视图任务块、悬停浮层里用）
    compact: { type: Boolean, default: false }
  },
  computed: {
    list() {
      const l = this.subtasks || [];
      return this.hideDone ? l.filter((s) => !s.completed && !s.cancelled) : l;
    },
    shown() { return this.max > 0 ? this.list.slice(0, this.max) : this.list; },
    hidden() { return this.list.length - this.shown.length; }
  },
  methods: {
    statusIcon(s) { return statusIcon(s); },
    // 标题：链接可点、#标签显示成小标签（与各视图的任务标题一致）
    rich(s) { return renderInlineHtml(s && s.summary); },
    // 子任务自己的日期 / 时间：有日期显示「月/日」（带时刻再加时间）；只有时间的显示时间
    when(s) {
      if (s.dueAt) {
        const tm = s.dueAllDay ? '' : timeText(s);
        return dateText(s) + (tm ? ' ' + tm : '');
      }
      return s.time ? s.time + (s.timeEnd ? '-' + s.timeEnd : '') : '';
    },
    toggle(s) { if (this.dadaSub) this.dadaSub.toggle(s); },
    open(s, e) { if (this.dadaSub) this.dadaSub.open(s, e); },
    ctxMenu(s, e) { if (this.dadaSub) this.dadaSub.ctx(s, e); },
    // 标题里的链接：照常打开链接，不同时触发「打开子任务」
    onRichClick(e) { if (e.target && e.target.tagName === 'A') e.stopPropagation(); }
  }
};
</script>
