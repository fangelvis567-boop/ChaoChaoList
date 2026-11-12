<template>
  <div class="tk-clview">
    <!-- 左侧：清单列表（固定 260px） -->
    <aside class="tk-cl-side">
      <div class="tk-cl-side-h"><i class="la la-tasks"></i><span>{{ $t('app.viewCl') }}</span></div>
      <!-- 自用改版：没有任务的日记不算清单；只剩这种日记时，按「还没有清单」提示 -->
      <div v-if="!listedLists.length" class="tk-cl-side-empty">{{ $t('app.clSideEmpty') }}</div>
      <!-- 自用改版：清单都已完成、又开着「隐藏已完成」时，左侧给一句提示，不至于一片空白 -->
      <div v-else-if="!sideRows.length" class="tk-cl-side-empty">{{ $t('app.clAllDoneHidden') }}</div>
      <div v-else class="tk-cl-list">
        <template v-for="c in sideRows" :key="c.key">
          <!-- 自用改版：「日记」组排在主题清单后面，前面一行组名；点组名收起 / 展开整组，状态记在本机 -->
          <div v-if="c.isSec" class="tk-cl-sec" role="button" tabindex="0"
               :aria-expanded="journalFolded ? 'false' : 'true'"
               @click="toggleJournalFold"
               @keydown.enter.prevent="toggleJournalFold"
               @keydown.space.prevent="toggleJournalFold">
            <i class="la la-chevron-right tk-cl-sec-caret" :class="{ open: !journalFolded }"></i>
            <span>{{ $t('app.clJournalGroup') }}</span>
            <span class="cnt">{{ c.count }}</span>
          </div>
          <div v-else class="tk-cl-item" :data-href="taskFilePath(c.key) || ''">
            <div class="tk-cl-item-main" :class="{ on: c.key === activeKey }"
                 role="button" tabindex="0"
                 @click="selectList(c.key)"
                 @keydown.enter.prevent="selectList(c.key)"
                 @keydown.space.prevent="selectList(c.key)">
              <div class="tk-cl-name">{{ c.name }}</div>
              <div class="tk-cl-bar"><i :style="{ width: pct(c) + '%' }"></i></div>
              <div class="tk-cl-meta">{{ $t('app.clProgressPct', { done: c.done, total: c.total, pct: pct(c) }) }}</div>
            </div>
            <button class="tk-cl-open" type="button" :title="$t('app.openChecklistFile')" @click.stop="openFile(c.key)">
              <i class="la la-external-link"></i>
            </button>
          </div>
        </template>
      </div>
    </aside>

    <!-- 右侧：选中清单的任务（按 ### 标题分组） -->
    <section class="tk-cl-main">
      <div v-if="!activeKey" class="tk-cl-empty-main">{{ $t('app.clPickSide') }}</div>
      <template v-else>
        <header class="tk-cl-main-h">
          <div class="tk-cl-head-l">
            <div class="tk-cl-title">{{ activeName }}</div>
            <div class="tk-cl-prog">{{ $t('app.clProgress', { done: activeDone, total: activeTotal }) }}</div>
          </div>
        </header>

        <div v-if="loading" class="tk-cl-loading">{{ $t('app.loading') }}</div>
        <div v-else-if="error" class="tk-err">{{ error }}</div>
        <template v-else>
          <!-- 列表视图：分组纵向堆叠（默认，保留原样式） -->
          <div v-if="mainView === 'list'" class="tk-cl-body">
            <div v-if="!visibleGroups.length" class="tk-cl-none">{{ $t('app.clEmpty') }}</div>
            <div v-for="g in visibleGroups" :key="gKey(g)" class="tk-cl-group"
                 :class="{ 'tk-cl-drophover': dragOverTitle === g.title }"
                 @dragover.prevent="onDragOver($event, g.title)" @drop="onDrop($event, g.title)">
              <div class="tk-cl-gtitle" :class="{ 'is-plain': !g.title }">
                <template v-if="g.title">
                  <span class="tk-cl-gtxt">{{ g.title }}</span><span class="tk-cl-gcnt">{{ g.count }}</span>
                </template>
                <span v-else class="tk-cl-gplain">{{ $t('app.ungrouped') }}</span>
                <button class="tk-add cl-gadd" type="button" :title="$t('app.addTaskToGroup')" @click="openAdd(g)">
                  <i class="la la-plus-circle"></i>
                </button>
              </div>
              <transition-group class="tk-cl-rows" tag="div" name="tk-clmove">
                <div v-for="t in g.tasks" :key="t.guid" class="tk-cl-row"
                     :class="{ done: t.completed, cancel: t.cancelled, 'is-sub': t.depth > 0 }" :style="{ '--cl-depth': t.depth || 0 }" @click="onTaskClick(t, $event)" :title="$t('app.rowJumpTip')"
                     draggable="true" @dragstart="onDragStart($event, t)" @dragend="onDragEnd"
                     @contextmenu.prevent="onContextMenu(t, $event)">
                  <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]"
                     @click.stop.prevent="onToggle(t)"></i>
                  <div class="tk-cl-row-main">
                    <div class="tk-cl-sumrow">
                      <div class="tk-cl-sum" v-html="renderInlineHtml(t && t.summary)" @click="onRichClick"></div>
                      <span v-if="t.scheduledAt" class="tk-sched" v-tooltip="scheduledText(t)">{{ scheduledText(t) }}</span>
                    </div>
                    <div v-if="t.description" class="tk-cl-desc">{{ firstLine(t.description) }}</div>
                  </div>
                  <!-- 自用改版：有子任务的显示子任务进度（如 1/3）和收起按钮，和列表视图一样 -->
                  <sub-progress v-if="hasSubs(t)" :task="t" class="tk-cl-subprog" />
                  <button v-if="showFold(t)" class="tk-subfold tk-cl-subfold" :class="{ 'is-folded': isFolded(t) }" type="button"
                          v-tooltip="isFolded(t) ? $t('app.subUnfold') : $t('app.subFold')" @click.stop="toggleFold(t)"><i class="la la-angle-down"></i></button>
                  <span v-if="t.dueAt && (!sameJournalDay(t) || (timeText(t) && !t.dueAllDay))" class="tk-cl-date"><template v-if="!sameJournalDay(t)"><i class="tk-date-ico la la-calendar"></i>{{ dateText(t) }}</template><template v-if="timeText(t) && !t.dueAllDay"><i class="tk-date-ico tk-date-ico-sep la la-clock"></i>{{ timeText(t) }}</template></span>
                </div>
                <div v-if="!g.tasks.length" key="__empty" class="tk-cl-gempty">{{ $t('app.noTasks') }}</div>
              </transition-group>
            </div>
          </div>

          <!-- 分栏视图：每个分组一栏，固定宽度，多栏时横向滚动 -->
          <div v-else class="tk-cl-cols">
            <div v-if="!visibleGroups.length" class="tk-cl-none">{{ $t('app.clEmpty') }}</div>
            <div v-for="g in visibleGroups" :key="gKey(g)" class="tk-cl-col"
                 :class="{ 'tk-cl-drophover': dragOverTitle === g.title }"
                 @dragover.prevent="onDragOver($event, g.title)" @drop="onDrop($event, g.title)">
            <div class="tk-cl-gtitle" :class="{ 'is-plain': !g.title }">
              <template v-if="g.title">
                <span class="tk-cl-gtxt">{{ g.title }}</span><span class="tk-cl-gcnt">{{ g.count }}</span>
              </template>
              <span v-else class="tk-cl-gplain">{{ $t('app.ungrouped') }}</span>
              <button class="tk-add cl-gadd" type="button" :title="$t('app.addTaskToGroup')" @click="openAdd(g)">
                <i class="la la-plus-circle"></i>
              </button>
            </div>
            <transition-group class="tk-cl-rows" tag="div" name="tk-clmove">
              <div v-for="t in g.tasks" :key="t.guid" class="tk-cl-row"
                   :class="{ done: t.completed, cancel: t.cancelled, 'is-sub': t.depth > 0 }" :style="{ '--cl-depth': t.depth || 0 }" @click="onTaskClick(t, $event)"
                   :title="$t('app.rowJumpTip')"
                   draggable="true" @dragstart="onDragStart($event, t)" @dragend="onDragEnd"
                   @contextmenu.prevent="onContextMenu(t, $event)">
                <i class="tk-check" :class="[{ done: t.completed }, statusIcon(t)]"
                   @click.stop.prevent="onToggle(t)"></i>
                <div class="tk-cl-row-main">
                  <div class="tk-cl-sumrow">
                    <div class="tk-cl-sum" v-html="renderInlineHtml(t && t.summary)" @click="onRichClick"></div>
                    <span v-if="t.scheduledAt" class="tk-sched" v-tooltip="scheduledText(t)">{{ scheduledText(t) }}</span>
                  </div>
                  <div v-if="t.description" class="tk-cl-desc">{{ firstLine(t.description) }}</div>
                  <span v-if="t.dueAt && (!sameJournalDay(t) || (timeText(t) && !t.dueAllDay))" class="tk-cl-date tk-cl-date-sub"><template v-if="!sameJournalDay(t)"><i class="tk-date-ico la la-calendar"></i>{{ dateText(t) }}</template><template v-if="timeText(t) && !t.dueAllDay"><i class="tk-date-ico tk-date-ico-sep la la-clock"></i>{{ timeText(t) }}</template></span>
                </div>
                <!-- 自用改版：有子任务的显示子任务进度（如 1/3）和收起按钮，和列表视图一样 -->
                <sub-progress v-if="hasSubs(t)" :task="t" class="tk-cl-subprog" />
                <button v-if="showFold(t)" class="tk-subfold tk-cl-subfold" :class="{ 'is-folded': isFolded(t) }" type="button"
                        v-tooltip="isFolded(t) ? $t('app.subUnfold') : $t('app.subFold')" @click.stop="toggleFold(t)"><i class="la la-angle-down"></i></button>
              </div>
              <div v-if="!g.tasks.length" key="__empty" class="tk-cl-gempty">{{ $t('app.noTasks') }}</div>
            </transition-group>
            </div>
          </div>
        </template>
      </template>
    </section>

    <!-- 任务行右键菜单（统一单例组件，teleport 到 body；与日/周/月/日程视图共用） -->
    <task-context-menu />
  </div>
