"""
只读分析「Quick Editing」插件（「增强编辑」的接手维护版）：哪些命令可以在 Dada 的任务描述框里使用。

何时重跑：Quick Editing 升级之后。结果用来更新 src/core/ui/quickEditingCommands.js 里的白名单。

用法（在仓库根目录）：
  1. 取与库里已装版本一致的源码（版本号见 <库>/.obsidian/plugins/quick-editing/manifest.json）：
       gh api "repos/hanser0521/quick-editing/contents/src/main.ts?ref=<版本号>" \
         -H "Accept: application/vnd.github.raw" > /tmp/qe-main.ts
  2. python3 tests/tools/analyze_quick_editing.py /tmp/qe-main.ts \
         --hotkeys "<库>/.obsidian/hotkeys.json" --old src/core/ui/enhancedEditingCommands.js
     （--hotkeys、--old 都可省略：前者只影响报告里「绑了快捷键的」那一段，后者只影响「与旧白名单的差异」）
  3. 把报告最后的 id 列表与 quickEditingCommands.js 对照更新；
     报告里新出现的排除项，要人工看一眼排除原因是否属实。

读：Quick Editing 的 main.ts，以及（可选）快捷键配置 hotkeys.json 和旧白名单；
写：不写任何文件，只把报告打印到屏幕。

判定思路（与 analyze_enhanced_editing.py 相同，按 Quick Editing 的写法做了调整）：
  描述框里放行某个命令的前提是「当场执行完、只改编辑器里的文字」。
  - Quick Editing 的命令通过 Obsidian 的「当前编辑器」(workspace.activeEditor) 拿编辑器；
    描述框获得焦点时「当前编辑器」就是描述框自己，所以这条取编辑器的路本身是安全的，不算风险。
  - 但延后执行的部分（异步、等剪贴板、弹出预览窗）真正执行时，焦点可能已经离开描述框，
    会落到别的笔记上；用到模块变量「当前文件」的，拿到的是背后打开的那篇笔记，不是任务所在的文件。
  所以顺着 this.函数名( 的调用关系，找出命令会执行到的全部函数（先去掉注释、按缩进切分函数），
  有以下任一情况的一律排除：异步、读剪贴板、操作窗口 / 标签页 / 文件 / 网页元素、联网、弹窗或菜单、
  调用 Obsidian 其他功能、用到「当前文件」、调用风险模块（剪贴板、预览、设置页、读写文件、库内链接），
  或会打开「格式刷」这类之后继续起作用的开关。
"""
import argparse
import io
import json
import re

# ---------- 读命令行参数 ----------

parser = argparse.ArgumentParser(description='只读分析 Quick Editing 哪些命令可在 Dada 描述框里使用')
parser.add_argument('main_ts', help='Quick Editing 的 src/main.ts 文件路径')
parser.add_argument('--hotkeys', help='库里的 .obsidian/hotkeys.json（可选）')
parser.add_argument('--old', help='旧白名单文件 src/core/ui/enhancedEditingCommands.js（可选）')
args = parser.parse_args()

raw_text = io.open(args.main_ts, encoding='utf-8').read()


