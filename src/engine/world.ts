import type { Faction, Id, Link, Site, Terrain, Unit, World } from './types.ts';

export function emptyWorld(): World {
  return { day: 0, factions: [], sites: [], units: [], links: [], log: [], pending: null };
}

export function addFaction(world: World, name: string): Faction {
  const f: Faction = { id: world.factions.length + 1, name };
  world.factions.push(f);
  return f;
}

export function addSite(world: World, site: Omit<Site, 'id'>): Site {
  const s: Site = { ...site, id: world.sites.length + 1 };
  world.sites.push(s);
  return s;
}

export function addLink(world: World, a: Id, b: Id, detour: number, terrain: Terrain | null): Link {
  const l: Link = { id: world.links.length + 1, a, b, detour, terrain };
  world.links.push(l);
  return l;
}

export function addUnit(world: World, unit: Omit<Unit, 'id'>): Unit {
  const u: Unit = { ...unit, id: world.units.length + 1 };
  world.units.push(u);
  return u;
}

export function siteById(world: World, id: Id): Site | undefined {
  return world.sites.find((s) => s.id === id);
}

/** 据点名，找不到就用编号顶上。日志与问询都用它。 */
export function siteName(world: World, id: Id): string {
  const s = siteById(world, id);
  return s ? s.name : '据点 ' + String(id);
}

/** 连接的名字：两端据点。 */
export function linkName(world: World, link: Link): string {
  return siteName(world, link.a) + ' — ' + siteName(world, link.b);
}

/**
 * 连接的长度：两端直线距离乘绕行系数。坐标只拿来做两件事——画地图与算这个长度，
 * 所以挪动一个据点会同时改掉挂在它上面的每一条连接的长度。
 */
export function linkLength(world: World, link: Link): number {
  const a = siteById(world, link.a);
  const b = siteById(world, link.b);
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y) * link.detour;
}

export function linkById(world: World, id: Id): Link | undefined {
  return world.links.find((l) => l.id === id);
}

export function linkBetween(world: World, a: Id, b: Id): Link | undefined {
  return world.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

/** 连接的另一个端点。 */
export function otherEnd(link: Link, from: Id): Id {
  return link.a === from ? link.b : link.a;
}

export function cloneWorld(world: World): World {
  return structuredClone(world);
}

export function worldToJson(world: World): string {
  return JSON.stringify(world, null, 2);
}

export function worldFromJson(text: string): World {
  return JSON.parse(text) as World;
}

/** 一个最小世界：两座城、一条连接、一支带行军命令的部队。自检与首次运行都用它。 */
export function demoWorld(): World {
  const w = emptyWorld();
  const wei = addFaction(w, '魏');
  const shu = addFaction(w, '蜀');

  const a = addSite(w, {
    name: 'A 城', x: 1000, y: 2000, scale: 3, population: 9000,
    morale: 70, stability: 60, money: 1000, food: 1000, parent: null, faction: wei.id,
  });
  const b = addSite(w, {
    name: 'B 城', x: 3000, y: 2500, scale: 2, population: 6000,
    morale: 65, stability: 55, money: 800, food: 800, parent: null, faction: shu.id,
  });

  addLink(w, a.id, b.id, 1, 'plain');

  addUnit(w, {
    faction: wei.id, name: '甲队', troops: 500, training: 50, organization: 100,
    place: { kind: 'site', site: a.id }, carriedFood: 100, foodPolicy: null,
    queue: [{ kind: 'march', to: b.id }],
  });

  return w;
}
