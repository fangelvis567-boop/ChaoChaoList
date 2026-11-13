<template>
  <div v-if="open" class="tk-mask" @click.self="close">
    <div class="tk-modal">
      <button class="tk-close" @click="close"><i class="la la-times"></i></button>
      <div class="tk-modal-head">
        <h3 class="tk-modal-title">{{ editing ? (isSubtask ? $t('editor.editSubTitle') : $t('editor.editTitle')) : $t('editor.newTitle') }}</h3>
        <button v-if="editing" class="btn btn-icon" type="button" v-tooltip="$t('editor.openFileTip')" @click="openFile">
          <i class="la la-external-link"></i>
        </button>
      </div>
      <!-- 子任务窗口：标题下方注明它属于哪个任务（自用改版） -->
      <div v-if="isSubtask && parentTitle" class="tk-sub-of">{{ $t('editor.subOf', { name: parentTitle }) }}</div>
      <label class="tk-field">
        <span>{{ $t('editor.fieldTitle') }}</span>
        <input ref="sumInput" v-model="form.title" type="text" :placeholder="$t('editor.titlePh')" @keydown.enter="onTitleEnter" />
      </label>
      <!-- 链接：胶囊右侧按钮可编辑，末尾 + 可新增 -->
      <div class="tk-links">
        <span class="tk-links-label">{{ $t('editor.links') }}</span>
        <span v-for="(l, i) in form.links" :key="i" class="tk-link-chip">
          <a class="tk-link-chip-text" :href="l.url" target="_blank" rel="noopener noreferrer">{{ l.text || l.url }}</a>
          <button class="tk-link-edit" type="button" :title="$t('modals.linkEdit')" @click="openLinkEditor(i)">
            <i class="la la-pencil"></i>
          </button>
        </span>
        <button class="tk-add-mini" type="button" :title="$t('modals.linkAdd')" @click="openLinkEditor(-1)">
          <i class="la la-plus"></i>
        </button>
      </div>
      <!-- 标签：胶囊右侧 × 可删除，末尾 + 可新增 -->
      <div class="tk-links">
        <span class="tk-links-label">{{ $t('editor.tags') }}</span>
        <span v-for="(tag, i) in form.tags" :key="tag" class="tk-tag-chip" :style="chipStyle(tag)">
          <span class="tk-tag-text">#{{ tag }}</span>
          <button class="tk-tag-del" type="button" :title="$t('editor.delTag')" @click="removeTag(i)">
            <i class="la la-times"></i>
          </button>
        </span>
        <span v-if="addingTag" class="tk-tag-chip is-editing">
          <input ref="tagInput" v-model="tagDraft" class="tk-tag-input" type="text" :placeholder="$t('editor.tagName')"
                 @input="refreshSugs" @keydown.up="onTagNav($event, -1)" @keydown.down="onTagNav($event, 1)"
                 @keydown.enter="onTagEnter" @keydown.esc="onTagEsc" @blur="commitTag" />
          <!-- 智能提示面板：历史标签按频次倒序，输入时包含匹配过滤（issue #22） -->
          <div v-if="sugOpen" class="tk-tag-sugs">
            <div v-for="(s, i) in sugList" :key="s.name" class="tk-tag-sug"
                 :class="{ active: i === sugIdx }"
                 @mousedown.prevent="adoptSug(s.name)" @mouseenter="sugIdx = i">
              <span class="tk-tag-text">#{{ s.name }}</span>
              <span v-if="sugDotStyle(s.name)" class="tk-tag-sug-dot" :style="sugDotStyle(s.name)"></span>
              <span class="tk-tag-sug-n">{{ s.count }}</span>
            </div>
          </div>
        </span>
        <button v-else class="tk-add-mini" type="button" :title="$t('editor.addTag')" @click="startAddTag">
          <i class="la la-plus"></i>
        </button>
      </div>
      <!-- 描述（自用改版）：平时显示排版后的 Markdown，点击进入编辑。
           外层用 div 而不是 label：label 会把点击转交给里面的输入框，干扰「点排版结果进入编辑」 -->
      <div class="tk-field">
        <span>{{ $t('editor.desc') }}<em class="tk-field-hint">{{ descMode === 'embed' ? $t('editor.descHintEmbed') : $t('editor.descMdHint') }}</em></span>
        <markdown-field v-model="form.description" :app="plugin ? plugin.app : null" :source-path="sourcePath"
                        :file="contextFile" :placeholder="$t('editor.descPh')" :edit-tip="$t('editor.descEditTip')"
                        :disabled="saving" @mode="descMode = $event" />
      </div>
      <!-- 日期和时间（自用改版，仿滴答清单）：这里只放一个日期胶囊，显示当前设的日期、时间；
           点开是日期面板（DateTimePanel：日期 / 时间段两个标签、快捷日期、日历、时间）。
           面板改的是草稿，点「确定」才填回下面的表单，最后仍由「保存」写进笔记 -->
      <div class="tk-time-block">
        <button type="button" class="tk-date-chip" :class="{ 'is-open': datePanelOpen, 'is-empty': dateChip.kind === 'none' }"
                :disabled="saving" @click="toggleDatePanel">
          <i class="la la-calendar"></i>
          <span class="tk-date-chip-text">{{ dateChipText }}</span>
          <i class="la la-angle-down tk-date-chip-caret"></i>
        </button>
        <!-- 无日期：用一行字说明保存后这条任务去哪 -->
        <div v-if="form.timeMode === 'none' && !datePanelOpen" class="tk-nodate-hint">{{ noDateHint }}</div>
        <date-time-panel v-if="datePanelOpen" ref="datePanel" :form="form" :today="todayYmd" :time-step="timeStep"
                         @confirm="applyDatePanel" @clear="clearDatePanel" @cancel="datePanelOpen = false" />
      </div>
      <!-- 计划日期（⏳ scheduled）：设置「启用计划时间」开启时显示（issue #13） -->
      <label v-if="showScheduled" class="tk-field">
        <span>{{ $t('editor.scheduledDate') }}</span>
        <DatePicker v-model="form.scheduledDate" :disabled="saving" />
      </label>
      <div v-if="editing" class="tk-sub">
        <div class="tk-sub-title">{{ $t('editor.subtasks') }}</div>
        <!-- 点子任务 → openSubtask：在当前窗口上面再开一个编辑窗口（自用改版） -->
        <subtask-list ref="subList" :task-guid="task.guid" @change="$emit('subtasks-changed', $event)" @open="openSubtask" />
      </div>
      <div v-if="error" class="tk-err">{{ error }}</div>
      <!-- 优先级：置于表单最下方 -->
      <label class="tk-field">
        <span>{{ $t('editor.priority') }}</span>
        <div class="tk-prio-sel">
          <button v-for="opt in priorityOptions" :key="opt.level" type="button"
            class="tk-prio-opt" :class="['lvl-' + opt.level, { 'prio-on': form.priority === opt.level }]"
            @click="form.priority = opt.level">
            <span v-if="opt.icon" class="tk-prio-ico">{{ opt.icon }}</span>{{ opt.label }}
          </button>
        </div>
      </label>
      <!-- 底栏：左（状态操作 + 删除）· 右（唯一主按钮） -->
      <div class="tk-modal-ops">
        <template v-if="editing">
          <button v-if="!form.completed" class="btn" type="button" :disabled="saving" @click="completeTask">
            <i class="la la-check"></i>{{ $t('editor.doneBtn') }}
          </button>
          <button v-else class="btn" type="button" :disabled="saving" @click="completeTask">
            <i class="la la-undo"></i>{{ $t('editor.markUndoneBtn') }}
          </button>
          <button v-if="!form.cancelled" class="btn" type="button" :disabled="saving" @click="cancelTask">
            <i class="la la-ban"></i>{{ $t('editor.cancelTaskBtn') }}
          </button>
          <button v-else class="btn" type="button" :disabled="saving" @click="cancelTask">
            <i class="la la-undo"></i>{{ $t('editor.restoreTaskBtn') }}
          </button>
          <button class="btn btn-danger" type="button" :disabled="saving" @click="remove">
            <i class="la la-trash"></i>{{ $t('editor.delTask') }}
          </button>
        </template>
        <span class="spacer"></span>
        <button class="btn btn-gold" :disabled="saving || !form.title.trim()" @click="save()">
          <i class="la la-save"></i>{{ saving ? $t('editor.saving') : $t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { TFile, Notice } from 'obsidian';
import { Tasks } from '../composables/useTasks.js';
import { splitSummary, composeSummary, sanitizeTag, isImeKey, PRIORITY_ICON, priorityToLevel, levelToPriorityEmoji, withAlpha, validHex, INBOX_KEY, weekdayLong } from '../composables/tasks-logic.js';
import { chipInfo } from '../composables/dateDraft.js';
import { defaultTaskTags } from '../composables/deviceUser.js';
import { getTaskMatcher } from '../composables/viewFilter.js';
import DateTimePanel from './DateTimePanel.vue';
import { LinkFormModal, ConfirmModal } from '../ui/modals.js';
import { openTaskInFile } from '../utils/openTaskInFile.js';
import { taskFilePath } from '../api/tasks.js';
import { VueModal } from '../ui/VueModal.js';
import SubtaskList from './SubtaskList.vue';
import DatePicker from './DatePicker.vue';
import MarkdownField from './MarkdownField.vue';

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

export default {
  name: 'TaskEditorModal',
  components: { SubtaskList, DatePicker, MarkdownField, DateTimePanel },
  props: {
    open: { type: Boolean, default: false },
    task: { type: Object, default: null },
    // 从父任务的子任务列表里点开时为 true：标题显示「编辑子任务」，并注明所属任务
    isSubtask: { type: Boolean, default: false },
    parentTitle: { type: String, default: '' },
    defaultDate: { type: String, default: '' },
    // 双击时间轴空白格新建：预填开始时刻（HH:MM），落到对应时间
    defaultTime: { type: String, default: '' },
    // VueModal 桥挂载的独立 app 拿不到全局 plugin，显式传入（打开原生链接弹窗用）
    plugin: { type: Object, default: null },
    // 清单分组内新建：传入 { list, group } 时，新任务追加到该分组最后一行（而非文件末尾）
    createIn: { type: Object, default: null },
    // 四象限新建：预置优先级档位（high / medium / low / none），使新任务落入对应象限
    defaultPriority: { type: String, default: '' }
  },
  data() {
    return {
      form: this.blank(),
      saving: false,
      error: '',
      // 当前编辑的链接下标（< 0 表示新增）
      linkEditIndex: -1,
      // 新增标签
      addingTag: false,
      tagDraft: '',
      // 标签智能提示（issue #22）：tagSugs 全量历史，sugList 为过滤后面板列表，sugIdx 键盘焦点
      tagSugs: [],
      sugList: [],
      sugIdx: -1,
      sugOpen: false,
      // 描述框的形态（由 MarkdownField 告知）：'embed' 内嵌 Obsidian 编辑器 / 'plain' 普通文本框
      descMode: '',
      // 自用改版：日期面板是否展开
      datePanelOpen: false
    };
  },
  computed: {
    editing() { return !!(this.task && this.task.guid); },
    // 时间形态三态（allday / single / range）中，是否全天
    isAllDay() { return this.form.timeMode === 'allday'; },
    // 时间选择器步长：取自插件设置（timeStep），取不到时默认 5（分钟）
    timeStep() { return (this.plugin && this.plugin.settings && this.plugin.settings.timeStep) || 5; },
    // 计划日期（⏳ scheduled）编辑开关：跟随设置「启用计划时间」（issue #13）
    showScheduled() {
      const st = this.plugin && this.plugin.settings;
      return !!(st && st.showScheduled === true);
    },
    isCrossDate() { return this.form.timeMode === 'crossdate'; },
    // 无日期（自用改版）：保存时不带日期和时间
    isNoDate() { return this.form.timeMode === 'none'; },
    // 今天，YYYY-MM-DD（日期胶囊判断「今天 / 明天」、面板的快捷日期都用它）
    todayYmd() { return ymd(new Date()); },
    // 日期胶囊要显示的内容（换算规则见 composables/dateDraft.js 的 chipInfo）
    dateChip() { return chipInfo(this.form, this.todayYmd); },
    // 日期胶囊上的文字，如「今天 11/11 周三 · 09:00–10:00」「11/10 周二 – 11/14 周六」「无日期」
    dateChipText() {
      const c = this.dateChip;
      const allDay = this.$t('app.allDay');
      if (c.kind === 'span') {
        // 跨日期带时间的显示成「11/12 周四 14:00 – 11/13 周五 10:00」
        const from = this.chipDate(c.from) + (c.fromTime ? ' ' + c.fromTime : '');
        const to = this.chipDate(c.to) + (c.toTime ? ' ' + c.toTime : '');
        return from + ' – ' + to;
      }
      if (c.kind === 'time') return this.$t('editor.noDate') + ' · ' + c.time;
      if (c.kind === 'day') {
        const rel = c.rel ? this.$t('editor.rel_' + c.rel) + ' ' : '';
        return rel + this.chipDate(c.date) + ' · ' + (c.time || allDay);
      }
      return this.$t('editor.noDate');
    },
    // 「无日期」下的提示：说明保存后这条任务去哪。
    // 日记里的主任务，日期就是日记的文件名，去掉日期 = 搬到收件箱；
    // 收件箱、清单里的任务和子任务，日期写在行内，去掉后任务留在原处。
    noDateHint() {
      // 自用改版：在清单页的日记里新建时，「无日期」和日视图里一样进收件箱
      if (!this.editing) return this.$t(this.createIn && !this.createIn.journal ? 'editor.noDateNewList' : 'editor.noDateNewInbox');
      const key = String(this.task.date || '');
      const isSub = this.isSubtask || !!this.task.parentGuid;
      if (!isSub && /^\d{4}-\d{2}-\d{2}$/.test(key)) return this.$t('editor.noDateFromDaily', { date: key });
      return this.$t('editor.noDateKeep');
    },
    // 任务所在笔记的路径：渲染描述里的双链、图片时以它为起点（新建任务还没有所在笔记，留空）
    sourcePath() {
      const t = this.task;
      if (!t || !t.guid) return '';
      return t.file || taskFilePath(t.date) || '';
    },
    // 描述框所属的笔记（TFile）：内嵌编辑器解析链接、保存粘贴的附件、S3 上传插件读取笔记设置，都以它为准。
    // 编辑已有任务 = 任务所在的笔记；新建任务还没落盘，按它将要写入的位置依次找一篇已存在的笔记
    // （清单文件 → 当天日记 → 收件箱），都不存在时为 null（此时编辑器照常可用，只是没有所属笔记）
    contextFile() {
      const app = this.plugin && this.plugin.app;
      if (!app) return null;
      const byPath = (p) => {
        const f = p ? app.vault.getAbstractFileByPath(p) : null;
        return f instanceof TFile ? f : null;
      };
      if (this.sourcePath) return byPath(this.sourcePath);
      const keys = [];
      if (this.createIn && this.createIn.list) keys.push(this.createIn.list);
      if (this.defaultDate) keys.push(this.defaultDate);
      keys.push(INBOX_KEY);
      for (const k of keys) {
        const f = byPath(taskFilePath(k));
        if (f) return f;
      }
      return null;
    },
    // 优先级四档（高 / 中 / 低 / 无，从左到右），图标取自 obsidian-tasks 风格；默认「无」
    priorityOptions() {
      return [
        { level: 'high', icon: PRIORITY_ICON.high, label: this.$t('editor.prioHigh') },
        { level: 'medium', icon: PRIORITY_ICON.medium, label: this.$t('editor.prioMedium') },
        { level: 'low', icon: PRIORITY_ICON.low, label: this.$t('editor.prioLow') },
        { level: 'none', icon: '', label: this.$t('editor.prioNone') }
      ];
    }
  },
  watch: {
    // immediate：VueModal 桥挂载时 open 已为 true，必须立即初始化预填表单
    open: { handler(v) { if (v) this.init(); }, immediate: true }
  },
  methods: {
    blank() {
      return {
        // 标签栏：这台设备设了「使用者」（如 🌻）就预先放上它，保存前可以删掉或换成别的（自用改版）
        guid: '', title: '', description: '', links: [], tags: defaultTaskTags(),
        dueDate: this.defaultDate || '', dueTime: this.defaultTime || '',
        // 没有预设日期的新任务（收件箱、清单里新建）默认停在「无日期」（自用改版）；
        // 有预设日期的：带了时间（如双击时间轴空白格）是单个时间，没带就是全天——和滴答清单一样，时间要用再加
        timeMode: this.defaultDate ? (this.defaultTime ? 'single' : 'allday') : 'none', dueStart: this.defaultTime || '', dueEnd: '', startDate: '',
        scheduledDate: '',
        remind: true, completed: false, cancelled: false, cancelledAt: '',
        priority: this.defaultPriority || 'none'
      };
    },
    init() {
      this.error = '';
      this.saving = false;
      this.linkEditIndex = -1;
      this.addingTag = false;
      this.tagDraft = '';
      this.datePanelOpen = false;
      this.form = this.editing ? this.taskToForm(this.task) : this.blank();
      // 新建且未指定时间时，带出下一个准点/半点（结束=开始+30 分）
      this.ensureDefaultTimes();
      this.$nextTick(() => { if (this.$refs.sumInput) this.$refs.sumInput.focus(); });
    },
    // 标题只取纯文字，链接与标签拆成独立字段各自维护
    taskToForm(t) {
      let dueDate = '', dueTime = '', timeMode = 'single', dueStart = '', dueEnd = '', startDate = '';
      const sd = t.dueAt ? new Date(t.dueAt) : null;
      const ed = (t.dueEndAt && !t.dueAllDay) ? new Date(t.dueEndAt) : null;
      const startMs = (t.startAt != null) ? Number(t.startAt) : null;
      const cross = sd && startMs != null && ymd(new Date(startMs)) !== ymd(sd);
      if (cross) {
        timeMode = 'crossdate';
        startDate = ymd(new Date(startMs));
        dueDate = ymd(sd);
        // 自用改版：跨天又带时间的（如 11/12 14:00 到 11/13 10:00）：开始时间在开始那天，结束时间在结束那天
        if (!t.dueAllDay) {
          const s = new Date(startMs);
          dueStart = pad(s.getHours()) + ':' + pad(s.getMinutes());
          dueTime = dueStart;
          if (t.dueEndAt) {
            const e = new Date(t.dueEndAt);
            dueEnd = pad(e.getHours()) + ':' + pad(e.getMinutes());
          }
        }
      } else if (sd) {
        dueDate = ymd(sd);
        if (t.dueAllDay) {
          timeMode = 'allday';
        } else {
          dueTime = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
        }
      }
      if (ed && !cross) {
        timeMode = 'range';
        dueStart = pad(sd.getHours()) + ':' + pad(sd.getMinutes());
        dueEnd = pad(ed.getHours()) + ':' + pad(ed.getMinutes());
      }
      // 没有日期、但任务行开头写了时间（常见于日记里的子任务，如「09:00 查房」）：
      // 把这个时间带进表单，免得之后一设日期，原来的时间就被默认时间顶掉（自用改版）
      if (!sd && t.time) {
        dueTime = t.time;
        dueStart = t.time;
        if (t.timeEnd) { timeMode = 'range'; dueEnd = t.timeEnd; }
      }
      // 既没有日期也没有时间：打开时停在「无日期」（自用改版）
      if (!sd && !t.time) timeMode = 'none';
      const parts = splitSummary(t.summary);
      return {
        guid: t.guid,
        title: parts.title,
        description: t.description || '',
        links: parts.links.slice(),
        tags: parts.tags.slice(),
        dueDate, dueTime, timeMode, dueStart, dueEnd, startDate,
        scheduledDate: t.scheduledAt ? ymd(new Date(t.scheduledAt)) : '',
        remind: t.remind !== false,
        completed: !!t.completed,
        cancelled: !!t.cancelled,
        cancelledAt: t.cancelledAt || '',
        priority: priorityToLevel(t.priority)
      };
    },
    // 下一个准点或半点：向上取整到 30 分钟边界（如 09:12 → 09:30，09:40 → 10:00）
    nextHalfHour() {
      const now = new Date();
      const total = now.getHours() * 60 + now.getMinutes();
      let next = Math.ceil(total / 30) * 30;
      if (next >= 1440) next = 1410; // 封顶 23:30
      const hh = Math.floor(next / 60), mm = next % 60;
      return {
        start: pad(hh) + ':' + pad(mm),
        end: pad(Math.floor((next + 30) / 60) % 24) + ':' + pad((next + 30) % 60)
      };
    },
    // HH:mm 加 add 分钟，按天取模
    addMinutes(hhmm, add) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
      let total = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
      total = (total + add) % (24 * 60);
      return pad(Math.floor(total / 60)) + ':' + pad(total % 60);
    },
    // HH:mm → 当日分钟数；非法返回默认 9:00
    toMin(hhmm) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
    },
    // 把 HH:mm 向上取整到「下一个整点 / 半点」边界（如 09:12→09:30，09:40→10:00）
    ceilHalfHour(hhmm) {
      const total = this.toMin(hhmm);
      let next = Math.ceil(total / 30) * 30;
      if (next >= 1440) next = 1410; // 封顶 23:30
      return pad(Math.floor(next / 60)) + ':' + pad(next % 60);
    },
    // 未指定时间时，按模式带出默认值（单时间→下一个半点；时间段→开始为下一个半点、结束+30 分）
    ensureDefaultTimes() {
      if (this.isAllDay || this.isNoDate) return;
      if (this.form.timeMode === 'crossdate') {
        if (!this.form.startDate) this.form.startDate = this.form.dueDate || '';
        return;
      }
      if (this.form.timeMode === 'range') {
        if (!this.form.dueStart) {
          const d = this.nextHalfHour();
          this.form.dueStart = this.form.dueTime || d.start;
          this.form.dueEnd = this.form.dueEnd || d.end;
        }
      } else if (!this.form.dueTime) {
        this.form.dueTime = this.form.dueStart || this.nextHalfHour().start;
      }
    },
    // ---------- 日期胶囊和日期面板（自用改版，仿滴答清单） ----------
    // 胶囊上的日期：「11/11 周三」；不是今年的，前面加年份（「2027/1/5 周二」）
    chipDate(ymdStr) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr || '');
      if (!m) return ymdStr || '';
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const md = (d.getMonth() + 1) + '/' + d.getDate();
      const text = d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
      const wd = weekdayLong(d);
      return wd ? text + ' ' + wd : text;
    },
    // 点胶囊：展开 / 收起日期面板（收起 = 不要面板里改的）
    toggleDatePanel() { this.datePanelOpen = !this.datePanelOpen; },
    // 面板点了「确定」：把面板换算好的字段填回表单
    applyDatePanel(patch) {
      Object.assign(this.form, patch);
      this.datePanelOpen = false;
      this.error = '';
    },
    // 面板点了「清除」：不要日期，和原来的「无日期」一样（保存时日期、时间都去掉）。
    // 表单里原来的日期不清空，再打开面板时从「什么都没选」开始
    clearDatePanel() {
      this.form.timeMode = 'none';
      this.datePanelOpen = false;
      this.error = '';
    },
    // 构造时间戳：单时间只给开始；时间段额外给结束；全天只给当日 00:00
    buildDueAt() {
      // 无日期（自用改版）：日期、结束时间、开始日一律清空
      if (this.isNoDate) return { dueAt: null, dueEndAt: null, startAt: '' };
      if (!this.form.dueDate) return { dueAt: null, dueEndAt: null };
      const date = this.form.dueDate;
      if (this.isAllDay) return { dueAt: new Date(date + 'T00:00:00').getTime(), dueEndAt: null };
      if (this.isCrossDate) {
        const end = this.form.dueDate;
        const s = this.form.startDate;
        // 自用改版：跨天又带时间：开始 = 开始那天 + 开始时间，结束 = 结束那天 + 结束时间（结束时间可不填）。
        // dueAt 取「结束那天 + 开始时间」：清单、收件箱里的任务，数据层从 dueAt 取行首写的开始时间
        const st = this.form.dueStart;
        if (st && s && end && s < end) {
          const et = this.form.dueEnd;
          return {
            dueAt: new Date(end + 'T' + st).getTime(),
            dueEndAt: et ? new Date(end + 'T' + et).getTime() : null,
            startAt: new Date(s + 'T' + st).getTime(),
            dueAllDay: false
          };
        }
        const dueAt = end ? new Date(end + 'T00:00:00').getTime() : null;
        // 开始日不得晚于结束日，否则回退为与结束日相同的单日
        const startAt = (s && end && s <= end)
          ? new Date(s + 'T00:00:00').getTime()
          : dueAt;
        return { dueAt, dueEndAt: null, startAt, dueAllDay: true };
      }
      let start, end = null;
      if (this.form.timeMode === 'range') {
        start = this.form.dueStart || this.nextHalfHour().start;
        end = this.form.dueEnd || this.addMinutes(start, 30);
      } else {
        start = this.form.dueTime || this.nextHalfHour().start;
      }
      const dueAt = new Date(date + 'T' + start).getTime();
      const dueEndAt = end ? new Date(date + 'T' + end).getTime() : null;
      return { dueAt, dueEndAt };
    },
    // opts.cancelled 存在时同时写入取消态（「取消任务/恢复任务」按钮直达）
    async save(opts) {
      // keydown 阶段触发，长按回车会连发：saving 锁防重复创建
      if (this.saving) return;
      const title = (this.form.title || '').trim();
      if (!title) return;
      // 自用改版：日期面板还开着就点了保存——按面板上此刻选的保存（面板里填错了就提示，先不保存）
      if (this.datePanelOpen && this.$refs.datePanel) {
        const r = this.$refs.datePanel.result();
        if (r.error) { this.error = this.$t(r.error); return; }
        this.applyDatePanel(r.patch);
      }
      // 时间段：结束须晚于开始，否则提示并阻止保存（不再静默吸附，避免改期被悄悄改写）
      if (this.form.timeMode === 'range' && this.form.dueStart && this.form.dueEnd
          && this.toMin(this.form.dueEnd) <= this.toMin(this.form.dueStart)) {
        this.error = this.$t('editor.endAfterStart');
        return;
      }
      this.saving = true; this.error = '';
      const built = this.buildDueAt();
      const { dueAt, dueEndAt, startAt } = built;
      const payload = {
        // 存盘时还原为完整 Markdown：标题 | [链接](地址) | #标签（提醒关闭时追加 🔕 标记）
        summary: composeSummary(title, this.form.links, this.form.tags, { mute: !this.form.remind }),
        description: this.form.description || '',
        dueAt,
        dueEndAt,
        startAt,
        // 无日期也按「全天」传：数据层据此把行首的时间（如「09:00」）一并去掉。
        // 自用改版：跨日期默认全天，带了时间的（buildDueAt 返回 dueAllDay: false）除外
        dueAllDay: built.dueAllDay === false ? false : (this.isAllDay || this.isCrossDate || this.isNoDate),
        priority: levelToPriorityEmoji(this.form.priority),
        // 计划日期（⏳）：仅在「启用计划时间」时随 payload 传出（未传 = 数据层保持不动）
        ...(this.showScheduled ? { scheduledDate: this.form.scheduledDate || '' } : {})
      };
      if (this.editing) {
        payload.completed = this.form.completed;
        payload.cancelled = (opts && opts.cancelled !== undefined) ? opts.cancelled : this.form.cancelled;
      }
      try {
        const saved = this.editing
          ? await Tasks.updateTask(this.form.guid, payload)
          : (this.createIn
              ? await Tasks.createChecklistTask(this.createIn.list, this.createIn.group, payload)
              : await Tasks.createTask(payload));
        // 自用改版：新建的任务不在当前「按标签筛选」里（比如正筛着某个标签而它没带）时提示一句，免得以为没加上
        if (!this.editing) {
          const match = getTaskMatcher();
          if (match && !match({ tags: this.form.tags })) new Notice(this.$t('app.filterHidesNew'));
        }
        this.$emit('saved', saved);
        this.close();
      } catch (e) {
        this.error = (this.editing ? this.$t('app.saveFail') : this.$t('app.createFail')) + (e && e.message || e);
      } finally {
        this.saving = false;
      }
    },
    // 取消任务 / 恢复任务：一键写回当前表单内容并切换取消态，成功后关闭弹窗
    cancelTask() {
      if (this.saving) return;
      this.form.cancelled = !this.form.cancelled;
      this.save({ cancelled: this.form.cancelled });
    },
    // 完成 / 标记未完成：一键写回并切换完成态（✅ 自动记录当天日期），成功后关闭弹窗
    completeTask() {
      if (this.saving) return;
      this.form.completed = !this.form.completed;
      if (this.form.completed) this.form.cancelled = false; // 完成视为恢复，清除取消态
      this.save({ completed: this.form.completed });
    },
    remove() {
      if (!this.form.guid || this.saving) return;
      new ConfirmModal(this.plugin ? this.plugin.app : null, {
        title: this.$t('editor.delTitle'),
        message: this.$t('editor.delMsg', { name: this.form.title || this.$t('editor.thatTask') }),
        confirmText: this.$t('common.delete'),
        danger: true,
        onConfirm: () => this.doRemove()
      }).open();
    },
    async doRemove() {
      this.saving = true;
      try {
        await Tasks.deleteTask(this.form.guid);
        this.$emit('deleted', this.form.guid);
        this.close();
      } catch (e) {
        this.error = this.$t('app.delFail') + (e && e.message || e);
      } finally {
        this.saving = false;
      }
    },
    /* ---------- 子任务：点开后在当前窗口上面再开一个同样的编辑窗口（自用改版） ---------- */
    openSubtask(sub) {
      if (!sub || !this.plugin) return;
      // 子任务窗口里做的任何改动（保存、删除、增删它自己的子任务）都可能让文件里的行号变化，
      // 所以它一有动静，就重新读一遍本窗口的子任务列表，并通知外层视图刷新
      const refresh = () => {
        const list = this.$refs.subList;
        if (list && typeof list.load === 'function') list.load();
        this.$emit('subtasks-changed');
      };
      // this.$.type 就是本组件自身的定义：子任务用同一个编辑窗口，所以它也能再有自己的子任务
      new VueModal(this.plugin.app, this.$.type, {
        open: true,
        task: sub,
        plugin: this.plugin,
        isSubtask: true,
        parentTitle: (this.form.title || '').trim(),
        onSaved: refresh,
        onDeleted: refresh,
        onSubtasksChanged: refresh
      }).open();
    },
    /* ---------- 打开任务所在的笔记，并高亮定位到任务所在行 ---------- */
    async openFile() {
      await openTaskInFile(this.plugin, this.task);
      this.close();
    },
    /* ---------- 链接（原生弹窗；index < 0 表示新增） ---------- */
    openLinkEditor(index) {
      const links = this.form.links;
      new LinkFormModal(this.plugin ? this.plugin.app : null, {
        link: index >= 0 ? (links[index] || null) : null,
        onSave: (item) => {
          // Vue3：直接赋值（Proxy 响应式）
          if (index >= 0) links[index] = item;
          else links.push(item);
        },
        onDelete: () => {
          if (index >= 0) links.splice(index, 1);
        }
      }).open();
    },

    /* ---------- 标签（含智能提示，issue #22） ---------- */
    async startAddTag() {
      this.addingTag = true;
      this.tagDraft = '';
      this.sugOpen = false;
      this.sugIdx = -1;
      this.$nextTick(() => { const el = this.$refs.tagInput; if (el) el.focus(); });
      // 异步拉取全库历史标签（collectTags 有缓存，写路径后自动重建）
      try {
        const list = await Tasks.collectTags();
        if (!this.addingTag) return; // 期间输入框已关闭
        this.tagSugs = Array.isArray(list) ? list : [];
        this.refreshSugs();
      } catch (e) { console.warn('[ChaoChaoList] collectTags failed:', e); }
    },
    // 按当前草稿过滤历史标签：包含匹配；排除本任务已添加的；空草稿 = 展示频次最高的前 8 个
    refreshSugs() {
      const q = sanitizeTag(this.tagDraft).toLowerCase();
      const taken = this.form.tags;
      const filtered = (this.tagSugs || []).filter((s) =>
        taken.indexOf(s.name) < 0 && (!q || s.name.toLowerCase().indexOf(q) >= 0));
      this.sugList = filtered.slice(0, 8);
      this.sugIdx = -1;
      this.sugOpen = this.sugList.length > 0;
    },
    // 采纳建议：加入标签后清空草稿并刷新面板（面板保持打开，可继续连选）
    adoptSug(name) {
      if (this.form.tags.indexOf(name) < 0) this.form.tags.push(name);
      this.tagDraft = '';
      this.refreshSugs();
      this.$nextTick(() => { const el = this.$refs.tagInput; if (el) el.focus(); });
    },
    onTagNav(e, d) {
      if (isImeKey(e) || !this.sugOpen || !this.sugList.length) return;
      const n = this.sugList.length;
      this.sugIdx = ((this.sugIdx < 0 ? (d > 0 ? -1 : 0) : this.sugIdx) + d + n) % n;
      e.preventDefault();
    },
    cancelAddTag() {
      this.addingTag = false;
      this.tagDraft = '';
      this.sugOpen = false;
    },
    commitTag() {
      if (!this.addingTag) return;
      const name = sanitizeTag(this.tagDraft);
      if (name && this.form.tags.indexOf(name) < 0) this.form.tags.push(name);
      this.addingTag = false;
      this.tagDraft = '';
      this.sugOpen = false;
    },
    // 标签胶囊配色（issue #8）：已配置颜色 → 浅底 .28 + 同色边框，文字 --ink；未配置走默认样式
    chipStyle(tag) {
      const c = validHex((this.plugin && this.plugin.settings && this.plugin.settings.tagColors || {})[tag]);
      return c ? { background: withAlpha(c, 0.28), borderColor: c, color: 'var(--ink)' } : null;
    },
    // 标签提示列表行尾圆点：已配置实色底（未配置不渲染）
    sugDotStyle(name) {
      const c = validHex((this.plugin && this.plugin.settings && this.plugin.settings.tagColors || {})[name]);
      return c ? { background: c, borderColor: 'transparent' } : null;
    },
    removeTag(i) {
      this.form.tags.splice(i, 1);
    },
    /* ---------- 键盘：输入法组字期间的回车 / esc 不算快捷键 ---------- */
    // 标题回车 = 保存；中文输入法按回车是「上屏候选词」，那一下必须放行
    onTitleEnter(e) {
      if (isImeKey(e)) return;
      this.save();
    },
    onTagEnter(e) {
      if (isImeKey(e)) return;
      // 面板打开时回车 = 采纳高亮项（未高亮则取第一项），面板关闭才走原本的提交
      if (this.sugOpen && this.sugList.length) {
        this.adoptSug(this.sugList[this.sugIdx >= 0 ? this.sugIdx : 0].name);
        return;
      }
      this.commitTag();
    },
    onTagEsc(e) {
      if (isImeKey(e)) return;
      // Esc 两段式：先关建议面板，再取消输入
      if (this.sugOpen) { this.sugOpen = false; return; }
      this.cancelAddTag();
    },
    close() { this.$emit('update:open', false); }
  }
};
</script>

