// The three views of one switchable table: sites, units, links.
// Anything the designer may edit is an input; derived values (position, order
// queue) stay read-only text.
import type { Link, Order, Site, Terrain, Unit, World } from '../engine/types.ts';
import {
  factionName,
  orderFromValue,
  orderText,
  orderValue,
  placeText,
  TERRAIN_LABEL,
  TERRAINS,
} from './format.ts';

function toNumber(text: string, fallback: number): number {
  if (text.trim() === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/** Display rounding: a raw value like 99.16666666666667 does not fit in a cell. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

interface SiteTableProps {
  world: World;
  onEdit: (id: number, patch: Partial<Site>) => void;
}

export function SiteTable({ world, onEdit }: SiteTableProps) {
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
              <select value={s.faction} onChange={(e) => onEdit(s.id, { faction: Number(e.target.value) })}>
                {world.factions.map((f) => (
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
                onChange={(e) => onEdit(s.id, { parent: e.target.value.trim() === '' ? null : Number(e.target.value) })}
              />
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
}

export function UnitTable({ world, onEdit, onOrder }: UnitTableProps) {
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
              <select value={u.faction} onChange={(e) => onEdit(u.id, { faction: Number(e.target.value) })}>
                {world.factions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
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
              <select value={orderValue(u)} onChange={(e) => onOrder(u.id, orderFromValue(e.target.value))}>
                <option value="">无</option>
                <option value="hold">原地待命</option>
                {world.sites.map((s) => (
                  <option key={s.id} value={'march:' + String(s.id)}>
                    前往 {s.name}
                  </option>
                ))}
              </select>
              {u.queue.length > 1 ? <div className="dim small">队列：{orderText(world, u)}</div> : null}
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
          <th>距离</th>
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
            <td>
              <input
                type="number"
                value={l.distance}
                onChange={(e) => onEdit(l.id, { distance: toNumber(e.target.value, l.distance) })}
              />
            </td>
            <td>
              <select
                value={l.terrain}
                onChange={(e) => onEdit(l.id, { terrain: e.target.value as Terrain })}
              >
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
