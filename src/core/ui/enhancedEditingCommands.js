// 「增强编辑」(Enhanced-editing) 插件里，可以在任务描述框中使用的命令（自用改版）
// ----------------------------------------------------------------------------
// 注：2026-11-10 起主库已换用增强编辑的接手版 Quick Editing（名单见 quickEditingCommands.js）。
// 这份名单保留不删，供退回旧插件时使用；旧插件停用后它的命令不再注册，这里的条目不起作用。
//
// 背景：增强编辑的命令不认 Obsidian 的「当前编辑器」，只认「当前打开的笔记」
// （workspace.getActiveViewOfType(MarkdownView).editor）。在描述框里按它的快捷键时，
// embeddedEditor.js 会在这条命令执行的那一下，把「当前打开的笔记」临时换成描述框，
// 执行完立刻换回。所以只能放行「当场执行完、只改编辑器里文字」的命令——
// 会延后执行（异步）的命令，延后的那部分会落到背后那篇笔记上。
//
// 这份名单是逐个分析增强编辑的源码得出的（2026-11-10，用户本机的版本，含本地修改）：
// 顺着每个命令会调用到的全部函数检查，排除了以下几类，共 27 个：
//   - 格式刷类（打开后会在之后的选择上继续起作用）：粗体 / 斜体 / 删除线 / 下划线格式刷、
//     转换无语法文本（不选文字时会打开纯文本格式刷）等；
//   - 异步、或直接操作窗口 / 标签页的：左窗上下滚动、修改内部链接的显示名称等；
//   - 调用 Obsidian 其他功能的：折叠各级标题、搜索、读写文件等。
// 增强编辑以后若升级，需重新分析后再更新这份名单（名单里没有的命令在描述框里不响应，不会误改笔记）。

