// 日期面板（自用改版，仿滴答清单）用的纯函数：不依赖 Vue，方便自动测试（tests/data-layer.test.js）。
// ----------------------------------------------------------------------------
// 编辑窗口里只放一个「日期胶囊」，点开是日期面板（components/DateTimePanel.vue）。
// 面板里改的是一份草稿（draft），点「确定」才把草稿换算回编辑窗口的表单（form）；
// 最后仍由编辑窗口的「保存」写进笔记。
//
// 表单沿用编辑窗口原有的字段，保存逻辑（TaskEditorModal 的 buildDueAt）不用改：
//   timeMode —— none 无日期 / allday 全天 / single 单个时间 / range 同一天的时间段 / crossdate 跨日期
//   dueDate（日期；跨日期时是结束日期）、startDate（跨日期的开始日期）、
//   dueTime（单个时间）、dueStart / dueEnd（时间段的开始、结束时间；跨日期带时间时是开始那天的开始时间、结束那天的结束时间）
// 草稿是面板上看到的样子：
//   tab —— 'date'（某一天）或 'span'（时间段：开始日期到结束日期）
//   date —— 某一天，YYYY-MM-DD，可空（空 = 没选日期）
//   start / end —— 开始、结束时间，HH:MM，可空：都空 = 全天；只有开始 = 单个时间；两个都有 = 同一天的时间段
//   spanStart / spanEnd —— 时间段的开始、结束日期
//   spanAllDay —— 时间段是不是全天（默认是）；关掉后才用下面两个时间
//   spanStartTime / spanEndTime —— 时间段开始那天的开始时间、结束那天的结束时间（结束时间可空）
// 日期一律是 YYYY-MM-DD 字符串、时间一律是 HH:MM 字符串，可以直接按字符串比大小。

const pad = (n) => (n < 10 ? '0' + n : '' + n);

