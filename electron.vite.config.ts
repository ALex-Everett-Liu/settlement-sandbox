import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// 目录约定与 electron-vite 的默认一致：src/main/index.ts、src/preload/index.ts、
// src/renderer/index.html。所以这里只挂渲染进程的 React 插件。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
});