</template>

<script>
import { Tasks } from '../../composables/useTasks.js';
import { taskFilePath } from '../../api/tasks.js';
import { statusIcon, dateText, timeText, richSummaryNoTags, renderInlineHtml, scheduledText, descPreview, todayKey } from '../../composables/tasks-logic.js';
import { getClJournalFoldedPref, setClJournalFoldedPref } from '../../composables/viewPrefs.js';
// 自用改版：子任务挂在主任务下面显示（排行规则见 checklistRows.js）；进度小标、收起状态与列表视图共用
import { buildChecklistRows, hasVisibleSubtasks } from '../../composables/checklistRows.js';
import { hasSubtasks, isSubFolded, toggleSubFold } from '../../composables/subtasks.js';
import SubProgress from './SubProgress.vue';
import { VueModal } from '../../ui/VueModal.js';
import TaskEditorModal from '../TaskEditorModal.vue';
import { openTaskInFile } from '../../utils/openTaskInFile.js';
import { openCtxMenu } from '../../composables/useTaskCtxMenu.js';
import TaskContextMenu from './TaskContextMenu.vue';

export default {
  name: 'ChecklistView',
  props: {
    plugin: { type: Object, required: true },
    checklists: { type: Array, default: () => [] },
    // 清单主区视图：列表 / 分栏（由父 TasksApp 提升上来并持久化）
    mainView: { type: String, default: 'cols' },
    // 与日/周/月/日程共享的「仅显示待办」开关（由 TasksApp 的 hideDone 传入）
    hideDone: { type: Boolean, default: false }
  },
  components: { TaskContextMenu, SubProgress },
  data() {
    return {
      lists: [],
      activeKey: '',
      activeName: '',
      groups: [],
      activeTotal: 0,
      activeDone: 0,
      loading: false,
      error: '',
      dragGuid: '',        // 正在拖拽的任务 guid
      dragOverTitle: '',   // 当前拖拽悬停的分组标题（用于高亮）
      journalFolded: getClJournalFoldedPref(), // 自用改版：左侧「日记」组是否收起（记在本机，默认展开）
    };
  },
  computed: {
    // 每组要显示的任务行（自用改版：子任务挂在主任务下面，排法和「隐藏已完成」的规则见 checklistRows.js）。
    // tasks = 按显示顺序排好的任务行；count = 组名旁的任务数。开着「隐藏已完成」时，去掉一条都不剩的组
    visibleGroups() {
      const isFolded = (t) => this.isFolded(t);
      const out = this.groups.map((g) => {
        const r = buildChecklistRows(g.tasks, { hideDone: this.hideDone, isFolded });
        return { title: g.title, tasks: r.rows, count: r.count };
      });
      return this.hideDone ? out.filter((g) => g.tasks.length) : out;
    },
    // 当前选中的清单 / 日记在库里的路径（收起状态按「文件 + 任务文字」记，要和列表视图记的对得上）
    activeFile() {
      return (this.activeKey && taskFilePath(this.activeKey)) || '';
    },
    // 自用改版：能出现在左侧的卡片。没有任务的日记（0 / 0）不列出来，「日记」组只收有任务的那几天；
    // 正在看的那张除外（比如刚在右侧删掉它最后一条任务），免得右侧内容突然被换掉。
    // 主题清单哪怕还没有任务也照常列出——新建的清单要能点进去加任务。
    listedLists() {
      return this.lists.filter((c) => !(c.journal && !c.total) || c.key === this.activeKey);
    },
    // 自用改版：左侧实际显示的行：主题清单 → 「日记」组名 → 日记卡片（组收起时不列卡片）。
    // 「隐藏已完成」开着时，进度 100% 的卡片也藏起来；正在看的那张除外，免得勾完最后一条时选中项突然消失。
    // 还没有任务的主题清单（0 / 0）不算完成，照常显示。组名后的数字是此刻露出来的日记篇数，
    // 一篇都不露时连组名也不显示。
    // 组名行用 isSec 标记，其余行就是清单条目本身（和 lists 共用同一批对象，进度同步不受影响）。
    sideRows() {
      const hidden = (c) => this.hideDone && c.total > 0 && c.done >= c.total && c.key !== this.activeKey;
      const rows = this.listedLists.filter((c) => !c.journal && !hidden(c));
      const shown = this.listedLists.filter((c) => c.journal && !hidden(c));
      if (shown.length) {
        rows.push({ key: '__journal_sec', isSec: true, count: shown.length });
        if (!this.journalFolded) rows.push(...shown);
      }
      return rows;
    },
    // 自用改版：当前选中的是日记（「日记」组，或打了清单标记的日记）时，返回那天的日期键；否则空串
    activeJournalDate() {
      const c = this.lists.find((x) => x.key === this.activeKey);
      return (c && c.date) || '';
    },
  },
  watch: {
    // 清单列表随父级自动刷新（外部改 tags / 增删清单文件触发重载）后同步本地副本。
    // 之前只 created 时拷贝一次，导致改 tags 后侧栏不刷新，需切视图才更新。
    checklists: {
      immediate: true,
      async handler(cls) {
        const prevKey = this.activeKey;
        this.lists = (cls && cls.length) ? cls.slice() : [];
        // 自用改版：左侧第一张露出来的卡片（进度 100% 被藏的、没有任务的日记、收起的「日记」组里的都跳过）。
        // 一张都没露出来时就先不选——硬选一张藏着的，它会因为「正在看的那张不藏」又冒出来。
        const first = this.sideRows.find((r) => !r.isSec);
        if (prevKey && this.lists.some((x) => x.key === prevKey)) {
          // 当前选中项仍在：保留选中、同步名称，并重读当前清单的分组——
          // 右侧 groups / 统计是 loadGroups 读文件得到的本地数据，不随 lists 引用自动更新；
          // 缺这一步会导致手动改笔记后左侧刷新而右侧滞留旧数据
          const c = this.lists.find((x) => x.key === prevKey);
          if (c) this.activeName = c.name;
          await this.loadGroups(prevKey);
        } else if (first) {
          await this.selectList(first.key);
        } else {
          this.activeKey = '';
          this.activeName = '';
          this.groups = [];
          this.activeTotal = 0;
          this.activeDone = 0;
        }
      }
    }
  },
  methods: {
    statusIcon, richSummaryNoTags, renderInlineHtml, dateText, timeText, taskFilePath, scheduledText,
    pct(c) { return c.total ? Math.round((c.done / c.total) * 100) : 0; },
    // 自用改版：点「日记」组名收起 / 展开整组，并记在本机
    toggleJournalFold() {
      this.journalFolded = !this.journalFolded;
      setClJournalFoldedPref(this.journalFolded);
    },
    // 自用改版：日记卡片里，日期就是这篇日记那天的任务不再重复显示日期（时间照常显示）
    sameJournalDay(t) {
      return !!(this.activeJournalDate && t && t.dueAt && todayKey(Number(t.dueAt)) === this.activeJournalDate);
    },
    gKey(g) { return g.title || '___ungrouped'; },
    // ---------- 子任务（自用改版）：进度小标、收起 / 展开 ----------
    // 有没有子任务（有就显示进度小标，哪怕子任务都做完、被「隐藏已完成」藏起来了）
    hasSubs(t) { return hasSubtasks(t); },
    // 要不要显示收起按钮：下面此刻有子任务可显示才显示
    showFold(t) { return hasVisibleSubtasks(t, this.hideDone); },
    // 收起状态的键用「所在文件 + 任务文字」（见 subtasks.js 的 foldKey）。
    // 主题清单里的任务记录没带 file，这里补上清单文件的路径，和列表视图里同一条任务记的是同一个键
    foldRef(t) { return { file: t.file || this.activeFile, summary: t.summary }; },
    isFolded(t) { return isSubFolded(this.foldRef(t)); },
    toggleFold(t) { toggleSubFold(this.foldRef(t)); },
    // 描述预览：取第一行文字并去掉 Markdown 符号（描述现在按 Markdown 原文保存）
    firstLine(s) { return descPreview(s); },
    async selectList(key) {
      this.activeKey = key;
      const c = this.lists.find((x) => x.key === key);
      if (c) this.activeName = c.name;
      await this.loadGroups(key);
    },
    async loadGroups(key) {
      this.loading = true; this.error = '';
      try {
        const r = await Tasks.loadChecklistGroups(key);
        this.groups = r.groups || [];
        this.activeName = r.name || this.activeName;
        this.activeTotal = r.total || 0;
        this.activeDone = r.done || 0;
      } catch (e) { this.error = this.$t('app.loadChecklistFail') + (e && e.message || e); }
      finally { this.loading = false; }
    },
    async onToggle(t) {
      const done = !t.completed;
      try {
        await Tasks.toggleComplete(t.guid, done);
        t.completed = done; t.completedAt = done ? Date.now() : null;
        this.activeDone += done ? 1 : -1;
        const c = this.lists.find((x) => x.key === this.activeKey);
        if (c) c.done += done ? 1 : -1; // lists 与父级 checklists 共享引用，进度同步
      } catch (e) { this.error = this.$t('app.opFail') + (e && e.message || e); }
    },
    // 右键任务行：打开统一右键菜单（写文件 + 就地更新字段由单例处理；重算进度经 onAfterApply 回调）
    onContextMenu(t, e) {
      openCtxMenu(t, e, { onAfterApply: this.recalcProgress, onAfterDelete: () => this.loadGroups(this.activeKey) });
    },
    // 从本地 groups 重新计算当前清单的 total / done，并同步侧栏进度
    recalcProgress() {
      let total = 0, done = 0;
      for (const g of this.groups) for (const t of g.tasks) {
        total += 1;
        if (t.completed && !t.cancelled) done += 1;
      }
      this.activeTotal = total;
      this.activeDone = done;
      const c = this.lists.find((x) => x.key === this.activeKey);
      if (c) { c.total = total; c.done = done; }
    },
    // 任务行点击：Ctrl/⌘ 直接跳转高亮，否则打开编辑器
    onTaskClick(t, e) {
      if (e && (e.metaKey || e.ctrlKey)) this.openTask(t);
      else this.openEditor(t);
    },
    // Ctrl/Cmd + 点击任务项：直接跳转到任务所在笔记并高亮（不打开编辑器）
    async openTask(t) {
      await openTaskInFile(this.plugin, t);
    },
    openEditor(task, defaultDate) {
      new VueModal(this.plugin.app, TaskEditorModal, {
        open: true, task, defaultDate, plugin: this.plugin,
        // 自用改版：点开的是子任务时，和其他视图一样标题显示「编辑子任务」，并注明属于哪个任务
        isSubtask: !!(task && task.parentGuid),
        parentTitle: (task && task.parentTitle) || '',
        onSaved: () => this.loadGroups(this.activeKey),
        onDeleted: () => this.loadGroups(this.activeKey),
        onSubtasksChanged: () => this.loadGroups(this.activeKey)
      }).open();
    },
    // 分组内新建：弹 TaskEditorModal（create 模式），保存时追加到该分组最后一行
    openAdd(g) {
      // 自用改版：当前这份是日记（「日记」组，或打了清单标记的日记）时，新建任务默认就是这篇日记那天；
      // 保存时数据层按日记的规矩落位（同一天插进这个分组，换了日期放进那天的日记，无日期进收件箱）
      const journalDate = this.activeJournalDate;
      new VueModal(this.plugin.app, TaskEditorModal, {
        open: true, task: null, defaultDate: journalDate, plugin: this.plugin,
        createIn: { list: this.activeKey, group: g.title || '', journal: !!journalDate },
        onSaved: () => this.loadGroups(this.activeKey),
        onDeleted: () => this.loadGroups(this.activeKey),
        onSubtasksChanged: () => this.loadGroups(this.activeKey)
      }).open();
    },
    openFile(key) {
      const path = taskFilePath(key);
      if (!path) return;
      this.plugin.app.workspace.openLinkText(path, '', false);
    },
    // v-html 内的链接点击：阻止冒泡，避免同时触发所在行的「打开编辑器」
    onRichClick(e) {
      if (e.target && e.target.tagName === 'A') e.stopPropagation();
    },
    // 拖拽：将任务项拖到其他分组
    onDragStart(e, t) {
      this.dragGuid = t.guid;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.guid);
      }
    },
    onDragEnd() { this.dragGuid = ''; this.dragOverTitle = ''; },
    onDragOver(e, title) { this.dragOverTitle = title; },
    onDrop(e, title) {
      const guid = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || this.dragGuid;
      this.dragOverTitle = ''; this.dragGuid = '';
      if (!guid) return;
      this.moveTask(guid, title);
    },
    async moveTask(guid, title) {
      try {
        await Tasks.moveChecklistTask(this.activeKey, guid, title);
        await this.loadGroups(this.activeKey); // 重新加载以反映新分组
      } catch (e) { this.error = this.$t('app.moveFail') + (e && e.message || e); }
    }
  }
};
</script>

