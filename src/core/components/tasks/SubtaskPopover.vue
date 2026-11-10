<template>
  <!-- 子任务悬停浮层（自用改版）：周视图、月视图里鼠标停在带子任务的任务上时弹出。
       挂到 <body> 下（任务视图容器启用了 container 查询，会把 fixed 定位限制在容器内）；
       鼠标移进浮层时保持打开，可直接勾选、点开子任务。 -->
  <teleport to="body">
    <div v-if="task" class="tk-subpop" :style="pos"
         @mouseenter="$emit('keep')" @mouseleave="$emit('leave')">
      <div class="tk-subpop-hd" @click="openParent($event)">
        <span class="tk-subpop-title">{{ title }}</span>
        <sub-progress :task="task" />
      </div>
      <subtask-lines :subtasks="task.subtasks || []" :hide-done="hideDone" compact />
    </div>
  </teleport>
</template>

<script>
import { plainTitle } from '../../composables/tasks-logic.js';
import SubtaskLines from './SubtaskLines.vue';
import SubProgress from './SubProgress.vue';

const WIDTH = 280; // 浮层宽度（px）

export default {
  name: 'SubtaskPopover',
  components: { SubtaskLines, SubProgress },
  inject: { dadaSub: { default: null } },
  props: {
    // 当前悬停的父任务（null = 不显示）
    task: { type: Object, default: null },
    // 触发浮层的元素在屏幕上的位置（getBoundingClientRect 的结果）
    rect: { type: Object, default: null },
    hideDone: { type: Boolean, default: false }
  },
  emits: ['keep', 'leave'],
  computed: {
    title() { return plainTitle(this.task); },
    // 默认放在任务下方、左对齐；下方放不下就放到上方；左右不超出窗口
    pos() {
      const r = this.rect || { left: 0, right: 0, top: 0, bottom: 0 };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(r.left, vw - WIDTH - 8));
      const below = vh - r.bottom;
      const style = { left: left + 'px', width: WIDTH + 'px' };
      if (below >= 160 || below >= r.top) {
        style.top = (r.bottom + 4) + 'px';
        style.maxHeight = Math.max(120, below - 16) + 'px';
      } else {
        style.bottom = (vh - r.top + 4) + 'px';
        style.maxHeight = Math.max(120, r.top - 16) + 'px';
      }
      return style;
    }
  },
  methods: {
    // 点浮层标题：打开父任务的编辑窗口
    openParent(e) { if (this.dadaSub && this.task) this.dadaSub.open(this.task, e); }
  }
};
</script>