/** 把 YYYY-MM-DD 解析成本地日期（当天 0 点）；格式不对返回 null */
function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** 本地日期 → YYYY-MM-DD */
export function toYmd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** YYYY-MM-DD 加减 n 天（按本地日历，跨月、跨年自动进位）；格式不对返回空串 */
export function addDays(ymd, n) {
  const d = parseYmd(ymd);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** 两个 YYYY-MM-DD 相差几天（b 减 a）；有一个格式不对返回 0 */
export function daysBetween(a, b) {
  const da = parseYmd(a), db = parseYmd(b);
  if (!da || !db) return 0;
  // 用 UTC 日期相减，避开夏令时那一天少一小时、多一小时的问题
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** HH:MM → 当天的第几分钟；格式不对返回 null */
function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 下一个整点或半点（如 09:12 → 09:30，09:40 → 10:00，最晚 23:30），给「添加时间」当默认值 */
export function nextHalfHour(now) {
  const d = now || new Date();
  let next = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 30) * 30;
  if (next >= 1440) next = 1410;
  return pad(Math.floor(next / 60)) + ':' + pad(next % 60);
}

/**
 * 表单 → 面板草稿（打开面板时调用）
 * @param {object} form 编辑窗口的表单
 * @returns {object} 草稿
 */
export function formToDraft(form) {
  const f = form || {};
  const d = {
    tab: 'date', date: '', start: '', end: '',
    spanStart: '', spanEnd: '', spanAllDay: true, spanStartTime: '', spanEndTime: ''
  };
  switch (f.timeMode) {
    case 'crossdate': {
      // 跨日期：带了开始时间就不是全天；切到「日期」标签时停在开始那天
      const st = f.dueStart || f.dueTime || '';
      return Object.assign(d, {
        tab: 'span', date: f.startDate || f.dueDate || '',
        spanStart: f.startDate || f.dueDate || '', spanEnd: f.dueDate || '',
        spanAllDay: !st, spanStartTime: st, spanEndTime: st ? (f.dueEnd || '') : ''
      });
    }
    case 'allday':
      return Object.assign(d, { date: f.dueDate || '' });
    case 'single':
      return Object.assign(d, { date: f.dueDate || '', start: f.dueTime || f.dueStart || '' });
    case 'range':
      return Object.assign(d, { date: f.dueDate || '', start: f.dueStart || f.dueTime || '', end: f.dueEnd || '' });
    default:
      // 无日期：面板打开时什么都不选
      return d;
  }
}

/**
 * 面板草稿 → 要写回表单的字段（点「确定」时调用）。只返回要改的字段，由调用方合并进表单。
 * 没选日期、但填了时间时，得到「只有时间、没有日期」的任务（日记里的子任务常见这种写法，如「09:00 查房」）。
 * @param {object} draft 草稿
 * @returns {object} 表单字段
 */
export function draftToForm(draft) {
  const d = draft || {};
  const noTimes = { dueTime: '', dueStart: '', dueEnd: '' };
  if (d.tab === 'span') {
    // 关掉「全天」并填了开始时间，才算带时间
    const st = (!d.spanAllDay && d.spanStartTime) || '';
    const et = st ? (d.spanEndTime || '') : '';
    if (d.spanStart && d.spanEnd && d.spanStart < d.spanEnd) {
      return { timeMode: 'crossdate', startDate: d.spanStart, dueDate: d.spanEnd, dueTime: st, dueStart: st, dueEnd: et };
    }
    // 开始、结束是同一天：就是那一天——带时间的是那天的单个时间 / 时间段，不带就是全天
    const day = d.spanEnd || d.spanStart || '';
    if (!day) return Object.assign({ timeMode: 'none', startDate: '', dueDate: '' }, noTimes);
    if (!st) return Object.assign({ timeMode: 'allday', startDate: '', dueDate: day }, noTimes);
    if (!et) return { timeMode: 'single', startDate: '', dueDate: day, dueTime: st, dueStart: st, dueEnd: '' };
    return { timeMode: 'range', startDate: '', dueDate: day, dueTime: st, dueStart: st, dueEnd: et };
  }
  const base = { startDate: '', dueDate: d.date || '' };
  if (!d.start) return Object.assign(base, { timeMode: d.date ? 'allday' : 'none' }, noTimes);
  if (!d.end) return Object.assign(base, { timeMode: 'single', dueTime: d.start, dueStart: d.start, dueEnd: '' });
  return Object.assign(base, { timeMode: 'range', dueTime: d.start, dueStart: d.start, dueEnd: d.end });
}

/**
 * 草稿有没有填错（点「确定」前检查）
 * @param {object} draft 草稿
 * @returns {string} 出错时返回提示文字的 i18n 键，没问题返回空串
 */
export function draftError(draft) {
  const d = draft || {};
  if (d.tab === 'span') {
    if (d.spanStart && d.spanEnd && d.spanEnd < d.spanStart) return 'editor.endDateAfterStart';
    // 开始、结束是同一天又带了时间：结束时间要晚于开始时间（跨了天的，结束时刻比开始早也没关系）
    if (!d.spanAllDay && d.spanStart && d.spanStart === d.spanEnd) {
      const ss = toMin(d.spanStartTime), se = toMin(d.spanEndTime);
      if (ss != null && se != null && se <= ss) return 'editor.endAfterStart';
    }
    return '';
  }
  const s = toMin(d.start), e = toMin(d.end);
  return (s != null && e != null && e <= s) ? 'editor.endAfterStart' : '';
}

/** 面板顶部的四个快捷日期（顺序即显示顺序，和滴答清单一样） */
export const QUICK_PICKS = ['today', 'tomorrow', 'week', 'tonight'];

/**
 * 点快捷日期后草稿要改的字段：今天 / 明天 / 7 天后只改日期，原来填的时间保留；今晚 = 今天 20:00
 * @param {string} kind QUICK_PICKS 里的一项
 * @param {string} today 今天，YYYY-MM-DD
 * @returns {object} 草稿字段
 */
export function quickPick(kind, today) {
  switch (kind) {
    case 'today': return { date: today };
    case 'tomorrow': return { date: addDays(today, 1) };
    case 'week': return { date: addDays(today, 7) };
    case 'tonight': return { date: today, start: '20:00', end: '' };
    default: return {};
  }
}

/** 某个快捷日期此刻是不是选中状态（用来高亮按钮）。今天 20:00 只算「今晚」，不同时算「今天」 */
export function isQuickPicked(kind, draft, today) {
  const d = draft || {};
  const tonight = d.date === today && d.start === '20:00' && !d.end;
  if (kind === 'tonight') return tonight;
  const p = quickPick(kind, today);
  return !!p.date && d.date === p.date && !(kind === 'today' && tonight);
}

/**
 * 切换「日期」/「时间段」标签：两边的日期互相带过去，免得切过去是空的
 * @param {object} draft 草稿
 * @param {string} tab 'date' 或 'span'
 * @param {string} today 今天，YYYY-MM-DD
 * @returns {object} 新草稿
 */
export function switchTab(draft, tab, today) {
  const d = Object.assign({}, draft, { tab });
  if (tab === 'span') {
    // 时间段没填过：从选中的那天（没选就今天）开始，默认到第二天
    if (!d.spanStart) d.spanStart = d.date || today;
    if (!d.spanEnd || d.spanEnd < d.spanStart) d.spanEnd = addDays(d.spanStart, 1);
    // 「日期」那边填了时间、时间段这边还没有：带过来，并关掉全天
    if (d.start && !d.spanStartTime) {
      d.spanStartTime = d.start;
      d.spanEndTime = d.end || '';
      d.spanAllDay = false;
    }
  } else {
    if (!d.date) d.date = d.spanStart || '';
    // 时间段带了开始时间、「日期」这边还没有：带上开始时间（结束时间在另一天，不带）
    if (!d.start && !d.spanAllDay && d.spanStartTime) d.start = d.spanStartTime;
  }
  return d;
}

/**
 * 日期胶囊上显示什么（只给数据，文字由界面按当前语言拼）：
 *   { kind: 'none' }                       无日期
 *   { kind: 'time', time }                 只有时间、没有日期
 *   { kind: 'day', date, rel, time }       某一天；rel 为 'today' / 'tomorrow' / 'yesterday' / ''，time 为空 = 全天
 *   { kind: 'span', from, to, fromTime, toTime }   跨日期；fromTime / toTime 为开始、结束时间，全天为空串
 * time 形如「09:00」或「09:00–10:00」。
 * @param {object} form 编辑窗口的表单
 * @param {string} today 今天，YYYY-MM-DD
 * @returns {object}
 */
export function chipInfo(form, today) {
  const f = form || {};
  const rel = (ymd) => (ymd === today ? 'today'
    : ymd === addDays(today, 1) ? 'tomorrow'
      : ymd === addDays(today, -1) ? 'yesterday' : '');
  switch (f.timeMode) {
    case 'crossdate': {
      const st = f.dueStart || f.dueTime || '';
      return { kind: 'span', from: f.startDate || f.dueDate || '', to: f.dueDate || '', fromTime: st, toTime: st ? (f.dueEnd || '') : '' };
    }
    case 'allday':
      return f.dueDate ? { kind: 'day', date: f.dueDate, rel: rel(f.dueDate), time: '' } : { kind: 'none' };
    case 'single':
    case 'range': {
      const start = f.timeMode === 'range' ? (f.dueStart || f.dueTime || '') : (f.dueTime || f.dueStart || '');
      const end = f.timeMode === 'range' ? (f.dueEnd || '') : '';
      const time = start ? (end ? start + '–' + end : start) : '';
      if (!f.dueDate) return time ? { kind: 'time', time } : { kind: 'none' };
      return { kind: 'day', date: f.dueDate, rel: rel(f.dueDate), time };
    }
    default:
      return { kind: 'none' };
  }
}