export const ENHANCED_EDITING_COMMANDS = new Set([
  'Enhanced-editing:internal-link', // [[链接]]语法
  'Enhanced-editing:tag-text', // #标签 语法
  'Enhanced-editing:tag2link-text', // 标签转为内链
  'Enhanced-editing:link2tag-text', // 内链转为标签
  'Enhanced-editing:internal-link2', // [[链接|同名]]语法
  'Enhanced-editing:auto-text', // 智能符号
  'Enhanced-editing:mouse-up', // 游标上移
  'Enhanced-editing:mouse-down', // 游标下移
  'Enhanced-editing:mouse-left', // 游标左移
  'Enhanced-editing:mouse-right', // 游标右移
  'Enhanced-editing:mouse-start', // 游标移至行首
  'Enhanced-editing:mouse-end', // 游标移至行尾
  'Enhanced-editing:note-start', // 游标移至文首
  'Enhanced-editing:note-end', // 游标移至文末
  'Enhanced-editing:biaoti0-text', // 取消标题
  'Enhanced-editing:biaoti1-text', // H1标题
  'Enhanced-editing:biaoti2-text', // H2标题
  'Enhanced-editing:biaoti3-text', // H3标题
  'Enhanced-editing:biaoti4-text', // H4标题
  'Enhanced-editing:biaoti5-text', // H5标题
  'Enhanced-editing:biaoti6-text', // H6标题
  'Enhanced-editing:auto-texts', // 自动设置标题
  'Enhanced-editing:enlarge-texts', // 大字号文本
  'Enhanced-editing:quit-format', // 关闭格式刷
  'Enhanced-editing:cuti-text', // **粗体**
  'Enhanced-editing:gaoliang-text', // ==高亮==
  'Enhanced-editing:gaoliang1-text', // *==多彩高亮1==*
  'Enhanced-editing:gaoliang2-text', // **==多彩高亮2==**
  'Enhanced-editing:gaoliang3-text', // ***==多彩高亮3==***
  'Enhanced-editing:tuhei-text', // ==~~涂黑~~==
  'Enhanced-editing:tucai-text', // *==~~涂彩~~==*
  'Enhanced-editing:wakong-text', // *~~挖空~~*
  'Enhanced-editing:xieti-text', // *斜体*
  'Enhanced-editing:shanchu-text', // ~~删除线~~
  'Enhanced-editing:xiahua-text', // _下划线_
  'Enhanced-editing:add-daima', // ```代码块```
  'Enhanced-editing:add-langxian', // ~~~三浪线~~~
  'Enhanced-editing:add-callout', // 转换callout语法 
  'Enhanced-editing:internal-hyper', // [[]]转为[]()
  'Enhanced-editing:hyper-internal', // []()转为[[]]
  'Enhanced-editing:clear-link', // 去除超链接语法()
  'Enhanced-editing:copy-text', // 获取无语法文本
  'Enhanced-editing:add-up', // 上标语法
  'Enhanced-editing:add-ub', // 下标语法
  'Enhanced-editing:text-Color1', // 转换彩色文字1
  'Enhanced-editing:text-Color2', // 转换彩色文字2
  'Enhanced-editing:text-Color3', // 转换彩色文字3
  'Enhanced-editing:text-Color4', // 转换彩色文字4
  'Enhanced-editing:text-Color5', // 转换彩色文字5
  'Enhanced-editing:text-background1', // 转换彩色背景1
  'Enhanced-editing:text-background2', // 转换彩色背景2
  'Enhanced-editing:text-background3', // 转换彩色背景3
  'Enhanced-editing:text-background4', // 转换彩色背景4
  'Enhanced-editing:text-background5', // 转换彩色背景5
  'Enhanced-editing:add-todo', // 转换待办状态
  'Enhanced-editing:sum-time', // 合计任务用时
  'Enhanced-editing:add-todoTime', // 标记完成及时间
  'Enhanced-editing:y2w-list', // 有转无序列表()
  'Enhanced-editing:w2y-list', // 无转有序列表()
  'Enhanced-editing:add-tiankong', // 填空{{c*::选文}}
  'Enhanced-editing:list-mermaid', // 列表转为图示
  'Enhanced-editing:file-path', // 转换路径
  'Enhanced-editing:text-line', // 拆分多行
  'Enhanced-editing:jian-fan', // 简体转繁
  'Enhanced-editing:fan-jian', // 繁体转简
  'Enhanced-editing:yinhao-yinhao', // 转换引号
  'Enhanced-editing:jisuan-form', // 计算所选结果
  'Enhanced-editing:edit-intext', // 修复外来文本
  'Enhanced-editing:edit-biaodian', // 修复错误标点
  'Enhanced-editing:edit-yufa', // 修复错误语法
  'Enhanced-editing:edit-duanhang', // 修复意外断行
  'Enhanced-editing:delete-list', // 删除当前段落
  'Enhanced-editing:old-Cursor', // 上次光标
  'Enhanced-editing:parent-biaozhu', // 光标向上跳转
  'Enhanced-editing:next-biaozhu', // 光标向下跳转
  'Enhanced-editing:Selection-text', // 选择当前整段
  'Enhanced-editing:Selection-juzi', // 选择当前整句
  'Enhanced-editing:Selection-markdown', // 选择当前语法
  'Enhanced-editing:tiqu-text', // 获取标注文本
  'Enhanced-editing:iframe-URL', // 嵌入当前网址页面
  'Enhanced-editing:sort-lines', // 升序排列所选段落
  'Enhanced-editing:reverse-lines', // 降序排列所选段落
  'Enhanced-editing:jiaId-lines', // 添加段落编号
  'Enhanced-editing:jianId-lines', // 去除段落编号
  'Enhanced-editing:add-Line0', // 插入有效空行
  'Enhanced-editing:space-lines', // 空格转为空行
  'Enhanced-editing:add-lines', // 批量插入空行
  'Enhanced-editing:add-line1', // 上方插入空行
  'Enhanced-editing:add-line2', // 下方插入空行
  'Enhanced-editing:del-lines', // 批量去除空行
  'Enhanced-editing:this-twoSpace', // 当前行缩进
  'Enhanced-editing:add-space2', // 行首添加空格
  'Enhanced-editing:del-space1', // 去除行首空格
  'Enhanced-editing:add-space1', // 末尾追加空格
  'Enhanced-editing:del-space2', // 去除末尾空格
  'Enhanced-editing:add-allSpspace', // 添加间隔空格
  'Enhanced-editing:del-allSpspace', // 去除所有空格
  'Enhanced-editing:del-allZhushi' // 去除所有注释
]);
