// 世界对象的类型。这一层不依赖任何包，也不引用外壳。

export type Id = number;

/**
 * 一档地貌。名字与四个数都由 User 声明，想细分就多建几行，行与行之间互不隶属。
 * 眼下只有 speed 有读者（行军速度）；战场宽度、守方加成、粮草产出三项等着战斗
 * 与按地貌算粮草那两条链接上来。
 */
export interface Terrain {
  id: Id;
  name: string;
  /** 行军速度系数：平原 1，山地 0.55 这一类。越小越难走。 */
  speed: number;
  /** 战场宽度。 */
  width: number;
  /** 守方加成，1 表示不加成。 */
  defense: number;
  /** 粮草产出系数，1 表示不加成。 */
  food: number;
}

/** 断粮时的处理方式（设计 §五 第 11 条）。每支部队各记各的。 */
export type FoodPolicy = 'attrition' | 'forage' | 'restrict';

/** 部队在哪：据点里、连接上行军、据点之外停着、离开道路行军。 */
export type Place =
  | { kind: 'site'; site: Id }
  | { kind: 'march'; link: Id; from: Id; to: Id; t: number }
  /** 停在据点之外的某一点。当道扎营与野外扎营都是它，区别只在这个坐标落不落在连接上。 */
  | { kind: 'camp'; x: number; y: number }
  /** 离开道路行军：从一点直线走到另一点。速度按 factor 那一个倍率算，不读任何连接的地貌。 */
  | {
      kind: 'offroad';
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      /** 目的地是一座据点时就记它的编号，抵达即进城；为空就是停在那个坐标上。 */
      toSite: Id | null;
      t: number;
      /** 相对道路速度的倍率：下命令那一刻由 User 给，字面就是道路的几成。 */
      factor: number;
    };

/** 队列里的一条命令。目前有「继续走」「原地待命」「离开道路走到一个坐标」。 */
export type Order =
  | { kind: 'hold' }
  | { kind: 'march'; to: Id }
  | { kind: 'offroad'; toSite: Id | null; toX: number; toY: number; factor: number };

/** 一个选项：value 写回世界，label 给人看。 */
export interface AskOption {
  value: string;
  label: string;
}

/** 答案写回哪一处。每一种问询都知道自己改哪个字段。 */
export type AskTarget =
  | { kind: 'linkTerrain'; link: Id }
  | { kind: 'unitFoodPolicy'; unit: Id }
  /**
   * 离开道路那一趟的代价：答案是 User 填的一个倍率，答完把整条队列换成那一条新命令
   * （与「前往…」同一条规矩：命令列上按一次换掉整条队列）。
   */
  | { kind: 'unitOffroadOrder'; unit: Id; toSite: Id | null; toX: number; toY: number };

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

/**
 * 辖区：一片地方的行政归属（州、郡这一类），不是一个地点。
 * 名字与等级由 User 声明；治所只是它当下借用的那个据点，随时可迁移。
 */
export interface Division {
  id: Id;
  name: string;
  /** 等级：0 起，越大越高。上级辖区的等级不低于下级的等级。 */
  rank: number;
  /** 上级辖区，可以没有。 */
  parent: Id | null;
  /** 治所：一个据点，必须落在自己的整棵子树里；可以没有。 */
  seat: Id | null;
}

export interface Site {
  id: Id;
  name: string;
  /** 坐标：原点在左下角，x 向右、y 向上，范围是 0..mapWidth × 0..mapHeight。只用来画地图与算连接长度。 */
  x: number;
  y: number;
  /** 发展度 0–100，一位小数：产出与 upkeep 按它算，地图上记号的大小也按它。 */
  development: number;
  /** 防御设施等级 0–10，一位小数。现在只由 User 声明，不参与结算（战斗还没做）。 */
  fortification: number;
  population: number;
  /** 民心 0–100，偏产出与征兵。 */
  morale: number;
  /** 稳定度 0–100，偏风险。 */
  stability: number;
  money: number;
  food: number;
  /** 上级据点，随时可改。 */
  parent: Id | null;
  /**
   * 层级：User 声明的等级，0 起，越大越高，记号形状按它分档。
   * 系统只守一条：上级的层级不低于下级的层级——差多少不管，平级也能挂。
   */
  level: number;
  /** 行政归属：挂在哪个辖区下面；可以没有。 */
  division: Id | null;
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
  /** 地貌：指向 `World.terrains` 里的一档；null 表示还没填。 */
  terrain: Id | null;
}

export interface World {
  /** 已经过去的天数。第 1 天从 1 开始。 */
  day: number;
  factions: Faction[];
  /** 行政区划：一片地方的行政归属，与据点各记各的。 */
  divisions: Division[];
  sites: Site[];
  units: Unit[];
  links: Link[];
  /** 地貌：一档一行，由 User 自己增改。连接只指向这里的编号。 */
  terrains: Terrain[];
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
  /** 金钱产出 = moneyPerDevelopment × 发展度 × (民心 ÷ moraleRef)。 */
  moneyPerDevelopment: number;
  foodPerDevelopment: number;
  moraleRef: number;
  upkeepMoneyPerDevelopment: number;
  upkeepFoodPerDevelopment: number;
  /** 每兵每天口粮。 */
  unitFoodPerTroop: number;
  /** 民心每月向 moraleBaseline 靠拢的比例。 */
  moralePull: number;
  moraleBaseline: number;
  stabilityPull: number;
  stabilityBaseline: number;
  /** 人口每月按民心偏移的增长率分母。 */
  populationMoraleDivisor: number;
  /** 行军速度基准（地图单位／天），再乘地貌那一档的系数与部队系数。 */
  speedBase: number;

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
