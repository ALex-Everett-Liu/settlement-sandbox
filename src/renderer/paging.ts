// 翻页与排序：六张表与日志共用的一套算法。纯函数，不引界面库也不引数据库，
// 所以 tools/selftest.ts 能直接跑这一份（引擎自检里那一节「翻页与排序」）。
//
// 每页几条由设置页签给（参数表里的 pageSize）。页码与排序是界面状态，不进世界库：
// 它们随页签记住，关掉程序就没了。
import type { World } from '../engine/types.ts';
import { divisionSites, linkName, siteBranch } from '../engine/world.ts';

/** 能翻页的六张表。日志不在这里（它不排序，页码另算）。 */
export const PAGE_LISTS = ['factions', 'divisions', 'sites', 'units', 'links', 'terrains'] as const;
export type PageList = (typeof PAGE_LISTS)[number];

/** 每一张表在页签上的名字，写说明行时用。 */
export const LIST_LABEL: Record<PageList, string> = {
  factions: '势力表',
  divisions: '辖区表',
  sites: '据点表',
  units: '部队表',
  links: '连接表',
  terrains: '地貌表',
};

export type SortKey = 'id' | 'name';

export interface Sort {
  key: SortKey;
  /** 升序是 true；再点同一个按钮就翻成 false。 */
  up: boolean;
}

export interface ListState {
  page: number;
  sort: Sort;
}

/** 开窗口时每一张表都停在第 1 页、按编号升序。 */
export const DEFAULT_SORT: Sort = { key: 'id', up: true };

export function emptyListStates(): Record<PageList, ListState> {
  const out = {} as Record<PageList, ListState>;
  for (const list of PAGE_LISTS) out[list] = { page: 1, sort: { ...DEFAULT_SORT } };
  return out;
}

/** 排序与找页码用的那一行：编号兜底，名字是显示名（连接表用的是「A 城 — B 城」）。 */
export interface Row {
  id: number;
  name: string;
}

/**
 * 按名称比大小：走 `localeCompare` 带 `zh`，中文因此按拼音排（按码点排的话「吴」会跑到「蜀」前面）。
 * 同名时由 sortRows 再按编号兜底，顺序不会跳来跳去。
 */
export function compareName(a: string, b: string): number {
  return a.localeCompare(b, 'zh');
}

/** 两个键的比较：选中的那个键说了算，同名／同编号时用另一个键兜底。 */
export function compareRows(a: Row, b: Row, sort: Sort): number {
  if (sort.key === 'name') {
    const byName = compareName(a.name, b.name);
    if (byName !== 0) return sort.up ? byName : -byName;
    return sort.up ? a.id - b.id : b.id - a.id;
  }
  return sort.up ? a.id - b.id : b.id - a.id;
}

/** 排好的新数组：不动传进来的那一个。名字由调用方给，各表的字段不一样。 */
export function sortRows<T extends { id: number }>(rows: T[], sort: Sort, name: (row: T) => string): T[] {
  const keyed = rows.map((row) => ({ row, id: row.id, name: name(row) }));
  keyed.sort((a, b) => compareRows(a, b, sort));
  return keyed.map((k) => k.row);
}

/** 一共几页。一条都没有、或者只装得下一页时都是 1 页——页码格与计数照画。 */
export function pageCount(total: number, pageSize: number): number {
  const size = pageSize < 1 ? 1 : Math.floor(pageSize);
  const n = Math.ceil(total / size);
  return n < 1 ? 1 : n;
}

/** 这一页该显示哪些行。页码超出范围时由调用方先退到末页（见 App 的退页那一处）。 */
export function pageRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const size = pageSize < 1 ? 1 : Math.floor(pageSize);
  const start = (Math.max(1, page) - 1) * size;
  return rows.slice(start, start + size);
}

/** 某一行落在第几页；不在这个列表里（被筛掉了）就是 0。新增之后用它跳到那一行。 */
export function pageOfRow(rows: Row[], id: number, pageSize: number): number {
  const index = rows.findIndex((r) => r.id === id);
  if (index < 0) return 0;
  const size = pageSize < 1 ? 1 : Math.floor(pageSize);
  return Math.floor(index / size) + 1;
}

/** 页码格收什么字：1 到最大页之间的整数。 */
export function isPageNumber(text: string, pages: number): boolean {
  if (text.trim() === '') return false;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= pages;
}

/** 据点表「只看某一支」挑中的那一支；没有就是 null。 */
export interface OnlyBranch {
  kind: 'site' | 'division';
  id: number;
}

/**
 * 某一张表的行，按当前筛选收一收（只有据点表有筛选）。
 * 顺序与各张表自己渲染时的顺序同一个来源，所以这里算出来的页码就是表里看到的页码。
 */
export function tableRows(world: World, list: PageList, only: OnlyBranch | null): Row[] {
  if (list === 'factions') return world.factions.map((f) => ({ id: f.id, name: f.name }));
  if (list === 'divisions') return world.divisions.map((d) => ({ id: d.id, name: d.name }));
  if (list === 'units') return world.units.map((u) => ({ id: u.id, name: u.name }));
  if (list === 'links') return world.links.map((l) => ({ id: l.id, name: linkName(world, l) }));
  if (list === 'terrains') return world.terrains.map((t) => ({ id: t.id, name: t.name }));
  const rows = world.sites.map((s) => ({ id: s.id, name: s.name }));
  if (only === null) return rows;
  const branch = only.kind === 'division' ? divisionSites(world, only.id) : siteBranch(world, only.id);
  return rows.filter((r) => branch.has(r.id));
}

/**
 * 日志那一段：新的在上。第 1 页是最新的那 pageSize 条，页内也是新的在上；
 * 页码超出已有的行数时给空数组（退页由调用方先做）。
 */
export function newestFirst<T>(lines: T[], page: number, pageSize: number): T[] {
  const size = pageSize < 1 ? 1 : Math.floor(pageSize);
  const end = lines.length - (Math.max(1, page) - 1) * size;
  const start = Math.max(0, end - size);
  const slice = lines.slice(start, Math.max(0, end));
  slice.reverse();
  return slice;
}
