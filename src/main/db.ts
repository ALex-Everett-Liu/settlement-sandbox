// 存档层：世界进 node:sqlite，快照走它自带的 backup。
// 这一层不引用 Electron，也不碰界面；路径由调用方给，所以能直接用 node 自检。
import * as fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import type {
  Ask,
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
import { emptyWorld } from '../engine/world.ts';

export const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factions (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
  scale INTEGER NOT NULL, population INTEGER NOT NULL, morale REAL NOT NULL,
  stability REAL NOT NULL, money REAL NOT NULL, food REAL NOT NULL,
  parent INTEGER, faction INTEGER NOT NULL
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
  return db;
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

/** 世界整体写回。一次事务里清空再加，简单且不会写坏。日志只追加新的那些行。 */
export function saveWorld(db: DatabaseSync, world: World): void {
  const storedLog = Number(metaGet(db, 'log_count') ?? '0');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM factions');
    db.exec('DELETE FROM sites');
    db.exec('DELETE FROM links');
    db.exec('DELETE FROM units');

    const insFaction = db.prepare('INSERT INTO factions (id, name) VALUES (?, ?)');
    for (const f of world.factions) insFaction.run(f.id, f.name);

    const insSite = db.prepare(
      'INSERT INTO sites (id, name, x, y, scale, population, morale, stability, money, food, parent, faction)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const s of world.sites) {
      insSite.run(s.id, s.name, s.x, s.y, s.scale, s.population, s.morale, s.stability, s.money, s.food, s.parent, s.faction);
    }

    const insLink = db.prepare('INSERT INTO links (id, a, b, detour, terrain) VALUES (?, ?, ?, ?, ?)');
    for (const l of world.links) insLink.run(l.id, l.a, l.b, l.detour, l.terrain);

    const insUnit = db.prepare(
      'INSERT INTO units (id, faction, name, troops, training, organization, place_kind, place_site,' +
        ' place_link, place_from, place_to, place_t, carried_food, queue_json, food_policy)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const u of world.units) {
      const p = u.place;
      insUnit.run(
        u.id, u.faction, u.name, u.troops, u.training, u.organization,
        p.kind,
        p.kind === 'site' ? p.site : null,
        p.kind === 'site' ? null : p.link,
        p.kind === 'site' ? null : p.from,
        p.kind === 'site' ? null : p.to,
        p.kind === 'site' ? null : p.t,
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
  for (const r of db.prepare('SELECT * FROM sites ORDER BY id').all() as Array<Record<string, unknown>>) {
    w.sites.push({
      id: Number(r['id']), name: String(r['name']), x: Number(r['x']), y: Number(r['y']),
      scale: Number(r['scale']), population: Number(r['population']), morale: Number(r['morale']),
      stability: Number(r['stability']), money: Number(r['money']), food: Number(r['food']),
      parent: r['parent'] === null ? null : Number(r['parent']), faction: Number(r['faction']),
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
    const place: Place =
      kind === 'site'
        ? { kind: 'site', site: Number(r['place_site']) }
        : {
            kind: kind === 'camp' ? 'camp' : 'march',
            link: Number(r['place_link']),
            from: Number(r['place_from']),
            to: Number(r['place_to']),
            t: Number(r['place_t']),
          };
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
