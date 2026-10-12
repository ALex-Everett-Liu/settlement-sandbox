// 翻页与排序：六张表与日志共用的一套算法。纯函数，不引界面库也不引数据库，
// 所以 tools/selftest.ts 能直接跑这一份（引擎自检里那一节「翻页与排序」）。
//
// 每页几条由设置页签给（参数表里的 pageSize）。页码与排序是界面状态，不进世界库：
// 它们随页签记住，关掉程序就没了。
import type { World } from '../engine/types.ts';
import {
  divisionSites,
  divisionTotals,
  factionTotals,
  garrisonTroops,
  linkLength,
  linkName,
  siteBranch,
} from '../engine/world.ts';

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

export type SortKey = string;

export interface Sort {
  key: SortKey;
  /** 升序是 true；再点同一个入口就翻成 false（数值列第一下给的是 false，也就是大的在前）。 */
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

/**
 * 排序与找页码用的那一行：编号、显示名（连接表用的是「A 城 — B 城」），
 * 以及这一行上能点的那些数值列。三样都在这儿，所以「表里按什么排」与「新增那一行落在第几页」
 * 用的是同一份算法，界面那一头只管把页码与排序按住。
 */
export interface Row {
  id: number;
  name: string;
  /** 列名 → 值。哪些列能点见 `SORT_COLUMNS`；计数列（据点、部队、下级辖区）也在里面。 */
  numbers: Record<string, number>;
}

/**
 * 每一张表上能点的数值列（表头就是按这一张表画的）。表头写的中文与这里的对得上；
 * 自检里有一条盯着「列出的每一列，每一行都有值」，所以表头与这里的键不会各写各的。
 * 日志不在这里：它本来就是新的在上。
 */
export const SORT_COLUMNS: Record<PageList, { key: string; label: string }[]> = {
  factions: [
    { key: 'sites', label: '据点' },
    { key: 'units', label: '部队' },
    { key: 'troops', label: '兵力' },
    { key: 'money', label: '钱' },
    { key: 'food', label: '粮' },
    { key: 'population', label: '总人口' },
  ],
  divisions: [
    { key: 'rank', label: '等级' },
    { key: 'sites', label: '据点' },
    { key: 'areaSites', label: '地盘据点' },
    { key: 'below', label: '下级辖区' },
    { key: 'money', label: '钱' },
    { key: 'food', label: '粮' },
    { key: 'troops', label: '兵力' },
    { key: 'population', label: '总人口' },
  ],
  sites: [
    { key: 'development', label: '发展度' },
    { key: 'fortification', label: '防御设施等级' },
    { key: 'population', label: '人口' },
    { key: 'morale', label: '民心' },
    { key: 'stability', label: '稳定度' },
    { key: 'money', label: '金钱' },
    { key: 'food', label: '粮草' },
    { key: 'garrisonTroops', label: '驻军兵力' },
    { key: 'x', label: '坐标 x' },
    { key: 'y', label: '坐标 y' },
  ],
  units: [
    { key: 'troops', label: '兵力' },
    { key: 'training', label: '训练度' },
    { key: 'organization', label: '组织度' },
    { key: 'carriedFood', label: '随身粮草' },
  ],
  links: [
    { key: 'length', label: '长度' },
    { key: 'detour', label: '绕行系数' },
  ],
  terrains: [
    { key: 'speed', label: '行军速度系数' },
    { key: 'width', label: '战场宽度' },
    { key: 'defense', label: '守方加成' },
    { key: 'food', label: '粮草产出系数' },
  ],
};

/**
 * 按名称比大小：走 `localeCompare` 带 `zh`，中文因此按拼音排（按码点排的话「吴」会跑到「蜀」前面）。
 * 同名时由 sortRows 再按编号兜底，顺序不会跳来跳去。
 */
export function compareName(a: string, b: string): number {
  return a.localeCompare(b, 'zh');
}

/**
 * 两个键的比较：选中的那个键说了算。名称走拼音，数值列按数比，两种都在相等时按编号兜底，
 * 所以翻页、跳页时行的先后不会跳。
 */
export function compareRows(a: Row, b: Row, sort: Sort): number {
  // 相等时的兜底：跟着方向走，倒序时也是整个倒过来。
  const byId = () => (sort.up ? a.id - b.id : b.id - a.id);
  if (sort.key === 'id') return byId();
  if (sort.key === 'name') {
    const byName = compareName(a.name, b.name);
    if (byName !== 0) return sort.up ? byName : -byName;
    return byId();
  }
  // 数值列。这一行没有那一列时按 0 算（表头与 numbers 对不上才会走到这里，自检里有盯着的一条）。
  const av = a.numbers[sort.key] ?? 0;
  const bv = b.numbers[sort.key] ?? 0;
  if (av !== bv) return sort.up ? av - bv : bv - av;
  return byId();
}

/** 排好的新数组：不动传进来的那一个。 */
export function sortRows(rows: Row[], sort: Sort): Row[] {
  return rows.slice().sort((a, b) => compareRows(a, b, sort));
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
 * 某一张表的行，按当前筛选收一收（只有据点表有筛选），每一行带上这一行能排的那几列。
 * 顺序与各张表自己渲染时的顺序同一个来源，所以这里算出来的页码就是表里看到的页码。
 */
export function tableRows(world: World, list: PageList, only: OnlyBranch | null): Row[] {
  if (list === 'factions') {
    return world.factions.map((f) => {
      const t = factionTotals(world, f.id);
      return {
        id: f.id,
        name: f.name,
        numbers: {
          sites: t.sites, units: t.units, troops: t.troops,
          money: t.money, food: t.food, population: t.population,
        },
      };
    });
  }
  if (list === 'divisions') {
    // 一遍扫完驻军，别按行各扫一遍部队。
    const garrison = garrisonTroops(world);
    return world.divisions.map((d) => {
      const t = divisionTotals(world, d.id, garrison);
      return {
        id: d.id,
        name: d.name,
        numbers: {
          rank: d.rank,
          sites: world.sites.filter((s) => s.division === d.id).length,
          areaSites: t.sites,
          below: world.divisions.filter((x) => x.parent === d.id).length,
          money: t.money, food: t.food, troops: t.troops, population: t.population,
        },
      };
    });
  }
  if (list === 'units') {
    return world.units.map((u) => ({
      id: u.id,
      name: u.name,
      numbers: {
        troops: u.troops, training: u.training, organization: u.organization, carriedFood: u.carriedFood,
      },
    }));
  }
  if (list === 'links') {
    return world.links.map((l) => ({
      id: l.id,
      name: linkName(world, l),
      numbers: { length: linkLength(world, l), detour: l.detour },
    }));
  }
  if (list === 'terrains') {
    return world.terrains.map((t) => ({
      id: t.id,
      name: t.name,
      numbers: { speed: t.speed, width: t.width, defense: t.defense, food: t.food },
    }));
  }
  const garrison = garrisonTroops(world);
  const rows = world.sites.map((s) => ({
    id: s.id,
    name: s.name,
    numbers: {
      development: s.development, fortification: s.fortification, population: s.population,
      morale: s.morale, stability: s.stability, money: s.money, food: s.food,
      garrisonTroops: garrison.get(s.id) ?? 0,
      x: s.x,
      y: s.y,
    },
  }));
  if (only === null) return rows;
  const branch = only.kind === 'division' ? divisionSites(world, only.id) : siteBranch(world, only.id);
  return rows.filter((r) => branch.has(r.id));
}

/** 取这一行的某一列的值。表头与 `numbers` 对不上时按 0 算——自检里有一条盯着它们对得上。 */
export function rowNumber(row: Row, key: string): number {
  return row.numbers[key] ?? 0;
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
