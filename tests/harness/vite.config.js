// 浏览器演示页的开发服务器配置。
//
// 启动（在仓库根目录）：
//   npx vite --config tests/harness/vite.config.js
// 然后在浏览器打开 http://localhost:5199
//
// 它做的事：把 tests/harness/ 当作网站根目录，把源码里的 'obsidian' 换成演示用替身
// （tests/harness/obsidian-stub.js），这样编辑窗口可以脱离 Obsidian 在浏览器里运行。
// 读写范围：只读仓库源码；只监听本机 5199 端口；缓存写在 node_modules/.vite 里。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [vue()],
  resolve: {
    alias: { obsidian: resolve(here, 'obsidian-stub.js') }
  },
  // 与正式构建（仓库根目录的 vite.config.js）保持同样的编译期常量
  define: {
    __DADA_DEV__: 'false',
    'process.env': JSON.stringify({ NODE_ENV: 'development' })
  },
  server: {
    port: 5199,
    strictPort: true,
    // 演示页在 tests/harness/ 里，要允许它读取上两级的源码目录
    fs: { allow: [resolve(here, '../..')] }
  }
});
