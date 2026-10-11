// 世界对象的类型。这一层不依赖任何包，也不引用外壳。

export type Id = number;

/** 地貌五档。影响野战宽度、行军速度、守方加成、粮草产出。 */
export type Terrain = 'plain' | 'hill' | 'mountain' | 'water' | 'pass';

/** 断粮时的处理方式（设计 §五 第 11 条）。每支部队各记各的。 */
export type FoodPolicy = 'attrition' | 'forage' | 'restrict';

/** 部队在哪：据点里、连接上行军、连接上扎营。 */
export type Place =
  | { kind: 'site'; site: Id }
  | { kind: 'march'; link: Id; from: Id; to: Id; t: number }
  | { kind: 'camp'; link: Id; from: Id; to: Id; t: number };

/** 队列里的一条命令。目前只有「继续走」与「原地待命」。 */
export type Order = { kind: 'hold' } | { kind: 'march'; to: Id };

/** 一个选项：value 写回世界，label 给人看。 */
export interface AskOption {
  value: string;
  label: string;
}

/** 答案写回哪一处。每一种问询都知道自己改哪个字段。 */
export type AskTarget = { kind: 'linkTerrain'; link: Id } | { kind: 'unitFoodPolicy'; unit: Id };

/** 引擎停下来问 User 的一件事。 */
export interface Ask {
  /** 问的是谁，界面拿它当标题。 */
  subject: string;
  question: string;
  options: AskOption[];
  /** 默认值：直接确认就用它。 */
  fallback: string;
  target: AskTarget;
}

export interface Faction {
  id: Id;
  name: string;
}

export interface Site {
  id: Id;
  name: string;
  /** 坐标：原点在左下角，x 向右、y 向上，范围是 0..mapWidth × 0..mapHeight。只用来画地图与算连接长度。 */
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
  /** 断粮时怎么办。null 表示还没问过 User。 */
  foodPolicy: FoodPolicy | null;
  queue: Order[];
}

export interface Link {
  id: Id;
  a: Id;
  b: Id;
  /** 绕行系数。长度 = 两端直线距离 × 它，默认 1.0；山路绕远就调大。 */
  detour: number;
  /** null 表示这条连接还没填地貌。引擎不许自己挑一档，会停下来问。 */
  terrain: Terrain | null;
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
  /** 引擎停在这里等 User 回答；不为 null 时时间轴一天也不往前走。 */
  pending: Ask | null;
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

  /** 地图的框：原点在左下角，x 向右、y 向上。 */
  mapWidth: number;
  mapHeight: number;
  /**
   * 缩放的上下界。滚轮与「放大」「缩小」不越过去；「缩到全图」不受它们限制，
   * 所以地图很大时它会落在下界以下——那时再往小里缩放仍会被挡住，往回缩放不受影响。
   */
  zoomMin: number;
  zoomMax: number;

  /** UI theme. The engine never reads it; only the shell does. */
  theme: Theme;
}
