import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE=1 时产出单文件模式：所有代码内联进一个 chunk，便于打包成独立 html
const single = process.env.SINGLE === '1';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 4000,
    ...(single
      ? {
          outDir: 'dist-single',
          assetsInlineLimit: 100000000,
          cssCodeSplit: false,
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        }
      : {}),
  },
});
