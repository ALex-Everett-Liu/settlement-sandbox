// 热键模式（类似 Vim 的提示模式）：标签表、缓冲的解析、行内字母的分配。
// 这一份不引 React、也不碰 DOM，所以 tools/selftest.ts 能直接跑它（「热键」那一节）。
//
// 两族标签：
//   固定码——页签、表上方那一行、顶上那一排、表头。一律两位小写字母：fa、st、pp、ha……
//   行内码——第几行 + 行内第几个口。1a、10c……
// 固定码首字是字母、行内码首字是数字，两族因此不会互相吞；两位的固定码之间也没有一个是另一个的前缀，
// 所以敲满两位就触发，不用回车收尾；敲了一位就停在半截等下一键。

/** 页签。App 拿它当 Record 的键，标签表与它一一对应。 */
export type View =
  | 'factions'
  | 'divisions'
  | 'sites'
  | 'units'
  | 'links'
  | 'terrains'
  | 'log'
  | 'map'
  | 'settings';

export interface ViewTab {
  id: View;
  label: string;
  /**
   * 热键：两位英文缩写。九张页签里 fa、di、si 是名称的头两个字母，其余五张各让一步，
   * 只要九个码互不相同、也不与表上方那一行、顶上一排、表头那一族撞（自检里盯着）。
   */
  code: string;
}

export const VIEWS: ViewTab[] = [
  { id: 'factions', label: '势力', code: 'fa' },
  { id: 'divisions', label: '辖区', code: 'di' },
  { id: 'sites', label: '据点', code: 'si' },
  { id: 'units', label: '部队', code: 'ut' },
  { id: 'links', label: '连接', code: 'lk' },
  { id: 'terrains', label: '地貌', code: 'tr' },
  { id: 'log', label: '日志', code: 'lg' },
  { id: 'map', label: '地图', code: 'mp' },
  { id: 'settings', label: '设置', code: 'st' },
];

/**
 * 表上方那一行。筛选只有据点表有；新增一行只有五张表有（连接表没有新增）。
 * 日志那一行只有翻页三样。
 */
export const BAR_CODES = {
  filter: 'fl',
  byId: 'id',
  byName: 'nm',
  prev: 'pp',
  next: 'np',
  page: 'pg',
  add: 'na',
} as const;

/** 最上面那一排，以及页签那一行里的「新增据点」。 */
export const TOP_CODES = {
  run: 'rn',
  speed: 'sp',
  day: 'td',
  month: 'tm',
  save: 'sv',
  snapshot: 'sn',
  addSite: 'as',
} as const;

/**
 * 地图页签工具行上那几个控件。这一页没有表格，所以只有这几个加页签与顶上那一排。
 * 地形层那个勾选框的标签挂在包着它的 <label> 上：勾选框是替换元素，画不出小签。
 */
export const MAP_CODES = {
  zoomIn: 'zi',
  zoomOut: 'zo',
  fit: 'zf',
  terrain: 'tl',
} as const;

/**
 * 这个模式自己的键。触发那个组合避开了菜单栏的助记键：默认菜单占了 F/E/V/W/H 五个字母
 * （File、Edit、View、Window、Help），按 Alt+H 会先落到 Help 上，界面收不到。
 */
export const MODE_KEYS = {
  /** 与 Alt 一起按：进/出这个模式。 */
  toggle: 'k',
  /** 标签的隐/现。 */
  marks: '`',
} as const;

/** 表头的标签是 h + 一个字母，按这一页能点的列序。 */
export const HEAD_PREFIX = 'h';

/** 第几个（从 0 数）字母。超过 z 就没有标签了：那一格不再有提示，按不出来。 */
export function letterAt(i: number): string {
  return i >= 0 && i < 26 ? String.fromCharCode(97 + i) : '';
}

/** 行内第 row 行（从 1 数）第 k 个口（从 0 数）的标签，例如 1a、10c。 */
export function rowCode(row: number, k: number): string {
  const letter = letterAt(k);
  return letter === '' ? '' : String(row) + letter;
}

/** 表头第 k 列的标签：ha、hb…… */
export function headCode(k: number): string {
  const letter = letterAt(k);
  return letter === '' ? '' : HEAD_PREFIX + letter;
}

export type Resolution =
  | { kind: 'empty' }
  | { kind: 'exact'; code: string }
  | { kind: 'prefix' }
  | { kind: 'none' };

/** 缓冲现在算哪一步：正好是一个标签、还算半截、还是根本没有这个标签。 */
export function resolveBuffer(buffer: string, codes: string[]): Resolution {
  if (buffer === '') return { kind: 'empty' };
  if (codes.includes(buffer)) return { kind: 'exact', code: buffer };
  if (codes.some((c) => c.startsWith(buffer))) return { kind: 'prefix' };
  return { kind: 'none' };
}

/**
 * 缓冲全是数字、而且正好是这一页的行号时，展开那一行（标签换成这一行的字母）；否则 0。
 * 页里行数不止九行时，「1」既是第 1 行也是第 10 行的开头，所以这里只决定画哪一行，
 * 触发要等到敲满一个完整的行内码。
 */
export function expandRow(buffer: string, rows: number): number {
  if (!/^\d+$/.test(buffer)) return 0;
  const n = Number(buffer);
  return Number.isInteger(n) && n >= 1 && n <= rows ? n : 0;
}

/** 固定码（不含行内那些）。自检拿它查重复与前缀，界面上则是行内码之外那一层的全集。 */
export function fixedCodes(headCount: number): string[] {
  const out: string[] = VIEWS.map((v) => v.code);
  out.push(...Object.values(BAR_CODES), ...Object.values(TOP_CODES), ...Object.values(MAP_CODES));
  for (let i = 0; i < headCount; i += 1) out.push(headCode(i));
  return out.filter((c) => c !== '');
}
