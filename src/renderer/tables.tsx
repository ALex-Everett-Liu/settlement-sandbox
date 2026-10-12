// The four views of one switchable table: factions, sites, units, links.
// Anything the designer may edit is an input; derived values (position, order
// queue, the five totals on a faction row) stay read-only text.
import { useRef, useState } from 'react';
import type { Link, Order, Site, Terrain, Unit, World } from '../engine/types.ts';
import { divisionName, divisionSites, linkLength, siteBranch } from '../engine/world.ts';
import { factionName, garrisonText, orderText, placeText, round1, round2, siteName, TERRAIN_LABEL, TERRAINS } from './format.ts';

function toNumber(text: string, fallback: number): number {
  if (text.trim() === '') return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/** 这个字是不是一个落在 [min, max] 里的数。 */
function inRange(text: string, min: number, max: number): boolean {
  if (text.trim() === '') return false;
  const n = Number(text);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * 数字格：只有落进 [min, max] 的数才写回世界。写不进去的值留在格子里并标红，
 * 由 onNote 报一句，等 User 自己改回来——不夹到边界，也不替 User 改数。
 * 草稿在输入期间一直留着（不然敲「12.」时最后那个小数点会被顶掉），焦点离开时才与世界的值对齐；
 * 越界的草稿离开焦点也留着，直到改成一个写得回去的数。
 */
export function NumberCell({
  value, min, max, step, label, title, onCommit, onNote,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  title: string;
  onCommit: (v: number) => void;
  onNote: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(round1(value));
  const bad = draft !== null && !inRange(draft, min, max);

  return (
    <input
      className={bad ? 'bad' : undefined}
      type="number"
      step={step}
      value={text}
      title={title}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (inRange(t, min, max)) {
          onCommit(Number(t));
          return;
        }
        onNote(
          label + '只收 ' + String(min) + ' 到 ' + String(max) + ' 之间的数：' +
            (t.trim() === '' ? '格子还空着' : '「' + t + '」写不回去') + '。改一个数再写，别的不动。',
        );
      }}
      onBlur={() => {
        if (draft === null || inRange(draft, min, max)) setDraft(null);
      }}
    />
  );
}

/** 上级那一格写这个字代表「没有上级」。它也在可选名字里，所以能被重新清掉。 */
const NO_PARENT = '（无）';

/**
 * 删除按钮。要按两下：第一下把按钮换成「确认删除」，焦点离开就收回。
 * 挡路的情况由调用方判——按了第二下也可能什么也没删，说明行会写清楚挡在哪一条。
 */
function DeleteButton({ what, onConfirm }: { what: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={armed ? 'danger' : undefined}
      title={armed ? '再点一下就删掉' + what : '删掉' + what + '：要按两下'}
      // 收回的判据是焦点离开，不是鼠标移出按钮的框：字从「删除」变「确认删除」时框会变宽、
      // 表格会重新分配列宽，鼠标一动没动框却变了，onMouseLeave 会被误判出来，刚点亮的「确认删除」当场被收回。
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
      }}
    >
      {armed ? '确认删除' : '删除'}
    </button>
  );
}

/**
 * 候选列表里的一条。写回世界的是 id，名字只用来显示与过滤——
 * 名字允许重复，两处同名时按回车不写回，靠候选里跟着的编号分。
 */
interface PickItem {
  id: number;
  /** 格子里与候选里显示的名字。 */
  name: string;
  /** 候选里跟在名字后面的编号（「#5」这种）；「（无）」这一类没有编号，就不写。 */
  tag?: string;
  /**
   * 这一条是据点还是辖区。只有据点表那个「只看某一支」用得上——
   * 两套编号各从 1 起，光看 id 分不出是哪一种。别处不传就当作据点。
   */
  kind?: 'site' | 'division';
}

interface NamePickerProps {
  /** 现在这一条的名字，格子里显示它。 */
  value: string;
  /** 可选的全部条目。 */
  items: PickItem[];
  /** 这一格挑的是什么，用来写提示：势力 / 上级。 */
  label: string;
  /** 留空按回车时当作选中了哪一条；不传就是留空不算数。 */
  emptyPick?: PickItem;
  /** 按回车或点候选时才调它，参数是挑中的那一条。 */
  onPick: (item: PickItem) => void;
}

