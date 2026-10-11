import { useCallback, useEffect, useRef, useState } from 'react';
import { answerAsk } from '../engine/ask.ts';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Link, Order, Params, Site, Theme, Unit, World } from '../engine/types.ts';
import { addLink, addSite, demoWorld, siteName } from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import { MapView } from './map.tsx';
import { LinkTable, SiteTable, UnitTable } from './tables.tsx';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

type View = 'sites' | 'units' | 'links' | 'map';

const VIEWS: { id: View; label: string }[] = [
  { id: 'sites', label: '据点' },
  { id: 'units', label: '部队' },
  { id: 'links', label: '连接' },
  { id: 'map', label: '地图' },
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

  const switchTheme = useCallback(() => {
    const next: Params = { ...params, theme: theme === 'light' ? 'dark' : 'light' };
    setParams(next);
    if (api) void api.saveParams(next);
  }, [params, theme]);

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

  /** 在地图上点了一个据点：还没有起点就是挑起点，已经有起点就是建连接，点的是起点本身就取消。 */
  const pickSite = useCallback(
    (id: number) => {
      const w = worldRef.current;
      if (!w) return;
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
    [linkFrom, addLinkBetween],
  );

  const cancelPick = useCallback(() => {
    if (linkFrom === 0) return;
    setLinkFrom(0);
    setNote('起点取消了');
  }, [linkFrom]);

  // 挑起点的时候按 Esc 取消。
  useEffect(() => {
    if (linkFrom === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkFrom, cancelPick]);

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const counts: Record<View, number> = {
    sites: world ? world.sites.length : 0,
    units: world ? world.units.length : 0,
    links: world ? world.links.length : 0,
    map: world ? world.sites.length : 0,
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
          <button className="push" onClick={switchTheme}>
            {theme === 'light' ? '深色' : '浅色'}
          </button>
        </div>
        <div className="row tabs">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'tab active' : 'tab'} onClick={() => setView(v.id)}>
              {v.label}
              <span className="dim"> {counts[v.id]}</span>
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
        ) : view === 'sites' ? (
          <SiteTable
            world={world}
            onEdit={editSite}
            startSite={linkFrom === 0 ? null : linkFrom}
            onPick={pickSite}
          />
        ) : view === 'units' ? (
          <UnitTable world={world} onEdit={editUnit} onOrder={editQueue} />
        ) : view === 'links' ? (
          <LinkTable world={world} onEdit={editLink} />
        ) : (
          <MapView
            world={world}
            params={params}
            theme={theme}
            startSite={linkFrom === 0 ? null : linkFrom}
            onAddSite={addSiteAt}
            onPickSite={pickSite}
            onCancelPick={cancelPick}
          />
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
