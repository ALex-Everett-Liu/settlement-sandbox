import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import { dayOfMonth, month, tickDay, year } from '../engine/tick.ts';
import type { Params, Site, World } from '../engine/types.ts';
import { demoWorld } from '../engine/world.ts';
import type { SandboxApi } from '../shared/ipc.ts';

const api = (window as unknown as { sandbox?: SandboxApi }).sandbox;
const SPEEDS = [1, 2, 4, 8, 16];

function toNumber(text: string, fallback: number): number {
  if (text.trim() === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [params] = useState<Params>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [dbPath, setDbPath] = useState('（还不知道）');
  const [note, setNote] = useState('正在打开世界库…');
  const worldRef = useRef<World | null>(null);

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

  const calendar = world
    ? '第 ' + year(world, params) + ' 年 ' + month(world, params) + ' 月 ' + dayOfMonth(world, params) + ' 日'
    : '—';
  const sites = world ? world.sites : [];
  const factions = world ? world.factions : [];
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
        <div className="dim small">世界库：{dbPath}</div>
        <div className="dim small">{note}</div>
      </header>

      <main>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>规模</th>
              <th>人口</th>
              <th>民心</th>
              <th>稳定度</th>
              <th>金钱</th>
              <th>粮草</th>
              <th>势力</th>
              <th>上级</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td>
                  <input value={s.name} onChange={(e) => editSite(s.id, { name: e.target.value })} />
                </td>
                <td>
                  <input
                    type="number"
                    value={s.scale}
                    onChange={(e) => editSite(s.id, { scale: toNumber(e.target.value, s.scale) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={s.population}
                    onChange={(e) => editSite(s.id, { population: toNumber(e.target.value, s.population) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    value={s.morale}
                    onChange={(e) => editSite(s.id, { morale: toNumber(e.target.value, s.morale) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    value={s.stability}
                    onChange={(e) => editSite(s.id, { stability: toNumber(e.target.value, s.stability) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={s.money}
                    onChange={(e) => editSite(s.id, { money: toNumber(e.target.value, s.money) })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={s.food}
                    onChange={(e) => editSite(s.id, { food: toNumber(e.target.value, s.food) })}
                  />
                </td>
                <td>
                  <select value={s.faction} onChange={(e) => editSite(s.id, { faction: Number(e.target.value) })}>
                    {factions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    placeholder="无"
                    value={s.parent === null ? '' : String(s.parent)}
                    onChange={(e) =>
                      editSite(s.id, { parent: e.target.value.trim() === '' ? null : Number(e.target.value) })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="log">
          <h3>日志（最近 14 条，新的在上）</h3>
          {logTail.length === 0 ? <p className="dim">还没有日志。</p> : <ol>{logTail.map((line, i) => <li key={i}>{line}</li>)}</ol>}
        </section>
      </main>
    </div>
  );
}
