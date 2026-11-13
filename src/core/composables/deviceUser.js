// ============================================================================
// 这台设备的使用者（自用改版）
// ----------------------------------------------------------------------------
// 两个人共用一个库时，任务会混在一起。做法是给每条任务带一个标签标明是谁的
// （比如 #🌻、#🥕）：每台设备在插件设置里填一次「这台设备的使用者」，之后在这台
// 设备上新建任务就自动带上这个标签。
//
// 使用者就是一个普通标签，所以筛选、改颜色、改名、删除都沿用插件已有的标签功能，
// 这里只管两件事：把「这台设备是谁在用」记下来、读出来。
//
// 存在哪：Obsidian 给每个库留的本机存储（app.saveLocalStorage / app.loadLocalStorage，
// 按库分开）。故意不写进插件的 data.json——库是两个人共用的，data.json 可能跟着库
// 同步，那样两个人的设置会互相覆盖。代价是每台设备都要各填一次。
// ============================================================================
import { cleanTagName } from './tasks-logic.js';

/** 本机存储里的键名（Obsidian 会自动在前面拼上这个库的编号，所以不同的库互不影响） */
export const DEVICE_USER_KEY = 'chaochao-list-device-user';

/** Obsidian 的 app 对象；插件启动时由 initDeviceUser 交进来 */
let appRef = null;

/**
 * 插件启动时调用一次，把 Obsidian 的 app 交进来（读写本机存储要用它）。
 * @param {Object|null} app Obsidian 的 app 对象
 */
export function initDeviceUser(app) {
  appRef = app || null;
}

/**
 * 读出这台设备的使用者标签（不带 #）。没设置、读不到、或存的内容不能当标签用时，返回空串。
 * @returns {string} 例如 '🌻'；没有则是 ''
 */
export function getDeviceUserTag() {
  try {
    if (!appRef || typeof appRef.loadLocalStorage !== 'function') return '';
    const saved = appRef.loadLocalStorage(DEVICE_USER_KEY);
    return typeof saved === 'string' ? cleanTagName(saved) : '';
  } catch (e) {
    return ''; // 读本机存储出错：当作没设置，不影响新建任务
  }
}

/**
 * 保存这台设备的使用者标签。
 *   - 留空：清掉设置，以后新建任务不再自动加标签；
 *   - 能当标签用的名字（文字、数字、表情符号、_ - /）：整理后存下（去掉开头的 #、空格换成 -）；
 *   - 不能当标签用的（比如带 📅 ✅ 这类任务标记用的符号）：不保存，原来的设置不变。
 * @param {string} input 用户在设置里填的内容
 * @returns {{ ok: boolean, tag: string }} ok 表示这次输入有没有被接受；tag 是现在生效的使用者标签
 */
export function setDeviceUserTag(input) {
  const raw = String(input == null ? '' : input).trim();
  const name = raw ? cleanTagName(raw) : '';
  if (raw && !name) return { ok: false, tag: getDeviceUserTag() };
  try {
    if (!appRef || typeof appRef.saveLocalStorage !== 'function') return { ok: false, tag: '' };
    // 传 null = 把这一项从本机存储里删掉
    appRef.saveLocalStorage(DEVICE_USER_KEY, name || null);
  } catch (e) {
    return { ok: false, tag: getDeviceUserTag() };
  }
  return { ok: true, tag: name };
}

/**
 * 新建任务时预先带上的标签：设了使用者就是 [使用者标签]，没设就是空列表。
 * 编辑窗口打开空白表单时用它填标签栏（保存前看得见，可以删掉或换成别的）。
 * @returns {string[]}
 */
export function defaultTaskTags() {
  const user = getDeviceUserTag();
  return user ? [user] : [];
}
