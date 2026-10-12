import type { Division, Faction, Id, Link, Site, Terrain, Unit, World } from './types.ts';

export function emptyWorld(): World {
  return {
    day: 0, factions: [], divisions: [], sites: [], units: [], links: [], terrains: [], log: [], pending: null,
  };
}

/**
 * 下一个编号：取当前最大编号加一。删掉的编号一律不回收——旧存档里指到那个编号的据点、
 * 部队或连接会直接认到新对象头上，那比编号不连号难查得多。
 */
function nextId(list: { id: Id }[]): Id {
  return list.reduce((max, x) => Math.max(max, x.id), 0) + 1;
}

export function addFaction(world: World, name: string): Faction {
  const f: Faction = { id: nextId(world.factions), name };
  world.factions.push(f);
  return f;
}

export function addSite(world: World, site: Omit<Site, 'id'>): Site {
  const s: Site = { ...site, id: nextId(world.sites) };
  world.sites.push(s);
  return s;
}

export function addLink(world: World, a: Id, b: Id, detour: number, terrain: Id | null): Link {
  const l: Link = { id: nextId(world.links), a, b, detour, terrain };
  world.links.push(l);
  return l;
}

export function addUnit(world: World, unit: Omit<Unit, 'id'>): Unit {
  const u: Unit = { ...unit, id: nextId(world.units) };
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

// —— 部队的位置与驻军 ——

// —— 地貌：一档一行，由 User 自己增改。连接只指向这里的编号。——

export function addTerrain(
  world: World,
  name: string,
  speed: number,
  width: number,
  defense: number,
  food: number,
): Terrain {
  const t: Terrain = { id: nextId(world.terrains), name, speed, width, defense, food };
  world.terrains.push(t);
  return t;
}

export function terrainById(world: World, id: Id): Terrain | undefined {
  return world.terrains.find((t) => t.id === id);
}

/** 地貌名，找不到就用编号顶上。日志与说明行都用它。 */
export function terrainName(world: World, id: Id): string {
  const t = terrainById(world, id);
  return t ? t.name : '地貌 ' + String(id);
}

/**
 * 这条连接的地貌。没填、或者编号指不到任何一档，都算「未填」——引擎不替 User 挑一档，
 * 走到这条连接上就停下来问。
 */
export function linkTerrain(world: World, link: Link): Terrain | undefined {
  return link.terrain === null ? undefined : terrainById(world, link.terrain);
}

/** 有几条连接指着这一档地貌。删除挡路与表里那一列都用它。 */
export function terrainLinks(world: World, id: Id): number {
  return world.links.filter((l) => l.terrain === id).length;
}

/**
 * 新世界开头的那五档，名字与行军速度系数照搬原来写死的那一套。
 * 后面三个数（战场宽度、守方加成、粮草产出系数）现在是同一个占位值：还没有读者，
 * 等战斗与按地貌算粮草那两条链做出来，再由 User 自己调。
 */
export function seedTerrains(world: World): Terrain[] {
  return [
    addTerrain(world, '平原', 1, 100, 1, 1),
    addTerrain(world, '丘陵', 0.8, 100, 1, 1),
    addTerrain(world, '山地', 0.55, 100, 1, 1),
    addTerrain(world, '水网', 0.7, 100, 1, 1),
    addTerrain(world, '隘口', 0.6, 100, 1, 1),
  ];
}

/**
 * 部队当前在哪一点。在据点里就用那座据点的坐标，停着就用存下来的坐标，
 * 走路就按进度插值。地图、浮层与「定位」都走它，所以只有这一处算坐标。
 * 据点或连接找不到时返回 null：那一处数据互相冲突，画不出来也走不了。
 */
export function unitPoint(world: World, u: Unit): { x: number; y: number } | null {
  const p = u.place;
  if (p.kind === 'site') {
    const s = siteById(world, p.site);
    return s ? { x: s.x, y: s.y } : null;
  }
  if (p.kind === 'camp') return { x: p.x, y: p.y };
  if (p.kind === 'offroad') {
    return { x: p.fromX + (p.toX - p.fromX) * p.t, y: p.fromY + (p.toY - p.fromY) * p.t };
  }
  const a = siteById(world, p.from);
  const b = siteById(world, p.to);
  return a && b ? { x: a.x + (b.x - a.x) * p.t, y: a.y + (b.y - a.y) * p.t } : null;
}

/**
 * 一座据点的驻军：位置是这座据点的那些部队，外加它们的兵力合计。
 * 据点浮层、据点表与「删除据点」那条挡路条件都用它，免得三处各数一遍。
 */
export function siteGarrison(world: World, site: Id): { count: number; troops: number } {
  let count = 0;
  let troops = 0;
  for (const u of world.units) {
    if (u.place.kind !== 'site' || u.place.site !== site) continue;
    count += 1;
    troops += u.troops;
  }
  return { count, troops };
}

/**
 * 「到哪里去」怎么写：目的地是一座据点就写它的名字，否则写那一点坐标（留两位小数）。
 * 日志、说明行与队列那一行都用它。
 */
export function destinationName(world: World, toSite: Id | null, x: number, y: number): string {
  if (toSite !== null) return siteName(world, toSite);
  const r = (v: number) => String(Math.round(v * 100) / 100);
  return '（' + r(x) + ', ' + r(y) + '）';
}

/**
 * 把 id 挂到 parent 下面会不会成环：沿上级一路往上，能走回 id 就会。
 * seen 记走过的据点：库里要是已经有一个环，也不再绕圈，直接当成会成环挡回去。
 */
export function parentWouldCycle(world: World, id: Id, parent: Id): boolean {
  let cur: Id | null = parent;
  const seen = new Set<Id>();
  while (cur !== null) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = siteById(world, cur)?.parent ?? null;
  }
  return false;
}

