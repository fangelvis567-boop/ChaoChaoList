"""
只读分析「增强编辑」(Enhanced-editing) 插件：哪些命令可以在 Dada 的任务描述框里使用。

何时重跑：增强编辑插件升级（或被本地修改）之后。结果用来更新
src/core/ui/enhancedEditingCommands.js 里的白名单。

用法（在仓库根目录）：
  1. 用 Obsidian 命令行导出该插件的命令清单（Obsidian 需正在运行、主库已打开）：
       obsidian vault="<主库名>" eval code="JSON.stringify(Object.keys(app.commands.commands)
         .filter((k) => k.startsWith('Enhanced-editing:'))
         .map((k) => ({ id: k, name: app.commands.commands[k].name, hotkeys: [] })))" \
         | sed 's/^=> //' > /tmp/ee-commands.json
     （hotkeys 留空也行，只影响报告里「绑了快捷键的」那两段的筛选）
  2. python3 tests/tools/analyze_enhanced_editing.py <插件的 main.js 路径> /tmp/ee-commands.json
  3. 把报告最后一行的 id 列表与 enhancedEditingCommands.js 对照更新；
     报告里新出现的排除项，要人工看一眼排除原因是否属实。

读：插件的 main.js 和命令清单；写：不写任何文件，只打印报告。

判定思路：描述框里放行某个命令的前提是「当场执行完、只改编辑器里的文字」——
描述框只在命令执行的那一下把「当前打开的笔记」换成自己，延后执行的部分会落到背后的笔记上。
所以顺着 this.函数名( 的调用关系找出命令会执行到的全部函数（先去掉注释、按缩进切分函数），
有异步、直接操作窗口 / 标签页 / 文件 / 网页元素 / 联网 / 弹窗 / 其他 Obsidian 功能、
或会打开「格式刷」这类之后继续起作用的开关的，一律排除。
"""
import io, json, re, sys

src_path, cmd_path = sys.argv[1], sys.argv[2]
lines = io.open(src_path, encoding='utf-8').read().split('\n')
cmds = json.load(open(cmd_path, encoding='utf-8'))


def strip_comments(text):
    """去掉 /* … */ 块注释和行尾 // 注释（只认行首或空白后面的 //，避免误伤字符串里的 https://）。"""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return '\n'.join(re.sub(r'(^|\s)//.*$', r'\1', ln) for ln in text.split('\n'))


# 1. 按缩进切分方法：函数头是「4 个空格 + [async ] + 名字 + (参数) {」，结尾是「4 个空格 + } 或 };」
HEAD = re.compile(r'^ {4}(async +)?([\w一-鿿$]+) *\(([^()]*)\) *\{\s*$')
END = re.compile(r'^ {4}\};?\s*$')
methods = {}
i = 0
while i < len(lines):
    m = HEAD.match(lines[i])
    if m and m.group(2) not in ('if', 'for', 'while', 'switch', 'catch', 'function'):
        j = i + 1
        while j < len(lines) and not END.match(lines[j]):
            j += 1
        body = strip_comments('\n'.join(lines[i:j + 1]))
        methods.setdefault(m.group(2), []).append({'async': bool(m.group(1)), 'body': body})
        i = j + 1
        continue
    i += 1

# 2. addCommand 块：从 this.addCommand({ 到第一个 }); 为止
text = '\n'.join(lines)
cmd_bodies = {}
for m in re.finditer(r'this\.addCommand\(\s*\{', text):
    end = text.find('});', m.end())
    block = strip_comments(text[m.start(): end + 3])
    idm = re.search(r"id:\s*['\"]([^'\"]+)['\"]", block)
    if idm:
        cmd_bodies[idm.group(1)] = block

ALLOWED_VIEW_LINE = 'this.app.workspace.getActiveViewOfType(obsidian.MarkdownView)'
RISKS = [
    ('异步', r'\basync\b|\bawait\b|setTimeout|setInterval|requestAnimationFrame|\.then\('),
    ('窗口/标签页', r'activeLeaf|getLeaf|iterateAllLeaves|iterateRootLeaves|setViewState|openLinkText|getLeavesOfType|splitActiveLeaf'),
    ('读写文件', r'\bvault\.|fileManager|adapter\.'),
    ('网页元素', r'\bdocument\.|createEl\(|\.innerHTML|querySelector'),
    ('联网', r'requestUrl|fetch\(|XMLHttpRequest'),
    ('弹窗/菜单', r'\bnew\s+\w*Modal\b|\bnew\s+(obsidian\.)?Menu\b'),
    ('格式刷开关', r'\bis[A-Z]\w*\s*=\s*(true|!)'),
    ('其他工作区调用', r'workspace\.(?!getActiveViewOfType\(obsidian\.MarkdownView\))'),
    ('调用 Obsidian 其他功能', r'internalPlugins|app\.commands|app\.setting|app\.plugins|metadataCache|getActiveFile|activeEditor|\.leaf\b'),
    ('直接用笔记视图', r'\bview\.(?!editor\b)\w+'),
]
# 只写剪贴板（不读）不影响任何笔记，单独标注、不算排除理由
NOTE_ONLY = [('写剪贴板', r'clipboard\.writeText')]
BLOCK_CLIP_READ = ('读剪贴板', r'clipboard\.read')


def closure(start):
    seen, stack = set(), [start]
    while stack:
        body = stack.pop()
        for callee in re.findall(r'this\.([\w一-鿿$]+)\s*\(', body):
            if callee in methods and callee not in seen:
                seen.add(callee)
                stack.extend(d['body'] for d in methods[callee])
    return seen


rows = []
for c in cmds:
    cid = c['id'].split(':', 1)[1]
    block = cmd_bodies.get(cid)
    if not block:
        rows.append((c, ['找不到命令定义'], [], {}))
        continue
    funcs = closure(block)
    bodies = [block] + [d['body'] for f in funcs for d in methods[f]]
    flags, notes, where = [], [], {}
    if any(d['async'] for f in funcs for d in methods[f]):
        flags.append('异步')
    for label, pat in RISKS + [BLOCK_CLIP_READ]:
        for b in bodies:
            mm = re.search(pat, b)
            if mm:
                if label not in flags:
                    flags.append(label)
                where.setdefault(label, b[max(0, mm.start() - 40): mm.end() + 30].replace('\n', ' '))
                break
    for label, pat in NOTE_ONLY:
        if any(re.search(pat, b) for b in bodies):
            notes.append(label)
    rows.append((c, flags, notes, where))

safe = [r for r in rows if not r[1]]
print('可放行: %d 个；排除: %d 个（共 %d）' % (len(safe), len(rows) - len(safe), len(rows)))
print('\n=== 排除的命令里，绑了快捷键的 ===')
for c, flags, notes, where in rows:
    if flags and c['hotkeys']:
        print('  %-38s %-22s %-14s 原因: %s' % (c['id'].split(':')[1], c['name'].replace('增强编辑: ', '')[:20], ','.join(c['hotkeys']), '、'.join(flags)))
        for k, v in list(where.items())[:2]:
            print('        [%s] …%s…' % (k, v[:110]))
print('\n=== 放行的命令里，绑了快捷键的 ===')
for c, flags, notes, where in safe:
    if c['hotkeys']:
        print('  %-38s %-22s %-14s %s' % (c['id'].split(':')[1], c['name'].replace('增强编辑: ', '')[:20], ','.join(c['hotkeys']), ('（' + '、'.join(notes) + '）') if notes else ''))
print('\n=== 放行命令 id 全表 ===')
print(json.dumps([c['id'] for c, *_ in safe], ensure_ascii=False))
