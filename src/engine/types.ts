// 世界对象的类型。这一层不依赖任何包，也不引用外壳。

export type Id = number;

/** 地貌五档。影响野战宽度、行军速度、守方加成、粮草产出。 */
export type Terrain = 'plain' | 'hill' | 'mountain' | 'water' | 'pass';

/** 部队在哪：据点里、连接上行军、连接上扎营。 */
export type Place =
  | { kind: 'site'; site: Id }
  | { kind: 'march'; link: Id; from: Id; to: Id; t: number }
  | { kind: 'camp'; link: Id; from: Id; to: Id; t: number };

/** 队列里的一条命令。目前只有「继续走」与「原地待命」。 */
export type Order = { kind: 'hold' } | { kind: 'march'; to: Id };

export interface Faction {
  id: Id;
  name: string;
}

export interface Site {
  id: Id;
  name: string;
  /** 坐标只用来画地图；行军按连接距离算。 */
  x: number;
  y: number;
  /** 规模 1–5，与人口各自独立填。 */
  scale: number;
  population: number;
  /** 民心 0–100，偏产出与征兵。 */
  morale: number;
  /** 稳定度 0–100，偏风险。 */
  stability: number;
  money: number;
  food: number;
  /** 上级据点，随时可改。 */
  parent: Id | null;
  faction: Id;
}

export interface Unit {
  id: Id;
  faction: Id;
  name: string;
  troops: number;
  /** 训练度 0–100，跟着部队走。 */
  training: number;
  /** 组织度 0–100。 */
  organization: number;
  place: Place;
  /** 随身粮草，出城时从所在据点领。 */
  carriedFood: number;
  queue: Order[];
}

export interface Link {
  id: Id;
  a: Id;
  b: Id;
  distance: number;
  terrain: Terrain;
}

export interface World {
  /** 已经过去的天数。第 1 天从 1 开始。 */
  day: number;
  factions: Faction[];
  sites: Site[];
  units: Unit[];
  links: Link[];
  /** 日志。现在是事件级的，还没有做到「每支部队每天一行」。 */
  log: string[];
}

/** UI theme. Not a settlement number, but it rides with the world, so it lives here. */
export type Theme = 'light' | 'dark';

/** 参数表。全部是占位值，等数值那一遍重算。 */
export interface Params {
  daysPerMonth: number;
  monthsPerYear: number;
  /** 金钱产出 = moneyPerScale × 规模 × (民心 ÷ moraleRef)。 */
  moneyPerScale: number;
  foodPerScale: number;
  moraleRef: number;
  upkeepMoneyPerScale: number;
  upkeepFoodPerScale: number;
  /** 每兵每天口粮。 */
  unitFoodPerTroop: number;
  /** 民心每月向 moraleBaseline 靠拢的比例。 */
  moralePull: number;
  moraleBaseline: number;
  stabilityPull: number;
  stabilityBaseline: number;
  /** 人口每月按民心偏移的增长率分母。 */
  populationMoraleDivisor: number;
  /** 行军速度基准（地图单位／天），再乘地貌系数与部队系数。 */
  speedBase: number;
  terrainSpeed: Record<Terrain, number>;

  /** UI theme. The engine never reads it; only the shell does. */
  theme: Theme;
}
