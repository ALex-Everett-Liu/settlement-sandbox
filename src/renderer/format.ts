// Renderer-side formatting: engine enums and positions become Chinese labels.
// Nothing here mutates the world.
import type { Order, Place, Terrain, Unit, World } from '../engine/types.ts';

export const TERRAIN_LABEL: Record<Terrain, string> = {
  plain: '平原',
  hill: '丘陵',
  mountain: '山地',
  water: '水域',
  pass: '隘口',
};

/** Fixed order, so the terrain dropdown does not follow object key order. */
export const TERRAINS: Terrain[] = ['plain', 'hill', 'mountain', 'water', 'pass'];

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

/** Where the unit stands right now. The only value that moves on its own. */
export function placeText(world: World, place: Place): string {
  if (place.kind === 'site') return '在 ' + siteName(world, place.site);
  const ends = siteName(world, place.from) + ' → ' + siteName(world, place.to);
  return ends + (place.kind === 'march' ? ' 行军 ' : ' 扎营 ') + percent(place.t);
}

/** The whole queue as one line; the table adds it when the queue holds more than one order. */
export function orderText(world: World, unit: Unit): string {
  if (unit.queue.length === 0) return '—';
  const parts = unit.queue.map((o: Order) => (o.kind === 'hold' ? '原地待命' : '前往 ' + siteName(world, o.to)));
  return parts.join('、');
}

/** The command column edits the queue's first order; a select needs a string value. */
export function orderValue(unit: Unit): string {
  const first = unit.queue[0];
  if (!first) return '';
  return first.kind === 'hold' ? 'hold' : 'march:' + String(first.to);
}

/** Turn a select value back into a queue. Choosing one replaces the whole queue. */
export function orderFromValue(value: string): Order[] {
  if (value === '') return [];
  if (value === 'hold') return [{ kind: 'hold' }];
  return [{ kind: 'march', to: Number(value.slice('march:'.length)) }];
}