def strip_comments(text):
    """去掉 // 行注释和 /* … */ 块注释，保留字符串和换行。

    不能先用正则删块注释再删行注释：源码里有「isGLS1 =false;   ///*==多彩高亮==*」这种
    行注释里夹着 /* 的写法，先删块注释会从这里一路删到很远的下一个 */，把整段代码吃掉。
    所以这里从左到右逐字扫描：在字符串（' " `）里时原样保留；不在字符串里时，
    遇到 // 就跳到行尾，遇到 /* 就跳到 */（块注释里的换行保留，行号不变）。
    正则字面量（如 /^https?:\\/\\//）里的斜杠都带反斜杠，不会被当成注释开头。
    """
    out, i, n = [], 0, len(text)
    quote = None  # 当前所在字符串的引号；None 表示不在字符串里
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:      # 转义字符：连同下一个字符一起保留
                out.append(text[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in '\'"`':
            quote = c
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            i = n if j < 0 else j            # 换行本身留给下一轮保留
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append('\n' * text.count('\n', i, j))
            i = j
            continue
        out.append(c)
        i += 1
    return ''.join(out)


text = strip_comments(raw_text)
lines = text.split('\n')

# ---------- 1. 顶部 import：记下每个导入的名字来自哪个模块 ----------

imported = {}  # 名字 → 模块路径，例如 'handleClipboardEvent' → './clipboard/event-paste'
for m in re.finditer(r'import\s*\{([^}]*)\}\s*from\s*[\'"]([^\'"]+)[\'"]', text):
    for part in m.group(1).split(','):
        name = part.strip()
        if not name:
            continue
        name = re.sub(r'^type\s+', '', name)          # 去掉 TypeScript 的 type 前缀
        name = name.split(' as ')[-1].strip()          # 「a as b」取本地名 b
        if name:
            imported[name] = m.group(2)

# 风险模块（按路径前缀匹配）：调用这些模块里的函数，说明命令会做「改文字」以外的事。
# 不在这里的 ./obsidian/internal-links（生成链接文字）、./obsidian/vault-file（判断是不是库内笔记）
# 经人工核对（1.0.7）都是同步、只读的纯函数，不算风险。
RISKY_MODULES = [
    ('./clipboard/', '剪贴板 / 粘贴'),
    ('./transformations/preview', '预览弹窗'),
    ('./ui/', '弹窗 / 设置页'),
]

# ---------- 2. 按缩进切分类的方法 ----------
# 函数头开头：4 个空格 + [private 等修饰词] + [async ] + 名字 + [<泛型>] + (
# 函数头可能跨好几行（参数一行一个），所以从「(」开始数括号，数到括号配平、且该行以「{」结尾为止；
# 括号配平了却不以「{」结尾的（例如抽象方法声明），不算方法。
# 方法结尾：4 个空格 + } 或 };
START = re.compile(
    r'^ {4}(?:(?:private|public|protected|static|readonly|override)\s+)*'
    r'(async\s+)?([\w一-鿿$]+)\s*(?:<[^>]*>)?\s*\(')
END = re.compile(r'^ {4}\};?\s*$')
NOT_METHODS = {'if', 'for', 'while', 'switch', 'catch', 'function', 'else'}


def signature_end(i, paren_pos):
    """从第 i 行的 paren_pos（「(」所在位置）起数括号，返回函数头结束（以「{」结尾）的行号；不是方法则返回 None。"""
    depth = 0
    for j in range(i, min(i + 20, len(lines))):
        seg = lines[j][paren_pos:] if j == i else lines[j]
        depth += seg.count('(') - seg.count(')')
        if depth <= 0:
            return j if lines[j].rstrip().endswith('{') else None
    return None


methods = {}  # 方法名 → [{async, body}]（同名方法可能有多个，例如重载）
i = 0
while i < len(lines):
    m = START.match(lines[i])
    if m and m.group(2) not in NOT_METHODS:
        sig_end = signature_end(i, m.end() - 1)
        if sig_end is not None:
            j = sig_end + 1
            while j < len(lines) and not END.match(lines[j]):
                j += 1
            methods.setdefault(m.group(2), []).append(
                {'async': bool(m.group(1)), 'body': '\n'.join(lines[i:j + 1])})
            i = j + 1
            continue
    i += 1

# ---------- 3. 格式刷开关：「关闭格式刷」里被设为 false 的变量，就是全部格式刷开关 ----------

brush_flags = set()
for d in methods.get('关闭格式刷', []):
    brush_flags.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*=\s*false\b', d['body']))
brush_pat = (r'\b(' + '|'.join(sorted(map(re.escape, brush_flags))) + r')\s*=\s*(true\b|!)') if brush_flags else None

# ---------- 4. 命令定义：this.addQuickCommand({ … }); ----------

commands = []  # [(id, 名称, 定义块)]
for m in re.finditer(r'this\.addQuickCommand\(\s*\{', text):
    end = text.find('});', m.end())
    block = text[m.start(): end + 3]
    idm = re.search(r"id\s*:\s*['\"]([^'\"]+)['\"]", block)
    nm = re.search(r"name\s*:\s*['\"]([^'\"]+)['\"]", block)
    if idm:
        commands.append((idm.group(1), nm.group(1) if nm else '', block))

# ---------- 5. 风险判定 ----------

# 允许的取编辑器写法：先替换成占位符，免得被「其他工作区调用」误判
ALLOWED_SNIPPETS = [
    ('this.app.workspace.activeEditor?.file ?? this.app.workspace.getActiveFile()', '__当前编辑器的文件__'),
    ('this.app.workspace.activeEditor', '__当前编辑器__'),
]
RISKS = [
    ('异步', r'\basync\b|\bawait\b|setTimeout|setInterval|requestAnimationFrame|\.then\(|queueMicrotask'),
    ('读剪贴板', r'clipboard\.read|\.readText\('),
    ('窗口/标签页', r'activeLeaf|getLeaf|iterateAllLeaves|iterateRootLeaves|setViewState|openLinkText'
                   r'|getLeavesOfType|splitActiveLeaf|getMostRecentLeaf|revealLeaf|setActiveLeaf'),
    # 只拦「写」：读文件列表、读元数据缓存、生成链接文字（generateMarkdownLink）都是同步只读，不拦
    ('写文件', r'vault\.(modify|modifyBinary|create|createBinary|createFolder|delete|trash|rename|copy|append|process)\b'
              r'|fileManager\.(renameFile|trashFile|processFrontMatter)\b'
              r'|adapter\.(write|writeBinary|append|remove|rmdir|mkdir|rename|copy|trashLocal|trashSystem)\b'),
    # 折叠只改显示、不改文字，而且描述框里已关掉折叠功能
    ('折叠', r'exec\(\s*[\'"](toggleFold|foldAll|unfoldAll|foldLess|foldMore)[\'"]'),
    ('网页元素', r'\bdocument\.|activeDocument\.|createEl\(|createDiv\(|\.innerHTML|querySelector|ownerDocument'),
    ('联网', r'requestUrl|fetch\(|XMLHttpRequest'),
    ('弹窗/菜单', r'\bnew\s+\w*Modal\b|\bnew\s+(obsidian\.)?Menu\b|showAtMouseEvent|showAtPosition'),
    ('其他工作区调用', r'workspace\.'),
    # 读元数据缓存（查链接目标、读别名）是同步只读，不拦；只拦注册 / 触发它的事件
    ('调用 Obsidian 其他功能', r'internalPlugins|app\.commands|app\.setting|app\.plugins'
                              r'|metadataCache\.(on|off|trigger)\b|\.leaf\b'),
    ('直接用笔记视图', r'\bview\.(?!editor\b)\w+'),
    ('用到「当前文件」（背后的笔记）', r'当前文件'),
]
# 只写剪贴板（不读）不影响任何笔记，单独标注、不算排除理由
NOTE_ONLY = [('写剪贴板', r'clipboard\.writeText|\.writeText\(')]


def closure(start_body):
    """从命令定义块出发，顺着 this.方法名( 找出会执行到的全部方法名。"""
    seen, stack = set(), [start_body]
    while stack:
        body = stack.pop()
        for callee in re.findall(r'this\.([\w一-鿿$]+)\s*\(', body):
            if callee in methods and callee not in seen:
                seen.add(callee)
                stack.extend(d['body'] for d in methods[callee])
    return seen


def judge(block):
    """返回 (排除理由列表, 备注列表, {理由: 命中位置附近的代码})。"""
    funcs = closure(block)
    bodies = [block] + [d['body'] for f in funcs for d in methods[f]]
    flags, notes, where = [], [], {}

    def hit(label, body, mm):
        if label not in flags:
            flags.append(label)
        where.setdefault(label, body[max(0, mm.start() - 40): mm.end() + 30].replace('\n', ' '))

    if any(d['async'] for f in funcs for d in methods[f]):
        flags.append('异步')
    for b in bodies:
        clean = b
        for snippet, placeholder in ALLOWED_SNIPPETS:
            clean = clean.replace(snippet, placeholder)
        for label, pat in RISKS:
            mm = re.search(pat, clean)
            if mm:
                hit(label, clean, mm)
        if brush_pat:
            mm = re.search(brush_pat, clean)
            if mm:
                hit('格式刷开关', clean, mm)
        # 调用导入的函数：来自风险模块的算排除理由
        for name, module in imported.items():
            mm = re.search(r'(?<![\w.$])' + re.escape(name) + r'\s*\(', clean)
            if not mm:
                continue
            if name == 'executeCoreCommand':
                # 只放行 Obsidian 自带的编辑器命令（editor:…），它们同样作用在「当前编辑器」上
                for cm in re.finditer(r'executeCoreCommand\([^,]+,\s*[\'"]([^\'"]+)[\'"]', clean):
                    if not cm.group(1).startswith('editor:'):
                        hit('调用 Obsidian 其他功能', clean, cm)
                continue
            for prefix, label in RISKY_MODULES:
                if module.startswith(prefix):
                    hit('模块：' + label, clean, mm)
        for label, pat in NOTE_ONLY:
            if re.search(pat, clean) and label not in notes:
                notes.append(label)
    return flags, notes, where


rows = [(cid, name, *judge(block)) for cid, name, block in commands]
safe = [r for r in rows if not r[2]]

# ---------- 6. 可选输入：快捷键与旧白名单 ----------

hotkeys = {}
if args.hotkeys:
    hk = json.load(io.open(args.hotkeys, encoding='utf-8'))
    for full_id, keys in hk.items():
        if not keys or ':' not in full_id:
            continue
        plugin, cid = full_id.split(':', 1)
        if plugin in ('quick-editing', 'Enhanced-editing'):
            label = ','.join('+'.join(k.get('modifiers', []) + [k.get('key', '')]) for k in keys)
            hotkeys.setdefault(cid, []).append(label + ('（旧版）' if plugin == 'Enhanced-editing' else ''))

old_ids = set()
if args.old:
    old_ids = set(re.findall(r"'Enhanced-editing:([^']+)'", io.open(args.old, encoding='utf-8').read()))

# ---------- 7. 报告 ----------

print('方法 %d 个；格式刷开关 %d 个；命令 %d 个 → 可放行 %d 个，排除 %d 个'
      % (sum(len(v) for v in methods.values()), len(brush_flags), len(rows), len(safe), len(rows) - len(safe)))

if hotkeys:
    print('\n=== 绑了快捷键的命令 ===')
    for cid, name, flags, notes, where in rows:
        if cid in hotkeys:
            verdict = '放行' if not flags else '排除（' + '、'.join(flags) + '）'
            print('  %-16s %-20s %-24s %s' % (cid, name[:20], ' / '.join(hotkeys[cid]), verdict))
            for k, v in list(where.items())[:2]:
                print('        [%s] …%s…' % (k, v[:110]))

if old_ids:
    now_ids = {r[0] for r in safe}
    all_ids = {r[0] for r in rows}
    print('\n=== 与旧白名单（增强编辑）的差异 ===')
    print('  旧版放行、这次排除：')
    for cid, name, flags, notes, where in rows:
        if cid in old_ids and flags:
            print('    %-16s %-20s 原因：%s' % (cid, name[:20], '、'.join(flags)))
            for k, v in list(where.items())[:2]:
                print('          [%s] …%s…' % (k, v[:110]))
    print('  旧版没放行、这次放行：')
    for cid, name, flags, notes, where in safe:
        if cid not in old_ids:
            print('    %-16s %s' % (cid, name))
    print('  旧版放行、新版已没有这个命令：', sorted(old_ids - all_ids) or '无')

print('\n=== 排除的命令（全部）===')
for cid, name, flags, notes, where in rows:
    if flags:
        print('  %-20s %-22s 原因：%s' % (cid, name[:22], '、'.join(flags)))

print('\n=== 放行命令全表（可直接贴进 quickEditingCommands.js）===')
for cid, name, flags, notes, where in safe:
    print("  'quick-editing:%s', // %s%s" % (cid, name, ('（' + '、'.join(notes) + '）') if notes else ''))
