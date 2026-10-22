import type { Params } from './types.ts';

/**
 * 占位参数。全部待重算——设计文档 §九 的数值待定项（按人口与地貌重写产出、
 * 口粮、兵源上限，以及行军速度公式与地貌五档的四个系数）。
 */
export const DEFAULT_PARAMS: Params = {
  daysPerMonth: 30,
  monthsPerYear: 12,

  /**
   * 产出与 upkeep 按发展度（0–100，一位小数）算。这四个数由原来那一套按规模 1–5 的
   * 系数各除以 20 得来，所以同一座城（发展度 = 规模 × 20）算出来的钱粮与改之前一样。
   * 仍然是占位值，等数值那一遍重算。
   */
  moneyPerDevelopment: 1,
  foodPerDevelopment: 1.5,
  moraleRef: 70,
  upkeepMoneyPerDevelopment: 0.25,
  upkeepFoodPerDevelopment: 0,

  /** 原来是「每兵每月 0.05」，这里摊到每天。 */
  unitFoodPerTroop: 0.05 / 30,

  moralePull: 0.02,
  moraleBaseline: 70,
  stabilityPull: 0.02,
  stabilityBaseline: 60,
  populationMoraleDivisor: 10000,

  speedBase: 120,
  // 各地貌的行军速度系数不在这里：它是地貌表每一行上的一个数，由 User 自己增改（schema v8 起）。

  /** 地图的框。坐标原点在左下角，范围是 0..mapWidth × 0..mapHeight。 */
  mapWidth: 10000,
  mapHeight: 7000,

  /** 缩放的上下界；types.ts 里那一段写了它俩与「缩到全图」的关系。 */
  zoomMin: 0.02,
  zoomMax: 6,

  /**
   * 六张表与日志每页几条。界面读它，引擎不读。旧的 `world.db` 里没有这一项，打开时按默认值补上
   * （`fillParamsGaps`），所以不用升 schema。
   */
  pageSize: 50,

  /** The window opens light; the toggle writes the other value back to the database. */
  theme: 'light',
};
