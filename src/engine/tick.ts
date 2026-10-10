import type { Params, Unit, World } from './types.ts';
import { linkBetween, linkById, otherEnd, siteById } from './world.ts';

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
 */
export function tickDay(world: World, p: Params): void {
  world.day += 1;
  startQueuedMoves(world, p);
  for (const u of world.units) {
    consumeFood(world, u, p);
    advanceMarch(world, u, p);
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

function nameOfSite(world: World, id: number): string {
  const s = siteById(world, id);
  return s ? s.name : '据点 ' + String(id);
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
      world.log.push(`第 ${world.day} 天：${u.name} 要去 ${nameOfSite(world, order.to)}，但两点之间没有连接，命令作废。`);
      u.queue.shift();
      continue;
    }
    u.queue.shift();
    u.place = { kind: 'march', link: link.id, from, to: order.to, t: 0 };
    world.log.push(`第 ${world.day} 天：${u.name} 从 ${nameOfSite(world, from)} 出发，前往 ${nameOfSite(world, order.to)}。`);
  }
}

function advanceMarch(world: World, u: Unit, p: Params): void {
  const pl = u.place;
  if (pl.kind === 'site') return;

  const link = linkById(world, pl.link);
  if (!link) return;

  const terrainFactor = p.terrainSpeed[link.terrain];
  const days = marchDays(u, link.distance, terrainFactor, p);
  if (!Number.isFinite(days) || days <= 0) return;

  pl.t += 1 / days;
  if (pl.t < 1) return;

  const arrived = pl.to;
  u.place = { kind: 'site', site: arrived };
  u.queue = [];
  world.log.push(`第 ${world.day} 天：${u.name} 抵达 ${nameOfSite(world, arrived)}，停住等命令。`);
}

function consumeFood(world: World, u: Unit, p: Params): void {
  u.carriedFood -= u.troops * p.unitFoodPerTroop;
  if (u.carriedFood < 0) {
    u.carriedFood = 0;
    world.log.push(`第 ${world.day} 天：${u.name} 随身粮草见底（按设计此处应停下来问 User，目前只记一行）。`);
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
