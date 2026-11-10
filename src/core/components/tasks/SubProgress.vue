<template>
  <!-- 子任务进度小标（自用改版）：如「1/3」，没有子任务时不显示 -->
  <span v-if="p.total || has" class="tk-subprog" :class="{ 'is-all-done': p.total && p.done === p.total }"
        v-tooltip="$t('app.subProgressTip', { done: p.done, total: p.total })">
    <i class="la la-list-ul"></i>{{ p.done }}/{{ p.total }}
  </span>
</template>

<script>
import { subProgress, hasSubtasks } from '../../composables/subtasks.js';

export default {
  name: 'SubProgress',
  props: { task: { type: Object, required: true } },
  computed: {
    p() { return subProgress(this.task); },
    has() { return hasSubtasks(this.task); }
  }
};
</script>
