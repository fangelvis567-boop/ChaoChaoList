// 清单页右侧的任务行（自用改版）：把一组任务排成「主任务 → 它下面的子任务」的一维行列表。
// ----------------------------------------------------------------------------
// 数据来自 api/tasks.js 的 loadChecklistGroups：一组任务是「父在前、子紧随其后」的一维列表，
// 每条记录带 depth（层级，0 = 主任务）和 subtasks（直接子任务，已按优先级、日期排好）。
// 这里是纯函数，不依赖 Vue，方便自动测试（tests/data-layer.test.js）。
//
// 规则（和列表视图、四象限一样：子任务挂在主任务下面，不和主任务分开）：
//   - 只在同一层的兄弟之间排：没做完的在前，做完 / 取消的在后，其余保持数据层排好的先后。
//     原先是整组摊平后统一把做完的沉到底，主任务一沉，它没做完的子任务就留在上面，
//     看起来像挂在别的任务下面。
//   - 「隐藏已完成」开着时，做完 / 取消的任务不显示；但做完的主任务下面还有没做完的子任务时，
//     主任务照常显示（灰色、打勾），下面只列没做完的子任务，这样看得出它们属于哪件事。
//   - 收起的任务，它下面的子任务不列出来（是否收起由调用方的 isFolded 判断）。

/** 做完或取消了 */
function isDone(t) {
  return !!(t && (t.completed || t.cancelled));
}

/** 「隐藏已完成」时这条任务要不要显示：自己没做完，或者下面（任意一层）还有没做完的子任务 */
function shownWhenHidingDone(t) {
  return !isDone(t) || ((t && t.subtasks) || []).some(shownWhenHidingDone);
}

/**
 * 把一组任务排成要显示的行。
 * @param {Array} tasks 一组的全部任务记录（父在前、子紧随其后的一维列表）
 * @param {{ hideDone?: boolean, isFolded?: (t: object) => boolean }} [opts]
 *   hideDone —— 「隐藏已完成」开着没有
 *   isFolded —— 判断某条任务的子任务是否收起；不传就当都展开
 * @returns {{ rows: Array, count: number }}
 *   rows —— 要显示的任务记录（就是传进来的那些对象本身），按显示顺序排好
 *   count —— 组名旁显示的任务数：「隐藏已完成」时只数没做完的（为了说明归属而留着的已完成主任务不算），
 *            否则全部都数；收起只影响显示，不影响这个数
 */
export function buildChecklistRows(tasks, opts = {}) {
  const hideDone = !!opts.hideDone;
  const isFolded = typeof opts.isFolded === 'function' ? opts.isFolded : () => false;
  const list = tasks || [];
  // 同一层兄弟排序：没做完的在前，做完的在后；同类之间保持原有先后（稳定排序）
  const order = (arr) => arr
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (Number(isDone(a.t)) - Number(isDone(b.t))) || a.i - b.i)
    .map((x) => x.t);
  const rows = [];
  // 从主任务开始一层层往下走：先放这条任务，再（没收起时）放它的子任务
  const walk = (arr) => {
    for (const t of order(arr)) {
      if (hideDone && !shownWhenHidingDone(t)) continue;
      rows.push(t);
      if (!isFolded(t)) walk(t.subtasks || []);
    }
  };
  walk(list.filter((t) => !t.depth));
  const count = hideDone ? list.filter((t) => !isDone(t)).length : list.length;
  return { rows, count };
}

/**
 * 这条任务下面此刻有没有要显示的子任务——有才给它显示「收起 / 展开」按钮。
 * （子任务全做完、又开着「隐藏已完成」时，下面什么都不显示，按钮按了也看不出变化，就不显示）
 * @param {object} t 任务记录
 * @param {boolean} hideDone 「隐藏已完成」开着没有
 * @returns {boolean}
 */
export function hasVisibleSubtasks(t, hideDone) {
  const subs = (t && t.subtasks) || [];
  return hideDone ? subs.some(shownWhenHidingDone) : subs.length > 0;
}
