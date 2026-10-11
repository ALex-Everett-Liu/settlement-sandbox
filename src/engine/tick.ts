import type { Params, Unit, World } from './types.ts';
import { askFoodPolicy, askLinkTerrain } from './ask.ts';
import { FOOD_POLICY_LABEL } from './labels.ts';
import { linkBetween, linkById, otherEnd, siteName } from './world.ts';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 当天是这个月的第几天。第 1 天是 1 月 1 日。 */
export function dayOfMonth(world: World, p: Params): number {
  return ((world.day - 1) % p.daysPerMonth) + 1;
}

export function month(world: World, p: Params): number {
  return Math.floor((world.day - 1) / p.daysPerMonth) % p.monthsPerYear + 1;
}

export function year(world: World, p: Params): number {
  return Math.floor((world.day - 1) / (p.daysPerMonth * p.monthsPerYear)) + 1;
}

export function isMonthEnd(world: World, p: Params): boolean {
  return dayOfMonth(world, p) === p.daysPerMonth;
}

/**
 * 推进一天。顺序：日期加一 → 队列里的行军命令启动 → 每支部队吃粮与行军 →
 * 若是月末，结算月层。
 * pending 不为空时一整天都不走：引擎停在某个问题上等 User 回答。
 * 一天里最多只会挂上一个问题——每一步之后都看一眼，挂上了就停。
 */
export function tickDay(world: World, p: Params): void {
  if (world.pending) return;
  world.day += 1;
  startQueuedMoves(world, p);
  if (world.pending) return;
  for (const u of world.units) {
    consumeFood(world, u, p);
    if (world.pending) return;
    advanceMarch(world, u, p);
    if (world.pending) return;
  }
  if (isMonthEnd(world, p)) settleMonth(world, p);
}

/** 占位公式：兵越多越慢，训练度越高越快。地貌系数由调用方先乘进来。 */
export function marchingSpeed(u: Unit, terrainFactor: number, p: Params): number {
  const troopFactor = Math.max(0.4, 1 - Math.min(u.troops, 20000) / 40000);
  const trainingFactor = 0.5 + u.training / 200;
  return p.speedBase * terrainFactor * troopFactor * trainingFactor;
}

/** 连接上的行军天数。 */
export function marchDays(u: Unit, distance: number, terrainFactor: number, p: Params): number {
  const speed = marchingSpeed(u, terrainFactor, p);
  return speed <= 0 ? Infinity : distance / speed;
}

function startQueuedMoves(world: World, p: Params): void {
  for (const u of world.units) {
    if (u.place.kind !== 'site' || u.queue.length === 0) continue;
    const order = u.queue[0];
    if (!order || order.kind !== 'march') continue;

    const from = u.place.site;
    if (order.to === from) {
      u.queue.shift();
      continue;
    }
    const link = linkBetween(world, from, order.to);
    if (!link) {
      world.log.push(`第 ${world.day} 天：${u.name} 要去 ${siteName(world, order.to)}，但两点之间没有连接，命令作废。`);
      u.queue.shift();
      continue;
    }
    // 地貌没填就不替 User 猜：停下来问，命令留在队列里，答完再出发。
    if (link.terrain === null) {
      world.pending = askLinkTerrain(
        `${u.name} 要从 ${siteName(world, from)} 去 ${siteName(world, order.to)}`,
        link,
      );
      return;
    }
    u.queue.shift();
    u.place = { kind: 'march', link: link.id, from, to: order.to, t: 0 };
    world.log.push(`第 ${world.day} 天：${u.name} 从 ${siteName(world, from)} 出发，前往 ${siteName(world, order.to)}。`);
  }
}

function advanceMarch(world: World, u: Unit, p: Params): void {
  const pl = u.place;
  if (pl.kind === 'site') return;

  const link = linkById(world, pl.link);
  if (!link) return;

  // 走在半路时地貌被清空了：同样停下来问，不能拿旧值接着算。
  if (link.terrain === null) {
    world.pending = askLinkTerrain(`${u.name} 正走在 ${siteName(world, pl.from)} — ${siteName(world, pl.to)} 上`, link);
    return;
  }

  const terrainFactor = p.terrainSpeed[link.terrain];
  const days = marchDays(u, link.distance, terrainFactor, p);
  if (!Number.isFinite(days) || days <= 0) return;

  pl.t += 1 / days;
  if (pl.t < 1) return;

  const arrived = pl.to;
  u.place = { kind: 'site', site: arrived };
  u.queue = [];
  world.log.push(`第 ${world.day} 天：${u.name} 抵达 ${siteName(world, arrived)}，停住等命令。`);
}

/**
 * 吃粮。粮草见底时按设计 §五 第 11 条停下来问怎么办；
 * 问过一次就按记下的办，不再每天记一行。三种处理方式的具体数值还没定（§九）。
 */
function consumeFood(world: World, u: Unit, p: Params): void {
  const before = u.carriedFood;
  u.carriedFood -= u.troops * p.unitFoodPerTroop;
  if (u.carriedFood > 0) return;

  u.carriedFood = 0;
  if (u.foodPolicy === null) {
    world.pending = askFoodPolicy(`${u.name} 的随身粮草吃完了`, u);
    return;
  }
  if (before > 0) {
    world.log.push(
      `第 ${world.day} 天：${u.name} 随身粮草见底，按「${FOOD_POLICY_LABEL[u.foodPolicy]}」处置（三种处理方式的数值还没定）。`,
    );
  }
}

/** 月层结算：每座据点各自收支，民心与稳定度向基准靠拢，人口随民心偏移。 */
export function settleMonth(world: World, p: Params): void {
  for (const s of world.sites) {
    const moraleFactor = s.morale / p.moraleRef;
    const income = Math.round(p.moneyPerScale * s.scale * moraleFactor);
    const harvest = Math.round(p.foodPerScale * s.scale * moraleFactor);
    const moneyCost = Math.round(p.upkeepMoneyPerScale * s.scale);
    const foodCost = Math.round(p.upkeepFoodPerScale * s.scale);

    s.money += income - moneyCost;
    s.food += harvest - foodCost;
    s.morale = clamp(s.morale + (p.moraleBaseline - s.morale) * p.moralePull, 0, 100);
    s.stability = clamp(s.stability + (p.stabilityBaseline - s.stability) * p.stabilityPull, 0, 100);
    s.population = Math.max(
      0,
      Math.round(s.population * (1 + (s.morale - p.moraleBaseline) / p.populationMoraleDivisor)),
    );
  }
  world.log.push(`第 ${world.day} 天：月末结算完毕。`);
}

export { otherEnd };