<style scoped>
.tk-clview { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; }

/* ===== 左侧清单列表（随面板按比例收窄，不再固定 260px） ===== */
.tk-cl-side {
  /* 与右侧按 2:5 占比共享空间，面板变窄时本列按比例收窄；
     container-type 让内部按钮随「本列宽度」响应，而非主窗口 */
  flex: 2 1 0; max-width: 260px; min-width: 120px; min-height: 0;
  container-type: inline-size;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--panel);
}
.tk-cl-side-h {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; font-size: 14px; font-weight: 700; color: var(--ink);
  border-bottom: 1px solid var(--line);
}
.tk-cl-side-h i { color: var(--gold); font-size: 16px; }
.tk-cl-side-empty {
  padding: 28px 18px; color: var(--ink-soft); font-size: 12.5px; line-height: 1.7; text-align: center;
  /* 自用改版：提示文案里用 \n 换行，pre-line 让它真的分成两行（原版写的是 <br />，会被原样显示出来） */
  white-space: pre-line;
}
.tk-cl-list { flex: 1; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
/* 自用改版：左侧「日记」组的组名（排在主题清单后面），点一下收起 / 展开整组 */
.tk-cl-sec { display: flex; align-items: center; gap: 5px; margin-top: 6px; padding: 4px 6px; border-radius: 6px; font-size: 12px; color: var(--ink-soft); cursor: pointer; user-select: none; }
.tk-cl-sec:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
.tk-cl-sec-caret { font-size: 11px; transition: transform .15s ease; }
.tk-cl-sec-caret.open { transform: rotate(90deg); }
.tk-cl-sec .cnt { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.tk-cl-item { display: flex; align-items: center; gap: 8px; }
.tk-cl-item-main {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px;
  padding: 11px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid transparent; text-align: left;
  background: transparent; color: var(--ink);
  transition: background .15s ease, transform .12s ease;
}
/* 清单项右侧：打开对应 vault 文件（独立于选中态，与列表视图一致） */
.tk-cl-open {
  flex: none; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px;
  background: transparent; color: var(--ink-soft); cursor: pointer; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center; box-shadow: none;
  transition: background .15s ease, color .15s ease;
}
.tk-cl-open:hover { background: var(--gold-bg); color: var(--gold); }
.tk-cl-item-main:hover { background: var(--gold-bg); }
.tk-cl-item-main:active { transform: scale(.99); }
.tk-cl-item-main.on { background: var(--gold); border-color: transparent; box-shadow: var(--shadow-s); }
.tk-cl-item-main.on .tk-cl-name,
.tk-cl-item-main.on .tk-cl-meta { color: var(--text-on-accent); }
.tk-cl-item-main.on .tk-cl-bar { background: rgba(255, 255, 255, .28); }
.tk-cl-name { font-size: 14px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-cl-bar { height: 6px; border-radius: 999px; background: rgba(127, 127, 127, .18); overflow: hidden; }
.tk-cl-bar > i { display: block; height: 100%; border-radius: 999px; background: var(--c-done); transition: width .3s ease; }
.tk-cl-meta { font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

/* ===== 右侧主区（随面板弹性收窄；container-type 让任务日期随「本区宽度」响应） ===== */
.tk-cl-main { flex: 5 1 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; container-type: inline-size; }
.tk-cl-empty-main { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--ink-soft); }
.tk-cl-main-h {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 14px 0 14px 20px; border-bottom: 1px solid var(--line);
}
.tk-cl-head-l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tk-cl-title { font-size: 18px; font-weight: 700; color: var(--ink); line-height: 1.25; word-break: break-all; }
.tk-cl-prog { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.tk-cl-loading, .tk-cl-none { padding: 40px; text-align: center; color: var(--ink-soft); }
.tk-cl-body { flex: 1; overflow: auto; padding: 4px 20px 28px; }

.tk-cl-group { margin-top: 18px; }
/* 拖拽放置目标高亮（列表 / 分栏两种容器通用） */
.tk-cl-group.tk-cl-drophover,
.tk-cl-col.tk-cl-drophover { background: var(--gold-bg); }
.tk-cl-gtitle {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 700; color: var(--ink);
  padding: 8px 0 9px; margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
}
.tk-cl-gtitle::before { content: ''; width: 4px; height: 16px; border-radius: 3px; background: var(--gold); flex: none; }
.tk-cl-gtitle.is-plain { border-bottom: none; padding-top: 0; }
.tk-cl-gtitle.is-plain::before { background: transparent; width: 0; }
.tk-cl-gtxt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-cl-gplain { font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.tk-cl-gcnt { font-size: 11px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.tk-cl-rows { display: flex; flex-direction: column; }
/* 清单任务排序动画：勾选完成/取消后平滑沉到组底（FLIP 位移），并给增删一个轻微淡入淡出 */
/* 用 .tk-cl-rows 后代选择器提高特异性，压过 .tk-cl-row 自带的 transition（否则 transform 不被过渡，位移动画失效） */
.tk-cl-rows .tk-clmove-move { transition: transform .3s cubic-bezier(.4, 0, .2, 1); }
.tk-cl-rows .tk-clmove-enter-active,
.tk-cl-rows .tk-clmove-leave-active { transition: opacity .2s ease; }
.tk-cl-rows .tk-clmove-enter-from,
.tk-cl-rows .tk-clmove-enter { opacity: 0; }
.tk-cl-rows .tk-clmove-leave-to,
.tk-cl-rows .tk-clmove-leave { opacity: 0; }

.tk-cl-row {
  position: relative; /* 子任务的引导线（::before）按行定位 */
  display: flex; align-items: flex-start; gap: 11px;
  padding: 9px 10px; border-radius: 9px; cursor: grab;
  /* 按层级深度缩进，体现主任务 / 子任务隶属关系（自用改版：深度按任务树算，见数据层记录的 depth） */
  padding-left: calc(10px + (var(--cl-depth, 0) * 24px));
  transition: background .15s ease;
}
.tk-cl-row:active { cursor: grabbing; }
.tk-cl-row:hover { background: var(--gold-bg); }
.tk-cl-row .tk-check { flex: none; margin-top: 1px; }
/* 自用改版：子任务行，和列表视图的子任务清单一样——左边一条细引导线，圆圈和文字小一号。
   引导线画在上一层任务圆圈的正下方，每多一层多一条（重复渐变，每 24px 一条）；
   上下各多伸出 2px，盖住行与行之间的空隙，同一个主任务下的子任务连成一条竖线 */
.tk-cl-row.is-sub { padding-top: 6px; padding-bottom: 6px; }
.tk-cl-row.is-sub::before {
  content: ''; position: absolute; pointer-events: none;
  top: -2px; bottom: -2px; left: 19px;
  width: calc(var(--cl-depth, 0) * 24px);
  background: repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px 24px);
}
.tk-cl-row.is-sub .tk-check { font-size: 17px; }
.tk-cl-row.is-sub .tk-cl-sum { font-size: 13px; }
/* 进度小标、收起按钮与第一行文字对齐 */
.tk-cl-row > .tk-cl-subprog { margin-top: 2px; }
.tk-cl-row > .tk-cl-subfold { margin-top: 1px; }
.tk-cl-row-main { flex: 1 1 auto; min-width: 0; }
/* 标题与 ⏳ 徽标同行（徽标见共享样式 .tk-sched，issue #13） */
.tk-cl-sumrow { display: flex; align-items: baseline; min-width: 0; gap: 2px; }
.tk-cl-sumrow .tk-cl-sum { flex: 1 1 auto; min-width: 0; }
/* ⏳ 徽标字号对齐右侧日期小字（.tk-cl-date 12px） */
.tk-cl-sumrow .tk-sched { font-size: 12px; line-height: 16px; }
.tk-cl-sum { font-size: 14px; color: var(--ink); line-height: 1.5; word-break: break-word; }
.tk-cl-sum :deep(a) { color: var(--accent, var(--gold)); }
.tk-cl-desc { font-size: 12px; color: var(--ink-soft); line-height: 1.5; margin-top: 2px; word-break: break-word; }
.tk-cl-row.done .tk-cl-sum { color: var(--done-color); opacity: var(--done-opacity); }
.tk-cl-row.cancel .tk-cl-sum { color: var(--done-color); text-decoration: line-through; opacity: var(--done-opacity); }
.tk-cl-row.done .tk-cl-desc,
.tk-cl-row.cancel .tk-cl-desc { opacity: var(--done-opacity); }
.tk-cl-date { flex: none; font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; padding-top: 3px; }
/* 分栏视图下：日期时间作为任务文字下方的副行（块级、与正文留间距） */
.tk-cl-date-sub { display: block; margin-top: 3px; }
.tk-cl-gempty { padding: 6px 10px 10px; color: var(--ink-soft); font-size: 12px; opacity: .7; }

/* 分栏视图：每个分组一栏，固定宽度，横向滚动；每栏内部独立纵向滚动 */
.tk-cl-cols {
  flex: 1; min-height: 0; display: flex; gap: 14px; align-items: stretch;
  overflow-x: auto; overflow-y: hidden; padding: 12px 20px 20px;
  /* 横向滚动条常驻可见（macOS 默认会隐藏，仅滚动时闪现） */
  scrollbar-width: thin;
  scrollbar-color: var(--ink-soft) transparent;
}
.tk-cl-cols::-webkit-scrollbar { height: 10px; }
.tk-cl-cols::-webkit-scrollbar-track { background: transparent; }
.tk-cl-cols::-webkit-scrollbar-thumb {
  background: var(--ink-soft); border-radius: 999px;
  border: 3px solid transparent; background-clip: padding-box;
}
.tk-cl-cols::-webkit-scrollbar-thumb:hover { background: var(--gold); }
.tk-cl-cols > .tk-cl-none { flex: 1; }
.tk-cl-col {
  flex: none; width: 280px; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
}
.tk-cl-col .tk-cl-gtitle {
  flex: none; margin: 0; padding: 12px 14px 10px; border-bottom: 1px solid var(--line);
}
.tk-cl-col .tk-cl-gtitle.is-plain { border-bottom: 1px solid var(--line); padding-top: 12px; }
.tk-cl-col .tk-cl-rows {
  flex: 1; overflow-y: auto; padding: 6px 8px 12px; gap: 2px;
  /* 分栏内纵向滚动条同样常驻可见 */
  scrollbar-width: thin; scrollbar-color: var(--ink-soft) transparent;
}
.tk-cl-col .tk-cl-rows::-webkit-scrollbar { width: 8px; }
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-track { background: transparent; }
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-thumb {
  background: var(--ink-soft); border-radius: 999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.tk-cl-col .tk-cl-rows::-webkit-scrollbar-thumb:hover { background: var(--gold); }
/* 窄页面分栏模式：每栏收窄、栏间距收紧，避免横向空间浪费（随面板宽度而非主窗口） */
@container (max-width: 720px) {
  .tk-cl-cols { gap: 10px; padding: 10px 14px 16px; }
  .tk-cl-col { width: 240px; }
}
@container (max-width: 480px) {
  .tk-cl-cols { gap: 6px; padding: 8px 10px 12px; }
  .tk-cl-col { width: 196px; }
}
/* 窄页面列表视图（分组竖向堆叠）：收紧左右内边距、分组间距与行内 gap，避免窄屏留白过多（随面板宽度） */
@container (max-width: 720px) {
  .tk-cl-body { padding: 4px 14px 24px; }
  .tk-cl-main-h { padding: 12px 0 12px 14px; }
  .tk-cl-group { margin-top: 14px; }
  .tk-cl-gtitle { gap: 8px; padding: 7px 0 8px; }
  .tk-cl-row { gap: 9px; padding-right: 8px; }
}
@container (max-width: 480px) {
  .tk-cl-body { padding: 4px 10px 20px; }
  .tk-cl-main-h { padding: 10px 0 10px 10px; }
  .tk-cl-group { margin-top: 10px; }
  .tk-cl-gtitle { gap: 6px; padding: 6px 0 7px; }
  .tk-cl-row { gap: 7px; padding-right: 6px; }
}

/* ===== 随「各自容器宽度」收起次要信息（与日程视图一致，均看本列/本区宽度而非主窗口） ===== */
/* 左侧清单列变窄（≤200px）：隐藏「打开文件」按钮、已完成计数与百分比进度条，仅留清单名称 */
@container (max-width: 200px) {
  .tk-cl-open, .tk-cl-meta, .tk-cl-bar { display: none; }
}
/* 右侧主区变窄（≤420px）：隐藏任务行的日期与时间，仅留正文 */
@container (max-width: 420px) {
  .tk-cl-date { display: none; }
}
</style>

<!-- 右键菜单 teleport 到 body，scoped 样式无法命中，这里用全局（非 scoped）样式确保生效 -->