<style scoped>
/* 表单原语（.tk-field/.btn 等）在全局弹窗样式 task-modal.css 中 */
/* 提权到 .tk-modal：避免被 tasks-shared.css 的 .task-app .tk-check（20px 字号 + 18px 宽高）覆盖 */
.tk-modal .tk-check { display: flex; align-items: center; gap: 7px; width: 100%; height: auto; font-size: 13px; line-height: 1.6; color: var(--ink-soft); margin: 2px 0 16px; cursor: pointer; }
/* 时间区：日期胶囊 + 展开的日期面板，纵向排布 */
.tk-time-block { display: flex; flex-direction: column; gap: 10px; margin: 2px 0 16px; }
.tk-time-block .tk-check { margin: 0; }
/* 日期胶囊（自用改版，仿滴答清单）：显示当前设的日期、时间，点开日期面板 */
.tk-date-chip {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
  height: auto; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; box-shadow: none;
  background: var(--panel); color: var(--gold); font-family: inherit; font-size: 14px; line-height: 1.4; cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.tk-date-chip:hover, .tk-date-chip.is-open { background: var(--gold-bg); border-color: var(--gold); }
.tk-date-chip.is-empty { color: var(--ink-soft); }
.tk-date-chip:disabled { opacity: .5; cursor: default; }
.tk-date-chip-text { font-variant-numeric: tabular-nums; }
.tk-date-chip-caret { color: var(--ink-soft); transition: transform .15s ease; }
.tk-date-chip.is-open .tk-date-chip-caret { transform: rotate(180deg); }
/* 「无日期」下的说明文字（自用改版） */
.tk-nodate-hint { font-size: 13px; line-height: 1.5; color: var(--ink-soft); padding: 2px 2px 0; }
.tk-ic { font-size: 14px; color: var(--ink-soft); }
.tk-ic.la-check-circle-o { color: var(--gold); }
/* 子任务窗口标题下方的「属于：xxx」（自用改版） */
.tk-sub-of { margin: -8px 0 14px; font-size: 12px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 字段名后面的小字提示，如描述旁的「支持 Markdown」 */
.tk-field-hint { margin-left: 8px; font-style: normal; font-size: 12px; opacity: .75; }
.tk-sub { margin: 4px 0 16px; padding-top: 14px; border-top: 1px dashed var(--line); }
.tk-sub-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }

/* 标题下方的链接 / 标签行 */
.tk-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 10px; }
.tk-links-label { flex: none; width: 28px; font-size: 12px; color: var(--ink-soft); }

