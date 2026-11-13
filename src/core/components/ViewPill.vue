<template>
  <!-- 底部悬浮视图切换胶囊（horizontal 菜单样式，保持原逻辑不变）。
       仍用 .tk-viewpill 包裹：该层为 position:absolute / height:0 / pointer-events:none，
       仅承载固定的底部胶囊模块，逻辑不受影响。 -->
  <div class="tk-viewpill" v-if="!vertical">
    <!-- 模块一：横向（展开态，居中胶囊） -->
    <transition name="tk-pill">
      <div class="tk-module-h tk-capsule" v-if="!collapsed" key="h">
        <div class="tk-module-h-items">
          <button v-for="v in flatItems" :key="v.key" type="button" draggable="true"
                  class="tk-viewpill-item" :class="{ on: view === v.key, 'menu-drag-over': menuDragOverKey === v.key }"
                  :title="$t(v.labelKey)"
                  @click="$emit('switch-view', v.key)"
                  @dragstart="onMenuDragStart(v.key, $event)" @dragover="onMenuDragOver(v.key, $event)"
                  @dragleave="onMenuDragLeave(v.key)" @drop="onMenuDrop(v.key, $event)" @dragend="onMenuDragEnd">
            <i :class="v.icon" class="vp-ico"></i><span class="vp-label">{{ $t(v.labelKey) }}</span>
          </button>
          <span class="tk-pill-sep"></span>
          <button class="tk-viewpill-item tk-viewpill-settings" type="button"
                  :title="$t('app.settings')" @click="openSettings">
            <i class="la la-cog vp-ico"></i><span class="vp-label">{{ $t('app.settings') }}</span>
          </button>
        </div>
        <button class="tk-viewpill-toggle" type="button"
                :title="$t('app.collapseViews')" @click="toggleCollapsed">
          <i class="la la-exchange-alt"></i>
        </button>
      </div>
    </transition>

    <!-- 模块二：竖向（折叠态，右下角圆钮 + hover 竖排列表） -->
    <transition name="tk-pill-v">
      <div class="tk-module-v" v-if="collapsed" key="v">
        <div class="tk-module-v-pill tk-capsule">
          <button class="tk-viewpill-toggle" type="button"
                  :title="$t('app.expandViews')" @click="toggleCollapsed">
            <i class="la la-exchange-alt"></i>
          </button>
        </div>
        <div class="tk-pill-v">
          <div class="tk-pill-v-inner">
            <button v-for="v in flatItems" :key="v.key" type="button" draggable="true"
                    class="tk-viewpill-item" :class="{ on: view === v.key, 'menu-drag-over': menuDragOverKey === v.key }"
                    :title="$t(v.labelKey)"
                    @click="$emit('switch-view', v.key)"
                    @dragstart="onMenuDragStart(v.key, $event)" @dragover="onMenuDragOver(v.key, $event)"
                    @dragleave="onMenuDragLeave(v.key)" @drop="onMenuDrop(v.key, $event)" @dragend="onMenuDragEnd">
              <i :class="v.icon" class="vp-ico"></i><span class="vp-label">{{ $t(v.labelKey) }}</span>
            </button>
            <button class="tk-viewpill-item tk-viewpill-settings" type="button"
                    :title="$t('app.settings')" @click="openSettings">
              <i class="la la-cog vp-ico"></i><span class="vp-label">{{ $t('app.settings') }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>

  <!-- 左侧固定「可展开/收起」竖向菜单（vertical 菜单样式；基础版与 Pro 共用，体验一致）。
       关键：必须直接作为 .task-app 的子节点，脱离 .tk-viewpill（其 height:0 会让内部
       absolute 轨道塌缩为 0 高度而不可见）。.task-app 为 position:relative 全高，
       故 top:0;bottom:0 才能铺满左侧；收起=仅图标竖栏，展开=图标+文字面板。 -->
  <div v-else class="tk-pro-rail" :class="{ collapsed: railCollapsed, right: railRight }">
    <div class="tk-pro-rail-items">
      <template v-for="(g, gi) in groups" :key="gi">
        <div v-if="gi > 0" class="tk-pro-rail-sep"></div>
        <div v-if="g.label" class="tk-pro-rail-group-h">{{ $t(g.label) }}</div>
        <button v-for="v in g.items" :key="v.key" type="button" draggable="true"
                class="tk-pro-rail-item" :class="{ on: view === v.key, 'menu-drag-over': menuDragOverKey === v.key }"
                v-tooltip="railCollapsed ? { text: $t(v.labelKey), placement: tipSide } : null"
                @click="$emit('switch-view', v.key)"
                @dragstart="onMenuDragStart(v.key, $event)" @dragover="onMenuDragOver(v.key, $event)"
                @dragleave="onMenuDragLeave(v.key)" @drop="onMenuDrop(v.key, $event)" @dragend="onMenuDragEnd">
          <i :class="v.icon" class="vp-ico"></i>
          <span class="vp-label">{{ $t(v.labelKey) }}</span>
        </button>
      </template>
    </div>
    <!-- 折叠 / 展开：位于设置上方，与设置按钮同款样式；整组动作按钮置底，与上方导航以分隔线隔开 -->
    <button class="tk-pro-rail-item tk-pro-rail-toggle" type="button"
            v-tooltip="railCollapsed ? { text: $t('app.expandViews'), placement: tipSide } : null"
            @click="$emit('update:rail-collapsed', !railCollapsed)">
      <i class="la la-exchange-alt vp-ico"></i>
      <span class="vp-label">{{ $t('app.collapseViews') }}</span>
    </button>
    <!-- 设置：左侧导航最下方，点击打开插件设置页（基础版 / Pro 共用） -->
    <button class="tk-pro-rail-item tk-pro-rail-settings" type="button"
            v-tooltip="railCollapsed ? { text: $t('app.settings'), placement: tipSide } : null"
            @click="openSettings">
      <i class="la la-cog vp-ico"></i>
      <span class="vp-label">{{ $t('app.settings') }}</span>
    </button>
  </div>
</template>

<script>
// 底部悬浮视图切换胶囊：从 TaskTopBar 的下拉抽离为独立组件，平铺全部视图。
// 宽度响应由父容器（.task-app）的 container-type 提供，见 tasks-shared.css 的 @container 规则。
import { VIEW_MENU_ITEMS } from '../composables/viewMenu.js';

export default {
  name: 'ViewPill',
  props: {
    // 当前视图 key：four / day / month / agenda / cl / all
    view: { type: String, required: true },
    // 是否竖向菜单模式：true 时渲染左侧固定菜单（取代底部胶囊）；由设置项 menuStyle 控制
    vertical: { type: Boolean, default: false },
    // 左侧菜单折叠态（由父组件持有并持久化）：true=收起(仅图标)，false=展开(图标+文字)
    railCollapsed: { type: Boolean, default: true },
    // 竖向菜单放在右侧（自用改版，设置里的「右侧竖向菜单」）：竖栏贴到右边，其余和左侧的一样
    railRight: { type: Boolean, default: false },
    // 插件实例：用于打开本插件设置页（由父组件 TasksApp 传入，确保 this.plugin 可用）
    plugin: { type: Object, default: null },
    // 菜单视图项（已按设置排序并过滤隐藏）：ViewPill 只负责渲染与拖拽，顺序/显隐由设置决定；
    // 缺省（未传或为空）回退为全部视图按默认顺序
    menuItems: { type: Array, default: null }
  },
  emits: ['switch-view', 'update:rail-collapsed', 'reorder-menu'],
  data() {
    return {
      // 内部折叠态（竖向菜单收起 / 展开）
      collapsed: this.loadCollapsed(),
      // 菜单拖拽排序的临时状态：正在拖拽的视图 key / 拖拽悬停目标 key
      dragMenuKey: '',
      menuDragOverKey: ''
    };
  },
  created() {
    this.collapsed = this.loadCollapsed();
  },
  computed: {
    // 竖栏收起时，鼠标停在图标上的提示朝哪边弹出：菜单在左侧就朝右，在右侧就朝左（自用改版）
    tipSide() { return this.railRight ? 'left' : 'right'; },
    // 菜单视图项：优先用设置传入的 menuItems（已排序 + 已过滤隐藏），否则回退全部视图默认顺序
    resolvedItems() {
      return (Array.isArray(this.menuItems) && this.menuItems.length) ? this.menuItems : VIEW_MENU_ITEMS;
    },
    // 视图分组：基础视图恒为一组（label 为 null 不渲染分组头）；供左侧竖向菜单遍历，
    // 横向胶囊 / 折叠列表由 flatItems 扁平排布。
    groups() {
      return [{ label: null, items: this.resolvedItems }];
    },
    // 横向胶囊 / 竖向折叠列表沿用扁平排布（分组头在窄行内容易拥挤）；仅左侧竖栏渲染分组头
    flatItems() {
      const out = [];
      for (const g of this.groups) for (const it of (g.items || [])) out.push(it);
      return out;
    }
  },
  methods: {
    loadCollapsed() {
      try { return window.localStorage.getItem('tk-viewpill-collapsed') === '1'; }
      catch (e) { return false; }
    },
    saveCollapsed(v) {
      try { window.localStorage.setItem('tk-viewpill-collapsed', v ? '1' : '0'); }
      catch (e) { /* 忽略存储不可用时异常 */ }
    },
    // 点击收起/展开：翻转后立即落盘，不依赖 watch
    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      this.saveCollapsed(this.collapsed);
    },
    // ===== 菜单拖拽排序：拖起某视图 → 悬停到另一视图上 → 松手即调序 =====
    // 顺序变更不在本组件内修改，统一上抛 reorder-menu(dragKey, overKey)，由父组件写设置并持久化
    onMenuDragStart(key, e) {
      this.dragMenuKey = key;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', key); } catch (err) { /* 忽略 */ }
      }
    },
    onMenuDragOver(key, e) {
      if (!this.dragMenuKey || this.dragMenuKey === key) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      this.menuDragOverKey = key;
    },
    onMenuDragLeave(key) {
      if (this.menuDragOverKey === key) this.menuDragOverKey = '';
    },
    onMenuDrop(key, e) {
      e.preventDefault();
      const drag = this.dragMenuKey || (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      this.dragMenuKey = '';
      this.menuDragOverKey = '';
      if (drag && drag !== key) this.$emit('reorder-menu', drag, key);
    },
    onMenuDragEnd() {
      this.dragMenuKey = '';
      this.menuDragOverKey = '';
    },
    // 打开本插件的设置页：先 open() 打开设置面板（任何 Obsidian 版本都支持），
    // 再尽力 openTabById 直接定位到本插件 Tab；个别旧版本无该方法则忽略，仍停在设置首页。
    // id 取 manifest.id（即 chaochao-list）
    openSettings() {
      const plugin = this.plugin;
      const app = plugin && plugin.app;
      const s = app && app.setting;
      const id = plugin && plugin.manifest && plugin.manifest.id;
      if (!s) return;
      try { s.open(); } catch (e) { /* 忽略 */ }
      try { if (typeof s.openTabById === 'function') s.openTabById(id); } catch (e) { /* 忽略 */ }
    }
  }
};
</script>

