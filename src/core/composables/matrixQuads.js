// ============================================================================
// 四象限的四个格子（自用改版：原先写在 components/tasks/FourQuadrantView.vue 里，
// 挪到这里后，面板的四象限视图和 Mac 桌面小组件用同一份，标题、颜色、优先级对应关系不会两边不一致）
//   左上 红 重要且紧急   → 高优先级
//   右上 橙 重要不紧急   → 中优先级
//   左下 蓝 紧急不重要   → 低优先级
//   右下 绿 不重要不紧急 → 无优先级
// key：格子位置；level：优先级档位（与 tasks-logic.js 的 priorityToLevel 一致）；
// titleKey：界面文字的键；color：格子的标题色。
// ============================================================================
export const MATRIX_QUADS = [
  { key: 'tl', level: 'high',   titleKey: 'app.matrixTitleHigh',   color: '#e0584f' },
  { key: 'tr', level: 'medium', titleKey: 'app.matrixTitleMedium', color: '#e0a93b' },
  { key: 'bl', level: 'low',    titleKey: 'app.matrixTitleLow',    color: '#4a90d2' },
  { key: 'br', level: 'none',   titleKey: 'app.matrixTitleNone',   color: '#4caf7d' }
];
