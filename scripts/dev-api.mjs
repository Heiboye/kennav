// 本地开发入口：直接启动 wrangler pages dev，通过 --kv 注入本地 KV 模拟绑定。
// 不改写根 wrangler.jsonc（生产配置保持纯净）；PASSWORD/AUTH_SECRET 由 .dev.vars 提供。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';

const child = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', '8788', '--kv=CLOUDNAV_KV'], {
  stdio: 'inherit',
  cwd: ROOT,
  shell: process.platform === 'win32', // Windows 下 npx 为 npx.cmd
});

const exit = (code) => process.exit(code ?? 0);
process.on('SIGINT', () => exit(130));
process.on('SIGTERM', () => exit(143));
child.on('exit', (code) => exit(code ?? 0));