/**
 * 这个层级值能不能写到某座据点上：上级的层级不低于它、下级的层级不高于它。
 * 能写返回 null，不能写返回挡回来的理由——说明行直接用它。
 */
export function levelRefusal(world: World, id: Id, level: number): string | null {
  const s = siteById(world, id);
  if (!s) return null;
  if (s.parent !== null) {
    const p = siteById(world, s.parent);
    if (p && level > p.level) {
      return '上级「' + p.name + '」是第 ' + String(p.level) + ' 层，比第 ' + String(level) + ' 层低';
    }
  }
  let worst: Site | null = null;
  for (const c of world.sites) {
    if (c.parent !== id) continue;
    if (c.level > level && (worst === null || c.level > worst.level)) worst = c;
  }
  if (worst !== null) {
    return '下级「' + worst.name + '」是第 ' + String(worst.level) + ' 层，比第 ' + String(level) + ' 层高';
  }
  return null;
}

/** 把 id 挂到 parent 下面，层级上过不过得去：候选的层级不能比它低。 */
export function parentLevelRefusal(world: World, id: Id, parent: Id): string | null {
  const s = siteById(world, id);
  const p = siteById(world, parent);
  if (!s || !p) return null;
  if (p.level < s.level) {
    return '「' + p.name + '」是第 ' + String(p.level) + ' 层，比「' + s.name + '」的第 ' + String(s.level) + ' 层低';
  }
  return null;
}

/**
 * 上级到下一级的索引：key 是上级的编号，value 是直接挂在它下面的那些据点。
 * 「层级」与「这一支」两处都用它。
 */
function childrenIndex(sites: Array<{ id: Id; parent: Id | null }>): Map<Id, Id[]> {
  const children = new Map<Id, Id[]>();
  for (const s of sites) {
    if (s.parent === null) continue;
    const list = children.get(s.parent);
    if (list) list.push(s.id);
    else children.set(s.parent, [s.id]);
  }
  return children;
}

/**
 * 按「没有下级就是第 0 层，否则是下级里最高那一档加一」算每个据点的层级。
 * 层级本身由 User 声明、存在 `Site.level` 里；这个算式只剩一个用处：库里升到 v4 时
 * 给新字段一个初值（以及自检）。界面不再按它算记号。
 * 走过的不再重算；库里要是有一个环，也不会绕个没完。
 */
export function levelsFromParents(sites: Array<{ id: Id; parent: Id | null }>): Map<Id, number> {
  const children = childrenIndex(sites);
  const level = new Map<Id, number>();
  const walk = (id: Id, seen: Set<Id>): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    let top = -1;
    for (const c of children.get(id) ?? []) top = Math.max(top, walk(c, seen));
    const n = top + 1;
    level.set(id, n);
    return n;
  };
  for (const s of sites) walk(s.id, new Set());
  return level;
}

/** 手上有一整个世界时的方便写法。 */
export function siteLevels(world: World): Map<Id, number> {
  return levelsFromParents(world.sites);
}

