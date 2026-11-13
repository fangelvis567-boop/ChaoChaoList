import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// line-awesome 的 @font-face 带 eot/woff2/woff/ttf/svg 五种格式，CSS url() 不吃
// assetsInlineLimit 函数，兜底格式会被全部内联（styles.css 暴涨）。这里在转换期直接把
// 每个 @font-face 改写为仅保留 woff2（Obsidian 桌面端 Chromium 必够用），字体以
// data-uri 内联进 styles.css。
function laWoff2Only() {
  return {
    name: 'dada:la-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('line-awesome.min.css')) return null;
      const next = code.replace(
        /src:url\(([^)]*)\.eot\);src:url\([^)]*\) format\("embedded-opentype"\),url\(([^)]*)\.woff2\) format\("woff2"\),url\([^)]*\) format\("woff"\),url\([^)]*\) format\("truetype"\),url\([^)]*\) format\("svg"\)/g,
        'src:url($1.woff2) format("woff2")'
      );
      return { code: next, map: null };
    }
  };
}


// ============================================================================
// Dada Todo · Obsidian 插件构建（库模式）
// ----------------------------------------------------------------------------
// 产物写入 chaochao-list/（目录名即插件 id，可直接整目录部署；2026-11-11 前 id 为 dada-todo-list）：
// main.js（CJS，Obsidian 要求）+ styles.css（Obsidian 自动注入）
//      + manifest.json（Obsidian 要求与 main.js 同目录，故构建后自动拷贝）。
// external：obsidian / electron 由 Obsidian 宿主提供，不打包。
//
// 部署：测试库插件目录软链到本目录产物文件夹
//   ~/Developer/dada-test-vault/.obsidian/plugins/chaochao-list
//     -> ~/Developer/dada-todo-list-mod/chaochao-list
// 开发循环：npm run dev 触发 watch 构建，Obsidian 重载社区插件即可生效。
// ============================================================================

const root = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'chaochao-list';
const isDev = process.env.DADA_DEV === '1';

// Mac 小组件程序的版本号和安装包校验值（自用改版）：只有发布脚本 scripts/release.sh 会通过环境变量
// CCL_WIDGET_APP 传进来（形如 {"version":"0.4.0","build":"6","sha256":"…"}），插件靠它判断要不要自动更新
// 小组件程序、核对下载的安装包（src/core/services/widgetAppUpdate.js）。平时自己构建没有这个变量，就是 null，
// 自动更新什么也不做。
function widgetAppInfo() {
  const raw = process.env.CCL_WIDGET_APP;
  if (!raw) return null;
  const o = JSON.parse(raw);
  if (!o || !/^\d+\.\d+\.\d+$/.test(o.version) || !/^\d+$/.test(o.build) || !/^[0-9a-f]{64}$/.test(o.sha256)) {
    throw new Error('CCL_WIDGET_APP 的内容不对：' + raw);
  }
  return { version: o.version, build: o.build, sha256: o.sha256 };
}

/** 构建后把 manifest.json 拷进产物目录（软链方式接库时产物必须自带 manifest） */
function copyManifest() {
  return {
    name: 'dada:copy-manifest',
    writeBundle() {
      copyFileSync(resolve(root, 'manifest.json'), resolve(root, OUT_DIR, 'manifest.json'));
    }
  };
}

export default defineConfig({
  plugins: [laWoff2Only(), vue(), copyManifest()],
  // 编译期注入 dev 标志 + 兜底手机端无 process 全局
  define: {
    __DADA_DEV__: JSON.stringify(isDev),
    __CCL_WIDGET_APP__: JSON.stringify(widgetAppInfo()),
    'process.env': JSON.stringify({ NODE_ENV: isDev ? 'development' : 'production' })
  },
  build: {
    outDir: OUT_DIR,
    // 任何模式都不清空产物目录：chaochao-list/ 被测试库软链为插件目录，
    // Obsidian 把运行时配置 data.json 写在这里，清空会删掉用户的标签颜色等全部设置
    // （产物文件名固定为 main.js/styles.css/manifest.json，无残留哈希文件风险）
    emptyOutDir: false,
    lib: {
      entry: 'src/core/main.js',
      formats: ['cjs'],
      fileName: () => 'main.js'
    },
    rollupOptions: {
      // @codemirror/*：Obsidian 运行时自带（内嵌编辑器要用），必须用它那一份，不能再打包一份进来，
      // 否则两份 CodeMirror 的扩展互不认识，编辑器会报「Unrecognized extension value」
      external: ['obsidian', 'electron', '@electron/remote', '@codemirror/state', '@codemirror/view'],
      output: {
        // 手机端 webview 无 process 全局时的兜底（仅不存在时注入）
        banner: `try{if(typeof process==='undefined'){globalThis.process={env:{NODE_ENV:${JSON.stringify(isDev ? 'development' : 'production')}}};}}catch(e){}`,
        // Obsidian 约定样式文件名为 styles.css
        assetFileNames: (info) => (info.name && info.name.endsWith('.css') ? 'styles.[ext]' : '[name].[ext]')
      }
    },
    cssCodeSplit: false,
    // Obsidian 桌面端为 Electron（Chromium 较新），无需转译降级
    target: 'chrome108',
    // line-awesome 字体：woff2 以 data-uri 内联进 styles.css（插件只有两个产物文件，
    // 不能引用外部字体文件）；woff/ttf/eot/svg 是 woff2 的兜底格式，Chromium 用不到，
    // 一律不内联（emit 到 dist/assets 也不会被引用）
    assetsInlineLimit: (filePath) => filePath.endsWith('.woff2')
  }
});
