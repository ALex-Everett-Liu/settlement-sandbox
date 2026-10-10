// electron's binary does not come from the npm registry: its own install script
// downloads it separately. npm sometimes finishes without it (see README), which
// leaves a tree that installs fine but cannot start. This runs after every
// `npm install` and fills the gap; if the download fails it exits non-zero
// instead of leaving that broken state.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const root = process.cwd();
const installer = path.join(root, 'node_modules', 'electron', 'install.js');
const binary =
  process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', 'electron', 'dist', 'electron');

if (!existsSync(installer)) {
  console.log('[ensure-electron] electron 还没装上，跳过');
  process.exit(0);
}

if (existsSync(binary)) {
  console.log('[ensure-electron] 二进制在：' + binary);
  process.exit(0);
}

console.log('[ensure-electron] 缺二进制，跑 electron 自己的安装脚本…');
try {
  execFileSync(process.execPath, [installer], { stdio: 'inherit', cwd: root });
} catch (e) {
  console.error('[ensure-electron] 下载失败：' + (e && e.message ? e.message : String(e)));
  console.error('[ensure-electron] 手动重试：node node_modules/electron/install.js');
  process.exit(1);
}

if (!existsSync(binary)) {
  console.error('[ensure-electron] 脚本跑完了，二进制还是不在：' + binary);
  process.exit(1);
}

console.log('[ensure-electron] 补上了：' + binary);
