<template>
  <!-- 日期面板（自用改版，仿滴答清单）：编辑窗口里点日期胶囊展开。
       上面两个标签：「日期」选某一天（快捷日期 + 日历 + 可选的时间），「时间段」选开始到结束的几天。
       这里改的是一份草稿：「确定」才填回编辑窗口，「取消」原样收起，「清除」= 无日期。
       草稿和表单之间的换算都在 composables/dateDraft.js（有自动测试）。 -->
  <div class="tk-dtp">
    <div class="tk-dtp-tabs">
      <button type="button" class="tk-dtp-tab" :class="{ active: d.tab === 'date' }" @click="setTab('date')">{{ $t('editor.date') }}</button>
      <button type="button" class="tk-dtp-tab" :class="{ active: d.tab === 'span' }" @click="setTab('span')">{{ $t('editor.timeRange') }}</button>
    </div>

    <!-- 「日期」：某一天。时间不填 = 全天；只填开始 = 单个时间；再填结束 = 同一天的时间段 -->
    <template v-if="d.tab === 'date'">
      <div class="tk-dtp-quick">
        <button v-for="q in quicks" :key="q.kind" type="button" class="tk-dtp-q" :class="{ on: picked(q.kind) }" @click="pick(q.kind)">
          <i class="la" :class="q.icon"></i><span>{{ $t(q.label) }}</span>
        </button>
      </div>
      <date-picker v-model="d.date" inline />
      <div class="tk-dtp-time">
        <i class="la la-clock tk-dtp-ico"></i>
        <template v-if="d.start">
          <time-picker v-model="d.start" :step="timeStep" :max="d.end" placeholder="HH:MM" />
          <span class="tk-dtp-sep">—</span>
          <time-picker v-model="d.end" :step="timeStep" :min="d.start" :placeholder="$t('editor.endTimeOpt')" />
          <button type="button" class="tk-dtp-x" :aria-label="$t('editor.clearTime')" @click="clearTime"><i class="la la-times"></i></button>
        </template>
        <button v-else type="button" class="tk-dtp-add" @click="addTime">{{ $t('editor.addTime') }}</button>
      </div>
    </template>

    <!-- 「时间段」：开始到结束，可以跨天。默认全天（和滴答清单一样有个开关）；
         关掉「全天」后，开始、结束两行各多一个时间框：开始那天的开始时间、结束那天的结束时间（结束时间可不填） -->
    <template v-else>
      <div class="tk-dtp-allday" role="switch" :aria-checked="d.spanAllDay ? 'true' : 'false'" @click="toggleSpanAllDay">
        <span>{{ $t('app.allDay') }}</span>
        <div class="checkbox-container" :class="{ 'is-enabled': d.spanAllDay }"><input type="checkbox" tabindex="-1" :checked="d.spanAllDay" /></div>
      </div>
      <div class="tk-field">
        <span>{{ $t('editor.startDate') }}</span>
        <div class="tk-dtp-dt">
          <date-picker v-model="d.spanStart" />
          <time-picker v-if="!d.spanAllDay" v-model="d.spanStartTime" :step="timeStep" placeholder="HH:MM" />
        </div>
      </div>
      <div class="tk-field">
        <span>{{ $t('editor.endDate') }}</span>
        <div class="tk-dtp-dt">
          <date-picker v-model="d.spanEnd" :min="d.spanStart" />
          <time-picker v-if="!d.spanAllDay" v-model="d.spanEndTime" :step="timeStep" :placeholder="$t('editor.endTimeOpt')" />
        </div>
      </div>
    </template>

    <div v-if="err" class="tk-err">{{ $t(err) }}</div>
    <div class="tk-dtp-foot">
      <button type="button" class="btn" @click="$emit('clear')">{{ $t('common.clear') }}</button>
      <span class="tk-dtp-spacer"></span>
      <button type="button" class="btn" @click="$emit('cancel')">{{ $t('common.cancel') }}</button>
      <button type="button" class="btn btn-gold" @click="confirm">{{ $t('common.confirm') }}</button>
    </div>
  </div>
</template>

<script>
import DatePicker from './DatePicker.vue';
import TimePicker from './TimePicker.vue';
import {
  formToDraft, draftToForm, draftError, quickPick, isQuickPicked, switchTab,
  nextHalfHour, daysBetween, addDays
} from '../composables/dateDraft.js';

