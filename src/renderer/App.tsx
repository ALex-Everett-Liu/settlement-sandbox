import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { answerAsk, askOffroadFactor } from '../engine/ask.ts';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Link, Order, Params, Site, Terrain, Theme, Unit, World } from '../engine/types.ts';
import {
  addDivision,
  addFaction,
  addLink,
  addSite,
  addTerrain,
  addUnit,
  colorRefusal,
  demoWorld,
  divisionName,
  divisionRankRefusal,
  divisionSites,
  divisionWouldCycle,
  levelRefusal,
  linkName,
  normalizeColor,
  parentLevelRefusal,
  parentWouldCycle,
  sameColorFactions,
  seatRefusal,
  siteDivisionNote,
  siteName,
  terrainLinks,
} from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import { markHints } from './hintdom.ts';
import { BAR_CODES, MODE_KEYS, resolveBuffer, TOP_CODES, VIEWS } from './hotkeys.ts';
import type { View } from './hotkeys.ts';
import { MapView } from './map.tsx';
import {
  emptyListStates,
  LIST_LABEL,
  newestFirst,
  PAGE_LISTS,
  pageCount,
  pageOfId,
  pageOfRow,
  sortRows,
  tableRows,
} from './paging.ts';
import type { ListState, OnlyBranch, PageList } from './paging.ts';
import { SettingsView, PARAM_RANGE } from './settings.tsx';
import {
  DivisionTable,
  FactionTable,
  LinkTable,
  Pager,
  SiteTable,
  TERRAIN_RANGE,
  TerrainTable,
  UnitTable,
} from './tables.tsx';
import type { ListBarProps } from './tables.tsx';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

/**
 * 两个有上下限的据点字段。写不回去就返回理由：值一个也不动，更不夹到边界——
 * 由界面把理由写进说明行，等 User 自己改一个数。
 */
function siteNumberRefusal(patch: Partial<Site>): string | null {
  if (patch.development !== undefined && !(patch.development >= 0 && patch.development <= 100)) {
    return '发展度只收 0 到 100 之间的数，「' + String(patch.development) + '」不写回去';
  }
  if (patch.fortification !== undefined && !(patch.fortification >= 0 && patch.fortification <= 10)) {
    return '防御设施等级只收 0 到 10 之间的数，「' + String(patch.fortification) + '」不写回去';
  }
  return null;
}

/** 地貌那四个数各自的范围。写不回去就返回理由：值一个也不动，更不夹到边界。 */
function terrainRefusal(patch: Partial<Terrain>): string | null {
  for (const key of ['speed', 'width', 'defense', 'food'] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    const r = TERRAIN_RANGE[key];
    if (!(v >= r.lo && v <= r.hi)) {
      return r.label + '只收 ' + String(r.lo) + ' 到 ' + String(r.hi) + ' 之间的数，「' + String(v) + '」不写回去';
    }
  }
  return null;
}

/**
 * 设置页签的一笔改动能不能写回：越界、不是整数、以及上界小于下界，都挡回来，不动 User 填的数。
 */
function paramsRefusal(params: Params, patch: Partial<Params>): string | null {
  for (const key of ['mapWidth', 'mapHeight', 'zoomMin', 'zoomMax', 'pageSize'] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    const r = PARAM_RANGE[key];
    if (!(v >= r.lo && v <= r.hi)) {
      return r.label + '只收 ' + String(r.lo) + ' 到 ' + String(r.hi) + ' 之间的数，「' + String(v) + '」不写回去';
    }
  }
  if (patch.pageSize !== undefined && !Number.isInteger(patch.pageSize)) {
    return '每页几条只收 1 到 1000 之间的整数，「' + String(patch.pageSize) + '」不写回去';
  }
  const zoomMin = patch.zoomMin ?? params.zoomMin;
  const zoomMax = patch.zoomMax ?? params.zoomMax;
  if (zoomMax < zoomMin) {
    return (
      '倍数上界不能小于下界（下界 ' + String(zoomMin) + '、上界 ' + String(zoomMax) + '），这一笔不写回去'
    );
  }
  return null;
}

/**
 * 新增之后的说明行：多半跳到它那一页；被筛掉时（据点表的「只看某一支」）说清楚为什么看不见。
 */
