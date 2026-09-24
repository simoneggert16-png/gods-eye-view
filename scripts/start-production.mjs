import { spawn } from 'node:child_process';
import path from 'node:path';

const port = process.env.PORT || '4173';
console.log(`[God's Eye View] Starting production preview server on 0.0.0.0:${port}...`);

const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const child = spawn(npxCmd, ['vite', 'preview', '--host', '0.0.0.0', '--port', String(port)], {
  stdio: 'inherit',
  shell: true,
});

child.on('error', (err) => {
  console.error('[God\'s Eye View] Server error:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
