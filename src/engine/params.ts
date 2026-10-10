import type { Params } from './types.ts';

/**
 * 占位参数。全部待重算——设计文档 §九 的数值待定项（按人口与地貌重写产出、
 * 口粮、兵源上限，以及行军速度公式与地貌五档的四个系数）。
 */
export const DEFAULT_PARAMS: Params = {
  daysPerMonth: 30,
  monthsPerYear: 12,

  moneyPerScale: 20,
  foodPerScale: 30,
  moraleRef: 70,
  upkeepMoneyPerScale: 5,
  upkeepFoodPerScale: 0,

  /** 原来是「每兵每月 0.05」，这里摊到每天。 */
  unitFoodPerTroop: 0.05 / 30,

  moralePull: 0.02,
  moraleBaseline: 70,
  stabilityPull: 0.02,
  stabilityBaseline: 60,
  populationMoraleDivisor: 10000,

  speedBase: 120,
  terrainSpeed: { plain: 1, hill: 0.8, mountain: 0.55, water: 0.7, pass: 0.6 },
};