export default {
  name: 'DateTimePanel',
  components: { DatePicker, TimePicker },
  props: {
    // 编辑窗口的表单：打开面板时从这里读出当前的日期、时间，生成草稿（面板不直接改它）
    form: { type: Object, required: true },
    // 今天，YYYY-MM-DD（快捷日期、默认日期都以它为准）
    today: { type: String, required: true },
    // 时间下拉的步长（分钟），取自插件设置
    timeStep: { type: Number, default: 5 }
  },
  // confirm(要写回表单的字段) / clear（清除日期）/ cancel（原样收起）
  emits: ['confirm', 'clear', 'cancel'],
  data() {
    return {
      d: formToDraft(this.form),
      err: '',
      // 四个快捷日期：图标 + 文字（今天、明天、7 天后、今晚）
      quicks: [
        { kind: 'today', icon: 'la-sun', label: 'editor.quickToday' },
        { kind: 'tomorrow', icon: 'la-cloud-sun', label: 'editor.quickTomorrow' },
        { kind: 'week', icon: 'la-calendar-week', label: 'editor.quickWeek' },
        { kind: 'tonight', icon: 'la-moon', label: 'editor.quickTonight' }
      ]
    };
  },
  watch: {
    // 时间段改了开始日期：结束日期跟着挪同样的天数，保持原来跨几天
    'd.spanStart'(nv, ov) {
      if (!nv || !ov || !this.d.spanEnd) return;
      this.d.spanEnd = addDays(this.d.spanEnd, daysBetween(ov, nv));
    }
  },
  methods: {
    setTab(tab) {
      if (this.d.tab === tab) return;
      this.d = switchTab(this.d, tab, this.today);
      this.err = '';
    },
    pick(kind) {
      Object.assign(this.d, quickPick(kind, this.today));
      this.err = '';
    },
    picked(kind) { return isQuickPicked(kind, this.d, this.today); },
    // 「添加时间」：先填下一个整点或半点，再自己改
    addTime() {
      this.d.start = nextHalfHour();
      this.d.end = '';
    },
    // 时间段的「全天」开关：关掉时开始时间还空着，就先填下一个整点或半点
    toggleSpanAllDay() {
      this.d.spanAllDay = !this.d.spanAllDay;
      if (!this.d.spanAllDay && !this.d.spanStartTime) this.d.spanStartTime = nextHalfHour();
      this.err = '';
    },
    // 「×」：去掉时间，回到全天
    clearTime() {
      this.d.start = '';
      this.d.end = '';
      this.err = '';
    },
    // 当前草稿换算成表单字段；填错时返回 { error }。编辑窗口在面板开着就点「保存」时也会调这里
    result() {
      const e = draftError(this.d);
      return e ? { error: e } : { patch: draftToForm(this.d) };
    },
    confirm() {
      const r = this.result();
      if (r.error) { this.err = r.error; return; }
      this.$emit('confirm', r.patch);
    }
  }
};
</script>

<style scoped>
/* 面板外框：和编辑窗口其他区块一样的细边框、圆角 */
.tk-dtp {
  display: flex; flex-direction: column; gap: 10px;
  width: 100%; max-width: 330px; box-sizing: border-box;
  padding: 12px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel); box-shadow: 0 4px 14px rgba(0, 0, 0, .08);
}
/* 「日期 / 时间段」两个标签，样式沿用原来的时间形态标签 */
.tk-dtp-tabs { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--background-modifier-hover); }
.tk-dtp-tab {
  flex: 1; height: auto; padding: 5px 0; border: none; border-radius: 6px; box-shadow: none;
  background: transparent; color: var(--ink-soft); font-family: inherit; font-size: 13px; line-height: 1.4; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tk-dtp-tab:hover { color: var(--ink); }
.tk-dtp-tab.active { background: var(--panel); color: var(--gold); font-weight: 700; box-shadow: 0 1px 2px rgba(0, 0, 0, .15); }
/* 快捷日期：图标在上、文字在下，四个一排 */
.tk-dtp-quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.tk-dtp-q {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  height: auto; padding: 6px 0; border: none; border-radius: 8px; box-shadow: none;
  background: transparent; color: var(--ink-soft); font-family: inherit; font-size: 12px; cursor: pointer;
}
.tk-dtp-q i { font-size: 20px; color: var(--ink); }
.tk-dtp-q:hover { background: var(--background-modifier-hover); }
.tk-dtp-q.on { background: var(--gold-bg); color: var(--gold); }
.tk-dtp-q.on i { color: var(--gold); }
/* 时间一行：时钟图标、开始 — 结束、清除；没填时间时是一个「添加时间」 */
.tk-dtp-time { display: flex; align-items: center; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line); }
.tk-dtp-ico { flex: none; font-size: 16px; color: var(--ink-soft); }
.tk-dtp-sep { flex: none; color: var(--ink-soft); }
.tk-dtp-time :deep(.tk-time-picker) { min-width: 0; flex: 1 1 0; }
.tk-dtp-x, .tk-dtp-add {
  flex: none; height: auto; border: none; box-shadow: none; background: transparent;
  font-family: inherit; cursor: pointer; border-radius: 6px;
}
.tk-dtp-x { padding: 4px 6px; color: var(--ink-soft); font-size: 14px; }
.tk-dtp-x:hover { background: var(--background-modifier-hover); color: var(--ink); }
.tk-dtp-add { padding: 4px 6px; color: var(--gold); font-size: 13px; }
.tk-dtp-add:hover { background: var(--gold-bg); }
/* 底部：左边「清除」，右边「取消」「确定」 */
.tk-dtp-foot { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line); }
.tk-dtp-spacer { flex: 1; }
.tk-dtp .tk-field { margin: 0; }
/* 时间段的「全天」开关一行：左边文字，右边 Obsidian 自带样式的开关 */
.tk-dtp-allday { display: flex; align-items: center; justify-content: space-between; padding: 2px; font-size: 13px; color: var(--ink); cursor: pointer; }
/* 时间段的开始 / 结束：日期框在左、时间框在右 */
.tk-dtp-dt { display: flex; align-items: center; gap: 6px; }
.tk-dtp-dt > .tk-dp { flex: 1 1 auto; min-width: 0; }
.tk-dtp-dt :deep(.tk-time-picker) { flex: 0 0 104px; min-width: 0; }
</style>
