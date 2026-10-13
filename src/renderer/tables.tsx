// The four views of one switchable table: factions, sites, units, links.
// Anything the designer may edit is an input; derived values (position, order
// queue, the five totals on a faction row) stay read-only text.
// 每张表上方那一行是共用的一套：筛选（据点表有）、排序两个按钮、翻页那一组。
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Link, Order, Site, Terrain, Unit, World } from '../engine/types.ts';
import { colorRefusal, divisionName, factionColor, linkLength, normalizeColor, terrainLinks, terrainName } from '../engine/world.ts';
import { factionName, garrisonText, orderText, placeText, round1, round2, siteName } from './format.ts';
import {
  DEFAULT_SORT,
  isPageNumber,
  pageCount,
  pageRows,
  rowNumber,
  sortRows,
  tableRows,
} from './paging.ts';
import type { OnlyBranch, PageList, Row, Sort } from './paging.ts';

/**
 * 地貌那四个数各自的上下限、小数位与中文名。越界的写法一律挡回来（见 App 的 terrainRefusal），
 * 由界面把理由写进说明行，等 User 自己改一个数——不夹到边界。
 * 速度系数的下限是 0.01 而不是 0：0 或负数会让行军天数变成无穷，部队就永远走不到，不声不响地卡住。
 */
export const TERRAIN_RANGE: Record<
  'speed' | 'width' | 'defense' | 'food',
  { label: string; lo: number; hi: number; step: number }