<style scoped>
/* ===== 容器：仅作定位上下文，自身不渲染样式 ===== */
.tk-viewpill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0;
  z-index: 20;
  pointer-events: none;
  /* 胶囊统一阴影：三处胶囊（横向 / 竖向钮 / 竖排列表）共用，便于集中调参 */
  --tk-pill-shadow: 0 6px 24px rgba(0, 0, 0, .18);
  /* 半透明胶囊底：基于 --panel 混透明，主题自适应；模糊由 backdrop-filter 提供 */
  --tk-pill-bg: color-mix(in srgb, var(--panel) 40%, transparent);
}

/* ===== 胶囊外壳：横向模块与竖向钮外壳共用的半透明毛玻璃胶囊（圆角 + 阴影 + 内边距） ===== */
.tk-capsule {
  display: inline-flex;
  align-items: center;
  padding: 6px 8px;
  background: var(--panel);            /* 兜底：不支持 color-mix 时回退为实色 */
  background: var(--tk-pill-bg);
  border-radius: 999px;
  box-shadow: var(--tk-pill-shadow);
  backdrop-filter: blur(10px) saturate(2);
  -webkit-backdrop-filter: blur(10px) saturate(2);
  pointer-events: auto;
}

/* ===== 模块一：横向（展开态，居中胶囊） ===== */
.tk-module-h {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  transform-origin: right center;
  gap: 2px;
}
/* 横向模块离开 / 进入：以右侧圆钮为锚点缩成圆 + 右移 + 渐隐（仅横向）。
   关键 transform-origin:right，使收缩朝右、而非对称朝中间收。 */
