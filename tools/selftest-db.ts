// 存档层自检：世界往返、日志只追加、快照与回退、参数表、旧库升级。
// 用法：node tools/selftest-db.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PARAMS } from '../src/engine/params.ts';
import { tickDay } from '../src/engine/tick.ts';
import { demoWorld, emptyWorld, FACTION_COLORS } from '../src/engine/world.ts';
import {
  fillParamsGaps,
  hasWorld,
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
check(
  '势力颜色也往返回来了',
  back0.factions[0]!.color === w.factions[0]!.color && back0.factions[0]!.color === FACTION_COLORS[0],
  back0.factions[0]!.color,
);
check(
  '地貌那五行也往返一致',
  canon(back0.terrains) === canon(w.terrains),
  back0.terrains.map((t) => t.name).join('、'),
);

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

console.log('\n== 保存之后主文件就是最新的 ==');
// 主文件单独拿走（不带 -wal）也该是最新的：保存之后 WAL 已经并回去了。
const mainOnly = path.join(dir, 'main-only.db');
fs.copyFileSync(dbPath, mainOnly);
const mainOnlyDb = new DatabaseSync(mainOnly, { readOnly: true });
const mainDay = Number((mainOnlyDb.prepare("SELECT v FROM meta WHERE k = 'day'").get() as { v: string }).v);
const mainLog = Number((mainOnlyDb.prepare('SELECT COUNT(*) AS n FROM log').get() as { n: number }).n);
mainOnlyDb.close();
check('主文件单独看也是最新的一天', mainDay === 30, String(mainDay));
check('主文件单独看日志也齐', mainLog === logAfter30, String(mainLog));

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
check('schema 版本记下来了', Number(ver.v) === 9, ver.v);

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

// 加 pageSize 之前写下的 params：同一个做法再走一遍。这一项不升 schema——参数表是 meta 里一段 JSON，
// 旧库打开时按默认值补齐，所以每页条数在旧库上也有值。
db.exec("DELETE FROM meta WHERE k = 'params'");
const older = { ...p } as Record<string, unknown>;
delete older['pageSize'];
db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('params', JSON.stringify(older));
const filledPage = fillParamsGaps(db, p);
check('缺 pageSize 时报告它', filledPage.length === 1 && filledPage[0] === 'pageSize', filledPage.join('、'));
check('补齐后每页 50 条', loadParams(db)?.pageSize === 50, String(loadParams(db)?.pageSize));

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
check('版本升到 9', Number(ver2.v) === 9, ver2.v);
const kept = up.prepare('SELECT detour, terrain FROM links WHERE id = 1').get() as {
  detour: number;
  terrain: number | null;
};
check('升级时地貌按名字指到了平原那一行', Number(kept.terrain) === 1, String(kept.terrain));
check('长度换成系数，按 1.0 起', Number(kept.detour) === 1, String(kept.detour));
const terrainCol = up.prepare("SELECT type FROM pragma_table_info('links') WHERE name = 'terrain'").get() as {
  type: string;
};
check('links.terrain 由名字改成了编号列', terrainCol.type.toUpperCase() === 'INTEGER', terrainCol.type);
const terrainRows = up.prepare('SELECT COUNT(*) AS n FROM terrains').get() as { n: number };
check('terrains 表写进了开头那五档', Number(terrainRows.n) === 5, String(terrainRows.n));
const plainRow = up.prepare('SELECT name, speed FROM terrains WHERE id = 1').get() as { name: string; speed: number };
check('平原那一行的名字与系数照旧', plainRow.name === '平原' && Number(plainRow.speed) === 1, JSON.stringify(plainRow));
const linkCols = (up.prepare("SELECT name FROM pragma_table_info('links')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
check('老的长度列没了', !linkCols.includes('distance'), linkCols.join('、'));
up.prepare('UPDATE links SET terrain = NULL WHERE id = 1').run();
const nulled = up.prepare('SELECT terrain FROM links WHERE id = 1').get() as { terrain: number | null };
check('升级后地貌可以为空', nulled.terrain === null);
const cols = (up.prepare("SELECT name FROM pragma_table_info('units')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
check('units 有 food_policy 列', cols.includes('food_policy'), cols.length + ' 列');
const siteCols = (up.prepare("SELECT name FROM pragma_table_info('sites')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
check('sites 有 level 列', siteCols.includes('level'), siteCols.join('、'));
check('升级前留了副本', fs.existsSync(path.join(dir, 'legacy-v1.v1-backup.db')));
const keptDay = up.prepare('SELECT v FROM meta WHERE k = ?').get('day') as { v: string };
check('day 没被动过', Number(keptDay.v) === 7, keptDay.v);
up.close();

console.log('\n== v3 升 v9：层级初值、辖区表与拆开的两个新字段 ==');
// 造一份 v3 形状的库：sites 没有 level 列，B 挂在 A 下面（A 应当拿第 1 层、B 拿第 0 层）。
const v3Path = path.join(dir, 'legacy-v3.db');
const v3 = new DatabaseSync(v3Path);
v3.exec(`
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE sites (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
  scale INTEGER NOT NULL, population INTEGER NOT NULL, morale REAL NOT NULL,
  stability REAL NOT NULL, money REAL NOT NULL, food REAL NOT NULL,
  parent INTEGER, faction INTEGER NOT NULL
);
`);
v3.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', '3');
const insV3 = v3.prepare(
  'INSERT INTO sites (id, name, x, y, scale, population, morale, stability, money, food, parent, faction)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
insV3.run(1, 'A 城', 0, 0, 1, 0, 70, 60, 0, 0, null, 1);
insV3.run(2, 'B 城', 0, 0, 1, 0, 70, 60, 0, 0, 1, 1);
v3.close();

const up3 = openWorldDb(v3Path);
const ver3 = up3.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v: string };
check('v3 的库升到 9', Number(ver3.v) === 9, ver3.v);
const lv = up3.prepare('SELECT id, level FROM sites ORDER BY id').all() as Array<{ id: number; level: number }>;
check('升级时按上下级算出层级初值', Number(lv[0]?.level) === 1 && Number(lv[1]?.level) === 0, JSON.stringify(lv));
const divTable = up3
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'divisions'")
  .get() as { name: string } | undefined;
check('有了 divisions 表', divTable !== undefined, String(divTable?.name));
const divCount = up3.prepare('SELECT COUNT(*) AS n FROM divisions').get() as { n: number };
check('辖区是空的，等 User 自己建', Number(divCount.n) === 0, String(divCount.n));
const siteCols3 = (
  up3.prepare("SELECT name FROM pragma_table_info('sites')").all() as Array<{ name: string }>
).map((r) => r.name);
check(
  'sites 有了 development 与 fortification',
  siteCols3.includes('development') && siteCols3.includes('fortification'),
  siteCols3.join('、'),
);
check('老的 scale 列没了', !siteCols3.includes('scale'));
const grown3 = up3.prepare('SELECT id, development, fortification FROM sites ORDER BY id').all() as Array<{
  id: number;
  development: number;
  fortification: number;
}>;
check(
  '规模 1 折成发展度 20、防御设施等级 0',
  Number(grown3[0]?.development) === 20 && Number(grown3[0]?.fortification) === 0,
  JSON.stringify(grown3),
);
check('升级前留了 v3 的副本', fs.existsSync(path.join(dir, 'legacy-v3.v3-backup.db')));
up3.close();

console.log('\n== v5 升 v9：自由坐标五列与拆开的两个新字段 ==');
// 造一份 v5 形状的库：units 有 food_policy，但没有自由坐标那几列。
const v5Path = path.join(dir, 'legacy-v5.db');
const v5 = new DatabaseSync(v5Path);
v5.exec(`
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE sites (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
  scale INTEGER NOT NULL, population INTEGER NOT NULL, morale REAL NOT NULL,
  stability REAL NOT NULL, money REAL NOT NULL, food REAL NOT NULL,
  parent INTEGER, level INTEGER NOT NULL, division INTEGER, faction INTEGER NOT NULL
);
CREATE TABLE units (
  id INTEGER PRIMARY KEY, faction INTEGER NOT NULL, name TEXT NOT NULL,
  troops INTEGER NOT NULL, training REAL NOT NULL, organization REAL NOT NULL,
  place_kind TEXT NOT NULL, place_site INTEGER, place_link INTEGER,
  place_from INTEGER, place_to INTEGER, place_t REAL,
  carried_food REAL NOT NULL, queue_json TEXT NOT NULL, food_policy TEXT
);
`);
v5.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', '5');
v5.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('day', '3');
v5
  .prepare(
    'INSERT INTO sites (id, name, x, y, scale, population, morale, stability, money, food, parent, level, division, faction)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(1, 'A 城', 100, 200, 1, 0, 70, 60, 0, 0, null, 0, null, 1);
v5
  .prepare(
    'INSERT INTO units (id, faction, name, troops, training, organization, place_kind, place_site,' +
      ' carried_food, queue_json, food_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(1, 1, '甲队', 500, 50, 100, 'site', 1, 10, '[]', null);
v5.close();

const up5 = openWorldDb(v5Path);
const ver5 = up5.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v: string };
check('v5 的库升到 9', Number(ver5.v) === 9, ver5.v);
const unitCols5 = (
  up5.prepare("SELECT name FROM pragma_table_info('units')").all() as Array<{ name: string }>
).map((r) => r.name);
check(
  'units 有了自由坐标那五列',
  ['place_x', 'place_y', 'place_tx', 'place_ty', 'place_factor'].every((c) => unitCols5.includes(c)),
  unitCols5.join('、'),
);
const keptUnit = up5.prepare('SELECT place_kind, place_site, place_x FROM units WHERE id = 1').get() as {
  place_kind: string;
  place_site: number;
  place_x: number | null;
};
check(
  '老行原样留着，新列是空的',
  keptUnit.place_kind === 'site' && Number(keptUnit.place_site) === 1 && keptUnit.place_x === null,
);
check('升级前留了 v5 的副本', fs.existsSync(path.join(dir, 'legacy-v5.v5-backup.db')));
const grown5 = up5.prepare('SELECT development, fortification FROM sites WHERE id = 1').get() as {
  development: number;
  fortification: number;
};
check(
  'v5 那一点也按 规模 × 20 折过来，防御设施等级从 0 起',
  Number(grown5.development) === 20 && Number(grown5.fortification) === 0,
  JSON.stringify(grown5),
);
up5.close();

console.log('\n== v8 升 v9：势力颜色 ==');
// 造一份 v8 形状的库：factions 只有 id 与 name（那时候还没有颜色这一列）。
const v8Path = path.join(dir, 'legacy-v8.db');
const v8 = new DatabaseSync(v8Path);
v8.exec(`
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE factions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
`);
v8.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', '8');
v8.prepare('INSERT INTO factions (id, name) VALUES (?, ?)').run(1, '魏');
v8.prepare('INSERT INTO factions (id, name) VALUES (?, ?)').run(2, '蜀');
v8.prepare('INSERT INTO factions (id, name) VALUES (?, ?)').run(7, '吴');
v8.close();

const up8 = openWorldDb(v8Path);
const ver8 = up8.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v: string };
check('v8 的库升到 9', Number(ver8.v) === 9, ver8.v);
const facCols = (up8.prepare("SELECT name FROM pragma_table_info('factions')").all() as Array<{ name: string }>).map(
  (r) => r.name,
);
check('factions 有了 color 列', facCols.includes('color'), facCols.join('、'));
const facRows = up8.prepare('SELECT id, name, color FROM factions ORDER BY id').all() as Array<{
  id: number;
  name: string;
  color: string;
}>;
check(
  '颜色按编号顺次发：魏第一个、蜀第二个、吴第三个',
  facRows[0]?.color === FACTION_COLORS[0] &&
    facRows[1]?.color === FACTION_COLORS[1] &&
    facRows[2]?.color === FACTION_COLORS[2],
  facRows.map((f) => f.name + '=' + f.color).join('、'),
);
check('升级前留了 v8 的副本', fs.existsSync(path.join(dir, 'legacy-v8.v8-backup.db')));
up8.close();

console.log('\n== 据点之外的位置往返 ==');
const fieldPath = path.join(dir, 'field.db');
const fdb = openWorldDb(fieldPath);
const fw = demoWorld();
fw.units[0]!.place = { kind: 'camp', x: 1234.5, y: 678.9 };
fw.units[0]!.queue = [{ kind: 'offroad', toSite: null, toX: 2000, toY: 100, factor: 0.35 }];
saveWorld(fdb, fw);
check('停在野地里：坐标与那条命令都回来了', canon(loadWorld(fdb).units) === canon(fw.units));
fw.units[0]!.place = {
  kind: 'offroad', fromX: 1.5, fromY: 2.5, toX: 3.5, toY: 4.5, toSite: 2, t: 0.5, factor: 0.25,
};
saveWorld(fdb, fw);
check('离开道路行军：起点、目的地、进度与倍率都回来了', canon(loadWorld(fdb).units) === canon(fw.units));
fdb.close();

console.log('\n== 空世界也算有世界 ==');
// 判据不能是「有没有据点」：那样把世界清空之后，下次开就被最小世界盖掉了。
const freshPath = path.join(dir, 'fresh.db');
const fresh = openWorldDb(freshPath);
check('全新的库还没有世界', !hasWorld(fresh));
saveWorld(fresh, emptyWorld());
check('空世界写进去之后就算有世界', hasWorld(fresh));
check('空世界读回来是零据点', loadWorld(fresh).sites.length === 0);
fresh.close();
const freshAgain = openWorldDb(freshPath);
check('重开这个库仍然算有世界', hasWorld(freshAgain));
freshAgain.close();

console.log('\n== 后加的标记会给老库补上 ==');
// 造一份加这个标记之前写下的库：世界在，标记没有。
const prePath = path.join(dir, 'pre-flag.db');
const pre = openWorldDb(prePath);
saveWorld(pre, demoWorld());
pre.exec("DELETE FROM meta WHERE k = 'initialized'");
pre.close();
const preAgain = openWorldDb(prePath);
check('老库打开一次就补上标记', hasWorld(preAgain));
check('老库的世界没被动过', loadWorld(preAgain).sites.length === 2);
preAgain.close();

db.close();
console.log('\n临时目录：' + dir);
console.log(bad ? '\n' + bad + ' 项未通过' : '\n全部通过');
process.exit(bad ? 1 : 0);
