// ============================================================================
// Mac 桌面小组件上点圆圈勾选任务（自用改版）：请求的格式、检查，以及「这条请求对应哪条任务」
// ----------------------------------------------------------------------------
// 流程：点小组件四象限里某条任务前面的圆圈 → 小组件程序（mac-widget/Sources/App/HelperApp.swift）
//   在 ~/Library/Application Support/ChaoChaoList/requests/ 写一个小文件（一条请求）
//   → 插件看到后照着勾上 / 取消勾选（services/widgetToggle.js），处理完删掉这个文件。
//
// 一条请求长这样：{ "v": 1, "vault": "库名", "id": "任务编号", "text": "任务标题", "done": true, "at": 毫秒时间 }
//   · done 是「要变成的状态」，不是「切换」：同一条请求处理两次、或任务已经在别处勾过，结果都不会反过来；
//   · 任务编号里带着行号，笔记改过之后行号可能对不上，所以还要核对标题；行号对不上时，在同一个文件里按标题找，
//     刚好找到一条才算数，找不到或有好几条同名的就不动。
//
// 这里只放不依赖 Obsidian 的纯函数，方便自动测试（tests/data-layer.test.js）。
// ============================================================================
import { parseGuid } from './tasks-logic.js';

/** 请求格式的版本（小组件程序写的是 1） */
export const TOGGLE_REQUEST_VERSION = 1;

/** 放了多久的请求直接作废（毫秒）：比如点完以后好几天没开 Obsidian，那时的任务多半已经变了 */
export const TOGGLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 读一条请求（请求文件的文本内容）。
 * 返回 { ok: true, req } 或 { ok: false, reason }；reason 是 'bad'（内容不对）或 'stale'（放太久了）。
 */
export function parseToggleRequest(text, now = Date.now()) {
  let o;
  try {
    o = JSON.parse(String(text));
  } catch (e) {
    return { ok: false, reason: 'bad' };
  }
  if (!o || typeof o !== 'object') return { ok: false, reason: 'bad' };
  // 字符串字段：必须是非空字符串，长度有个上限（防止坏文件塞进超长内容）
  const okStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
  const valid = o.v === TOGGLE_REQUEST_VERSION
    && okStr(o.vault, 500)
    && okStr(o.id, 2000)
    && typeof o.text === 'string' && o.text.length <= 2000
    && typeof o.done === 'boolean'
    && Number.isFinite(o.at);
  if (!valid) return { ok: false, reason: 'bad' };
  if (now - o.at > TOGGLE_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  return { ok: true, req: { vault: o.vault, id: o.id, text: o.text, done: o.done, at: o.at } };
}

/** 把顶层任务和它们的子任务（任意层）摊平成一个列表 */
export function flattenTasks(tasks) {
  const out = [];
  const walk = (list) => {
    for (const t of list || []) {
      if (!t) continue;
      out.push(t);
      walk(t.subtasks);
    }
  };
  walk(tasks);
  return out;
}

/**
 * 找请求对应的任务。
 *   1. 先按编号找，标题也对得上就是它；
 *   2. 对不上（多半是笔记改过、行号变了）：在编号所指的同一个文件里按标题找，刚好一条才算；
 *   3. 都不行就返回 null（调用方不改任何东西，只提示一句）。
 * titleOf：把任务标题转成小组件上显示的样子（widgetSnapshot.js 的 widgetTitle），用来和请求里的标题比较。
 */
export function findTaskForRequest(tasks, req, titleOf) {
  const all = flattenTasks(tasks);
  const title = (t) => titleOf(t && t.summary);
  const byId = all.find((t) => t.guid === req.id);
  if (byId && title(byId) === req.text) return byId;
  const g = parseGuid(req.id);
  if (!g || !req.text) return null;
  const same = all.filter((t) => {
    const tg = parseGuid(t.guid);
    return tg && tg.file === g.file && tg.dateKey === g.dateKey && title(t) === req.text;
  });
  return same.length === 1 ? same[0] : null;
}