/**
 * 按名字挑一个东西：敲名字只用来过滤，写回发生在按回车（与某一条的名字完全相同，
 * 且这样的只有一条）或点候选的时候。几百个势力或据点时下拉挑不动，敲两三个字就缩到一两条。
 */
function NamePicker({ value, items, label, emptyPick, onPick }: NamePickerProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 格子下面放不下候选列表时就改成往上展开。
  const [up, setUp] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const text = draft === null ? value : draft;
  const typed = text.trim();
  // 敲进去的字与哪几条的名字完全相同。名字允许重复，所以这里可能不止一条。
  const exact = items.filter((i) => i.name === typed);
  const only = exact.length === 1 ? exact[0] : undefined;
  // 只有 User 自己往里敲过字才判对错：一条都对不上、或者对上不止一条（同名）都算没挑定，
  // 字留在格子里并把格子标红。draft 是 null 表示这一格没在改，那时不判——挂着的本来就可能是个重名的名字。
  const bad = draft !== null && typed !== '' && only === undefined;
  const hits = typed === '' ? items : items.filter((i) => i.name.includes(typed));
  const shown = hits.slice(0, 6);

  /** 只有按回车（同名只有一个）或点候选才走到这里。 */
  const commit = (item: PickItem) => {
    onPick(item);
    setDraft(null);
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className={bad ? 'bad' : undefined}
        value={text}
        placeholder={label}
        title={
          bad
            ? exact.length > 1
              ? '有 ' + String(exact.length) + ' 个同名的' + label + '：从候选里点一个'
              : '没有这个' + label + '：按回车写回对得上的名字，或按 Esc 收回原来的名字'
            : label
        }
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
            else if (only !== undefined) commit(only);
          } else if (e.key === 'Escape') {
            setDraft(null);
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className={up ? 'picklist up' : 'picklist'}>
          {shown.map((item) => (
            <button
              key={item.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                commit(item);
                setOpen(false);
              }}
            >
              {item.name}
              {item.tag === undefined ? null : <span className="tag"> {item.tag}</span>}
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

/** 势力那一格的可挑条目：名字后面跟着编号，两个势力重名时靠编号分。 */
function factionItems(world: World): PickItem[] {
  return world.factions.map((f) => ({ id: f.id, name: f.name, tag: '#' + String(f.id) }));
}

interface FactionTableProps {
  world: World;
  /** 改名字：与别的表一样就地改，等月末那一次自动保存。 */
  onRename: (id: number, name: string) => void;
  /** 点「删除」（第二下）：名下还挂着据点或部队就会被挡回来，说明行写清楚还挂着多少。 */
  onDelete: (id: number) => void;
  /** 末尾那一行的「＋」：添一个新势力。 */
  onAdd: () => void;
}

/**
 * 势力表。名字能改，后面五列都是算出来的：名下有几座据点、几支部队，
 * 这些部队的兵力加总，以及这些据点自存的金钱与粮草（部队随身带着的那份不算在粮里）。
 */
export function FactionTable({ world, onRename, onDelete, onAdd }: FactionTableProps) {
  const rows = world.factions.map((f) => {
    const sites = world.sites.filter((s) => s.faction === f.id);
    const units = world.units.filter((u) => u.faction === f.id);
    return {
      faction: f,
      sites: sites.length,
      units: units.length,
      troops: units.reduce((sum, u) => sum + u.troops, 0),
      money: sites.reduce((sum, s) => sum + s.money, 0),
      food: sites.reduce((sum, s) => sum + s.food, 0),
    };
  });

  return (
    <table>
      <thead>
        <tr>
          <th>名字</th>
          <th>据点</th>
          <th>部队</th>
          <th>兵力</th>
          <th>钱</th>
          <th>粮</th>
          <th>删除</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="ro" colSpan={7}>
              还没有势力。按下面那一行的「＋」新建一个。
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.faction.id}>
              <td>
                <input value={r.faction.name} onChange={(e) => onRename(r.faction.id, e.target.value)} />
              </td>
              <td className="ro">{r.sites}</td>
              <td className="ro">{r.units}</td>
              <td className="ro">{round1(r.troops)}</td>
              <td className="ro">{round1(r.money)}</td>
              <td className="ro">{round1(r.food)}</td>
              <td>
                <DeleteButton what={'势力「' + r.faction.name + '」'} onConfirm={() => onDelete(r.faction.id)} />
              </td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={7}>
            <button onClick={onAdd}>＋ 新增势力</button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

interface SiteTableProps {
  world: World;
  onEdit: (id: number, patch: Partial<Site>) => void;
  /** 正在挑的起点据点；没有就是 null。 */
  startSite: number | null;
  /** 点「以此为起点」：接着在地图上挑终点，见设计 §六。 */
  onPick: (id: number) => void;
  /** 正在给它挑上级的那个据点；没有就是 null。 */
  pickingParent: number | null;
  /** 点「挂到…」：接着在地图上点一个据点作上级。 */
  onPickParent: (id: number) => void;
  /** 点「定位」：地图页签把这一座移到画面中央。 */
  onLocate: (id: number) => void;
  /** 点「删除」（第二下）：有部队停着、有连接挂着、有据点认它当上级、有部队正朝它去，都会被挡回来。 */
  onDelete: (id: number) => void;
  /** 只看某一支时挑中的那一个（据点或辖区）；null 就是全部。 */
  only: { kind: 'site' | 'division'; id: number; name: string } | null;
  /** 挑了一个（据点或辖区），或者挑「全部」时传 null。 */
  onOnly: (item: { kind: 'site' | 'division'; id: number; name: string } | null) => void;
  /** 改层级：破了「上级不低于下级」就由 App 挡回来。 */
  onEditLevel: (id: number, level: number) => void;
  /** 挑辖区：名字类，过滤输入框；与据点自己那个层级对不上时只在说明行提一句。 */
  onEditDivision: (id: number, division: number | null) => void;
  /** 哪一格写了写不回去的值：把它报给说明行，值留在格子里等 User 自己改。 */
  onNote: (message: string) => void;
}

export function SiteTable({
  world,
  onEdit,
  startSite,
  onPick,
  pickingParent,
  onPickParent,
  onLocate,
  onDelete,
  only,
  onOnly,
  onEditLevel,
  onEditDivision,
  onNote,
}: SiteTableProps) {
  if (world.sites.length === 0) return <p className="dim">还没有据点。</p>;

  // 「只看某一支」：挑据点就收它那一棵（所属据点往下），挑辖区就收它名下那一整片；选「全部」时是 null。
  const branch =
    only === null ? null : only.kind === 'division' ? divisionSites(world, only.id) : siteBranch(world, only.id);
  const rows = branch === null ? world.sites : world.sites.filter((s) => branch.has(s.id));

  return (
    <>
      <div className="row">
        <NamePicker
          value={only === null ? '' : only.name}
          items={[
            { id: 0, name: '全部' },
            ...world.sites.map((s) => ({ id: s.id, name: s.name, tag: '#' + String(s.id), kind: 'site' as const })),
            ...world.divisions.map((d) => ({
              id: d.id,
              name: d.name,
              tag: '#' + String(d.id) + '（辖区）',
              kind: 'division' as const,
            })),
          ]}
          label="只看某一支"
          emptyPick={{ id: 0, name: '全部' }}
          onPick={(item) => {
            if (item.id === 0) {
              onOnly(null);
              return;
            }
            onOnly({ kind: item.kind === 'division' ? 'division' : 'site', id: item.id, name: item.name });
          }}
        />
        <span className="dim small">
          {only === null
            ? '全部 ' + String(world.sites.length) + ' 座'
            : '只看' +
              (only.kind === 'division' ? '辖区' : '') +
              '「' +
              only.name +
              '」：' +
              String(rows.length) +
              ' 座'}
        </span>
      </div>
      <table>
      <thead>
        <tr>
          <th>名称</th>
          <th>发展度</th>
          <th>防御设施等级</th>
          <th>人口</th>
          <th>民心</th>
          <th>稳定度</th>
          <th>金钱</th>
          <th>粮草</th>
          <th>势力</th>
          <th>所属据点</th>
          <th>层级</th>
          <th>辖区</th>
          <th>驻军</th>
          <th>坐标 x</th>
          <th>坐标 y</th>
          <th>地图</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td>
              <input value={s.name} onChange={(e) => onEdit(s.id, { name: e.target.value })} />
            </td>
            <td>
              <NumberCell
                value={s.development}
                min={0}
                max={100}
                step={0.1}
                label="发展度"
                title="发展度 0–100，一位小数：钱粮产出与 upkeep 按它算，地图上记号的大小也按它。"
                onCommit={(v) => onEdit(s.id, { development: v })}
                onNote={onNote}
              />
            </td>
            <td>
              <NumberCell
                value={s.fortification}
                min={0}
                max={10}
                step={0.1}
                label="防御设施等级"
                title="防御设施等级 0–10，一位小数。现在只由 User 声明，不参与结算（战斗还没做）。"
                onCommit={(v) => onEdit(s.id, { fortification: v })}
                onNote={onNote}
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
                items={factionItems(world)}
                label="势力"
                onPick={(item) => onEdit(s.id, { faction: item.id })}
              />
            </td>
            <td>
              <div className="row">
                <span className={s.parent === null ? 'dim' : undefined}>
                  {s.parent === null ? '（无）' : siteName(world, s.parent)}
                </span>
                <button onClick={() => onPickParent(s.id)}>挂到…</button>
                {s.parent === null ? null : <button onClick={() => onEdit(s.id, { parent: null })}>摘掉</button>}
              </div>
              {pickingParent === s.id ? (
                <div className="dim small">在地图上点一个据点作上级（Esc 或点空白处取消）</div>
              ) : null}
            </td>
            <td>
              <input
                type="number"
                title="层级：上级不低于它、下级不高于它；记号形状按它分档"
                value={s.level}
                onChange={(e) => onEditLevel(s.id, toNumber(e.target.value, s.level))}
              />
            </td>
            <td>
              <NamePicker
                value={s.division === null ? '（无）' : divisionName(world, s.division)}
                items={[
                  { id: 0, name: '（无）' },
                  ...world.divisions.map((d) => ({ id: d.id, name: d.name, tag: '#' + String(d.id) })),
                ]}
                label="辖区"
                emptyPick={{ id: 0, name: '（无）' }}
                onPick={(item) => onEditDivision(s.id, item.id === 0 ? null : item.id)}
              />
            </td>
            <td className="ro" title="位置在这座据点的部队：支数 · 兵力合计。地图上不给它们画记号。">
              {garrisonText(world, s.id)}
            </td>
            <td>
              <input
                type="number"
                step="0.01"
                value={round2(s.x)}
                onChange={(e) => onEdit(s.id, { x: toNumber(e.target.value, s.x) })}
              />
            </td>
            <td>
              <input
                type="number"
                step="0.01"
                value={round2(s.y)}
                onChange={(e) => onEdit(s.id, { y: toNumber(e.target.value, s.y) })}
              />
            </td>
            <td>
              <div className="row">
                <button onClick={() => onPick(s.id)}>{startSite === s.id ? '起点 · 取消' : '以此为起点'}</button>
                <button onClick={() => onLocate(s.id)}>定位</button>
                <DeleteButton what={'据点「' + s.name + '」'} onConfirm={() => onDelete(s.id)} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

interface DivisionTableProps {
  world: World;
  onRename: (id: number, name: string) => void;
  onRank: (id: number, rank: number) => void;
  onParent: (id: number, parent: number | null) => void;
  /** 点「治所…」：接着在地图上点一个据点。 */
  onSeat: (id: number) => void;
  /** 正在给它挑治所的那个辖区；没有就是 null。 */
  pickingSeat: number | null;
  onDelete: (id: number) => void;
  onAdd: () => void;
}

/**
 * 辖区表：一片地方的行政归属。等级只约束辖区之间；治所是一个据点，随时可迁。
 * 名字能改，等级与上级辖区能就地改，末尾一列删除（要按两下）。
 */
export function DivisionTable({
  world,
  onRename,
  onRank,
  onParent,
  onSeat,
  pickingSeat,
  onDelete,
  onAdd,
}: DivisionTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>名字</th>
          <th>等级</th>
          <th>上级辖区</th>
          <th>治所</th>
          <th>据点</th>
          <th>下级辖区</th>
          <th>删除</th>
        </tr>
      </thead>
      <tbody>
        {world.divisions.length === 0 ? (
          <tr>
            <td className="ro" colSpan={7}>
              还没有辖区。
            </td>
          </tr>
        ) : null}
        {world.divisions.map((d) => {
          const siteCount = world.sites.filter((x) => x.division === d.id).length;
          const belowCount = world.divisions.filter((x) => x.parent === d.id).length;
          return (
            <tr key={d.id}>
              <td>
                <input value={d.name} onChange={(e) => onRename(d.id, e.target.value)} />
              </td>
              <td>
                <input
                  type="number"
                  title="等级：上级辖区不低于它、下级辖区不高于它"
                  value={d.rank}
                  onChange={(e) => onRank(d.id, toNumber(e.target.value, d.rank))}
                />
              </td>
              <td>
                <NamePicker
                  value={d.parent === null ? '（无）' : divisionName(world, d.parent)}
                  items={[
                    { id: 0, name: '（无）' },
                    ...world.divisions
                      .filter((x) => x.id !== d.id)
                      .map((x) => ({ id: x.id, name: x.name, tag: '#' + String(x.id) })),
                  ]}
                  label="上级辖区"
                  emptyPick={{ id: 0, name: '（无）' }}
                  onPick={(item) => onParent(d.id, item.id === 0 ? null : item.id)}
                />
              </td>
              <td>
                <div className="row">
                  <span className={d.seat === null ? 'dim' : undefined}>
                    {d.seat === null ? '（无）' : siteName(world, d.seat)}
                  </span>
                  <button onClick={() => onSeat(d.id)}>治所…</button>
                </div>
                {pickingSeat === d.id ? (
                  <div className="dim small">在地图上点一个据点作治所（Esc 或点空白处取消）</div>
                ) : null}
              </td>
              <td className="ro">{siteCount}</td>
              <td className="ro">{belowCount}</td>
              <td>
                <DeleteButton what={'辖区「' + d.name + '」'} onConfirm={() => onDelete(d.id)} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={7}>
            <button onClick={onAdd}>＋ 新增辖区</button>
          </td>
        </tr>
      </tfoot>
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
  /** 点「定位」：地图页签把这一支部队移到画面中央。 */
  onLocate: (id: number) => void;
  /** 点「删除」（第二下）：引擎正停在这支部队断粮怎么办那一问上时会挡回来。 */
  onDelete: (id: number) => void;
}

export function UnitTable({ world, onEdit, onOrder, onPickDestination, pickingUnit, onLocate, onDelete }: UnitTableProps) {
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
          <th>地图</th>
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
                items={factionItems(world)}
                label="势力"
                onPick={(item) => onEdit(u.id, { faction: item.id })}
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
                <div className="dim small">
                  在地图上点一个据点作目的地；按住 Shift 点空白处挑一个野地坐标（Esc 或点空白处取消）
                </div>
              ) : null}
            </td>
            <td>
              <div className="row">
                <button onClick={() => onLocate(u.id)}>定位</button>
                <DeleteButton what={'部队「' + u.name + '」'} onConfirm={() => onDelete(u.id)} />
              </div>
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
  /** 点「删除」（第二下）：这条连接上有部队行军或扎营时会被挡回来。 */
  onDelete: (id: number) => void;
}

export function LinkTable({ world, onEdit, onDelete }: LinkTableProps) {
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
        {world.links.map((l) => {
          const a = world.sites.find((s) => s.id === l.a)?.name ?? String(l.a);
          const b = world.sites.find((s) => s.id === l.b)?.name ?? String(l.b);
          return (
            <tr key={l.id}>
              <td className="ro">
                {a}
                {' — '}
                {b}
                <DeleteButton what={'连接「' + a + ' — ' + b + '」'} onConfirm={() => onDelete(l.id)} />
              </td>
              <td className="ro">{Math.round(linkLength(world, l) * 10) / 10}</td>
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
          );
        })}
      </tbody>
    </table>
  );
}
