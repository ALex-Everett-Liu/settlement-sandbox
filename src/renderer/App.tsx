import { useCallback, useEffect, useRef, useState } from 'react';
import { answerAsk } from '../engine/ask.ts';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Link, Order, Params, Site, Theme, Unit, World } from '../engine/types.ts';
import { addFaction, addLink, addSite, demoWorld, siteName } from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import { MapView } from './map.tsx';
import { SettingsView } from './settings.tsx';
import { FactionTable, LinkTable, SiteTable, UnitTable } from './tables.tsx';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

type View = 'factions' | 'sites' | 'units' | 'links' | 'map' | 'settings';

const VIEWS: { id: View; label: string }[] = [
  { id: 'factions', label: '势力' },
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

  /** 地图上双击：在双击的位置新增一个据点，名字先给个编号，其余用最小默认值。 */
  const addSiteAt = useCallback(
    (x: number, y: number) => {
      const w = worldRef.current;
      if (!w) return;
      const s = addSite(w, {
        name: '新据点 ' + String(w.sites.length + 1),
        x, y, scale: 1, population: 0, morale: 70, stability: 60,
        money: 0, food: 0, parent: null, faction: w.factions[0]?.id ?? 1,
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

  /** 点「前往…」：等一次地图上的点选，选中哪个据点就是目的地。 */
  const startOrderPick = useCallback((unitId: number) => {
    setLinkFrom(0);
    setOrderTarget(unitId);
    setNote('挑目的地：在地图上点一个据点（Esc 或点空白处取消）');
  }, []);

  /** 在地图上点了一个据点：正挑目的地就派那支部队去，否则走建连接那一套。 */
  const pickSite = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
      if (orderTarget !== 0) {
        const u = w.units.find((x) => x.id === orderTarget);
        editQueue(orderTarget, [{ kind: 'march', to: id }]);
        setNote((u ? u.name : '部队 ' + String(orderTarget)) + ' 前往 ' + siteName(w, id));
        if (api) void api.saveWorld(w);
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
    [linkFrom, orderTarget, addLinkBetween, editQueue],
  );

  const cancelPick = useCallback(() => {
    if (orderTarget !== 0) {
      setOrderTarget(0);
      setNote('挑目的地取消了');
      return;
    }
    if (linkFrom === 0) return;
    setLinkFrom(0);
    setNote('起点取消了');
  }, [linkFrom, orderTarget]);

  // 挑起点或挑目的地的时候按 Esc 取消。
  useEffect(() => {
    if (linkFrom === 0 && orderTarget === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkFrom, orderTarget, cancelPick]);

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const counts: Record<View, number> = {
    factions: world ? world.factions.length : 0,
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
                startSite={linkFrom === 0 ? null : linkFrom}
                pickUnit={orderTarget === 0 ? null : orderTarget}
                focus={focus}
                pickHint={
                  orderTarget !== 0
                    ? '挑目的地：在地图上点一个据点，Esc 或点空白处取消'
                    : linkFrom !== 0
                      ? '起点：' + siteName(world, linkFrom) + ' · 再点一个据点作终点，Esc 或点空白处取消'
                      : null
                }
                onAddSite={addSiteAt}
                onPickSite={pickSite}
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
            ) : view === 'sites' ? (
              <SiteTable
                world={world}
                onEdit={editSite}
                startSite={linkFrom === 0 ? null : linkFrom}
                onPick={pickSite}
                onLocate={locateSite}
              />
            ) : view === 'units' ? (
              <UnitTable
                world={world}
                onEdit={editUnit}
                onOrder={editQueue}
                onPickDestination={startOrderPick}
                pickingUnit={orderTarget === 0 ? null : orderTarget}
                onLocate={locateUnit}
              />
            ) : view === 'links' ? (
              <LinkTable world={world} onEdit={editLink} />
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
        <div className="row">
          {ask.options.map((o) => (
            <button key={o.value} className={value === o.value ? 'tab active' : 'tab'} onClick={() => setValue(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="row">
          <input
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
        <p className="dim small">默认值是「{fallbackLabel}」，也可以自己填一个值。</p>
      </div>
    </div>
  );
}
