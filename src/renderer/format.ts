// Renderer-side formatting: engine enums and positions become Chinese labels.
// Nothing here mutates the world.
import { TERRAIN_LABEL, TERRAINS } from '../engine/labels.ts';
import type { Place, Unit, World } from '../engine/types.ts';

// 地貌的名字与顺序由引擎那边给，界面不再各写一份。
export { TERRAIN_LABEL, TERRAINS };

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

/** Where the unit stands right now. The only value that moves on its own. */
export function placeText(world: World, place: Place): string {
  if (place.kind === 'site') return '在 ' + siteName(world, place.site);
  const ends = siteName(world, place.from) + ' → ' + siteName(world, place.to);
  return ends + (place.kind === 'march' ? ' 行军 ' : ' 扎营 ') + percent(place.t);
}

/** The whole queue as one line; the table shows it under the three command buttons. */
export function orderText(world: World, unit: Unit): string {
  if (unit.queue.length === 0) return '—';
  const parts = unit.queue.map((o) => (o.kind === 'hold' ? '原地待命' : '前往 ' + siteName(world, o.to)));
  return parts.join('、');
}
