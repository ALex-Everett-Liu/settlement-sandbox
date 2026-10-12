import { useCallback, useEffect, useRef, useState } from 'react';
import { answerAsk, askOffroadFactor } from '../engine/ask.ts';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Link, Order, Params, Site, Theme, Unit, World } from '../engine/types.ts';
import {
  addDivision,
  addFaction,
  addLink,
  addSite,
  demoWorld,
  divisionName,
  divisionRankRefusal,
  divisionSites,
  divisionWouldCycle,
  levelRefusal,
  linkName,
  parentLevelRefusal,
  parentWouldCycle,
  seatRefusal,
  siteDivisionNote,
  siteName,
} from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import { MapView } from './map.tsx';
import { SettingsView } from './settings.tsx';
import { DivisionTable, FactionTable, LinkTable, SiteTable, UnitTable } from './tables.tsx';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

type View = 'factions' | 'divisions' | 'sites' | 'units' | 'links' | 'map' | 'settings';

const VIEWS: { id: View; label: string }[] = [
  { id: 'factions', label: '势力' },
  { id: 'divisions', label: '辖区' },
  { id: 'sites', label: '据点' },
  { id: 'units', label: '部队' },
  { id: 'links', label: '连接' },
  { id: 'map', label: '地图' },
  { id: 'settings', label: '设置' },
];

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [view, setView] = useState<View>('sites');
  const [dbPath, setDbPath] = useState('（还不知道）');
  const [note, setNote] = useState('正在打开世界库…');
  // 正在挑的起点据点：0 表示还没挑。挑法是在地图上点据点，见 MapView 的 onPickSite。
  const [linkFrom, setLinkFrom] = useState(0);
  // 正在挑目的地的那支部队：0 表示没有。与起点共用地图上那一次点选。
  const [orderTarget, setOrderTarget] = useState(0);
  // 正在给它挑上级的那个据点：0 表示没有。同样共用地图上那一次点选。
  const [parentTarget, setParentTarget] = useState(0);
  // 据点表「只看某一支」选中的那一座；null 就是全部。
  const [onlySite, setOnlySite] = useState<{ kind: 'site' | 'division'; id: number; name: string } | null>(null);
  // 正在给哪个辖区挑治所：0 表示没有。与前面几种共用地图上那一次点选。
  const [seatTarget, setSeatTarget] = useState(0);
  // 「定位」请求：n 是次数，同一个目标按两次也要重新定位一次。
  const [focus, setFocus] = useState<{ kind: 'site' | 'unit'; id: number; n: number } | null>(null);
  const worldRef = useRef<World | null>(null);

  // The theme rides in the params table, so it is stored in this world's database.
  // A database written before the field existed has no theme; that reads as light.
  const theme: Theme = params.theme === 'dark' ? 'dark' : 'light';

  const commit = useCallback((w: World) => {
    worldRef.current = w;
    setWorld({ ...w });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!api) {
        setNote('window.sandbox 不存在：preload 没加载上');
        return;
      }
      try {
        const p = await api.dataPath();
        if (alive) setDbPath(p);
        const loadedParams = await api.loadParams();
        if (alive && loadedParams) setParams(loadedParams);
        const loaded = await api.loadWorld();
        const w = loaded ?? demoWorld();
        if (!loaded) await api.saveWorld(w);
        if (!alive) return;
        worldRef.current = w;
        setWorld({ ...w });
        setNote(loaded ? '读到了已有的世界' : '库里是空的：建了一个最小世界并写进去');
      } catch (e) {
        if (alive) setNote('启动失败：' + String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The two palettes in styles.css are keyed off <html data-theme>.
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  // 时间轴：自动走，速度是「每秒多少天」。
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      tickDay(w, params);
      commit(w);
    }, Math.max(16, Math.round(1000 / speed)));
    return () => window.clearInterval(id);
  }, [running, speed, params, commit]);

  const day = world ? world.day : 0;
  const stopped = world !== null && world.pending !== null;

  // 引擎停住了就别让时间轴空转：切回暂停，界面上才看得出为什么日期不动。
  useEffect(() => {
    if (stopped) setRunning(false);
  }, [stopped]);

  // 每到月末自动存一次。
  useEffect(() => {
    if (day === 0 || day % params.daysPerMonth !== 0) return;
    const w = worldRef.current;
    if (!w || !api) return;
    void api.saveWorld(w).then(() => setNote('第 ' + day + ' 天：月末自动保存'));
  }, [day, params.daysPerMonth]);

  const step = useCallback(
    (days: number) => {
      const w = worldRef.current;
      if (!w) return;
      for (let i = 0; i < days; i += 1) tickDay(w, params);
      commit(w);
    },
    [params, commit],
  );

  const editSite = useCallback(
    (id: number, patch: Partial<Site>) => {
      const w = worldRef.current;
      if (!w) return;
      const s = w.sites.find((x) => x.id === id);
      if (!s) return;
      Object.assign(s, patch);
      commit(w);
    },
    [commit],
  );

  /** 改层级：上级不低于它、下级不高于它，破了一条就挡回来并写明是哪两座。 */
  const editSiteLevel = useCallback(
    (id: number, level: number) => {
      const w = worldRef.current;
      if (!w) return;
      const s = w.sites.find((x) => x.id === id);
      if (!s) return;
      const why = levelRefusal(w, id, level);
      if (why !== null) {
        setNote('「' + s.name + '」改不成第 ' + String(level) + ' 层：' + why);
        return;
      }
      s.level = level;
      commit(w);
      setNote('「' + s.name + '」的层级改成第 ' + String(level) + ' 层');
    },
    [commit],
  );

  /** 新建一个辖区：名字与等级给初值，上级与治所都空着。 */
  const addDivisionRow = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const d = addDivision(w, '新辖区 ' + String(w.divisions.length + 1), 0);
    commit(w);
    setNote('新增辖区：' + d.name + '（#' + String(d.id) + '）');
    if (api) void api.saveWorld(w);
  }, [commit]);

  const renameDivision = useCallback(
    (id: number, name: string) => {
      const w = worldRef.current;
      if (!w) return;
      const d = w.divisions.find((x) => x.id === id);
      if (!d) return;
      d.name = name;
      commit(w);
    },
    [commit],
  );

  /** 改辖区等级：上级辖区不低于它、下级辖区不高于它，破了就挡回来。 */
  const editDivisionRank = useCallback(
    (id: number, rank: number) => {
      const w = worldRef.current;
      if (!w) return;
      const d = w.divisions.find((x) => x.id === id);
      if (!d) return;
      const why = divisionRankRefusal(w, id, rank);
      if (why !== null) {
        setNote('「' + d.name + '」改不成第 ' + String(rank) + ' 级：' + why);
        return;
      }
      d.rank = rank;
      commit(w);
      setNote('「' + d.name + '」的等级改成第 ' + String(rank) + ' 级');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 改上级辖区：挡环，也挡等级倒挂。 */
  const editDivisionParent = useCallback(
    (id: number, parent: number | null) => {
      const w = worldRef.current;
      if (!w) return;
      const d = w.divisions.find((x) => x.id === id);
      if (!d) return;
      if (parent === null) {
        d.parent = null;
        commit(w);
        setNote('「' + d.name + '」的上级辖区清掉了');
        if (api) void api.saveWorld(w);
        return;
      }
      if (parent === id) {
        setNote('辖区不能当自己的上级');
        return;
      }
      if (divisionWouldCycle(w, id, parent)) {
        setNote('挂上去会连成一个环：' + divisionName(w, parent) + ' 已经在「' + d.name + '」下面');
        return;
      }
      const p = w.divisions.find((x) => x.id === parent);
      if (p && p.rank < d.rank) {
        setNote('挂不上：「' + p.name + '」是第 ' + String(p.rank) + ' 级，比「' + d.name + '」的第 ' + String(d.rank) + ' 级低');
        return;
      }
      d.parent = parent;
      commit(w);
      setNote('「' + d.name + '」的上级辖区改成 ' + divisionName(w, parent));
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 点据点表的辖区那一格：写回之后，据点层数比辖区等级还高就只在说明行提一句。 */
  const editSiteDivision = useCallback(
    (id: number, division: number | null) => {
      const w = worldRef.current;
      if (!w) return;
      const s = w.sites.find((x) => x.id === id);
      if (!s) return;
      s.division = division;
      commit(w);
      const note = siteDivisionNote(w, id, division);
      if (note !== null) setNote('提醒：' + note);
      else {
        setNote(
          division === null
            ? '「' + s.name + '」的辖区清掉了'
            : '「' + s.name + '」挂在 ' + divisionName(w, division) + ' 下面',
        );
      }
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 点「治所…」：等一次地图上的点选，选中哪个据点就是治所。 */
  const startSeatPick = useCallback((divisionId: number) => {
    setLinkFrom(0);
    setOrderTarget(0);
    setParentTarget(0);
    setSeatTarget(divisionId);
    setNote('挑治所：在地图上点一个据点（Esc 或点空白处取消）');
  }, []);

  /** 删辖区：名下还有据点或下级辖区就不许删。 */
  const deleteDivision = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const d = w.divisions.find((x) => x.id === id);
      if (!d) return;
      const sites = w.sites.filter((x) => x.division === id).length;
      const below = w.divisions.filter((x) => x.parent === id).length;
      const why: string[] = [];
      if (sites > 0) why.push('名下有 ' + String(sites) + ' 座据点');
      if (below > 0) why.push('有 ' + String(below) + ' 个下级辖区');
      if (why.length > 0) {
        setNote('「' + d.name + '」' + why.join('、') + '，先把这些处理掉，再删');
        return;
      }
      w.divisions = w.divisions.filter((x) => x.id !== id);
      if (seatTarget === id) setSeatTarget(0);
      commit(w);
      setNote('删掉了辖区「' + d.name + '」（#' + String(id) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit, seatTarget],
  );

  const editUnit = useCallback(
    (id: number, patch: Partial<Unit>) => {
      const w = worldRef.current;
      if (!w) return;
      const u = w.units.find((x) => x.id === id);
      if (!u) return;
      Object.assign(u, patch);
      commit(w);
    },
    [commit],
  );

  const editLink = useCallback(
    (id: number, patch: Partial<Link>) => {
      const w = worldRef.current;
      if (!w) return;
      const l = w.links.find((x) => x.id === id);
      if (!l) return;
      Object.assign(l, patch);
      commit(w);
    },
    [commit],
  );

  // The command column replaces the whole queue; the tick acts on the first order.
  const editQueue = useCallback(
    (id: number, queue: Order[]) => {
      const w = worldRef.current;
      if (!w) return;
      const u = w.units.find((x) => x.id === id);
      if (!u) return;
      u.queue = queue;
      commit(w);
    },
    [commit],
  );

  const saveNow = useCallback(async () => {
    const w = worldRef.current;
    if (!w || !api) return;
    await api.saveWorld(w);
    setNote('已保存 · 第 ' + w.day + ' 天');
  }, []);

  const takeSnapshot = useCallback(async () => {
    const w = worldRef.current;
    if (!w || !api) return;
    const p = await api.snapshot('day-' + String(w.day).padStart(5, '0'));
    setNote('快照：' + p);
  }, []);

  /** 设置页签改参数：先夹一道范围，再写回世界库（主题也在这一页里改）。 */
  const writeParams = useCallback(
    (patch: Partial<Params>) => {
      const next: Params = { ...params, ...patch };
      next.mapWidth = Math.round(Math.min(1000000, Math.max(100, next.mapWidth)));
      next.mapHeight = Math.round(Math.min(1000000, Math.max(100, next.mapHeight)));
      next.zoomMin = Math.min(1, Math.max(0.0001, next.zoomMin));
      next.zoomMax = Math.min(100, Math.max(0.01, next.zoomMax));
      if (next.zoomMax < next.zoomMin) {
        if (patch.zoomMax !== undefined) next.zoomMin = next.zoomMax;
        else next.zoomMax = next.zoomMin;
      }
      setParams(next);
      if (api) void api.saveParams(next);
    },
    [params],
  );

  // 把答案写回世界并存一次：这类回答不该等到月末那一次自动保存。
  const answer = useCallback(
    (value: string) => {
      const w = worldRef.current;
      if (!w) return;
      if (!answerAsk(w, value)) {
        setNote('这个值写不回去：' + value);
        return;
      }
      commit(w);
      setNote('回答记下了');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 势力表里改名字：与别的表一样就地改，等月末那一次自动保存。 */
  const renameFaction = useCallback(
    (id: number, name: string) => {
      const w = worldRef.current;
      if (!w) return;
      const f = w.factions.find((x) => x.id === id);
      if (!f) return;
      f.name = name;
      commit(w);
    },
    [commit],
  );

  /** 势力表末尾那个「＋」：添一行，名字先给个编号，编号只往前走（不回收删掉的号）。 */
  const addFactionRow = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const f = addFaction(w, '新势力 ' + String(w.factions.length + 1));
    commit(w);
    setNote('新增势力：' + f.name + '（#' + String(f.id) + '）');
    if (api) void api.saveWorld(w);
  }, [commit]);

  /** 势力表里按「删除」：名下还挂着据点或部队就不删，说明行写清楚还挂着多少。 */
  const deleteFaction = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const f = w.factions.find((x) => x.id === id);
      if (!f) return;
      const sites = w.sites.filter((s) => s.faction === id).length;
      const units = w.units.filter((u) => u.faction === id).length;
      if (sites > 0 || units > 0) {
        setNote(
          '「' + f.name + '」名下还有 ' + String(sites) + ' 座据点、' + String(units) +
            ' 支部队，先把它们改派到别的势力，再删',
        );
        return;
      }
      w.factions = w.factions.filter((x) => x.id !== id);
      commit(w);
      setNote('删掉了势力「' + f.name + '」（#' + String(id) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 删一座据点：四条挡路条件，挡在哪一条就把哪一条写进说明行。 */
  const deleteSite = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const s = w.sites.find((x) => x.id === id);
      if (!s) return;
      const why: string[] = [];
      const staying = w.units.filter((u) => u.place.kind === 'site' && u.place.site === id).length;
      if (staying > 0) why.push('有 ' + String(staying) + ' 支部队停在里面');
      const hanging = w.links.filter((l) => l.a === id || l.b === id).length;
      if (hanging > 0) why.push('有 ' + String(hanging) + ' 条连接挂在它两头');
      const below = w.sites.filter((x) => x.parent === id).length;
      if (below > 0) why.push('有 ' + String(below) + ' 座据点认它当上级');
      const heading = w.units.filter((u) => {
        const p = u.place;
        const onTheWay = (p.kind === 'march' && p.to === id) || (p.kind === 'offroad' && p.toSite === id);
        return (
          onTheWay ||
          u.queue.some((o) => (o.kind === 'march' && o.to === id) || (o.kind === 'offroad' && o.toSite === id))
        );
      }).length;
      if (heading > 0) why.push('有 ' + String(heading) + ' 支部队正朝它去');
      if (why.length > 0) {
        setNote('「' + s.name + '」' + why.join('、') + '，先把这些处理掉，再删');
        return;
      }
      w.sites = w.sites.filter((x) => x.id !== id);
      if (linkFrom === id) setLinkFrom(0);
      if (parentTarget === id) setParentTarget(0);
      if (onlySite !== null && onlySite.id === id) setOnlySite(null);
      commit(w);
      setNote('删掉了据点「' + s.name + '」（#' + String(id) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit, linkFrom, parentTarget, onlySite],
  );

  /** 删一支部队：只有引擎正停在它断粮怎么办那一问上时才挡回来。 */
  const deleteUnit = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const u = w.units.find((x) => x.id === id);
      if (!u) return;
      const t = w.pending === null ? null : w.pending.target;
      if (t !== null && t.kind === 'unitFoodPolicy' && t.unit === id) {
        setNote('「' + u.name + '」断粮怎么办那一问还挂着，先答完或取消，再删');
        return;
      }
      if (t !== null && t.kind === 'unitOffroadOrder' && t.unit === id) {
        setNote('「' + u.name + '」离开道路那一问还挂着（填一个倍率），先答完或取消，再删');
        return;
      }
      w.units = w.units.filter((x) => x.id !== id);
      if (orderTarget === id) setOrderTarget(0);
      commit(w);
      setNote('删掉了部队「' + u.name + '」（#' + String(id) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit, orderTarget],
  );

  /** 删一条连接：上面有部队在行军或扎营就走不了；引擎正停在它的地貌那一问上也一样。 */
  const deleteLink = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const l = w.links.find((x) => x.id === id);
      if (!l) return;
      const t = w.pending === null ? null : w.pending.target;
      if (t !== null && t.kind === 'linkTerrain' && t.link === id) {
        setNote('这条连接的地貌那一问还挂着，先答完或取消，再删');
        return;
      }
      const on = w.units.filter((u) => {
        const p = u.place;
        // 只有连接上行军那一种位置挂在某条连接上；停在野地里、离开道路行军都不占连接。
        return p.kind === 'march' && p.link === id;
      }).length;
      if (on > 0) {
        setNote('这条连接上有 ' + String(on) + ' 支部队在行军，先让它们走开，再删');
        return;
      }
      w.links = w.links.filter((x) => x.id !== id);
      commit(w);
      setNote('删掉了连接「' + linkName(w, l) + '」（#' + String(id) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 地图上双击：在双击的位置新增一个据点，名字先给个编号，其余用最小默认值。 */
  const addSiteAt = useCallback(
    (x: number, y: number) => {
      const w = worldRef.current;
      if (!w) return;
      const s = addSite(w, {
        name: '新据点 ' + String(w.sites.length + 1),
        x, y, scale: 1, population: 0, morale: 70, stability: 60,
        money: 0, food: 0, parent: null, level: 0, division: null, faction: w.factions[0]?.id ?? 1,
      });
      commit(w);
      setNote('新增据点：' + s.name + '（' + String(x) + '，' + String(y) + '）');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 在这两座据点之间加一条连接：地貌先留空，引擎走到它上面时会停下来问。 */
  const addLinkBetween = useCallback(
    (a: number, b: number) => {
      const w = worldRef.current;
      if (!w || a === 0 || b === 0 || a === b) {
        setNote('新增连接要先挑两个不同的据点');
        return;
      }
      const exists = w.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
      if (exists) {
        setNote('这两座据点之间已经有连接了');
        return;
      }
      const l = addLink(w, a, b, 1, null);
      commit(w);
      setNote('新增连接 ' + String(l.id) + '：' + siteName(w, a) + ' — ' + siteName(w, b) + '，地貌未填，绕行系数 1.0');
      if (api) void api.saveWorld(w);
    },
    [commit],
  );

  /** 据点表里按「定位」：切到地图页签，把那一座移到画面中央。 */
  const locateSite = useCallback((id: number) => {
    setFocus((cur) => ({ kind: 'site', id, n: (cur?.n ?? 0) + 1 }));
    setView('map');
  }, []);

  /** 部队表里按「定位」：同一套；中心取那支部队当前的位置（行军中取连接上的插值点）。 */
  const locateUnit = useCallback((id: number) => {
    setFocus((cur) => ({ kind: 'unit', id, n: (cur?.n ?? 0) + 1 }));
    setView('map');
  }, []);

  /** 点「前往…」：等一次地图上的点选。点据点是去那座据点，按住 Shift 点空白处是去那个坐标。 */
  const startOrderPick = useCallback((unitId: number) => {
    setLinkFrom(0);
    setParentTarget(0);
    setOrderTarget(unitId);
    setNote('挑目的地：在地图上点一个据点，或按住 Shift 点一处野地（Esc 或点空白处取消）');
  }, []);

  /** 点「挂到…」：等一次地图上的点选，选中哪个据点就是它的上级。 */
  const startParentPick = useCallback((siteId: number) => {
    setLinkFrom(0);
    setOrderTarget(0);
    setParentTarget(siteId);
    setNote('挑上级：在地图上点一个据点（Esc 或点空白处取消）');
  }, []);

  /** 在地图上点了一个据点：正挑上级、正挑目的地、正挑连接起点，三种各走一条。 */
  const pickSite = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      if (parentTarget !== 0) {
        const s = w.sites.find((x) => x.id === parentTarget);
        if (!s) {
          setParentTarget(0);
          return;
        }
        if (id === parentTarget) {
          setNote('据点不能当自己的上级，换一个');
          return;
        }
        if (parentWouldCycle(w, parentTarget, id)) {
          setNote('挂上去会连成一个环：' + siteName(w, id) + ' 已经在 ' + s.name + ' 的下面，先把那一头理开');
          return;
        }
        const why = parentLevelRefusal(w, parentTarget, id);
        if (why !== null) {
          setNote('挂不上：' + why);
          return;
        }
        s.parent = id;
        commit(w);
        setNote('「' + s.name + '」的所属据点改成 ' + siteName(w, id));
        if (api) void api.saveWorld(w);
        setParentTarget(0);
        return;
      }
      if (seatTarget !== 0) {
        const d = w.divisions.find((x) => x.id === seatTarget);
        if (!d) {
          setSeatTarget(0);
          return;
        }
        const why = seatRefusal(w, seatTarget, id);
        if (why !== null) {
          setNote('治所设不成：' + why);
          return;
        }
        d.seat = id;
        commit(w);
        setNote('「' + d.name + '」的治所设在 ' + siteName(w, id));
        if (api) void api.saveWorld(w);
        setSeatTarget(0);
        return;
      }
      if (orderTarget !== 0) {
        const u = w.units.find((x) => x.id === orderTarget);
        if (!u) {
          setOrderTarget(0);
          return;
        }
        const s = w.sites.find((x) => x.id === id);
        // 在据点里出发就走那条连接；已经停在据点之外的，这一趟只能离开道路过去，
        // 于是先问 User 一个倍率——数由 User 定，引擎不替他挑一个。
        if (u.place.kind === 'site' || !s) {
          editQueue(orderTarget, [{ kind: 'march', to: id }]);
          setNote(u.name + ' 前往 ' + siteName(w, id));
          if (api) void api.saveWorld(w);
        } else {
          w.pending = askOffroadFactor(u.name + ' 要离开道路去 ' + s.name, u, { toSite: id, toX: s.x, toY: s.y });
          commit(w);
          setNote(u.name + ' 前往 ' + s.name + '：这一趟离开道路，填一个倍率');
          if (api) void api.saveWorld(w);
        }
        setOrderTarget(0);
        return;
      }
      if (linkFrom === 0) {
        setLinkFrom(id);
        setNote('起点：' + siteName(w, id) + ' · 再点一个据点作终点（Esc 或点空白处取消）');
        return;
      }
      if (linkFrom === id) {
        setLinkFrom(0);
        setNote('起点取消了');
        return;
      }
      addLinkBetween(linkFrom, id);
      setLinkFrom(0);
    },
    [linkFrom, orderTarget, parentTarget, seatTarget, addLinkBetween, editQueue, commit],
  );

  /**
   * 按住 Shift 在地图上点了一处空白：把那个坐标当作目的地。
   * 这一趟是离开道路走的，所以先停下来问 User 一个倍率，答完那一条命令才进队列
   * （与「前往…」同一条规矩：命令列上按一次换掉整条队列）。
   */
  const pickPoint = useCallback(
    (x: number, y: number) => {
      const w = worldRef.current;
      if (!w || orderTarget === 0) return;
      const u = w.units.find((v) => v.id === orderTarget);
      if (!u) {
        setOrderTarget(0);
        return;
      }
      w.pending = askOffroadFactor(u.name + ' 要离开道路', u, { toSite: null, toX: x, toY: y });
      commit(w);
      setNote(u.name + ' 这一趟离开道路：填一个倍率（相对道路速度）');
      if (api) void api.saveWorld(w);
      setOrderTarget(0);
    },
    [orderTarget, commit],
  );

  const cancelPick = useCallback(() => {
    if (seatTarget !== 0) {
      setSeatTarget(0);
      setNote('挑治所取消了');
      return;
    }
    if (parentTarget !== 0) {
      setParentTarget(0);
      setNote('挑上级取消了');
      return;
    }
    if (orderTarget !== 0) {
      setOrderTarget(0);
      setNote('挑目的地取消了');
      return;
    }
    if (linkFrom === 0) return;
    setLinkFrom(0);
    setNote('起点取消了');
  }, [linkFrom, orderTarget, parentTarget, seatTarget]);

  // 挑起点、挑目的地、挑上级或挑治所的时候按 Esc 取消。
  useEffect(() => {
    if (linkFrom === 0 && orderTarget === 0 && parentTarget === 0 && seatTarget === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkFrom, orderTarget, parentTarget, seatTarget, cancelPick]);

  /**
   * 正在挑目的地的那支部队要是驻军，它在地图上没有自己的记号，所以把「正在挑」那一圈
   * 套在它所在的那座据点上。
   */
  const orderGarrisonSite = (() => {
    if (world === null || orderTarget === 0) return null;
    const u = world.units.find((x) => x.id === orderTarget);
    return u && u.place.kind === 'site' ? u.place.site : null;
  })();

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const counts: Record<View, number> = {
    factions: world ? world.factions.length : 0,
    divisions: world ? world.divisions.length : 0,
    sites: world ? world.sites.length : 0,
    units: world ? world.units.length : 0,
    links: world ? world.links.length : 0,
    map: world ? world.sites.length : 0,
    settings: 0,
  };
  const logTail = world ? world.log.slice(-14).reverse() : [];

  return (
    <div className="app">
      <header>
        <div className="row">
          <strong className="title">据点沙盘</strong>
          <span className="cal">{calendar}</span>
          <span className="dim">第 {day} 天</span>
          <button onClick={() => setRunning((r) => !r)}>{running ? '暂停' : '自动走'}</button>
          <label className="dim">
            速度
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} 天/秒
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => step(1)}>推进一天</button>
          <button onClick={() => step(params.daysPerMonth)}>推进一月</button>
          <button className="primary" onClick={() => void saveNow()}>
            保存
          </button>
          <button onClick={() => void takeSnapshot()}>快照</button>
        </div>
        <div className="row tabs">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'tab active' : 'tab'} onClick={() => setView(v.id)}>
              {v.label}
              {counts[v.id] > 0 ? <span className="dim"> {counts[v.id]}</span> : null}
            </button>
          ))}
          <span className="dim small push">新增连接：在「地图」页签点两个据点</span>
          <button onClick={() => addSiteAt(Math.round(params.mapWidth / 2), Math.round(params.mapHeight / 2))}>
            新增据点
          </button>
        </div>
        <div className="dim small">世界库：{dbPath}</div>
        <div className="dim small">{note}</div>
      </header>

      <main>
        {!world ? (
          <p className="dim">世界还没读进来。</p>
        ) : (
          <>
            {/* 地图常驻：切页签只是把它藏起来，场景与视图（倍数、位置）都留着。 */}
            <div className={view === 'map' ? undefined : 'hidden'}>
              <MapView
                world={world}
                params={params}
                theme={theme}
                visible={view === 'map'}
                startSite={
                  parentTarget !== 0
                    ? parentTarget
                    : orderGarrisonSite !== null
                      ? orderGarrisonSite
                      : linkFrom === 0
                        ? null
                        : linkFrom
                }
                pickUnit={orderTarget === 0 ? null : orderTarget}
                focus={focus}
                pickHint={
                  seatTarget !== 0
                    ? '挑治所：在地图上点一个据点，Esc 或点空白处取消'
                    : parentTarget !== 0
                      ? '挑上级：在地图上点一个据点，Esc 或点空白处取消'
                      : orderTarget !== 0
                        ? '挑目的地：点一个据点，或按住 Shift 点一处野地，Esc 或点空白处取消'
                        : linkFrom !== 0
                          ? '起点：' + siteName(world, linkFrom) + ' · 再点一个据点作终点，Esc 或点空白处取消'
                          : null
                }
                onAddSite={addSiteAt}
                onPickSite={pickSite}
                onPickPoint={pickPoint}
                onCancelPick={cancelPick}
              />
            </div>
            {view === 'factions' ? (
              <FactionTable
                world={world}
                onRename={renameFaction}
                onDelete={deleteFaction}
                onAdd={addFactionRow}
              />
            ) : view === 'divisions' ? (
              <DivisionTable
                world={world}
                onRename={renameDivision}
                onRank={editDivisionRank}
                onParent={editDivisionParent}
                onSeat={startSeatPick}
                pickingSeat={seatTarget === 0 ? null : seatTarget}
                onDelete={deleteDivision}
                onAdd={addDivisionRow}
              />
            ) : view === 'sites' ? (
              <SiteTable
                world={world}
                onEdit={editSite}
                startSite={linkFrom === 0 ? null : linkFrom}
                onPick={pickSite}
                pickingParent={parentTarget === 0 ? null : parentTarget}
                onPickParent={startParentPick}
                onLocate={locateSite}
                onDelete={deleteSite}
                only={onlySite}
                onOnly={setOnlySite}
                onEditLevel={editSiteLevel}
                onEditDivision={editSiteDivision}
              />
            ) : view === 'units' ? (
              <UnitTable
                world={world}
                onEdit={editUnit}
                onOrder={editQueue}
                onPickDestination={startOrderPick}
                pickingUnit={orderTarget === 0 ? null : orderTarget}
                onLocate={locateUnit}
                onDelete={deleteUnit}
              />
            ) : view === 'links' ? (
              <LinkTable world={world} onEdit={editLink} onDelete={deleteLink} />
            ) : view === 'settings' ? (
              <SettingsView world={world} params={params} theme={theme} onChange={writeParams} />
            ) : null}
          </>
        )}

        <section className="log">
          <h3>日志（最近 14 条，新的在上）</h3>
          {logTail.length === 0 ? <p className="dim">还没有日志。</p> : <ol>{logTail.map((line, i) => <li key={i}>{line}</li>)}</ol>}
        </section>
      </main>

      {world && world.pending ? (
        <AskBox key={world.pending.subject + world.pending.question} world={world} onAnswer={answer} />
      ) : null}
    </div>
  );
}

/** 引擎停下来问的那个框：点一个选项，或者自己填一个值。 */
function AskBox({ world, onAnswer }: { world: World; onAnswer: (value: string) => void }) {
  const ask = world.pending;
  const [value, setValue] = useState(ask ? ask.fallback : '');
  if (!ask) return null;

  const fallbackLabel = ask.options.find((o) => o.value === ask.fallback)?.label ?? ask.fallback;

  return (
    <div className="askbackdrop">
      <div className="askbox">
        <h3>引擎停住了，等一个回答</h3>
        <p className="dim small">{ask.subject}</p>
        <p>{ask.question}</p>
        {ask.options.length > 0 ? (
          <div className="row">
            {ask.options.map((o) => (
              <button key={o.value} className={value === o.value ? 'tab active' : 'tab'} onClick={() => setValue(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="row">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAnswer(value);
            }}
          />
          <button className="primary" onClick={() => onAnswer(value)}>
            就这样
          </button>
        </div>
        {fallbackLabel === '' ? (
          <p className="dim small">没有默认值，这个数由 User 自己定。</p>
        ) : (
          <p className="dim small">默认值是「{fallbackLabel}」，也可以自己填一个值。</p>
        )}
      </div>
    </div>
  );
}
