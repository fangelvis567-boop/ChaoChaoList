// 「Quick Editing」插件里，可以在任务描述框中使用的命令（自用改版）
// ----------------------------------------------------------------------------
// Quick Editing 是「增强编辑」(obsidian-canzi/Enhanced-editing) 的接手维护版，在官方插件市场里，
// 插件 id 为 quick-editing（仓库 hanser0521/quick-editing）。2026-11-10 起主库用它替换了增强编辑。
//
// 和增强编辑不同，Quick Editing 的命令通过 Obsidian 的「当前编辑器」(workspace.activeEditor)
// 拿编辑器。描述框获得焦点时「当前编辑器」就是描述框自己，所以 embeddedEditor.js 执行这些命令时
// 不需要像增强编辑那样临时替换「当前打开的笔记」，直接执行即可。
// 但它们是普通命令（不是 Obsidian 的「编辑器命令」），描述框不会自动放行，所以仍要按名单放：
// 只放「当场执行完、只改编辑器里文字」的命令——会延后执行的（异步、等剪贴板、先弹预览窗再改），
// 真正执行时焦点可能已经离开描述框。
//
// 这份名单由 tests/tools/analyze_quick_editing.py 分析 Quick Editing 1.0.7 的源码得出（2026-11-10），
// 共 101 个命令，放行 60 个、排除 41 个。排除的几类：
//   - 格式刷类（打开后会在之后的选择上继续起作用）：各种格式刷、转换无语法文本（不选文字时会打开纯文本格式刷）；
//   - 不选文字时会先弹「全文修改预览」窗口再改的：全局转换[[链接]]、一键删除图片链接、修复外来文本 / 标点 /
//     语法 / 断行、批量增删空行和空格、去除所有注释等；
//   - 打开或切换文件、滚动窗口、搜索、改文件名、读写剪贴板的；
//   - 折叠标题（只改显示、不改文字，描述框里也关掉了折叠功能）。
// 粗体、斜体、删除线、高亮在 Quick Editing 里改由 Obsidian 自带命令负责（editor:toggle-bold 等），
// 它们是编辑器命令，描述框本来就支持，不在这份名单里。
// Quick Editing 以后若升级，需按分析脚本开头的说明重跑，再更新这份名单
// （名单里没有的命令在描述框里不响应，不会误改笔记）。

export const QUICK_EDITING_COMMANDS = new Set([
  'quick-editing:internal-link', // [[链接]]语法
  'quick-editing:tag-link-text', // 标签双链互转
  'quick-editing:internal-link2', // [[链接|同名]]语法
  'quick-editing:auto-text', // 智能符号
  'quick-editing:zeng-btexts', // 调高标题级别
  'quick-editing:jian-btexts', // 调低标题级别
  'quick-editing:auto-texts', // 自动设置标题
  'quick-editing:enlarge-texts', // 大字号文本
  'quick-editing:quit-format', // 关闭格式刷
  'quick-editing:gaoliang1-text', // *==多彩高亮1==*
  'quick-editing:gaoliang2-text', // **==多彩高亮2==**
  'quick-editing:gaoliang3-text', // ***==多彩高亮3==***
  'quick-editing:tuhei-text', // ==~~涂黑~~==
  'quick-editing:tucai-text', // *==~~涂彩~~==*
  'quick-editing:wakong-text', // *~~挖空~~*
  'quick-editing:xiahua-text', // _下划线_
  'quick-editing:add-langxian', // ~~~三浪线~~~
  'quick-editing:internal-hyper', // [[]]转为[]()
  'quick-editing:hyper-internal', // []()转为[[]]
  'quick-editing:clear-link', // 去除超链接语法()
  'quick-editing:add-up', // 上标语法
  'quick-editing:add-ub', // 下标语法
  'quick-editing:text-Color1', // 转换彩色文字1
  'quick-editing:text-Color2', // 转换彩色文字2
  'quick-editing:text-Color3', // 转换彩色文字3
  'quick-editing:text-Color4', // 转换彩色文字4
  'quick-editing:text-Color5', // 转换彩色文字5
  'quick-editing:text-background1', // 转换彩色背景1
  'quick-editing:text-background2', // 转换彩色背景2
  'quick-editing:text-background3', // 转换彩色背景3
  'quick-editing:text-background4', // 转换彩色背景4
  'quick-editing:text-background5', // 转换彩色背景5
  'quick-editing:add-todo', // 转换待办状态
  'quick-editing:sum-time', // 合计任务用时
  'quick-editing:add-todoTime', // 标记完成及时间
  'quick-editing:add-tiankong', // 填空{{c*::选文}}
  'quick-editing:list-mermaid', // 列表转为图示
  'quick-editing:file-path', // 转换路径
  'quick-editing:text-line', // 拆分多行
  'quick-editing:jian-fan', // 简体转繁
  'quick-editing:fan-jian', // 繁体转简
  'quick-editing:yinhao-yinhao', // 转换引号
  'quick-editing:old-Cursor', // 上次光标
  'quick-editing:parent-biaozhu', // 光标向上跳转
  'quick-editing:next-biaozhu', // 光标向下跳转
  'quick-editing:Selection-text', // 选择当前整段
  'quick-editing:Selection-juzi', // 选择当前整句
  'quick-editing:Selection-markdown', // 选择当前语法
  'quick-editing:iframe-URL', // 嵌入当前网址页面
  'quick-editing:sort-lines', // 升序排列所选段落
  'quick-editing:reverse-lines', // 降序排列所选段落
  'quick-editing:jiaId-lines', // 添加段落编号
  'quick-editing:jianId-lines', // 去除段落编号
  'quick-editing:promote-lines-level', // 调高所有标题级别
  'quick-editing:Down-lines-level', // 调低所有标题级别
  'quick-editing:modify-link-showname', // 修改内部链接的显示名称
  'quick-editing:add-Line0', // 插入有效空行
  'quick-editing:add-line1', // 上方插入空行
  'quick-editing:add-line2', // 下方插入空行
  'quick-editing:this-twoSpace', // 当前行缩进/取消缩进两字符
]);
