// Renderer-side formatting: engine enums and positions become Chinese labels.
// Nothing here mutates the world.
import type { Place, Unit, World } from '../engine/types.ts';
import { destinationName, siteGarrison } from '../engine/world.ts';

export function siteName(world: World, id: number): string {
  const site = world.sites.find((s) => s.id === id);
  return site ? site.name : '据点 ' + String(id);
}

export function factionName(world: World, id: number): string {
  const faction = world.factions.find((f) => f.id === id);
  return faction ? faction.name : '势力 ' + String(id);
}

function percent(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  return String(Math.round(clamped * 100)) + '%';
}

/** 坐标这类带小数的值：留两位，免得浮点尾巴露出来。 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 一位小数：发展度、防御设施等级、民心、稳定度这些显示用。 */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 数字格显示用：显示存下来的那个数，浮点尾巴按 `decimals` 位封顶（默认三位），
 * 不管尾巴直接印会印出 99.16666666666667 这种。位数本身不设限，0.55 这类两位的照原样显示；
 * 倍数下界那一格的下限是 0.0001，所以它单独传四位。
 * 原先一律按一位小数显示，于是 0.55 写成 0.6、倍数下界的 0.02 写成 0——格子里写的数与
 * 世界里的数对不上，User 从那一格再改一次就会把真的那个数改掉。
 */
export function cellText(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toFixed(decimals)));
}

/** 一个坐标点怎么写。 */
function point(x: number, y: number): string {
  return '（' + String(round2(x)) + ', ' + String(round2(y)) + '）';
}

/** Where the unit stands right now. The only value that moves on its own. */
export function placeText(world: World, place: Place): string {
  if (place.kind === 'site') return '在 ' + siteName(world, place.site);
  if (place.kind === 'camp') return '停在 ' + point(place.x, place.y);
  if (place.kind === 'offroad') {
    return (
      point(place.fromX, place.fromY) +
      ' → ' +
      destinationName(world, place.toSite, place.toX, place.toY) +
      ' 离开道路 ' +
      percent(place.t) +
      '（×' +
      String(place.factor) +
      '）'
    );
  }
  return siteName(world, place.from) + ' → ' + siteName(world, place.to) + ' 行军 ' + percent(place.t);
}

/** The whole queue as one line; the table shows it under the three command buttons. */
export function orderText(world: World, unit: Unit): string {
  if (unit.queue.length === 0) return '—';
  const parts = unit.queue.map((o) => {
    if (o.kind === 'hold') return '原地待命';
    if (o.kind === 'offroad') {
      return (
        '离开道路 前往 ' + destinationName(world, o.toSite, o.toX, o.toY) + '（×' + String(o.factor) + '）'
      );
    }
    return '前往 ' + siteName(world, o.to);
  });
  return parts.join('、');
}

/** 据点那一格：驻军几支、兵力几何；没有驻军就是「—」。浮层与据点表共用这一个写法。 */
export function garrisonText(world: World, site: number): string {
  const g = siteGarrison(world, site);
  return g.count === 0 ? '—' : String(g.count) + ' 支 · ' + String(g.troops);
}