.tk-pill-enter-active,
.tk-pill-leave-active,
.tk-pill-v-enter-active,
.tk-pill-v-leave-active {
  transition: opacity .3s ease, transform .32s cubic-bezier(.4, 0, .2, 1);
}
.tk-pill-leave-to,
.tk-pill-enter-from {
  opacity: 0;
  transform: translateX(calc(-50% + 30px)) scale(.1);
}
/* 竖向模块进入 / 离开：进入时从左往右滑入（起点在左侧 30px 处）+ 渐显；
   离开时反向滑出 + 渐隐。竖向模块无 translateX 基线，故直接以 0 为终点。 */
.tk-pill-v-enter-from,
.tk-pill-v-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}
/* 视图按钮包裹层（仅结构区分，无特殊动画；收缩交由上方模块整体 scale） */
.tk-module-h-items {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

/* ===== 模块二：竖向（折叠态，右下角圆钮 + hover 竖排列表） =====
   收起钮与列表为两个独立面板（各自背景/阴影），不再融合成一个面板。 */
.tk-module-v {
  position: absolute;
  bottom: 32px;
  right: 16px;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  pointer-events: auto;
}
/* 收起钮外壳：复用 .tk-capsule 白胶囊；仅额外居中（钮本身透明、由外壳提供白色填充），
   保证横竖两个切换钮的外观/尺寸一致。 */
.tk-module-v-pill { justify-content: center; }

/* 竖排菜单：独立面板，仅 hover 时高度(0fr→1fr) + 宽度展开（暂沿用，不动） */
.tk-pill-v {
  display: grid;
  grid-template-rows: 0fr;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  margin-bottom: 6px;            /* 与下方圆钮面板留间隙，显出「分开」 */
  background: var(--panel);            /* 兜底 */
  background: var(--tk-pill-bg);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--tk-pill-shadow);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  transition: grid-template-rows .32s cubic-bezier(.4, 0, .2, 1),
              max-width .32s cubic-bezier(.4, 0, .2, 1),
              opacity .22s ease;
}
.tk-pill-v-inner {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}
.tk-pill-v .tk-viewpill-item { justify-content: flex-start; width: 100%; padding: 8px 12px; }
.tk-module-v:hover .tk-pill-v {
  grid-template-rows: 1fr;
  max-width: 1000px;
  opacity: 1;
  pointer-events: auto;
}

