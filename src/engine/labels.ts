// 枚举的显示名与固定顺序。引擎问 User 的时候选项要有人看得懂的名字，
// 界面也从这里取，免得同一个枚举在两处各写一份。
// 地貌不在这里：它已经改成由 User 自己增改的一串记录（`World.terrains`）。
import type { FoodPolicy } from './types.ts';

export const FOOD_POLICY_LABEL: Record<FoodPolicy, string> = {
  attrition: '每天掉组织度与兵力',
  forage: '自动就地征粮',
  restrict: '只限制行动',
};

export const FOOD_POLICIES: FoodPolicy[] = ['attrition', 'forage', 'restrict'];

export function isFoodPolicy(value: string): value is FoodPolicy {
  return (FOOD_POLICIES as string[]).includes(value);
}
