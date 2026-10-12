// 存档层：世界进 node:sqlite，快照走它自带的 backup。
// 这一层不引用 Electron，也不碰界面；路径由调用方给，所以能直接用 node 自检。
import * as fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import type {
  Ask,
  Division,
  Faction,
  FoodPolicy,
  Id,
  Link,
  Order,
  Params,
  Place,
  Site,
  Terrain,
  Unit,
  World,
} from '../engine/types.ts';
import { emptyWorld, levelsFromParents } from '../engine/world.ts';

export const SCHEMA_VERSION = 6;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, rank INTEGER NOT NULL,
  parent INTEGER, seat INTEGER
);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
  scale INTEGER NOT NULL, population INTEGER NOT NULL, morale REAL NOT NULL,
  stability REAL NOT NULL, money REAL NOT NULL, food REAL NOT NULL,
  parent INTEGER, level INTEGER NOT NULL, division INTEGER, faction INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL,
  detour REAL NOT NULL, terrain TEXT
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY, faction INTEGER NOT NULL, name TEXT NOT NULL,
  troops INTEGER NOT NULL, training REAL NOT NULL, organization REAL NOT NULL,
  place_kind TEXT NOT NULL, place_site INTEGER, place_link INTEGER,
  place_from INTEGER, place_to INTEGER, place_t REAL,
  place_x REAL, place_y REAL, place_tx REAL, place_ty REAL, place_factor REAL,
  carried_food REAL NOT NULL, queue_json TEXT NOT NULL, food_policy TEXT
);
CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL);
`;

export function openWorldDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('schema_version') as { v?: string } | undefined;
  if (!row) {
    // 全新的库：这里特意不写 initialized，主进程据此知道「这个库里还没有世界」，
    // 交给界面去建最小世界。写过一次之后由 saveWorld 补上标记。
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('day', '0');
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('log_count', '0');
    return db;
  }
  const from = Number(row.v);
  if (from > SCHEMA_VERSION) {
    throw new Error('存档的 schema 版本是 ' + String(row.v) + '，本程序认的是 ' + String(SCHEMA_VERSION));
  }
  if (from < SCHEMA_VERSION) migrate(db, path, from);
  // 这个标记是后加的：以前写下的库没有它，但那些库里已经有世界了（哪怕是个空世界），
  // 打开一次就补上，免得被当成新库、又被最小世界盖掉。
  if (metaGet(db, 'initialized') === undefined) metaSet(db, 'initialized', '1');
  return db;
}

/**
 * 库里有没有世界。只有全新的库才没有——一份零据点、零势力的世界也算有。
 * 判据不能是「有没有据点」：那样一清空世界，下次开就被最小世界盖掉了。
 */
export function hasWorld(db: DatabaseSync): boolean {
  return metaGet(db, 'initialized') === '1';
}

/**
 * 旧库升级。按版本逐段落，缺哪一段就补哪一段。
 * v2：links.terrain 允许空（缺地貌要存得下），units 加 food_policy 列。
 * v3：连接不再直接存长度，改成存绕行系数 detour；长度由两端坐标算。
 * 整段在一个事务里跑；升级之前先留一份完整副本。
 */
function migrate(db: DatabaseSync, dbPath: string, from: number): void {
  const backupPath = keepBackup(db, dbPath, from);
  const steps: string[] = [];
  db.exec('BEGIN');
  try {
    if (from < 2) {
      if (!hasColumn(db, 'units', 'food_policy')) {
        db.exec('ALTER TABLE units ADD COLUMN food_policy TEXT');
        steps.push('units 加 food_policy');
      }
      // SQLite 改不了现成列的 NOT NULL，只能把那张表按新定义重建一次。
      db.exec('CREATE TABLE links_v2 (id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL, distance REAL NOT NULL, terrain TEXT)');
      db.exec('INSERT INTO links_v2 (id, a, b, distance, terrain) SELECT id, a, b, distance, terrain FROM links');
      db.exec('DROP TABLE links');
      db.exec('ALTER TABLE links_v2 RENAME TO links');
      steps.push('links.terrain 改为可空');
    }
    if (from < 3) {
      // 老的那个长度值与坐标无关，没法换算，一律按系数 1.0 起，长度改由坐标算。
      db.exec('CREATE TABLE links_v3 (id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL, detour REAL NOT NULL, terrain TEXT)');
      db.exec('INSERT INTO links_v3 (id, a, b, detour, terrain) SELECT id, a, b, 1.0, terrain FROM links');
      db.exec('DROP TABLE links');
      db.exec('ALTER TABLE links_v3 RENAME TO links');
      steps.push('links.distance 换成 detour，一律 1.0');
    }
    if (from < 4) {
      if (!hasColumn(db, 'sites', 'level')) {
        db.exec('ALTER TABLE sites ADD COLUMN level INTEGER NOT NULL DEFAULT 0');
      }
      // 初值用「按上下级算出来」的那一套：升完画面与升级前一致，之后由 User 自己调。
      const rows = db.prepare('SELECT id, parent FROM sites').all() as Array<{ id: number; parent: number | null }>;
      const levels = levelsFromParents(
        rows.map((r) => ({ id: Number(r.id), parent: r.parent === null ? null : Number(r.parent) })),
      );
      const setLevel = db.prepare('UPDATE sites SET level = ? WHERE id = ?');
      for (const r of rows) setLevel.run(levels.get(Number(r.id)) ?? 0, Number(r.id));
      steps.push('sites 加 level，按现有的上下级算出初值');
    }
    if (from < 5) {
      // 辖区是另一棵树：行政区划不是地点，治所只是它当下借用的那个据点。
      // 旧的据点—据点上级关系原样留着——它的含义从此是「所属据点」（地理包含）。
      if (!hasColumn(db, 'sites', 'division')) {
        db.exec('ALTER TABLE sites ADD COLUMN division INTEGER');
      }
      steps.push('加 divisions 表与 sites.division（辖区为空，旧关系当作所属据点）');
    }
    if (from < 6) {
      // 部队能停在据点之外的任意一点了，位置多出几个数：自己的坐标、目的地坐标，
      // 以及离开道路那一趟的倍率。旧数据这五列全是空的，读的时候照原来那几档走。
      for (const col of ['place_x', 'place_y', 'place_tx', 'place_ty', 'place_factor']) {
        if (!hasColumn(db, 'units', col)) db.exec('ALTER TABLE units ADD COLUMN ' + col + ' REAL');
      }
      steps.push('units 加自由坐标五列（place_x／place_y／place_tx／place_ty／place_factor）');
    }
    metaSet(db, 'schema_version', String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  checkpoint(db);
  console.log(
    '[sandbox] 库从 v' + String(from) + ' 升到 v' + String(SCHEMA_VERSION) + '：' + steps.join('；') + '；副本 ' + backupPath,
  );
}

/** 升级前留一份副本。已经有那一版的副本就不再动它；VACUUM INTO 是同步的，产出的是一份干净的库。 */
function keepBackup(db: DatabaseSync, dbPath: string, from: number): string {
  const target = dbPath.replace(/\.db$/i, '') + '.v' + String(from) + '-backup.db';
  if (!fs.existsSync(target)) db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
  return target;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare("SELECT name FROM pragma_table_info('" + table + "')").all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function metaGet(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(key) as { v?: string } | undefined;
  return row?.v;
}

function metaSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, value);
}

/**
 * 把 WAL 并回主文件。不并的话，最新那一段只存在于 world.db-wal 里：
 * 看主文件的时间戳会以为没保存，单独复制主文件也会丢掉那一段。
 * 这一句不能放在事务里。
 */
function checkpoint(db: DatabaseSync): void {
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
}

export function saveParams(db: DatabaseSync, params: Params): void {
  metaSet(db, 'params', JSON.stringify(params));
  checkpoint(db);
}

export function loadParams(db: DatabaseSync): Params | null {
  const raw = metaGet(db, 'params');
  return raw ? (JSON.parse(raw) as Params) : null;
}

/**
 * The params table gains fields over versions. A database written by an older build
 * holds only part of them, so the keys read back short. Fill the gaps from the
 * defaults and write the whole table back. Returns the names of the fields filled.
 */
export function fillParamsGaps(db: DatabaseSync, fallback: Params): string[] {
  const stored = loadParams(db);
  if (!stored) {
    saveParams(db, fallback);
    return [];
  }
  const missing = Object.keys(fallback).filter((k) => !Object.hasOwn(stored, k));
  if (missing.length > 0) saveParams(db, { ...fallback, ...stored });
  return missing;
}

/**
 * 位置拆成库里那几列。每一档只用得上其中几列，其余一律写 null。
 * `place_site` 的含义是「这个位置关联的那座据点」：在据点里就是那座据点，
 * 离开道路而目的地是据点时就是目的据点，其余为空。
 */
function placeColumns(p: Place): {
  site: number | null; link: number | null; from: number | null; to: number | null; t: number | null;
  x: number | null; y: number | null; tx: number | null; ty: number | null; factor: number | null;
} {
  const none = {
    site: null, link: null, from: null, to: null, t: null,
    x: null, y: null, tx: null, ty: null, factor: null,
  };
  if (p.kind === 'site') return { ...none, site: p.site };
  if (p.kind === 'camp') return { ...none, x: p.x, y: p.y };
  if (p.kind === 'offroad') {
    return { ...none, site: p.toSite, x: p.fromX, y: p.fromY, tx: p.toX, ty: p.toY, t: p.t, factor: p.factor };
  }
  return { ...none, link: p.link, from: p.from, to: p.to, t: p.t };
}

/** 世界整体写回。一次事务里清空再加，简单且不会写坏。日志只追加新的那些行。 */
export function saveWorld(db: DatabaseSync, world: World): void {
  const storedLog = Number(metaGet(db, 'log_count') ?? '0');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM factions');
    db.exec('DELETE FROM divisions');
    db.exec('DELETE FROM sites');
    db.exec('DELETE FROM links');
    db.exec('DELETE FROM units');

    const insFaction = db.prepare('INSERT INTO factions (id, name) VALUES (?, ?)');
    for (const f of world.factions) insFaction.run(f.id, f.name);

    const insDivision = db.prepare('INSERT INTO divisions (id, name, rank, parent, seat) VALUES (?, ?, ?, ?, ?)');
    for (const d of world.divisions) insDivision.run(d.id, d.name, d.rank, d.parent, d.seat);

    const insSite = db.prepare(
      'INSERT INTO sites (id, name, x, y, scale, population, morale, stability, money, food, parent, level, division, faction)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const s of world.sites) {
      insSite.run(
        s.id, s.name, s.x, s.y, s.scale, s.population, s.morale,
        s.stability, s.money, s.food, s.parent, s.level, s.division, s.faction,
      );
    }

    const insLink = db.prepare('INSERT INTO links (id, a, b, detour, terrain) VALUES (?, ?, ?, ?, ?)');
    for (const l of world.links) insLink.run(l.id, l.a, l.b, l.detour, l.terrain);

    const insUnit = db.prepare(
      'INSERT INTO units (id, faction, name, troops, training, organization, place_kind, place_site,' +
        ' place_link, place_from, place_to, place_t, place_x, place_y, place_tx, place_ty, place_factor,' +
        ' carried_food, queue_json, food_policy)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const u of world.units) {
      const p = placeColumns(u.place);
      insUnit.run(
        u.id, u.faction, u.name, u.troops, u.training, u.organization,
        u.place.kind, p.site, p.link, p.from, p.to, p.t,
        p.x, p.y, p.tx, p.ty, p.factor,
        u.carriedFood, JSON.stringify(u.queue), u.foodPolicy,
      );
    }

    if (world.log.length < storedLog) db.exec('DELETE FROM log');
    if (world.log.length > storedLog || world.log.length < storedLog) {
      const start = world.log.length < storedLog ? 0 : storedLog;
      const insLog = db.prepare('INSERT INTO log (line) VALUES (?)');
      for (let i = start; i < world.log.length; i += 1) insLog.run(world.log[i] as string);
    }

    metaSet(db, 'day', String(world.day));
    metaSet(db, 'log_count', String(world.log.length));
    metaSet(db, 'pending', JSON.stringify(world.pending));
    // 写过一次世界就算「有世界」了，哪怕里面一个据点也没有。
    metaSet(db, 'initialized', '1');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  checkpoint(db);
}

export function loadWorld(db: DatabaseSync): World {
  const w = emptyWorld();
  w.day = Number(metaGet(db, 'day') ?? '0');
  const pendingRaw = metaGet(db, 'pending');
  w.pending = pendingRaw ? (JSON.parse(pendingRaw) as Ask | null) : null;

  for (const r of db.prepare('SELECT * FROM factions ORDER BY id').all() as Array<Record<string, unknown>>) {
    w.factions.push({ id: Number(r['id']), name: String(r['name']) } satisfies Faction);
  }
  for (const r of db.prepare('SELECT * FROM divisions ORDER BY id').all() as Array<Record<string, unknown>>) {
    w.divisions.push({
      id: Number(r['id']), name: String(r['name']), rank: Number(r['rank']),
      parent: r['parent'] === null ? null : Number(r['parent']),
      seat: r['seat'] === null ? null : Number(r['seat']),
    } satisfies Division);
  }
  for (const r of db.prepare('SELECT * FROM sites ORDER BY id').all() as Array<Record<string, unknown>>) {
    w.sites.push({
      id: Number(r['id']), name: String(r['name']), x: Number(r['x']), y: Number(r['y']),
      scale: Number(r['scale']), population: Number(r['population']), morale: Number(r['morale']),
      stability: Number(r['stability']), money: Number(r['money']), food: Number(r['food']),
      parent: r['parent'] === null ? null : Number(r['parent']),
      level: Number(r['level'] ?? 0),
      division: r['division'] === null || r['division'] === undefined ? null : Number(r['division']),
      faction: Number(r['faction']),
    } satisfies Site);
  }
  for (const r of db.prepare('SELECT * FROM links ORDER BY id').all() as Array<Record<string, unknown>>) {
    w.links.push({
      id: Number(r['id']), a: Number(r['a']), b: Number(r['b']),
      detour: Number(r['detour']),
      terrain: r['terrain'] === null ? null : (String(r['terrain']) as Terrain),
    } satisfies Link);
  }
  for (const r of db.prepare('SELECT * FROM units ORDER BY id').all() as Array<Record<string, unknown>>) {
    const kind = String(r['place_kind']);
    const numOr = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    const x = numOr(r['place_x']);
    const y = numOr(r['place_y']);
    let place: Place;
    if (kind === 'site') {
      place = { kind: 'site', site: Number(r['place_site']) };
    } else if (kind === 'camp' && x !== null && y !== null) {
      place = { kind: 'camp', x, y };
    } else if (kind === 'offroad') {
      place = {
        kind: 'offroad',
        fromX: x ?? 0, fromY: y ?? 0,
        toX: numOr(r['place_tx']) ?? 0, toY: numOr(r['place_ty']) ?? 0,
        toSite: numOr(r['place_site']),
        t: numOr(r['place_t']) ?? 0,
        factor: numOr(r['place_factor']) ?? 1,
      };
    } else {
      // 连接上行军；v5 以前那种「连接上扎营」也落到这一档（那时候还没有自由坐标）。
      place = {
        kind: 'march',
        link: Number(r['place_link']),
        from: Number(r['place_from']),
        to: Number(r['place_to']),
        t: Number(r['place_t']),
      };
    }
    w.units.push({
      id: Number(r['id']), faction: Number(r['faction']), name: String(r['name']),
      troops: Number(r['troops']), training: Number(r['training']), organization: Number(r['organization']),
      place, carriedFood: Number(r['carried_food']),
      foodPolicy: r['food_policy'] === null || r['food_policy'] === undefined ? null : (String(r['food_policy']) as FoodPolicy),
      queue: JSON.parse(String(r['queue_json'])) as Order[],
    } satisfies Unit);
  }
  for (const r of db.prepare('SELECT line FROM log ORDER BY seq').all() as Array<Record<string, unknown>>) {
    w.log.push(String(r['line']));
  }
  return w;
}

/** 快照：走 node:sqlite 自带的 backup，比复制文件安全。 */
export async function writeSnapshot(db: DatabaseSync, path: string): Promise<void> {
  await backup(db, path);
}

/** 把一份快照写回目标库路径。调用前必须先把目标库关掉（Windows 上文件被占用会失败）。 */
export async function restoreFromSnapshot(snapshotPath: string, dbPath: string): Promise<void> {
  const src = new DatabaseSync(snapshotPath);
  try {
    await backup(src, dbPath);
  } finally {
    src.close();
  }
}

export function siteCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM sites').get() as { n: number };
  return Number(row.n);
}

export function unitCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM units').get() as { n: number };
  return Number(row.n);
}

export function logCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM log').get() as { n: number };
  return Number(row.n);
}

export type { Id };