function addedNote(text: string, page: number): string {
  return page === 0 ? text + '；它不在当前的筛选里，表里看不见它' : text + '；在第 ' + String(page) + ' 页';
}

/**
 * 六张表外面那一层：盯着焦点，好让「正在编辑哪一张表的哪一行」有个准。
 * 焦点进到格子里（输入框）就算编辑开始——这时候那张表冻住不重排；焦点落到表里的按钮上、
 * 或者跑到表外面去了，就算编辑结束，可以结算顺序了。
 */
function EditWatcher({
  list,
  onBegin,
  onEnd,
  children,
}: {
  list: PageList;
  onBegin: (list: PageList, row: number | null) => void;
  onEnd: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onFocus={(e) => {
        // 焦点落到按钮上（按「＋ 新增」或者「删除」）也算编辑结束：那一下之后世界就变了，顺序要跟上。
        const el = e.target as HTMLElement;
        if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') {
          onEnd();
          return;
        }
        const row = el.closest('tr')?.getAttribute('data-row');
        onBegin(list, row === null || row === undefined ? null : Number(row));
      }}
      onBlur={(e) => {
        // 焦点还在这一张表里就交给 onFocus 判；跑到表外面（或落到页面本身）才算结束。
        const next = e.relatedTarget as Node | null;
        if (next !== null && e.currentTarget.contains(next)) return;
        onEnd();
      }}
    >
      {children}
    </div>
  );
}

