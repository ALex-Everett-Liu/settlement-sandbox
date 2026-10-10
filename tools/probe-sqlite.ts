// 探针：把本机 node:sqlite 的实际接口面打出来，不靠印象写存档层。
// 用法：node tools/probe-sqlite.ts
import * as sqlite from 'node:sqlite';

console.log('== node:sqlite 导出的名字 ==');
console.log(Object.keys(sqlite).sort().join(', '));

const anySqlite = sqlite as unknown as Record<string, unknown>;
console.log('\n== 关键成员 ==');
for (const name of ['DatabaseSync', 'StatementSync', 'backup', 'constants']) {
  const v = anySqlite[name];
  console.log(name + ': ' + (v === undefined ? '（没有）' : typeof v));
}
if (typeof anySqlite['backup'] === 'function') {
  const fn = anySqlite['backup'] as (...args: unknown[]) => unknown;
  console.log('backup.length = ' + fn.length);
  console.log('backup 源码开头：' + fn.toString().slice(0, 240).replace(/\s+/g, ' '));
}

const DatabaseSync = anySqlite['DatabaseSync'] as new (path: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    columns(): unknown;
  };
  close(): void;
  isTransaction?: boolean;
};

console.log('\n== DatabaseSync 原型上的方法 ==');
console.log(Object.getOwnPropertyNames(DatabaseSync.prototype).sort().join(', '));

console.log('\n== 一次最小往返 ==');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, v REAL)');
const ins = db.prepare('INSERT INTO t (name, v) VALUES (?, ?)');
console.log('run 的返回：' + JSON.stringify(ins.run('甲', 1.5), (_k, v) => (typeof v === 'bigint' ? String(v) + 'n' : v)));
ins.run('乙', 2.5);
console.log('get 一行：' + JSON.stringify(db.prepare('SELECT * FROM t WHERE id = ?').get(1)));
console.log('all 两行：' + JSON.stringify(db.prepare('SELECT * FROM t ORDER BY id').all()));

console.log('\n== 事务与 isTransaction ==');
console.log('isTransaction 属性存在：' + String('isTransaction' in db) + '，值 ' + String((db as { isTransaction?: unknown }).isTransaction));
db.exec('BEGIN');
db.exec('INSERT INTO t (name, v) VALUES (?, ?)'.replace('?', "'丙'").replace('?', '3.5'));
console.log('BEGIN 之后 isTransaction = ' + String((db as { isTransaction?: unknown }).isTransaction));
db.exec('ROLLBACK');
console.log('ROLLBACK 之后行数 = ' + JSON.stringify(db.prepare('SELECT COUNT(*) AS n FROM t').get()));
db.close();

console.log('\n== 落盘与快照 ==');
const fs = await import('node:fs');
const os = await import('node:os');
const nodePath = await import('node:path');
const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ss-probe-'));
const file = nodePath.join(dir, 'world.db');
const disk = new DatabaseSync(file);
disk.exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)');
disk.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('day', '42');
if (typeof anySqlite['backup'] === 'function') {
  const backup = anySqlite['backup'] as (a: unknown, b: string) => Promise<void>;
  await backup(disk, nodePath.join(dir, 'snap.db'));
  const snap = new DatabaseSync(nodePath.join(dir, 'snap.db'));
  console.log('备份文件里的 day = ' + JSON.stringify(snap.prepare('SELECT v FROM meta WHERE k = ?').get('day')));
  snap.close();
} else {
  console.log('没有 backup，只能用别的办法取快照');
}
disk.close();
console.log('临时目录：' + dir);