/* 行末「+ 新增」小圆钮（提权同上，避免被 tasks-shared.css 覆盖尺寸） */
.tk-modal .tk-add-mini {
  flex: none; width: 22px; height: 22px; border: 1px dashed var(--line); border-radius: 50%;
  background: transparent; color: var(--ink-soft); font-size: 11px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.tk-add-mini:hover { background: var(--gold-bg); color: var(--gold); border-color: var(--gold); }

/* 标签胶囊：× 删除；已配置颜色的标签由 chipStyle 内联浅底+同色边框覆盖，未配置走默认描边 */
.tk-tag-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 2px 1px 10px; border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--tag-bg);
  color: var(--tag-ink);
  font-size: 12px; line-height: 20px;
}
.tk-tag-text { white-space: nowrap; }
.tk-tag-del {
  flex: none; width: 18px; height: 18px; border: none; border-radius: 50%;
  background: transparent; color: inherit; font-size: 10px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  opacity: .6; transition: opacity .15s ease, background .15s ease;
}
.tk-tag-del:hover { opacity: 1; background: var(--background-modifier-hover); }
.tk-tag-chip.is-editing { padding: 1px 8px; position: relative; }
/* 标签智能提示面板（issue #22）：锚定输入胶囊下方，历史标签按频次倒序 */
.tk-tag-sugs {
  position: absolute; top: calc(100% + 4px); left: 0; min-width: 160px; max-height: 180px;
  overflow: auto; z-index: 30; padding: 4px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .15);
}
.tk-tag-sug {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: 5px; font-size: 12px; color: var(--ink); cursor: pointer;
}
.tk-tag-sug.active, .tk-tag-sug:hover { background: var(--hover); }
/* 行尾颜色圆点（issue #8）：已配置才渲染，实色底（sugDotStyle 内联覆盖） */
.tk-tag-sug-dot {
  flex: none; width: 10px; height: 10px; border-radius: 50%;
  border: 1px solid transparent; background: transparent; box-sizing: border-box;
}
.tk-tag-sug .tk-tag-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-tag-sug-n { flex: none; font-size: 10px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.tk-tag-input {
  width: 88px; border: none; background: transparent; padding: 0;
  font: inherit; font-size: 12px; color: inherit; box-shadow: none;
}
.tk-tag-input:focus { outline: none; box-shadow: none; }
.tk-tag-input::placeholder { color: var(--ink-soft); }
.tk-link-chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%;
  padding: 1px 2px 1px 10px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
}
.tk-link-chip-text {
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--gold); font-size: 13px;
  text-decoration: underline; text-underline-offset: 2px;
}
.tk-link-edit {
  flex: none; width: 22px; height: 22px; border: none; border-radius: 50%;
  background: transparent; color: var(--ink-soft); font-size: 11px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease;
}
.tk-link-edit:hover { background: var(--gold-bg); color: var(--gold); }
</style>