> = {
  speed: { label: '行军速度系数', lo: 0.01, hi: 100, step: 0.05 },
  width: { label: '战场宽度', lo: 0, hi: 100000, step: 1 },
  defense: { label: '守方加成', lo: 0, hi: 100, step: 0.05 },
  food: { label: '粮草产出系数', lo: 0, hi: 100, step: 0.05 },
};

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
  value, min, max, step, label, title, whole, onCommit, onNote,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  title: string;
  /** 只收整数时传 true：小数也算写不回去，理由里写「整数」。 */
  whole?: boolean;
  onCommit: (v: number) => void;
  onNote: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(round1(value));
  const ok = (t: string) => inRange(t, min, max) && (whole !== true || Number.isInteger(Number(t)));
  const bad = draft !== null && !ok(draft);

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
        if (ok(t)) {
          onCommit(Number(t));
          return;
        }
        onNote(
          label + '只收 ' + String(min) + ' 到 ' + String(max) + ' 之间的' +
            (whole === true ? '整数' : '数') + '：' +
            (t.trim() === '' ? '格子还空着' : '「' + t + '」写不回去') + '。改一个数再写，别的不动。',
        );
      }}
      onBlur={() => {
        if (draft === null || ok(draft)) setDraft(null);
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
 * 每一张表上方那一行要的东西：当前页码、每页条数，以及三个回调。
 * 日志不排序，所以 sort 与 onSort 是可选的——那一行里只有页码与计数。
 */
export interface ListBarProps {
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onNote: (message: string) => void;
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  /**
   * 这一页的行按这一串编号摆（App 结算出来的那一份）。编辑期间它冻着不动，所以光标底下那一行不会跑；
   * 还没结算过、或者日志那一段没有顺序可言时，不传它就照当前的排序现算。
   */
  order?: number[];
}

/** 排序按钮：选中的那一个高亮并带一个箭头，再点一下就换方向。 */
function SortButton({
  text,
  by,
  sort,
  onSort,
}: {
  text: string;
  by: 'id' | 'name';
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const active = sort.key === by;
  return (
    <button
      className={active ? 'tab active' : 'tab'}
      title={active ? '再点一下改成倒序' : '按这一项排；再点一下就改成倒序'}
      onClick={() => onSort({ key: by, up: active ? !sort.up : true })}
    >
      {text}
      {active ? (sort.up ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

/**
 * 翻页那一组：可键入的页码格、「上一页」「下一页」与计数。页码格越界不写进去——
 * 字留在格子里并标红，等 User 自己改（与数字格同一条规矩）。
 * 条目少了、每页条数改小之后的「退到末页」由 App 做，不在这里：这里只管 User 敲的那一下。
 */
export function Pager({ total, what, bar }: { total: number; what: string; bar: ListBarProps }) {
  const pages = pageCount(total, bar.pageSize);
  // 草稿记着敲下去时停在第几页：页码从别处改了（跳页、退页）就把它丢掉，
  // 免得格子里留着一个与当前页无关的数。
  const [draft, setDraft] = useState<{ text: string; at: number } | null>(null);
  const kept = draft !== null && draft.at === bar.page ? draft : null;
  const text = kept === null ? String(bar.page) : kept.text;
  const bad = kept !== null && !isPageNumber(kept.text, pages);

  return (
    <span className="row pager push">
      <button onClick={() => bar.onPage(bar.page - 1)} disabled={bar.page <= 1}>
        上一页
      </button>
      <button onClick={() => bar.onPage(bar.page + 1)} disabled={bar.page >= pages}>
        下一页
      </button>
      <input
        className={bad ? 'bad' : undefined}
        value={text}
        title={'第几页：1 到 ' + String(pages) + ' 之间的整数，敲完按回车或点别处'}
        onChange={(e) => {
          const typed = e.target.value;
          setDraft({ text: typed, at: bar.page });
          if (isPageNumber(typed, pages)) {
            bar.onPage(Number(typed));
            return;
          }
          bar.onNote(
            what + '：页码只收 1 到 ' + String(pages) + ' 之间的整数：' +
              (typed.trim() === '' ? '格子还空着' : '「' + typed + '」跳不过去') +
              '。共 ' + String(total) + ' 条。',
          );
        }}
        onBlur={() => {
          if (kept === null || isPageNumber(kept.text, pages)) setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isPageNumber(text, pages)) bar.onPage(Number(text));
        }}
      />
      <span className="dim small">
        第 {bar.page} / {pages} 页 · 共 {total} 条
      </span>
    </span>
  );
}

/**
 * 表上方那一行：筛选、排序、翻页三样挤在一起。
 * 筛选那一块由调用方作为 children 传进来（只有据点表有），翻页那一组推到最右。
 */
function ListBar({
  total,
  what,
  bar,
  children,
}: {
  total: number;
  what: string;
  bar: ListBarProps;
  children?: ReactNode;
}) {
  const sort = bar.sort;
  const onSort = bar.onSort;
  return (
    <div className="row listbar">
      {children}
      {sort !== undefined && onSort !== undefined ? (
        <span className="row sortbar">
          <span className="dim small">排序</span>
          <SortButton text="按编号" by="id" sort={sort} onSort={onSort} />
          <SortButton text="按名称" by="name" sort={sort} onSort={onSort} />
        </span>
      ) : null}
      <Pager total={total} what={what} bar={bar} />
    </div>
  );
}

/**
 * 这一页要画的那几行（编号、名字与数值列）。顺序、每页几条与筛都在这一层算：
 * 顺序优先用 App 存下来的那一份（编辑期间它冻着，光标底下那一行因此不会跑），
 * 还没结算过时按当前的排序现算一遍；名字与数值列一律从现在的世界上取，所以格子里永远是新的值。
 */
function pageOfRows(
  world: World,
  list: PageList,
  only: OnlyBranch | null,
  bar: ListBarProps,
): { total: number; rows: Row[] } {
  const live = tableRows(world, list, only);
  const ids = bar.order ?? sortRows(live, bar.sort ?? DEFAULT_SORT).map((r) => r.id);
  const byId = new Map(live.map((r) => [r.id, r]));
  const rows: Row[] = [];
  for (const id of pageRows(ids, bar.page, bar.pageSize)) {
    const row = byId.get(id);
    if (row !== undefined) rows.push(row);
  }
  return { total: ids.length, rows };
}

/**
 * 同上，再把编号换回对象，两样成对给出来（表里要画整个对象的那几张用它）。
 * 成对是因为除了据点表与势力表，其余几张表的列都从对象上读，而排序用的列在 row 上。
 */
function pageOfObjects<T extends { id: number }>(
  world: World,
  list: PageList,
  only: OnlyBranch | null,
  bar: ListBarProps,
  byId: Map<number, T>,
): { total: number; page: { item: T; row: Row }[] } {
  const { total, rows } = pageOfRows(world, list, only, bar);
  const page: { item: T; row: Row }[] = [];
  for (const row of rows) {
    const item = byId.get(row.id);
    if (item !== undefined) page.push({ item, row });
  }
  return { total, page };
}

/**
 * 可点的表头：点一下按这一列排，再点一下换方向。数值列第一下是大的在前（与「按编号」「按名称」
 * 第一下升序不同）——看人口、兵力、钱粮时通常是想看最多的那几行。
 */
function SortTh({ text, col, bar, title }: { text: string; col: string; bar: ListBarProps; title?: string }) {
  const sort = bar.sort ?? DEFAULT_SORT;
  const onSort = bar.onSort;
  const active = sort.key === col;
  if (onSort === undefined) return <th title={title}>{text}</th>;
  return (
    <th title={title}>
      <button
        className={active ? 'on' : undefined}
        title="点一下按这一列排；再点一下换方向"
        onClick={() => onSort({ key: col, up: active ? !sort.up : false })}
      >
        {text}
        {active ? (sort.up ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}

/**
 * 颜色那一格：手打 `#rrggbb`，右边那个方块是系统取色器（它自己也显示当前的颜色）。
 * 写法不对就挡回来、字留在格子里标红，等 User 自己改——与数字格同一条规矩。
 */
function ColorCell({
  value, label, onCommit, onNote,
}: {
  value: string;
  label: string;
  onCommit: (color: string) => void;
  onNote: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const bad = draft !== null && colorRefusal(draft) !== null;
  // 库里存的一定是收下的那个写法；万一不是（手改过的库），系统取色器要一个能用的值。
  const picker = colorRefusal(value) === null ? value : '#000000';

  return (
    <div className="row colorswatch">
      <input
        className={bad ? 'bad' : undefined}
        value={text}
        title={label + '：#加六位十六进制，例如 #dc2626'}
        onChange={(e) => {
          const typed = e.target.value;
          setDraft(typed);
          const why = colorRefusal(typed);
          if (why === null) {
            onCommit(normalizeColor(typed));
            return;
          }
          onNote(why + '。改一个写法再写，别的不动。');
        }}
        onBlur={() => {
          if (draft === null || colorRefusal(draft) === null) setDraft(null);
        }}
      />
      <input
        type="color"
        value={picker}
        title="取色：打开系统取色器，选完把值填进左边那一格"
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  );
}

/** 候选列表里的一条。写回世界的是 id，名字只用来显示与过滤——
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
  /** 候选里名字前面那一小块颜色。现在只有势力有这个（它的颜色存在势力行上）。 */
  color?: string;
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
              {item.color === undefined ? null : (
                <span className="swatch" style={{ background: item.color }} />
              )}{' '}
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

/** 势力那一格的可挑条目：名字后面跟着编号，两个势力重名时靠编号分；每条带上它自己的颜色。 */
function factionItems(world: World): PickItem[] {
  return world.factions.map((f) => ({ id: f.id, name: f.name, tag: '#' + String(f.id), color: f.color }));
}

interface FactionTableProps {
  world: World;
  /** 表上方那一行：页码、每页条数、排序。 */
  bar: ListBarProps;
  /** 改名字：与别的表一样就地改，等月末那一次自动保存。 */
  onRename: (id: number, name: string) => void;
  /** 改颜色：写法不对由 App 挡回来，值一个也不动。 */
  onColor: (id: number, color: string) => void;
  /** 点「删除」（第二下）：名下还挂着据点或部队就会被挡回来，说明行写清楚还挂着多少。 */
  onDelete: (id: number) => void;
  /** 末尾那一行的「＋」：添一个新势力。 */
  onAdd: () => void;
}

/**
 * 势力表。名字能改，后面五列都是算出来的：名下有几座据点、几支部队，
 * 这些部队的兵力加总，以及这些据点自存的金钱与粮草（部队随身带着的那份不算在粮里）。
 * 表上方那一行按编号或名称排；每页几条由设置页签给。
 */
export function FactionTable({ world, bar, onRename, onColor, onDelete, onAdd }: FactionTableProps) {
  // 六个合计由引擎算（`factionTotals`，tableRows 里调），界面与自检用同一份算法。
  const { total, rows } = pageOfRows(world, 'factions', null, bar);
  // 颜色不在可排的数值列里（它不是数），所以那一格直接从势力行上取。
  const colors = new Map(world.factions.map((f) => [f.id, f.color]));

  return (
    <>
      <ListBar total={total} what="势力表" bar={bar} />
      <table>
      <thead>
        <tr>
          <th>名字</th>
          <th>颜色</th>
          <SortTh text="据点" col="sites" bar={bar} />
          <SortTh text="部队" col="units" bar={bar} />
          <SortTh text="兵力" col="troops" bar={bar} />
          <SortTh text="钱" col="money" bar={bar} />
          <SortTh text="粮" col="food" bar={bar} />
          <SortTh
            text="总人口"
            col="population"
            bar={bar}
            title="这个势力名下各据点的人口加起来（部队本身不带人口）。"
          />
          <th>删除</th>
        </tr>
      </thead>
      <tbody>
        {total === 0 ? (
          <tr>
            <td className="ro" colSpan={9}>
              还没有势力。按下面那一行的「＋」新建一个。
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.id} data-row={String(r.id)}>
              <td>
                <input value={r.name} onChange={(e) => onRename(r.id, e.target.value)} />
              </td>
              <td>
                <ColorCell
                  value={colors.get(r.id) ?? '#000000'}
                  label="颜色"
                  onCommit={(color) => onColor(r.id, color)}
                  onNote={bar.onNote}
                />
              </td>
              <td className="ro">{rowNumber(r, 'sites')}</td>
              <td className="ro">{rowNumber(r, 'units')}</td>
              <td className="ro">{round1(rowNumber(r, 'troops'))}</td>
              <td className="ro">{round1(rowNumber(r, 'money'))}</td>
              <td className="ro">{round1(rowNumber(r, 'food'))}</td>
              <td className="ro">{round1(rowNumber(r, 'population'))}</td>
              <td>
                <DeleteButton what={'势力「' + r.name + '」'} onConfirm={() => onDelete(r.id)} />
              </td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={9}>
            <button onClick={onAdd}>＋ 新增势力</button>
          </td>
        </tr>
      </tfoot>
      </table>
    </>
  );
}

interface SiteTableProps {
  world: World;
  /** 表上方那一行：页码、每页条数、排序；数字格写不回去的理由也走它的 onNote。 */
  bar: ListBarProps;
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
}

export function SiteTable({
  world,
  bar,
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
}: SiteTableProps) {
  if (world.sites.length === 0) return <p className="dim">还没有据点。</p>;

  // 「只看某一支」：挑据点就收它那一棵（所属据点往下），挑辖区就收它名下那一整片；选「全部」时是 null。
  // 筛选、排序与翻页都在 paging.ts 那一层做（见 tableRows），计数说的是筛完有多少座，不是这一页有多少行。
  const onlyBranch: OnlyBranch | null = only === null ? null : { kind: only.kind, id: only.id };
  const byId = new Map(world.sites.map((s) => [s.id, s]));
  const { total, page } = pageOfObjects(world, 'sites', onlyBranch, bar, byId);

  return (
    <>
      <ListBar total={total} what="据点表" bar={bar}>
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
              String(total) +
              ' 座'}
        </span>
      </ListBar>
      <table>
      <thead>
        <tr>
          <th>名称</th>
          <SortTh text="发展度" col="development" bar={bar} title="钱粮产出与 upkeep 按它算，地图上记号的大小也按它。" />
          <SortTh
            text="防御设施等级"
            col="fortification"
            bar={bar}
            title="现在只由 User 声明，不参与结算（战斗还没做）。"
          />
          <SortTh text="人口" col="population" bar={bar} />
          <SortTh text="民心" col="morale" bar={bar} />
          <SortTh text="稳定度" col="stability" bar={bar} />
          <SortTh text="金钱" col="money" bar={bar} />
          <SortTh text="粮草" col="food" bar={bar} />
          <th>势力</th>
          <th>所属据点</th>
          <th>层级</th>
          <th>辖区</th>
          <SortTh
            text="驻军"
            col="garrisonTroops"
            bar={bar}
            title="位置在这座据点的部队：支数 · 兵力合计。按这一列排用的是兵力合计。"
          />
          <SortTh text="坐标 x" col="x" bar={bar} />
          <SortTh text="坐标 y" col="y" bar={bar} />
          <th>地图</th>
        </tr>
      </thead>
      <tbody>
        {page.map(({ item: s }) => (
          <tr key={s.id} data-row={String(s.id)}>
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
                onNote={bar.onNote}
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
                onNote={bar.onNote}
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
              <div className="pickerswatch">
                <span
                  className="swatch"
                  style={{ background: factionColor(world, s.faction) ?? 'transparent' }}
                  title="这个势力在地图上的颜色"
                />
                <NamePicker
                  value={factionName(world, s.faction)}
                  items={factionItems(world)}
                  label="势力"
                  onPick={(item) => onEdit(s.id, { faction: item.id })}
                />
              </div>
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
  /** 表上方那一行：页码、每页条数、排序。 */
  bar: ListBarProps;
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
 * 「据点」那一列是直接挂在这个辖区名下的个数；「地盘据点」与钱、粮、兵力、人口
 * 四列按整棵子树算（含下级各级辖区名下的据点），兵力只数驻扎在地盘里的部队。
 */
export function DivisionTable({
  world,
  bar,
  onRename,
  onRank,
  onParent,
  onSeat,
  pickingSeat,
  onDelete,
  onAdd,
}: DivisionTableProps) {
  const byId = new Map(world.divisions.map((d) => [d.id, d]));
  const { total, page } = pageOfObjects(world, 'divisions', null, bar, byId);

  return (
    <>
      <ListBar total={total} what="辖区表" bar={bar} />
      <table>
      <thead>
        <tr>
          <th>名字</th>
          <SortTh text="等级" col="rank" bar={bar} title="等级只约束辖区之间：上级不低于它、下级不高于它。" />
          <th>上级辖区</th>
          <th>治所</th>
          <SortTh text="据点" col="sites" bar={bar} title="直接挂在这个辖区名下的据点个数。" />
          <SortTh
            text="地盘据点"
            col="areaSites"
            bar={bar}
            title="含各级下级辖区名下的据点——整棵子树里的据点数。"
          />
          <SortTh text="下级辖区" col="below" bar={bar} />
          <SortTh
            text="钱"
            col="money"
            bar={bar}
            title="地盘里各据点自存的金钱加起来（部队随身带的不算）。"
          />
          <SortTh text="粮" col="food" bar={bar} title="地盘里各据点自存的粮草加起来。" />
          <SortTh
            text="兵力"
            col="troops"
            bar={bar}
            title="只数驻扎在地盘里的部队，与据点表「驻军」那一列同一个口径；行军与野营的不算。"
          />
          <SortTh text="总人口" col="population" bar={bar} title="地盘里各据点的人口加起来。" />
          <th>删除</th>
        </tr>
      </thead>
      <tbody>
        {total === 0 ? (
          <tr>
            <td className="ro" colSpan={12}>
              还没有辖区。
            </td>
          </tr>
        ) : null}
        {page.map(({ item: d, row }) => {
          return (
            <tr key={d.id} data-row={String(d.id)}>
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
              <td className="ro">{rowNumber(row, 'sites')}</td>
              <td className="ro">{rowNumber(row, 'areaSites')}</td>
              <td className="ro">{rowNumber(row, 'below')}</td>
              <td className="ro">{round1(rowNumber(row, 'money'))}</td>
              <td className="ro">{round1(rowNumber(row, 'food'))}</td>
              <td className="ro">{round1(rowNumber(row, 'troops'))}</td>
              <td className="ro">{round1(rowNumber(row, 'population'))}</td>
              <td>
                <DeleteButton what={'辖区「' + d.name + '」'} onConfirm={() => onDelete(d.id)} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={12}>
            <button onClick={onAdd}>＋ 新增辖区</button>
          </td>
        </tr>
      </tfoot>
      </table>
    </>
  );
}

interface UnitTableProps {
  world: World;
  /** 表上方那一行：页码、每页条数、排序。 */
  bar: ListBarProps;
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

export function UnitTable({ world, bar, onEdit, onOrder, onPickDestination, pickingUnit, onLocate, onDelete }: UnitTableProps) {
  if (world.units.length === 0) return <p className="dim">还没有部队。</p>;

  const byId = new Map(world.units.map((u) => [u.id, u]));
  const { total, page } = pageOfObjects(world, 'units', null, bar, byId);

  return (
    <>
      <ListBar total={total} what="部队表" bar={bar} />
      <table>
      <thead>
        <tr>
          <th>名称</th>
          <th>势力</th>
          <SortTh text="兵力" col="troops" bar={bar} />
          <SortTh text="训练度" col="training" bar={bar} />
          <SortTh text="组织度" col="organization" bar={bar} />
          <th>位置</th>
          <SortTh text="随身粮草" col="carriedFood" bar={bar} />
          <th>命令</th>
          <th>地图</th>
        </tr>
      </thead>
      <tbody>
        {page.map(({ item: u }) => (
          <tr key={u.id} data-row={String(u.id)}>
            <td>
              <input value={u.name} onChange={(e) => onEdit(u.id, { name: e.target.value })} />
            </td>
            <td>
              <div className="pickerswatch">
                <span
                  className="swatch"
                  style={{ background: factionColor(world, u.faction) ?? 'transparent' }}
                  title="这个势力在地图上的颜色"
                />
                <NamePicker
                  value={factionName(world, u.faction)}
                  items={factionItems(world)}
                  label="势力"
                  onPick={(item) => onEdit(u.id, { faction: item.id })}
                />
              </div>
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
    </>
  );
}

interface LinkTableProps {
  world: World;
  /** 表上方那一行：页码、每页条数、排序（连接的名字是「A 城 — B 城」）。 */
  bar: ListBarProps;
  onEdit: (id: number, patch: Partial<Link>) => void;
  /** 点「删除」（第二下）：这条连接上有部队行军或扎营时会被挡回来。 */
  onDelete: (id: number) => void;
}

export function LinkTable({ world, bar, onEdit, onDelete }: LinkTableProps) {
  if (world.links.length === 0) return <p className="dim">还没有连接。</p>;

  // 连接的名字是「A 城 — B 城」（tableRows 里取的），所以「按名称」排的就是它。
  const byId = new Map(world.links.map((l) => [l.id, l]));
  const { total, page } = pageOfObjects(world, 'links', null, bar, byId);

  return (
    <>
      <ListBar total={total} what="连接表" bar={bar} />
      <table>
      <thead>
        <tr>
          <th>两端</th>
          <SortTh text="长度" col="length" bar={bar} title="两端直线距离 × 绕行系数。" />
          <SortTh text="绕行系数" col="detour" bar={bar} />
          <th>地貌</th>
        </tr>
      </thead>
      <tbody>
        {page.map(({ item: l }) => {
          const a = world.sites.find((s) => s.id === l.a)?.name ?? String(l.a);
          const b = world.sites.find((s) => s.id === l.b)?.name ?? String(l.b);
          return (
            <tr key={l.id} data-row={String(l.id)}>
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
                <NamePicker
                  value={l.terrain === null ? '（未填）' : terrainName(world, l.terrain)}
                  items={[
                    { id: 0, name: '（未填）' },
                    ...world.terrains.map((t) => ({ id: t.id, name: t.name, tag: '#' + String(t.id) })),
                  ]}
                  label="地貌"
                  emptyPick={{ id: 0, name: '（未填）' }}
                  onPick={(item) => onEdit(l.id, { terrain: item.id === 0 ? null : item.id })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}

interface TerrainTableProps {
  world: World;
  /** 表上方那一行：页码、每页条数、排序；数字格写不回去的理由也走它的 onNote。 */
  bar: ListBarProps;
  onEdit: (id: number, patch: Partial<Terrain>) => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
}

/**
 * 地貌表：一档一行，名字与四个数都由 User 自己填，想细分就多加几行。
 * 「用它的连接」是算出来的；有连接指着它就不许删（由 App 挡回来）。
 */
export function TerrainTable({ world, bar, onEdit, onDelete, onAdd }: TerrainTableProps) {
  const byId = new Map(world.terrains.map((t) => [t.id, t]));
  const { total, page } = pageOfObjects(world, 'terrains', null, bar, byId);

  return (
    <>
      <ListBar total={total} what="地貌表" bar={bar} />
      <table>
      <thead>
        <tr>
          <th>名字</th>
          <SortTh
            text="行军速度系数"
            col="speed"
            bar={bar}
            title="平原 1、山地 0.55 这一类，越小越难走。下限 0.01——填 0 或负数会让行军天数变成无穷。"
          />
          <SortTh text="战场宽度" col="width" bar={bar} title="战斗还没做，眼下没有读者，先把数填着。" />
          <SortTh text="守方加成" col="defense" bar={bar} title="1 表示不加成。战斗还没做，眼下没有读者。" />
          <SortTh text="粮草产出系数" col="food" bar={bar} title="1 表示不加成。按地貌算粮草那一条还没做，眼下没有读者。" />
          <th>用它的连接</th>
          <th>删除</th>
        </tr>
      </thead>
      <tbody>
        {page.map(({ item: t }) => (
          <tr key={t.id} data-row={String(t.id)}>
            <td>
              <input value={t.name} onChange={(e) => onEdit(t.id, { name: e.target.value })} />
            </td>
            <td>
              <NumberCell
                value={t.speed}
                min={TERRAIN_RANGE.speed.lo}
                max={TERRAIN_RANGE.speed.hi}
                step={TERRAIN_RANGE.speed.step}
                label={TERRAIN_RANGE.speed.label}
                title="行军速度系数：平原 1、山地 0.55 这一类，越小越难走。下限 0.01——填 0 或负数会让行军天数变成无穷，部队就永远走不到。"
                onCommit={(v) => onEdit(t.id, { speed: v })}
                onNote={bar.onNote}
              />
            </td>
            <td>
              <NumberCell
                value={t.width}
                min={TERRAIN_RANGE.width.lo}
                max={TERRAIN_RANGE.width.hi}
                step={TERRAIN_RANGE.width.step}
                label={TERRAIN_RANGE.width.label}
                title="战场宽度。战斗还没做，眼下没有读者，先把数填着。"
                onCommit={(v) => onEdit(t.id, { width: v })}
                onNote={bar.onNote}
              />
            </td>
            <td>
              <NumberCell
                value={t.defense}
                min={TERRAIN_RANGE.defense.lo}
                max={TERRAIN_RANGE.defense.hi}
                step={TERRAIN_RANGE.defense.step}
                label={TERRAIN_RANGE.defense.label}
                title="守方加成，1 表示不加成。战斗还没做，眼下没有读者。"
                onCommit={(v) => onEdit(t.id, { defense: v })}
                onNote={bar.onNote}
              />
            </td>
            <td>
              <NumberCell
                value={t.food}
                min={TERRAIN_RANGE.food.lo}
                max={TERRAIN_RANGE.food.hi}
                step={TERRAIN_RANGE.food.step}
                label={TERRAIN_RANGE.food.label}
                title="粮草产出系数，1 表示不加成。按地貌算粮草那一条还没做，眼下没有读者。"
                onCommit={(v) => onEdit(t.id, { food: v })}
                onNote={bar.onNote}
              />
            </td>
            <td className="ro">{terrainLinks(world, t.id)} 条</td>
            <td>
              <div className="row">
                <span className="dim small">#{t.id}</span>
                <DeleteButton what={'地貌「' + t.name + '」'} onConfirm={() => onDelete(t.id)} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={7}>
            <button onClick={onAdd}>＋ 新增地貌</button>
          </td>
        </tr>
      </tfoot>
      </table>
    </>
  );
}
