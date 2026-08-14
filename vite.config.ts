import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // 开发时把 /api 请求代理到 wrangler pages dev 后端 (Cloudflare Functions)
          '/api': 'http://127.0.0.1:8788',
        },
      },
      plugins: [react()],
      // 注意：不再注入 GEMINI_API_KEY / API_KEY 到构建产物，避免密钥被编译进公开 JS；
      // AI 密钥改为运行时配置（登录后经 /api/storage?getConfig=ai 从 KV 读取）
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
