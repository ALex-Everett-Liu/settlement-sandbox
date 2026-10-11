// 枚举的显示名与固定顺序。引擎问 User 的时候选项要有人看得懂的名字，
// 界面也从这里取，免得同一个枚举在两处各写一份。
import type { FoodPolicy, Terrain } from './types.ts';

export const TERRAIN_LABEL: Record<Terrain, string> = {
  plain: '平原',
  hill: '丘陵',
  mountain: '山地',
  water: '水网',
  pass: '隘口',
};

/** 固定顺序：下拉与问询框的选项都按它排。 */
export const TERRAINS: Terrain[] = ['plain', 'hill', 'mountain', 'water', 'pass'];

export const FOOD_POLICY_LABEL: Record<FoodPolicy, string> = {
  attrition: '每天掉组织度与兵力',
  forage: '自动就地征粮',
  restrict: '只限制行动',
};

export const FOOD_POLICIES: FoodPolicy[] = ['attrition', 'forage', 'restrict'];

export function isTerrain(value: string): value is Terrain {
  return (TERRAINS as string[]).includes(value);
}

export function isFoodPolicy(value: string): value is FoodPolicy {
  return (FOOD_POLICIES as string[]).includes(value);
}