// 页签的名字与热键都在 hotkeys.ts 里，`View` 与 `VIEWS` 从那边来：画出来的按钮与挂上去的标签不会各写各的。

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [view, setView] = useState<View>('sites');
  const [dbPath, setDbPath] = useState('（还不知道）');
  const [note, setNote] = useState('正在打开存档…');
  // 正在挑的起点据点：0 表示还没挑。挑法是在地图上点据点，见 MapView 的 onPickSite。
  const [linkFrom, setLinkFrom] = useState(0);
  // 正在挑目的地的那支部队：0 表示没有。与起点共用地图上那一次点选。
  const [orderTarget, setOrderTarget] = useState(0);
  // 正在给它挑上级的那个据点：0 表示没有。同样共用地图上那一次点选。
  const [parentTarget, setParentTarget] = useState(0);
  // 据点表「只看某一支」选中的那一座；null 就是全部。
  const [onlySite, setOnlySite] = useState<{ kind: 'site' | 'division'; id: number; name: string } | null>(null);
  // 六张表各自的页码与排序。切页签回来还停在原来那一页；筛或排序一变就回到第 1 页。
  const [lists, setLists] = useState<Record<PageList, ListState>>(emptyListStates);
  /**
   * 六张表显示的顺序（一串编号），由下面那个结算 effect 填。它是存下来的、不是渲染时现算的：
   * 编辑期间冻着不动，光标底下那一行因此不会跑（见结算 effect 那一段）。
   */
  const [orders, setOrders] = useState<Partial<Record<PageList, number[]>>>({});
  /**
   * 每一张表的顺序是按什么算出来的（排序、筛、每页条数打成一个键）。冻结只挡「世界变了」这一种重算：
   * 排序、筛、每页条数变了必须重算，否则筛完还是老顺序、行数也对不上。用 ref 不用 state：
   * 它只是给上面那个 effect 用来比对，写它不该引起另一次渲染。
   */
  const orderKeys = useRef<Partial<Record<PageList, string>>>({});
  // 焦点正在哪一张表的格子里；null 就是没有在编辑。
  const [editing, setEditing] = useState<{ list: PageList; row: number | null } | null>(null);
  // 刚编辑过的那一行：结算之后它要是落到别的页上，就跟着跳过去。
  const lastEdit = useRef<{ list: PageList; id: number } | null>(null);
  // 日志那一段的页码。它不排序（本来就是新的在上），所以只有一个数。
  const [logPage, setLogPage] = useState(1);
  // 正在给哪个辖区挑治所：0 表示没有。与前面几种共用地图上那一次点选。
  const [seatTarget, setSeatTarget] = useState(0);
  // 「定位」请求：n 是次数，同一个目标按两次也要重新定位一次。
  const [focus, setFocus] = useState<{ kind: 'site' | 'unit'; id: number; n: number } | null>(null);
  const worldRef = useRef<World | null>(null);
  // 热键模式：Alt+K 进/出。打开之后字母与数字归它吃，敲满一个标签就跳到那一处。
  const [hmOn, setHmOn] = useState(false);
  // 标签浮窗的隐/现：进模式时是显示着的，` 收起再按出来。
  const [hmMarks, setHmMarks] = useState(true);
  // 已经敲下去的那一截（`` 空 / `s` / `1` / `10`）。
  const [hmBuf, setHmBuf] = useState('');
  /** 这一页现在有哪些标签，由 markHints 每次渲染之后填；判「半截」「没有这个」靠它。 */
  const hmCodes = useRef<string[]>([]);
  /** 挂标签的范围：整个 .app（页签在 header 里，表格在 main 里）。 */
  const appRef = useRef<HTMLDivElement | null>(null);

  // The theme rides in the params table, so it is stored in this world's database.
  // A database written before the field existed has no theme; that reads as light.
  const theme: Theme = params.theme === 'dark' ? 'dark' : 'light';

  const commit = useCallback((w: World) => {
    worldRef.current = w;
    setWorld({ ...w });
  }, []);

  /**
   * 新增之后跳到那一行所在的页。行被筛掉时不动页码并返回 0，
   * 由说明行（addedNote）写一句「看不见它」。
   * 放在这里、几个「新增」回调之前，是因为那几个回调把它写进了依赖表里。
   */
  const jumpToRow = useCallback(
    (list: PageList, id: number): number => {
      const w = worldRef.current;
      if (!w) return 0;
      // 新增之后要跳到新那一行上：不再跟着刚才编辑过的那一行跑（那是另一码事）。
      lastEdit.current = null;
      const branch = onlySite === null ? null : { kind: onlySite.kind, id: onlySite.id };
      const rows = sortRows(tableRows(w, list, branch), lists[list].sort);
      const page = pageOfRow(rows, id, params.pageSize);
      if (page > 0) setLists((s) => ({ ...s, [list]: { ...s[list], page } }));
      return page;
    },
    [lists, onlySite, params.pageSize],
  );

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
        setNote(loaded ? '读到了已有的数据' : '库里是空的：建了一份初始数据并写进去');
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
      const why = siteNumberRefusal(patch);
      if (why !== null) {
        setNote(why);
        return;
      }
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
    setNote(addedNote('新增辖区：' + d.name + '（#' + String(d.id) + '）', jumpToRow('divisions', d.id)));
    if (api) void api.saveWorld(w);
  }, [commit, jumpToRow]);

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

  /** 设置页签改参数：越界与上下界颠倒都挡回来，值不写回、也不替 User 改数。 */
  const writeParams = useCallback(
    (patch: Partial<Params>) => {
      const why = paramsRefusal(params, patch);
      if (why !== null) {
        setNote(why);
        return;
      }
      const next: Params = { ...params, ...patch };
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

  /** 地貌表里改名字或改那四个数：越界由 terrainRefusal 挡回来，其余照写。 */
  const editTerrain = useCallback(
    (id: number, patch: Partial<Terrain>) => {
      const w = worldRef.current;
      if (!w) return;
      const t = w.terrains.find((x) => x.id === id);
      if (!t) return;
      const why = terrainRefusal(patch);
      if (why !== null) {
        setNote(why);
        return;
      }
      Object.assign(t, patch);
      commit(w);
    },
    [commit],
  );

  /** 新增一档地貌：名字给个编号，四个数给占位值，随即由 User 自己调。 */
  const addTerrainRow = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const t = addTerrain(w, '新地貌 ' + String(w.terrains.length + 1), 1, 100, 1, 1);
    commit(w);
    setNote(addedNote('新增地貌：' + t.name + '（#' + String(t.id) + '）', jumpToRow('terrains', t.id)));
    if (api) void api.saveWorld(w);
  }, [commit, jumpToRow]);

  /**
   * 表末的「＋ 新增部队」：生在哪座据点由那一行的挑选框给（0 表示野外）。
   * 势力跟着出生那座据点的势力走；没有出生据点时势力留空（编号 0，表里写「势力 0」），
   * 位置放在地图正中那一点。驻军不另建——派进城、走到的部队就是那座城的驻军。
   */
  const addUnitRow = useCallback(
    (siteId: number) => {
      const w = worldRef.current;
      if (!w) return;
      const site = w.sites.find((s) => s.id === siteId) ?? null;
      const u = addUnit(w, {
        faction: site === null ? 0 : site.faction,
        name: '新部队 ' + String(w.units.length + 1),
        troops: 1000,
        training: 50,
        organization: 100,
        place: site === null
          ? { kind: 'camp', x: params.mapWidth / 2, y: params.mapHeight / 2 }
          : { kind: 'site', site: site.id },
        carriedFood: 0,
        foodPolicy: null,
        queue: [],
      });
      commit(w);
      setNote(addedNote('新增部队：' + u.name + '（#' + String(u.id) + '）', jumpToRow('units', u.id)));
      if (api) void api.saveWorld(w);
    },
    [commit, jumpToRow, params],
  );

  /**
   * 删一档地貌：有连接指着它就不许删；表里只剩一档时也不许删——连接上没填地貌时
   * 引擎要停下来问，一档都没有就没得可问，那一问会卡住整条时间轴。
   */
  const deleteTerrain = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      const t = w.terrains.find((x) => x.id === id);
      if (!t) return;
      const used = terrainLinks(w, id);
      if (used > 0) {
        setNote('「' + t.name + '」还有 ' + String(used) + ' 条连接指着它，先把那些连接改到别的一档，再删');
        return;
      }
      if (w.terrains.length <= 1) {
        setNote('地貌表至少留一档：连接上没填地貌时引擎要停下来问，一档都没有就没得可问');
        return;
      }
      w.terrains = w.terrains.filter((x) => x.id !== id);
      commit(w);
      setNote('删掉了地貌「' + t.name + '」（#' + String(id) + '）');
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

  /**
   * 势力表里改颜色：只收 `#rrggbb`（由引擎的 colorRefusal 判），写不回去就报一句、值一个也不动。
   * 同色不挡——附庸用宗主色、同阵营用一套色都是常有的事——写回后在说明行里把同名的那几家念出来。
   */
  const editFactionColor = useCallback(
    (id: number, color: string) => {
      const w = worldRef.current;
      if (!w) return;
      const f = w.factions.find((x) => x.id === id);
      if (!f) return;
      const why = colorRefusal(color);
      if (why !== null) {
        setNote(why);
        return;
      }
      f.color = normalizeColor(color);
      commit(w);
      const twins = sameColorFactions(w, id, f.color);
      setNote(
        twins.length === 0
          ? '「' + f.name + '」的颜色改成 ' + f.color
          : '「' + f.name + '」的颜色改成 ' + f.color + '，与 ' +
            twins.map((t) => '「' + t.name + '」').join('、') + ' 相同——不挡，只提一句',
      );
    },
    [commit],
  );

  /** 势力表末尾那个「＋」：添一行，名字先给个编号，编号只往前走（不回收删掉的号）。 */
  const addFactionRow = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const f = addFaction(w, '新势力 ' + String(w.factions.length + 1));
    commit(w);
    setNote(
      addedNote(
        '新增势力：' + f.name + '（#' + String(f.id) + '），颜色 ' + f.color,
        jumpToRow('factions', f.id),
      ),
    );
    if (api) void api.saveWorld(w);
  }, [commit, jumpToRow]);

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
        x, y, development: 20, fortification: 0, population: 0, morale: 70, stability: 60,
        money: 0, food: 0, parent: null, level: 0, division: null, faction: w.factions[0]?.id ?? 1,
      });
      commit(w);
      setNote(
        addedNote(
          '新增据点：' + s.name + '（' + String(x) + '，' + String(y) + '）',
          jumpToRow('sites', s.id),
        ),
      );
      if (api) void api.saveWorld(w);
    },
    [commit, jumpToRow],
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
   * 按下一个完整的标签：按钮就当点了一下（只点了它，焦点不跟着走，所以还能接着敲下一个），
   * 输入口就把焦点放进去并全选——不全选的话接着敲的字会接在那个数后面。
   * 颜色格那种一格两个输入件的，焦点给第一个（手打 #rrggbb 那个）；勾选框（地形层）按一下就算换过来。
   * 页签切走之后地图那一块还在 .hidden 里，同一个标签优先找看得见的那一处。
   */
  const hitHint = useCallback((code: string) => {
    const all = appRef.current?.querySelectorAll<HTMLElement>('[data-hint="' + code + '"]');
    const el = all === undefined ? null : ([...all].find((x) => x.closest('.hidden') === null) ?? null);
    if (el === null) {
      setNote('热键：' + code + ' 那一处现在不在了');
      return;
    }
    if (el.tagName === 'BUTTON') {
      el.click();
      return;
    }
    const field = el.matches('input, select, textarea')
      ? el
      : el.querySelector<HTMLElement>('input, select, textarea');
    const target = field ?? el;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      target.click();
      return;
    }
    target.focus();
    if (target instanceof HTMLInputElement) {
      // 数字格与页码格选不了全部（type=number 不支持 setSelectionRange），焦点到了就够了。
      try {
        target.select();
      } catch {
        /* 选不了全部就只把焦点放上去 */
      }
    }
  }, []);

  /**
   * 热键模式的按键，三条规矩：
   * 1. Alt+K 任何时候都管用，包括焦点在格子里的时候——进/出这个模式。
   * 2. 焦点在格子里时，除了 Alt+K，别的键全让给那一格：↑↓、回车、Esc 都还是格子自己的；
   *    Esc 在这一格不是候选列表的时候把焦点收回来，人就回到模式里。
   * 3. 其余时候这个模式吃掉字母、数字与退格：敲满一个标签就跳过去，半截就等着，对不上就清空并说一句。
   * 引擎停在问答框上、或者正在地图上挑起点之类的的时候，键全让给那两处（Alt+K 仍然可用）。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const toggle = e.key.toLowerCase() === MODE_KEYS.toggle;
      if (e.altKey && !e.ctrlKey && !e.metaKey && toggle) {
        e.preventDefault();
        // 进来的时候把缓冲清空、浮窗放出：每次进这个模式都是同一个起点。
        if (!hmOn) {
          setHmBuf('');
          setHmMarks(true);
        }
        setHmOn(!hmOn);
        return;
      }
      if (!hmOn || world === null) return;
      if (world.pending !== null) return;
      if (linkFrom !== 0 || orderTarget !== 0 || parentTarget !== 0 || seatTarget !== 0) return;

      const el = document.activeElement;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (inField) {
        // 候选列表开着的时候，Esc 先关列表；列表关着的时候，Esc 把焦点从这一格收回来。
        if (e.key === 'Escape' && document.querySelector('.picklist') === null) {
          (el as HTMLElement).blur();
          setHmBuf('');
          e.preventDefault();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || e.key === 'Process') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setHmBuf('');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setHmBuf((b) => b.slice(0, -1));
        return;
      }
      if (e.key === MODE_KEYS.marks) {
        e.preventDefault();
        setHmMarks((s) => !s);
        return;
      }
      if (e.key.length !== 1) return;
      const ch = e.key.toLowerCase();
      if (!/^[a-z0-9]$/.test(ch)) return;
      e.preventDefault();
      const next = hmBuf + ch;
      const r = resolveBuffer(next, hmCodes.current);
      if (r.kind === 'exact') {
        setHmBuf('');
        hitHint(r.code);
        return;
      }
      if (r.kind === 'prefix') {
        setHmBuf(next);
        return;
      }
      setHmBuf('');
      setNote('热键：没有「' + next + '」这一个');
    };
    // 捕获阶段：先于格子自己的键处理拿到这一下，才判得出该让位还是该吃掉。
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // 缓冲要跟着进依赖表：不进来的话这一串键读到的永远是第一下时的那个空串。
  }, [hmOn, hmBuf, world, linkFrom, orderTarget, parentTarget, seatTarget, hitHint]);

  /**
   * 把标签挂上去。放在 layout effect 里：标签与表格同一帧出现，不会先闪一下没有标签的样子。
   * 不给依赖表：行、页、排序、筛选一变，能按的地方就整批换了；这一遍只是走一遍这一页的元素。
   * 引擎停在问答框上的时候不挂——那一段键属于那个框。
   */
  useLayoutEffect(() => {
    const root = appRef.current;
    if (root === null || !hmOn || world === null || world.pending !== null) return;
    hmCodes.current = markHints(root, hmBuf);
  });

  // 换页签就把已经敲的那一截清掉：用鼠标点过去的时候，缓冲里不该还挂着上一页的那一个数字。
  useEffect(() => {
    setHmBuf('');
  }, [view]);

  /**
   * 正在挑目的地的那支部队要是驻军，它在地图上没有自己的记号，所以把「正在挑」那一圈
   * 套在它所在的那座据点上。
   */
  const orderGarrisonSite = (() => {
    if (world === null || orderTarget === 0) return null;
    const u = world.units.find((x) => x.id === orderTarget);
    return u && u.place.kind === 'site' ? u.place.site : null;
  })();

  /** 据点表「只看某一支」的筛选，写成 paging 那一边认的写法。 */
  const onlyBranch: OnlyBranch | null = onlySite === null ? null : { kind: onlySite.kind, id: onlySite.id };

  /**
   * 表上方那一行要的东西。页码与排序是界面状态，不进世界库；每页几条来自参数表。
   * 换排序就回到第 1 页——顺序一变，原来那一页装的就是另一段行了。
   */
  const bar = (list: PageList): ListBarProps => ({
    page: lists[list].page,
    pageSize: params.pageSize,
    sort: lists[list].sort,
    // 顺序用结算出来的那一份（可能是冻着的）；还没结算过时表里会按当前的排序现算一遍。
    order: orders[list],
    onPage: (page: number) => {
      // 明确换页之后不再跟着刚才编辑过的那一行跑。
      lastEdit.current = null;
      setLists((s) => ({ ...s, [list]: { ...s[list], page } }));
    },
    onSort: (sort) => {
      lastEdit.current = null;
      setLists((s) => ({ ...s, [list]: { ...s[list], sort, page: 1 } }));
    },
    onNote: setNote,
  });

  /**
   * 焦点进了哪一张表的格子：这一张表从此冻住，直到焦点离开（见上面那个结算 effect）。
   * row 是那一行的编号（表里每一行都带 data-row），光标不在某一行上（比如页码格）时是 null。
   */
  const beginEdit = useCallback((list: PageList, row: number | null) => {
    setEditing({ list, row });
    if (row !== null) lastEdit.current = { list, id: row };
  }, []);

  /** 焦点离开格子：那张表解冻，下一次渲染就把顺序结算一遍。 */
  const endEdit = useCallback(() => setEditing(null), []);

  /**
   * 页码落空：删条目、改小每页条数之后，当前页码可能超出最大页。
   * 退到末页，并把退页写进说明行——不把一张空表摆给 User 看。
   */
  useEffect(() => {
    if (!world) return;
    const branch = onlySite === null ? null : { kind: onlySite.kind, id: onlySite.id };
    const over: string[] = [];
    const next: Partial<Record<PageList, ListState>> = {};
    for (const list of PAGE_LISTS) {
      const pages = pageCount(tableRows(world, list, branch).length, params.pageSize);
      const cur = lists[list].page;
      if (cur > pages) {
        next[list] = { ...lists[list], page: pages };
        over.push(LIST_LABEL[list] + '：第 ' + String(cur) + ' 页没有了，退到第 ' + String(pages) + ' 页');
      }
    }
    const logPages = pageCount(world.log.length, params.pageSize);
    const logOver = logPage > logPages;
    if (over.length === 0 && !logOver) return;
    if (over.length > 0) setLists((s) => ({ ...s, ...next }));
    if (logOver) {
      setLogPage(logPages);
      over.push('日志：第 ' + String(logPage) + ' 页没有了，退到第 ' + String(logPages) + ' 页');
    }
    setNote(over.join('；'));
  }, [world, lists, logPage, onlySite, params.pageSize]);

  /** 当前页签对应哪一张表；地图、日志与设置这三个页签下面是 null（没有表要结算顺序）。 */
  const visibleList: PageList | null =
    view === 'map' || view === 'log' || view === 'settings' ? null : view;

  /**
   * 表里显示的顺序是存下来的（一串编号），不是渲染时现算的。编辑期间（焦点在本表的格子里）世界怎么变
   * 都不重排、也不换页——不然正在录入的那一行会在光标底下跑，跨过页边界时还会从这一页消失、把焦点一起丢掉。
   * 冻结只挡这一种重算：换排序或方向、换筛选、改每页条数都换了一个新的键，那时照常重算。
   * 结算完，刚编辑过的那一行要是落到别的页上，跟着它跳过去并把页数写进说明行（与「新增一行」同一条规矩）。
   */
  useEffect(() => {
    if (world === null || visibleList === null) return;
    const branch = onlySite === null ? null : { kind: onlySite.kind, id: onlySite.id };
    const key = JSON.stringify([lists[visibleList].sort, branch, params.pageSize]);
    // 正在编辑这一张，而且排序、筛、每页条数都没动：冻着，一个字也不重排。
    if (editing !== null && editing.list === visibleList && orderKeys.current[visibleList] === key) return;

    const rows = tableRows(world, visibleList, branch);
    const ids = sortRows(rows, lists[visibleList].sort).map((r) => r.id);
    orderKeys.current[visibleList] = key;
    setOrders((s) => ({ ...s, [visibleList]: ids }));

    const was = lastEdit.current;
    if (was === null || was.list !== visibleList) return;
    lastEdit.current = null;
    const page = pageOfId(ids, was.id, params.pageSize);
    if (page === 0 || page === lists[visibleList].page) return;
    setLists((s) => ({ ...s, [visibleList]: { ...s[visibleList], page } }));
    setNote(
      '「' + (rows.find((r) => r.id === was.id)?.name ?? '') + '」排到第 ' + String(page) + ' 页',
    );
  }, [world, visibleList, editing, lists, onlySite, params.pageSize]);

  // 切页签之后不再跟着上一张表刚编辑过的那一行跑。
  useEffect(() => {
    lastEdit.current = null;
  }, [view]);

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const counts: Record<View, number> = {
    factions: world ? world.factions.length : 0,
    divisions: world ? world.divisions.length : 0,
    sites: world ? world.sites.length : 0,
    units: world ? world.units.length : 0,
    links: world ? world.links.length : 0,
    terrains: world ? world.terrains.length : 0,
    // 日志页签上的数是行数：时间轴跑起来它自己会涨。
    log: world ? world.log.length : 0,
    map: world ? world.sites.length : 0,
    settings: 0,
  };
  /** 这一页上的日志行：新的在上，第 1 页是最新的那 pageSize 条。 */
  const logShown = world ? newestFirst(world.log, logPage, params.pageSize) : [];
  const logTotal = world ? world.log.length : 0;
  // 日志只有页码，没有排序：它本来就是新的在上。
  const logBar: ListBarProps = {
    page: logPage,
    pageSize: params.pageSize,
    onPage: setLogPage,
    onNote: setNote,
  };

  return (
    <div className={'app' + (hmOn ? ' hm' : '') + (hmOn && hmMarks ? ' hm-marks' : '')} ref={appRef}>
      <header>
        <div className="row">
          <strong className="title">据点沙盘</strong>
          <span className="cal">{calendar}</span>
          <span className="dim">第 {day} 天</span>
          <button data-hint={TOP_CODES.run} onClick={() => setRunning((r) => !r)}>
            {running ? '暂停' : '自动走'}
          </button>
          {/* 热键标签挂在 <label> 上，不挂在 <select> 上：下拉是替换元素，画不出 ::before。 */}
          <label className="dim" data-hint={TOP_CODES.speed}>
            速度
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} 天/秒
                </option>
              ))}
            </select>
          </label>
          <button data-hint={TOP_CODES.day} onClick={() => step(1)}>
            推进一天
          </button>
          <button data-hint={TOP_CODES.month} onClick={() => step(params.daysPerMonth)}>
            推进一月
          </button>
          <button className="primary" data-hint={TOP_CODES.save} onClick={() => void saveNow()}>
            保存
          </button>
          <button data-hint={TOP_CODES.snapshot} onClick={() => void takeSnapshot()}>
            快照
          </button>
        </div>
        <div className="row tabs">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? 'tab active' : 'tab'}
              data-hint={v.code}
              onClick={() => setView(v.id)}
            >
              {v.label}
              {counts[v.id] > 0 ? <span className="dim"> {counts[v.id]}</span> : null}
            </button>
          ))}
          <span className="dim small push">新增连接：在「地图」页签点两个据点</span>
          <button
            data-hint={TOP_CODES.addSite}
            onClick={() => addSiteAt(Math.round(params.mapWidth / 2), Math.round(params.mapHeight / 2))}
          >
            新增据点
          </button>
        </div>
        <div className="dim small">存档文件：{dbPath}</div>
        <div className="dim small">{note}</div>
      </header>

      <main>
        {!world ? (
          <p className="dim">数据还没读进来。</p>
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
              <EditWatcher list="factions" onBegin={beginEdit} onEnd={endEdit}>
                <FactionTable
                  world={world}
                  bar={bar('factions')}
                  onRename={renameFaction}
                  onColor={editFactionColor}
                  onDelete={deleteFaction}
                  onAdd={addFactionRow}
                />
              </EditWatcher>
            ) : view === 'divisions' ? (
              <EditWatcher list="divisions" onBegin={beginEdit} onEnd={endEdit}>
                <DivisionTable
                  world={world}
                  bar={bar('divisions')}
                  onRename={renameDivision}
                  onRank={editDivisionRank}
                  onParent={editDivisionParent}
                  onSeat={startSeatPick}
                  pickingSeat={seatTarget === 0 ? null : seatTarget}
                  onDelete={deleteDivision}
                  onAdd={addDivisionRow}
                />
              </EditWatcher>
            ) : view === 'sites' ? (
              <EditWatcher list="sites" onBegin={beginEdit} onEnd={endEdit}>
                <SiteTable
                  world={world}
                  bar={bar('sites')}
                  onEdit={editSite}
                  startSite={linkFrom === 0 ? null : linkFrom}
                  onPick={pickSite}
                  pickingParent={parentTarget === 0 ? null : parentTarget}
                  onPickParent={startParentPick}
                  onLocate={locateSite}
                  onDelete={deleteSite}
                  only={onlySite}
                  onOnly={(item) => {
                    lastEdit.current = null;
                    setOnlySite(item);
                    // 筛完之后行换了一批，从第一页看起。
                    setLists((s) => ({ ...s, sites: { ...s.sites, page: 1 } }));
                  }}
                  onEditLevel={editSiteLevel}
                  onEditDivision={editSiteDivision}
                />
              </EditWatcher>
            ) : view === 'units' ? (
              <EditWatcher list="units" onBegin={beginEdit} onEnd={endEdit}>
                <UnitTable
                  world={world}
                  bar={bar('units')}
                  onEdit={editUnit}
                  onOrder={editQueue}
                  onPickDestination={startOrderPick}
                  pickingUnit={orderTarget === 0 ? null : orderTarget}
                  onLocate={locateUnit}
                  onDelete={deleteUnit}
                  onAdd={addUnitRow}
                />
              </EditWatcher>
            ) : view === 'links' ? (
              <EditWatcher list="links" onBegin={beginEdit} onEnd={endEdit}>
                <LinkTable world={world} bar={bar('links')} onEdit={editLink} onDelete={deleteLink} />
              </EditWatcher>
            ) : view === 'terrains' ? (
              <EditWatcher list="terrains" onBegin={beginEdit} onEnd={endEdit}>
                <TerrainTable
                  world={world}
                  bar={bar('terrains')}
                  onEdit={editTerrain}
                  onDelete={deleteTerrain}
                  onAdd={addTerrainRow}
                />
              </EditWatcher>
            ) : view === 'log' ? (
              /* 日志：引擎自己往里面写行（逐日推进与三种问答的写回），所以它不跟哪一张表走。
                 这一段原来是摆在页签切换区之外的，于是每个页签下面都拖着它；现在它自己一个页签。 */
              <section className="log">
                <h3>日志（新的在上）</h3>
                <Pager total={logTotal} what="日志" bar={logBar} />
                {logShown.length === 0 ? (
                  <p className="dim">还没有日志。</p>
                ) : (
                  <ol>
                    {logShown.map((line, i) => (
                      <li key={String(logPage) + '-' + String(i)}>{line}</li>
                    ))}
                  </ol>
                )}
              </section>
            ) : view === 'settings' ? (
              <SettingsView world={world} params={params} theme={theme} onChange={writeParams} onNote={setNote} />
            ) : null}
          </>
        )}
      </main>

      {hmOn ? (
        /* 模式的那一条：现在敲到哪儿了、还剩哪些键。点不到它（pointer-events: none），不挡鼠标。 */
        <div className="hintbar">
          <strong>热键</strong>
          <kbd>{hmBuf === '' ? '等按键' : hmBuf}</kbd>
          <span className="dim small">Esc 清空 · Backspace 退一格 · ` 隐/现 · Alt+K 退出</span>
        </div>
      ) : null}

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
