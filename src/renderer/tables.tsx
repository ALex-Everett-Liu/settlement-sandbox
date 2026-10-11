// The three views of one switchable table: sites, units, links.
// Anything the designer may edit is an input; derived values (position, order
// queue) stay read-only text.
import { useRef, useState } from 'react';
import type { Link, Order, Site, Terrain, Unit, World } from '../engine/types.ts';
import { linkLength } from '../engine/world.ts';
import { factionName, orderText, placeText, siteName, TERRAIN_LABEL, TERRAINS } from './format.ts';

function toNumber(text: string, fallback: number): number {
  if (text.trim() === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/** Display rounding: a raw value like 99.16666666666667 does not fit in a cell. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 上级那一格写这个字代表「没有上级」。它也在可选名字里，所以能被重新清掉。 */
const NO_PARENT = '（无）';

interface NamePickerProps {
  /** 现在这个名字。 */
  value: string;
  /** 可选的全部名字，按这个顺序给出。 */
  names: string[];
  /** 这一格挑的是什么，用来写提示：势力 / 上级。 */
  label: string;
  /** 留空按回车时当作选中了哪个名字；不传就是留空不算数。 */
  emptyPick?: string;
  /** 按回车或点候选时才调它。 */
  onPick: (name: string) => void;
}

/**
 * 按名字挑一个东西：敲名字只用来过滤，写回发生在按回车（与某个名字完全相同）或点候选的时候。
 * 几百个势力或据点时下拉挑不动，敲两三个字就缩到一两条。
 */
function NamePicker({ value, names, label, emptyPick, onPick }: NamePickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 格子下面放不下候选列表时就改成往上展开。
  const [up, setUp] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = draft === null ? value : draft;
  const typed = text.trim();
  // 打进去的字一个名字都对不上就标红；空着不算错，只是还没填。
  const bad = typed !== '' && !names.includes(typed);
  const hits = typed === '' ? names : names.filter((n) => n.includes(typed));
  const shown = hits.slice(0, 6);

  /** 只有按回车（与某个名字完全相同）或点候选才走到这里。 */
  const commit = (name: string) => {
    onPick(name);
    setDraft(null);
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className={bad ? 'bad' : undefined}
        value={text}
        placeholder={label}
        title={bad ? '没有这个' + label + '：按回车写回对得上的名字，或按 Esc 收回原来的名字' : label}
        onFocus={() => {
          const el = inputRef.current;
          // 候选列表最高 190 像素，再加一点余量。
          setUp(el !== null && window.innerHeight - el.getBoundingClientRect().bottom < 200);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (typed === '' && emptyPick !== undefined) commit(emptyPick);
            else if (names.includes(typed)) commit(typed);
          } else if (e.key === 'Escape') {
            setDraft(null);
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className={up ? 'picklist up' : 'picklist'}>
          {shown.map((n) => (
            <button
              key={n}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                commit(n);
                setOpen(false);
              }}
            >
              {n}
            </button>
          ))}
          {hits.length > shown.length ? (
            <span className="more dim small">还有 {hits.length - shown.length} 个</span>
          ) : null}
          {shown.length === 0 ? <span className="more dim small">没有这个{label}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

interface SiteTableProps {
  world: World;
  onEdit: (id: number, patch: Partial<Site>) => void;
  /** 正在挑的起点据点；没有就是 null。 */
  startSite: number | null;
  /** 点「以此为起点」：接着在地图上挑终点，见设计 §六。 */
  onPick: (id: number) => void;
}

export function SiteTable({ world, onEdit, startSite, onPick }: SiteTableProps) {
  if (world.sites.length === 0) return <p className="dim">还没有据点。</p>;

  return (
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
          <th>起点</th>
        </tr>
      </thead>
      <tbody>
        {world.sites.map((s) => (
          <tr key={s.id}>
            <td>
              <input value={s.name} onChange={(e) => onEdit(s.id, { name: e.target.value })} />
            </td>
            <td>
              <input
                type="number"
                value={s.scale}
                onChange={(e) => onEdit(s.id, { scale: toNumber(e.target.value, s.scale) })}
              />
            </td>
            <td>
              <input
                type="number"
                value={s.population}
                onChange={(e) => onEdit(s.id, { population: toNumber(e.target.value, s.population) })}
              />
            </td>
            <td>
              <input
                type="number"
                step="0.1"
                value={round1(s.morale)}
                onChange={(e) => onEdit(s.id, { morale: toNumber(e.target.value, s.morale) })}
              />
            </td>
            <td>
              <input
                type="number"
                step="0.1"
                value={round1(s.stability)}
                onChange={(e) => onEdit(s.id, { stability: toNumber(e.target.value, s.stability) })}
              />
            </td>
            <td>
              <input
                type="number"
                value={s.money}
                onChange={(e) => onEdit(s.id, { money: toNumber(e.target.value, s.money) })}
              />
            </td>
            <td>
              <input
                type="number"
                value={s.food}
                onChange={(e) => onEdit(s.id, { food: toNumber(e.target.value, s.food) })}
              />
            </td>
            <td>
              <NamePicker
                value={factionName(world, s.faction)}
                names={world.factions.map((f) => f.name)}
                label="势力"
                onPick={(name) => {
                  const f = world.factions.find((x) => x.name === name);
                  if (f) onEdit(s.id, { faction: f.id });
                }}
              />
            </td>
            <td>
              <NamePicker
                value={s.parent === null ? NO_PARENT : siteName(world, s.parent)}
                names={[NO_PARENT, ...world.sites.filter((x) => x.id !== s.id).map((x) => x.name)]}
                label="上级"
                emptyPick={NO_PARENT}
                onPick={(name) => {
                  if (name === NO_PARENT) {
                    onEdit(s.id, { parent: null });
                    return;
                  }
                  const p = world.sites.find((x) => x.name === name && x.id !== s.id);
                  if (p) onEdit(s.id, { parent: p.id });
                }}
              />
            </td>
            <td>
              <button onClick={() => onPick(s.id)}>{startSite === s.id ? '起点 · 取消' : '以此为起点'}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface UnitTableProps {
  world: World;
  onEdit: (id: number, patch: Partial<Unit>) => void;
  onOrder: (id: number, queue: Order[]) => void;
  /** 点「前往…」：进入在地图上挑目的地的状态。 */
  onPickDestination: (id: number) => void;
  /** 正在挑目的地的那支部队；没有就是 null。 */
  pickingUnit: number | null;
}

export function UnitTable({ world, onEdit, onOrder, onPickDestination, pickingUnit }: UnitTableProps) {
  if (world.units.length === 0) return <p className="dim">还没有部队。</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>名称</th>
          <th>势力</th>
          <th>兵力</th>
          <th>训练度</th>
          <th>组织度</th>
          <th>位置</th>
          <th>随身粮草</th>
          <th>命令</th>
        </tr>
      </thead>
      <tbody>
        {world.units.map((u) => (
          <tr key={u.id}>
            <td>
              <input value={u.name} onChange={(e) => onEdit(u.id, { name: e.target.value })} />
            </td>
            <td>
              <NamePicker
                value={factionName(world, u.faction)}
                names={world.factions.map((f) => f.name)}
                label="势力"
                onPick={(name) => {
                  const f = world.factions.find((x) => x.name === name);
                  if (f) onEdit(u.id, { faction: f.id });
                }}
              />
            </td>
            <td>
              <input
                type="number"
                value={u.troops}
                onChange={(e) => onEdit(u.id, { troops: toNumber(e.target.value, u.troops) })}
              />
            </td>
            <td>
              <input
                type="number"
                step="0.1"
                value={round1(u.training)}
                onChange={(e) => onEdit(u.id, { training: toNumber(e.target.value, u.training) })}
              />
            </td>
            <td>
              <input
                type="number"
                step="0.1"
                value={round1(u.organization)}
                onChange={(e) => onEdit(u.id, { organization: toNumber(e.target.value, u.organization) })}
              />
            </td>
            <td className="ro">{placeText(world, u.place)}</td>
            <td>
              <input
                type="number"
                step="0.1"
                value={round1(u.carriedFood)}
                onChange={(e) => onEdit(u.id, { carriedFood: toNumber(e.target.value, u.carriedFood) })}
              />
            </td>
            <td>
              <div className="row">
                <button onClick={() => onOrder(u.id, [{ kind: 'hold' }])}>待命</button>
                <button onClick={() => onPickDestination(u.id)}>前往…</button>
                <button onClick={() => onOrder(u.id, [])}>清空</button>
              </div>
              <div className="dim small">{orderText(world, u)}</div>
              {pickingUnit === u.id ? (
                <div className="dim small">在地图上点一个据点作目的地（Esc 或点空白处取消）</div>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface LinkTableProps {
  world: World;
  onEdit: (id: number, patch: Partial<Link>) => void;
}

export function LinkTable({ world, onEdit }: LinkTableProps) {
  if (world.links.length === 0) return <p className="dim">还没有连接。</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>两端</th>
          <th>长度</th>
          <th>绕行系数</th>
          <th>地貌</th>
        </tr>
      </thead>
      <tbody>
        {world.links.map((l) => (
          <tr key={l.id}>
            <td className="ro">
              {world.sites.find((s) => s.id === l.a)?.name ?? String(l.a)}
              {' — '}
              {world.sites.find((s) => s.id === l.b)?.name ?? String(l.b)}
            </td>
            <td className="ro">{Math.round(linkLength(world, l))}</td>
            <td>
              <input
                type="number"
                step="0.05"
                value={l.detour}
                onChange={(e) => onEdit(l.id, { detour: toNumber(e.target.value, l.detour) })}
              />
            </td>
            <td>
              <select
                value={l.terrain ?? ''}
                onChange={(e) => onEdit(l.id, { terrain: e.target.value === '' ? null : (e.target.value as Terrain) })}
              >
                <option value="">（未填）</option>
                {TERRAINS.map((t) => (
                  <option key={t} value={t}>
                    {TERRAIN_LABEL[t]}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
