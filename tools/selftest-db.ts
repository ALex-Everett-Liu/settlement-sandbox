// 存档层自检：世界往返、日志只追加、快照与回退、参数表、旧库升级。
// 用法：node tools/selftest-db.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PARAMS } from '../src/engine/params.ts';
import { tickDay } from '../src/engine/tick.ts';
import { demoWorld } from '../src/engine/world.ts';
import {
  fillParamsGaps,
  loadParams,
  loadWorld,
  logCount,
  openWorldDb,
  restoreFromSnapshot,
  saveParams,
  saveWorld,
  siteCount,
  unitCount,
  writeSnapshot,
} from '../src/main/db.ts';

let bad = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!ok) bad += 1;
}

/** 键序无关的规范化，用来比较两份世界是不是同一个东西。 */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = o[k];
          return acc;
        }, {});
    }
    return val;
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-db-'));
const dbPath = path.join(dir, 'world.db');
const p = DEFAULT_PARAMS;

console.log('== 存档往返 ==');
let db = openWorldDb(dbPath);
const w = demoWorld();
saveWorld(db, w);
const back0 = loadWorld(db);
check(
  '势力／据点／连接／部队都回来了',
  back0.factions.length === 2 && back0.sites.length === 2 && back0.links.length === 1 && back0.units.length === 1,
);
check('表里的行数对得上', siteCount(db) === 2 && unitCount(db) === 1, siteCount(db) + ' 据点 / ' + unitCount(db) + ' 部队');
check('往返之后世界一模一样', canon(back0) === canon(w));

console.log('\n== 推进 30 天并存档 ==');
for (let i = 0; i < 30; i += 1) tickDay(w, p);
const logAfter30 = w.log.length;
saveWorld(db, w);
const back30 = loadWorld(db);
check('day 存住了', back30.day === 30, String(back30.day));
check('日志行数对得上', logCount(db) === logAfter30, logCount(db) + ' 行');
check('日志内容一致', canon(back30.log) === canon(w.log));

console.log('\n== 再存一次不该重复写日志 ==');
saveWorld(db, w);
check('日志行数没变', logCount(db) === logAfter30, String(logCount(db)));

console.log('\n== 快照 ==');
const snap = path.join(dir, 'snap-day30.db');
await writeSnapshot(db, snap);
check('快照文件生成了', fs.existsSync(snap), fs.existsSync(snap) ? fs.statSync(snap).size + ' 字节' : '');
const snapDb = new DatabaseSync(snap);
const snapDay = snapDb.prepare('SELECT v FROM meta WHERE k = ?').get('day') as { v: string };
check('快照里是第 30 天', Number(snapDay.v) === 30, snapDay.v);
snapDb.close();

console.log('\n== 回退 ==');
for (let i = 0; i < 30; i += 1) tickDay(w, p);
saveWorld(db, w);
check('继续跑到第 60 天', loadWorld(db).day === 60, String(loadWorld(db).day));
db.close();
await restoreFromSnapshot(snap, dbPath);
db = openWorldDb(dbPath);
check('回退之后回到第 30 天', loadWorld(db).day === 30, String(loadWorld(db).day));
check('回退之后日志也回去了', logCount(db) === logAfter30, String(logCount(db)));

console.log('\n== 参数表与版本 ==');
saveParams(db, p);
check('参数往返一致', canon(loadParams(db)) === canon(p));
const ver = db.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v: string };
check('schema 版本记下来了', Number(ver.v) === 2, ver.v);

console.log('\n== 旧库缺字段 ==');
// 造一份加 theme 之前写下的 params：把它按旧格式塞回 meta 表。
db.exec("DELETE FROM meta WHERE k = 'params'");
const legacy = { ...p } as Record<string, unknown>;
delete legacy['theme'];
db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('params', JSON.stringify(legacy));
check('旧 params 读出来确实没有 theme', !Object.hasOwn(loadParams(db) ?? {}, 'theme'));
const filled = fillParamsGaps(db, p);
check('补齐时报告缺的字段', filled.length === 1 && filled[0] === 'theme', filled.join('、'));
check('补齐后 theme 有了', loadParams(db)?.theme === 'light', String(loadParams(db)?.theme));
check('再补一次不动它', fillParamsGaps(db, p).length === 0);

console.log('\n== 旧库升级 ==');
// 手工造一份 v1 形状的库：links.terrain 是 NOT NULL，units 表还没有。
const legacyPath = path.join(dir, 'legacy-v1.db');
const old = new DatabaseSync(legacyPath);
old.exec(`
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE links (
  id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL,
  distance REAL NOT NULL, terrain TEXT NOT NULL
);
`);
old.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', '1');
old.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('day', '7');
old.prepare('INSERT INTO links (id, a, b, distance, terrain) VALUES (?, ?, ?, ?, ?)').run(1, 1, 2, 600, 'plain');
old.close();

const up = openWorldDb(legacyPath);
const ver2 = up.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v: string };
check('版本升到 2', Number(ver2.v) === 2, ver2.v);
const keptTerrain = up.prepare('SELECT terrain FROM links WHERE id = 1').get() as { terrain: string | null };
check('升级时旧数据带过来了', keptTerrain.terrain === 'plain', String(keptTerrain.terrain));
up.prepare('UPDATE links SET terrain = NULL WHERE id = 1').run();
const nulled = up.prepare('SELECT terrain FROM links WHERE id = 1').get() as { terrain: string | null };
check('升级后地貌可以为空', nulled.terrain === null);
const cols = (up.prepare("SELECT name FROM pragma_table_info('units')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
check('units 有 food_policy 列', cols.includes('food_policy'), cols.length + ' 列');
check('升级前留了副本', fs.existsSync(path.join(dir, 'legacy-v1.v1-backup.db')));
const keptDay = up.prepare('SELECT v FROM meta WHERE k = ?').get('day') as { v: string };
check('day 没被动过', Number(keptDay.v) === 7, keptDay.v);
up.close();

db.close();
console.log('\n临时目录：' + dir);
console.log(bad ? '\n' + bad + ' 项未通过' : '\n全部通过');
process.exit(bad ? 1 : 0);