/* ===== 切换项 / 按钮 通用 ===== */
.tk-viewpill-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  color: var(--text-normal);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: none;
  white-space: nowrap;
  transition: background .15s ease, color .15s ease;
}
.tk-viewpill-item .vp-ico { font-size: 16px; width: 18px; text-align: center; flex: none; }
.tk-viewpill-item:not(.on):hover { background: var(--gold-bg); color: var(--ink); }
/* 当前视图：淡金底 + 金字（弱化实心金块的突兀感，仅以颜色/字重区分，不抢眼） */
.tk-viewpill-item.on { background: var(--gold-bg); color: var(--gold); font-weight: 700; }
/* 拖拽排序：悬停目标项描一圈金虚线，提示松手落点 */
.tk-viewpill-item.menu-drag-over { box-shadow: inset 0 0 0 2px var(--gold); }

/* 收起 / 展开按钮（两模块各一枚，图标方向不同） */
.tk-viewpill-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-normal);
  border-radius: 999px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.tk-viewpill-toggle:hover { background: var(--gold-bg); color: var(--ink); }

/* 面板宽 ≤ 768px：仅图标，文字隐藏（tooltip 由 title 提供） */
@container (max-width: 768px) {
  .tk-viewpill-item { padding: 8px 11px; }
  .tk-viewpill-item .vp-label { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .tk-module-h, .tk-pill-v, .tk-viewpill-item, .tk-viewpill-toggle,
  .tk-pill-enter-active, .tk-pill-leave-active,
  .tk-pill-v-enter-active, .tk-pill-v-leave-active { transition: none !important; }
}

/* ===== 竖向菜单（左侧 / 右侧，vertical 菜单样式，可展开/收起） =====
   自用改版：做成悬浮的玻璃面板（参照 macOS 的玻璃质感，和底部胶囊是同一路数）——
   不贴边，四周留 10px；大圆角（收起时正好是一条竖着的胶囊）；半透明底 + 背景模糊；
   一圈极细的描边、上沿一道高光、下方一层柔和的投影。
   面板让出的位置在 TasksApp 的 .task-app.tk-pro 里（收起 64px、展开 144px），两处的数要一起改。 */
.tk-pro-rail {
  /* 玻璃的几样「材料」集中在这里，想调深浅、通透程度只改这几行 */
  --tk-rail-bg: color-mix(in srgb, var(--panel-2) 55%, transparent);        /* 半透明的底色 */
  --tk-rail-sheen: rgba(255, 255, 255, .34);                                 /* 从上往下淡出的一层光泽 */
  --tk-rail-hairline: color-mix(in srgb, var(--ink) 10%, transparent);       /* 一圈极细的描边，也用作分隔线 */
  --tk-rail-rim: rgba(255, 255, 255, .75);                                   /* 上沿的高光 */
  --tk-rail-shadow: 0 3px 10px rgba(0, 0, 0, .09), 0 1px 2px rgba(0, 0, 0, .06);   /* 投影收得比较窄：紧贴着面板的一小圈 */
  --tk-rail-hover: color-mix(in srgb, var(--ink) 7%, transparent);           /* 鼠标停在某一项上的底色 */
  --tk-rail-on: color-mix(in srgb, var(--gold) 15%, transparent);            /* 当前视图那一项的底色 */

  position: absolute;
  left: 10px; top: 10px; bottom: 10px;
  width: 44px;                 /* 收起态：一列图标 */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  padding: 8px 6px;
  border-radius: 22px;
  background: var(--panel-2);  /* 兜底：不支持 color-mix 时退回实色 */
  background: linear-gradient(180deg, var(--tk-rail-sheen), transparent 38%), var(--tk-rail-bg);
  box-shadow: var(--tk-rail-shadow), inset 0 0 0 1px var(--tk-rail-hairline), inset 0 1px 0 var(--tk-rail-rim);
  backdrop-filter: blur(18px) saturate(1.8);
  -webkit-backdrop-filter: blur(18px) saturate(1.8);
  z-index: 15;
  overflow: hidden;
  transition: width .28s cubic-bezier(.4, 0, .2, 1);
}
/* 深色主题：高光、描边压暗，投影加重（.theme-dark 是 Obsidian 加在 <body> 上的） */
.theme-dark .tk-pro-rail {
  --tk-rail-bg: color-mix(in srgb, var(--panel-2) 62%, transparent);
  --tk-rail-sheen: rgba(255, 255, 255, .07);
  --tk-rail-hairline: rgba(255, 255, 255, .10);
  --tk-rail-rim: rgba(255, 255, 255, .18);
  --tk-rail-shadow: 0 3px 10px rgba(0, 0, 0, .40), 0 1px 2px rgba(0, 0, 0, .30);
  --tk-rail-hover: rgba(255, 255, 255, .08);
}
.tk-pro-rail:not(.collapsed) { width: 124px; }   /* 展开态：图标 + 文字 */
/* 右侧竖向菜单（自用改版）：悬浮在视图右边，其余和左侧的一样 */
.tk-pro-rail.right { left: auto; right: 10px; }

.tk-pro-rail-items {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; gap: 4px;
  justify-content: flex-start;
  overflow-y: auto; scrollbar-width: none;       /* 视图太多、窗口太矮时可以滚，不显示滚动条 */
}
.tk-pro-rail-items::-webkit-scrollbar { display: none; }
/* 分组标题（没有标签就不出）；收起态隐藏 */
.tk-pro-rail-group-h {
  font-size: 10.5px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
  color: var(--text-faint); padding: 10px 6px 4px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; flex: none;
}
.tk-pro-rail.collapsed .tk-pro-rail-group-h { display: none; }
/* 收起态：标题隐藏后，用一条细线分隔每个分组（第一个分组前不画）；展开态有标题，不用线 */
.tk-pro-rail-sep { display: none; }
.tk-pro-rail.collapsed .tk-pro-rail-sep {
  display: block; height: 0; border-top: 1px solid var(--tk-rail-hairline);
  margin: 6px 4px; flex: none;
}
/* 菜单里的每一项：展开时是一条圆角的行（图标 + 靠左的文字），收起时是一个小圆钮 */
.tk-pro-rail-item {
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  width: 100%; box-sizing: border-box; height: 32px; flex: none;
  border: none; background: transparent; color: var(--text-normal);
  font-family: inherit; font-size: 13px; font-weight: 600; text-align: left;
  padding: 0 5px; border-radius: 12px; cursor: pointer;
  box-shadow: none; white-space: nowrap;
  transition: background .15s ease, color .15s ease;
}
.tk-pro-rail-item .vp-ico { font-size: 18px; width: 22px; text-align: center; flex: none; }
/* 文字单行、靠左，太长就省略：避免中英文长短不一时换行，把图标顶歪 */
.tk-pro-rail-item .vp-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.tk-pro-rail.collapsed .tk-pro-rail-item { justify-content: center; padding: 0; border-radius: 999px; }
.tk-pro-rail.collapsed .vp-label { display: none; }
.tk-pro-rail-item:not(.on):hover { background: var(--tk-rail-hover); color: var(--ink); }
.tk-pro-rail-item.on { background: var(--tk-rail-on); color: var(--gold); font-weight: 700; }
/* 拖拽排序：悬停的那一项描一圈主题色，提示松手后落在哪 */
.tk-pro-rail-item.menu-drag-over { box-shadow: inset 0 0 0 2px var(--gold); }
/* 底部的「折叠」和「设置」：和上面的视图之间隔一条细线 */
.tk-pro-rail-toggle { margin-top: 12px; position: relative; overflow: visible; }
.tk-pro-rail-toggle::before {
  content: ''; position: absolute; left: 4px; right: 4px; top: -7px;
  height: 0; border-top: 1px solid var(--tk-rail-hairline);
}
.tk-pro-rail-settings { margin-top: 4px; }

/* 横向胶囊中设置按钮与视图项之间的竖向分隔线 */
.tk-pill-sep { width: 1px; align-self: stretch; background: var(--line); margin: 6px 4px; flex: none; }
</style>
