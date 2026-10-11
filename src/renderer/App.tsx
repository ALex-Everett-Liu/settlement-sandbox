import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Link, Order, Params, Site, Theme, Unit, World } from '../engine/types.ts';
import { demoWorld } from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import { LinkTable, SiteTable, UnitTable } from './tables.tsx';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

type View = 'sites' | 'units' | 'links';

const VIEWS: { id: View; label: string }[] = [
  { id: 'sites', label: '据点' },
  { id: 'units', label: '部队' },
  { id: 'links', label: '连接' },
];

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [view, setView] = useState<View>('sites');
  const [dbPath, setDbPath] = useState('（还不知道）');
  const [note, setNote] = useState('正在打开世界库…');
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

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const counts: Record<View, number> = {
    sites: world ? world.sites.length : 0,
    units: world ? world.units.length : 0,
    links: world ? world.links.length : 0,
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
        </div>
        <div className="dim small">世界库：{dbPath}</div>
        <div className="dim small">{note}</div>
      </header>

      <main>
        {!world ? (
          <p className="dim">世界还没读进来。</p>
        ) : view === 'sites' ? (
          <SiteTable world={world} onEdit={editSite} />
        ) : view === 'units' ? (
          <UnitTable world={world} onEdit={editUnit} onOrder={editQueue} />
        ) : (
          <LinkTable world={world} onEdit={editLink} />
        )}

        <section className="log">
          <h3>日志（最近 14 条，新的在上）</h3>
          {logTail.length === 0 ? <p className="dim">还没有日志。</p> : <ol>{logTail.map((line, i) => <li key={i}>{line}</li>)}</ol>}
        </section>
      </main>
    </div>
  );
}