/** 这一支：root 自己，加上它下面所有层级的据点。环也收得住。 */
export function siteBranch(world: World, root: Id): Set<Id> {
  const children = childrenIndex(world.sites);
  const out = new Set<Id>();
  const stack: Id[] = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out;
}

// —— 辖区：一片地方的行政归属。它不是一个地点，治所只是它当下借用的那个据点。——

export function addDivision(world: World, name: string, rank: number): Division {
  const d: Division = { id: nextId(world.divisions), name, rank, parent: null, seat: null };
  world.divisions.push(d);
  return d;
}

export function divisionById(world: World, id: Id): Division | undefined {
  return world.divisions.find((d) => d.id === id);
}

/** 辖区名，找不到就用编号顶上。 */
export function divisionName(world: World, id: Id): string {
  const d = divisionById(world, id);
  return d ? d.name : '辖区 ' + String(id);
}

/**
 * 一个辖区的地盘：自己名下的据点，加上各级下级辖区名下的据点。
 * 治所必须落在这里面。环也收得住。
 */
export function divisionSites(world: World, id: Id): Set<Id> {
  const out = new Set<Id>();
  const seen = new Set<Id>();
  const stack: Id[] = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const s of world.sites) if (s.division === cur) out.add(s.id);
    for (const d of world.divisions) if (d.parent === cur) stack.push(d.id);
  }
  return out;
}

/** 把 id 挂到 parent 下面会不会成环：沿上级辖区一路往上，能走回 id 就会。 */
export function divisionWouldCycle(world: World, id: Id, parent: Id): boolean {
  let cur: Id | null = parent;
  const seen = new Set<Id>();
  while (cur !== null) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = divisionById(world, cur)?.parent ?? null;
  }
  return false;
}

/** 这个等级能不能写到某个辖区上：上级辖区不低于它、下级辖区不高于它。 */
export function divisionRankRefusal(world: World, id: Id, rank: number): string | null {
  const d = divisionById(world, id);
  if (!d) return null;
  if (d.parent !== null) {
    const p = divisionById(world, d.parent);
    if (p && rank > p.rank) {
      return '上级辖区「' + p.name + '」是第 ' + String(p.rank) + ' 级，比第 ' + String(rank) + ' 级低';
    }
  }
  let worst: Division | null = null;
  for (const c of world.divisions) {
    if (c.parent !== id) continue;
    if (c.rank > rank && (worst === null || c.rank > worst.rank)) worst = c;
  }
  if (worst !== null) {
    return '下级辖区「' + worst.name + '」是第 ' + String(worst.rank) + ' 级，比第 ' + String(rank) + ' 级高';
  }
  return null;
}

/** 治所能不能设成这个据点：必须在自己的整棵子树里。 */
export function seatRefusal(world: World, division: Id, site: Id): string | null {
  const d = divisionById(world, division);
  if (!d) return null;
  if (divisionSites(world, division).has(site)) return null;
  return '「' + siteName(world, site) + '」不在「' + d.name + '」的地盘里';
}

/**
 * 据点自己的层数与它所属辖区的等级对不上时就提醒一句（不挡）：
 * 这个地方声明得比管它的辖区还高。对得上、或者没有辖区，都返回 null。
 */
export function siteDivisionNote(world: World, site: Id, division: Id | null): string | null {
  if (division === null) return null;
  const s = siteById(world, site);
  const d = divisionById(world, division);
  if (!s || !d) return null;
  if (s.level <= d.rank) return null;
  return '「' + s.name + '」是第 ' + String(s.level) + ' 层，比它所属的「' + d.name + '」（第 ' + String(d.rank) + ' 级）还高';
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
  const plain = seedTerrains(w)[0]!;

  const a = addSite(w, {
    name: 'A 城', x: 1000, y: 2000, development: 60, fortification: 2, population: 9000,
    morale: 70, stability: 60, money: 1000, food: 1000, parent: null, level: 0, division: null, faction: wei.id,
  });
  const b = addSite(w, {
    name: 'B 城', x: 3000, y: 2500, development: 40, fortification: 0, population: 6000,
    morale: 65, stability: 55, money: 800, food: 800, parent: null, level: 0, division: null, faction: shu.id,
  });

  addLink(w, a.id, b.id, 1, plain.id);

  addUnit(w, {
    faction: wei.id, name: '甲队', troops: 500, training: 50, organization: 100,
    place: { kind: 'site', site: a.id }, carriedFood: 100, foodPolicy: null,
    queue: [{ kind: 'march', to: b.id }],
  });

  return w;
}
