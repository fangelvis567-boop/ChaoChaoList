// 清单页右侧的任务行（自用改版）：把一组任务排成「主任务 → 它下面的子任务」的一维行列表。
// ----------------------------------------------------------------------------
// 数据来自 api/tasks.js 的 loadChecklistGroups：一组任务是「父在前、子紧随其后」的一维列表，
// 每条记录带 depth（层级，0 = 主任务）和 subtasks（直接子任务，已按优先级、日期排好）。
// 这里是纯函数，不依赖 Vue，方便自动测试（tests/data-layer.test.js）。
//
// 规则（和列表视图、四象限一样：子任务挂在主任务下面，不和主任务分开，做完的子任务划线显示）：
//   - 只在同一层的兄弟之间排：没做完的在前，做完 / 取消的在后，其余保持数据层排好的先后。
//     原先是整组摊平后统一把做完的沉到底，主任务一沉，它没做完的子任务就留在上面，
//     看起来像挂在别的任务下面。
//   - 「隐藏已完成」开着时，按「主任务连同它下面的子任务」整块来藏：整块都做完了才藏起来。
//     还没全部做完的，主任务和它下面的子任务都照常显示——做完的子任务划线，做完的主任务灰色打勾。
//     这样勾掉一条子任务时它不会马上消失，整件事做完才一起收走。
//   - 收起的任务，它下面的子任务不列出来（是否收起由调用方的 isFolded 判断）。

/** 做完或取消了 */
function isDone(t) {
  return !!(t && (t.completed || t.cancelled));
}

/** 这条任务连同它下面（任意一层）的子任务是不是全都做完了 */
function allDone(t) {
  return isDone(t) && ((t && t.subtasks) || []).every(allDone);
}

/**
 * 把一组任务排成要显示的行。
 * @param {Array} tasks 一组的全部任务记录（父在前、子紧随其后的一维列表）
 * @param {{ hideDone?: boolean, isFolded?: (t: object) => boolean }} [opts]
 *   hideDone —— 「隐藏已完成」开着没有
 *   isFolded —— 判断某条任务的子任务是否收起；不传就当都展开
 * @returns {{ rows: Array, count: number }}
 *   rows —— 要显示的任务记录（就是传进来的那些对象本身），按显示顺序排好
 *   count —— 组名旁显示的任务数：「隐藏已完成」时只数没做完的（做完的哪怕因为同一块还没做完而照常显示，也不算），
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
      rows.push(t);
      if (!isFolded(t)) walk(t.subtasks || []);
    }
  };
  // 「隐藏已完成」时只去掉整块都做完的主任务；留下来的主任务，下面的子任务全部照常显示
  const roots = list.filter((t) => !t.depth);
  walk(hideDone ? roots.filter((t) => !allDone(t)) : roots);
  const count = hideDone ? list.filter((t) => !isDone(t)).length : list.length;
  return { rows, count };
}
