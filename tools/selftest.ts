// 纯逻辑自检：不碰界面、不碰数据库，直接用 node 跑。
// 用法：node tools/selftest.ts
import { answerAsk, askOffroadFactor } from '../src/engine/ask.ts';
import { DEFAULT_PARAMS } from '../src/engine/params.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { dayOfMonth, isMonthEnd, marchDays, month, tickDay, year } from '../src/engine/tick.ts';
import type { Place, Unit } from '../src/engine/types.ts';
import {
  emptyListStates,
  isPageNumber,
  LIST_LABEL,
  newestFirst,
  PAGE_LISTS,
  pageCount,
  pageOfRow,
  pageRows,
  sortRows,
  tableRows,
} from '../src/renderer/paging.ts';
import {
  addDivision,
  addTerrain,
  demoWorld,
  destinationName,
  divisionRankRefusal,
  divisionSites,
  divisionWouldCycle,
  levelRefusal,
  linkLength,
  linkTerrain,
  parentLevelRefusal,
  parentWouldCycle,
  seatRefusal,
  siteBranch,
  siteDivisionNote,
  siteGarrison,
  siteLevels,
  terrainById,
  terrainLinks,
  terrainName,
  unitPoint,
  worldFromJson,
  worldToJson,
} from '../src/engine/world.ts';

let bad = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!ok) bad += 1;
}

/**
 * 读一眼部队的位置。包一层函数是必要的：TS 会把 `u.place` 钉在刚赋的那个字面量那一档上，
 * 于是推进几天之后再去看 kind，它会报「这两种没有重叠」。
 */
function placeOf(u: Unit): Place {
  return u.place;
}

const p = DEFAULT_PARAMS;

console.log('== 世界与对象 ==');
const w = demoWorld();
check('据点两座', w.sites.length === 2, String(w.sites.length));
check('连接一条', w.links.length === 1);
check('部队一支', w.units.length === 1);
check('势力两个', w.factions.length === 2);

const wA = w.sites[0]!;
const wB = w.sites[1]!;
const wL = w.links[0]!;
check(
  '据点的发展度与防御设施等级各自独立',
  wA.development === 60 && wA.fortification === 2 && wB.development === 40 && wB.fortification === 0,
  String(wA.development) + '／' + String(wA.fortification) + '、' + String(wB.development) + '／' + String(wB.fortification),
);
check(
  '连接的两端就是那两座城',
  (wL.a === wA.id && wL.b === wB.id) || (wL.a === wB.id && wL.b === wA.id),
);

// 上级：自己不能当自己的上级；挂上去之后再反过来，就会连成一个环。
const wp = demoWorld();
const pA = wp.sites[0]!;
const pB = wp.sites[1]!;
check('自己不能当自己的上级', parentWouldCycle(wp, pA.id, pA.id));
check('A 挂到 B 下面不成环', !parentWouldCycle(wp, pA.id, pB.id));
pA.parent = pB.id;
check('挂上之后再反过来就成环', parentWouldCycle(wp, pB.id, pA.id));

// 层级与「这一支」：没有下级是第 0 层；有下级的按下级里最高的那一档加一。
const wl = demoWorld();
const lA = wl.sites[0]!;
const lB = wl.sites[1]!;
const lv0 = siteLevels(wl);
check('两座都没有下级时都是第 0 层', lv0.get(lA.id) === 0 && lv0.get(lB.id) === 0);
lA.parent = lB.id;
const lv1 = siteLevels(wl);
check('A 挂到 B 下面之后 B 是第 1 层、A 还是第 0 层', lv1.get(lB.id) === 1 && lv1.get(lA.id) === 0);
const br = siteBranch(wl, lB.id);
check('B 这一支收进 B 与 A 两座', br.size === 2 && br.has(lA.id) && br.has(lB.id));
check('A 这一支只有它自己', siteBranch(wl, lA.id).size === 1);

// 层级由 User 声明，系统只守一条：上级的层级不低于下级的层级——差多少不管，平级也行。
const wr = demoWorld();
const rA = wr.sites[0]!;
const rB = wr.sites[1]!;
check('层级都是 0 时，改挂放行', parentLevelRefusal(wr, rA.id, rB.id) === null);
rA.level = 2;
check('候选上级比它低，改挂挡回来', parentLevelRefusal(wr, rA.id, rB.id) !== null);
rB.level = 2;
check('与候选上级同级放行', parentLevelRefusal(wr, rA.id, rB.id) === null);
rA.parent = rB.id;
check('层级比上级高，改层级挡回来', levelRefusal(wr, rA.id, 3) !== null);
check('与上级同级，改层级放行', levelRefusal(wr, rA.id, 2) === null);
check('层级比下级低挡回来，与下级同级放行', levelRefusal(wr, rB.id, 1) !== null && levelRefusal(wr, rB.id, 2) === null);

// 辖区：等级只约束辖区之间；治所必须落在自己的整棵子树里。
const wd = demoWorld();
const sA = wd.sites[0]!;
const sB = wd.sites[1]!;
const d1 = addDivision(wd, '辽东郡', 1);
const d2 = addDivision(wd, '幽州', 3);
check('新辖区是一个空壳：没有上级、没有治所', d1.parent === null && d1.seat === null);
d1.parent = d2.id;
check('等级高过上级时挡回来', divisionRankRefusal(wd, d1.id, 4) !== null);
check('不低于上级就放行（平级也行）', divisionRankRefusal(wd, d1.id, 3) === null);
check('辖区之间也挡环', divisionWouldCycle(wd, d2.id, d1.id));
sA.division = d2.id;
sB.division = d1.id;
check('地盘把下级辖区名下的据点也收进来', divisionSites(wd, d2.id).size === 2);
check('治所不在自己地盘里就挡回来', seatRefusal(wd, d1.id, sA.id) !== null && seatRefusal(wd, d1.id, sB.id) === null);
sA.level = 4;
check(
  '据点层数高过辖区等级时只提醒不挡',
  siteDivisionNote(wd, sA.id, d2.id) !== null && siteDivisionNote(wd, sB.id, d1.id) === null,
);

console.log('\n== 日历 ==');
const w2 = demoWorld();
tickDay(w2, p);
check('推进一天后 day 是 1', w2.day === 1);
check('第 1 天是 1 年 1 月 1 日', dayOfMonth(w2, p) === 1 && month(w2, p) === 1 && year(w2, p) === 1);
for (let i = 1; i < p.daysPerMonth; i += 1) tickDay(w2, p);
check('第 ' + p.daysPerMonth + ' 天是月末', isMonthEnd(w2, p), 'day=' + w2.day);
tickDay(w2, p);
check('第 ' + (p.daysPerMonth + 1) + ' 天不是月末', !isMonthEnd(w2, p) && dayOfMonth(w2, p) === 1);

console.log('\n== 行军 ==');
const w3 = demoWorld();
const u3 = w3.units[0]!;
const bId = w3.sites[1]!.id;
const length = linkLength(w3, wL);
check('长度 = 两端直线距离 × 绕行系数', Math.round(length) === 2062, Math.round(length) + ' 地图单位');
const days = marchDays(u3, length, 1, p);
check('行军天数是有限正数', Number.isFinite(days) && days > 1, days.toFixed(2) + ' 天');

let departed = -1;
let arrived = -1;
for (let d = 0; d < 60; d += 1) {
  tickDay(w3, p);
  if (departed < 0 && u3.place.kind === 'march') departed = w3.day;
  if (arrived < 0 && u3.place.kind === 'site' && u3.place.site === bId) arrived = w3.day;
}
check('部队出发了', departed === 1, '第 ' + departed + ' 天');
check('部队到达 B 城', arrived > 0, '第 ' + arrived + ' 天');
check(
  '在路上花的天数与公式相符',
  Math.abs(arrived - departed + 1 - days) <= 1.5,
  '实际 ' + (arrived - departed + 1) + ' 天，公式 ' + days.toFixed(2) + ' 天',
);
check('到达后队列清空', u3.queue.length === 0);

console.log('\n== 月层结算 ==');
const w4 = demoWorld();
const a4 = w4.sites[0]!;
const money0 = a4.money;
const food0 = a4.food;
for (let i = 0; i < p.daysPerMonth; i += 1) tickDay(w4, p);
check('月末结算写进日志', w4.log.some((line) => line.includes('月末结算完毕')));
check('金钱按公式增加', a4.money === money0 + 45, money0 + ' → ' + a4.money);
check('粮草按公式增加', a4.food === food0 + 90, food0 + ' → ' + a4.food);
check('民心已在基准上，不动', a4.morale === 70);
check('人口不变（民心等于基准）', a4.population === 9000);

console.log('\n== 随身粮草 ==');
const w5 = demoWorld();
const u5 = w5.units[0]!;
const food5 = u5.carriedFood;
tickDay(w5, p);
check('粮草按天扣', u5.carriedFood < food5, food5 + ' → ' + u5.carriedFood.toFixed(3));

console.log('\n== 缺数据就问 ==');
const w6 = demoWorld();
w6.links[0]!.terrain = null;
const u6 = w6.units[0]!;
tickDay(w6, p);
check(
  '停在问询上，命令还在队列里',
  w6.pending !== null && u6.queue.length === 1 && u6.place.kind === 'site',
);
check('问的是那条连接', w6.pending?.target.kind === 'linkTerrain');
check(
  '选项就是地貌表里那几行',
  w6.pending?.options.length === w6.terrains.length && w6.pending?.options.length === 5,
  (w6.pending?.options ?? []).map((o) => o.label).join('、'),
);
const dayAtAsk = w6.day;
tickDay(w6, p);
check('没回答之前时间轴不走', w6.day === dayAtAsk, '第 ' + w6.day + ' 天');
check('乱填的值不写回', !answerAsk(w6, 'swamp') && w6.pending !== null);
// 山地是第二行（编号 2）：答案给的是编号，不是名字。
check('合法的编号写回世界', answerAsk(w6, '2') && w6.links[0]!.terrain === 2, String(w6.links[0]!.terrain));
check('答完 pending 清空', w6.pending === null);
check('答完写了日志', w6.log.some((line) => line.includes('地貌填成 丘陵')));
tickDay(w6, p);
check('答完就能出发', u6.place.kind === 'march', '第 ' + w6.day + ' 天');

console.log('\n== 地貌表 ==');
const wt = demoWorld();
check(
  '开头那五档与旧的名字、速度系数一致',
  wt.terrains.map((t) => t.name + ':' + String(t.speed)).join('、') ===
    '平原:1、丘陵:0.8、山地:0.55、水网:0.7、隘口:0.6',
  wt.terrains.map((t) => t.name).join('、'),
);
check('连接指的就是平原那一行的编号', wt.links[0]!.terrain === wt.terrains[0]!.id);
const hill = terrainById(wt, 2);
check('按编号取得到那一档', hill !== undefined && hill.name === '丘陵');
check('取不到时用编号顶上', terrainName(wt, 99) === '地貌 99', terrainName(wt, 99));
check('平原那一行有一条连接指着', terrainLinks(wt, 1) === 1 && terrainLinks(wt, 2) === 0);
check('没填的连接算「未填」', linkTerrain(wt, { ...wt.links[0]!, terrain: null }) === undefined);
check('编号指不到任何一档也算「未填」', linkTerrain(wt, { ...wt.links[0]!, terrain: 99 }) === undefined);

// 行里那个速度系数真在算：把它改成一半，同一段路的天数就翻一倍。
const wtSlow = demoWorld();
wtSlow.terrains[0]!.speed = 0.5;
wtSlow.units[0]!.place = { kind: 'camp', x: 0, y: 0 };
wtSlow.units[0]!.queue = [{ kind: 'march', to: wtSlow.sites[1]!.id }];
const daysFast = marchDays(wt.units[0]!, linkLength(wt, wt.links[0]!), wt.terrains[0]!.speed, p);
const daysSlow = marchDays(wtSlow.units[0]!, linkLength(wtSlow, wtSlow.links[0]!), wtSlow.terrains[0]!.speed, p);
check('系数减半，天数翻倍', Math.abs(daysSlow - daysFast * 2) < 1e-9, daysFast.toFixed(2) + ' → ' + daysSlow.toFixed(2));

// 地貌表是 User 自己增改的：加一行，下一个问题里就多一个候选。
const wt2 = demoWorld();
const marsh = addTerrain(wt2, '沼泽', 0.3, 60, 0.8, 0.5);
wt2.links[0]!.terrain = null;
tickDay(wt2, p);
check(
  '新加的那一档也在候选里',
  wt2.pending?.options.length === 6 && wt2.pending.options.some((o) => o.label === '沼泽'),
  (wt2.pending?.options ?? []).map((o) => o.label).join('、'),
);
check('答新加的那一档也认', answerAsk(wt2, String(marsh.id)) && wt2.links[0]!.terrain === marsh.id);

console.log('\n== 断粮就问 ==');
const w7 = demoWorld();
const u7 = w7.units[0]!;
u7.carriedFood = 10; // 500 兵每天吃 0.833，十来天见底
let sawAsk = -1;
for (let d = 0; d < 40 && sawAsk < 0; d += 1) {
  tickDay(w7, p);
  if (w7.pending) sawAsk = w7.day;
}
check('粮草吃完了就停下来问', sawAsk > 0 && w7.pending?.target.kind === 'unitFoodPolicy', '第 ' + sawAsk + ' 天');
check('兜里是 0，不是负数', u7.carriedFood === 0);
const dayAtFoodAsk = w7.day;
tickDay(w7, p);
check('没回答之前时间轴不走', w7.day === dayAtFoodAsk);
check('答完记住了', answerAsk(w7, 'forage') && u7.foodPolicy === 'forage');
tickDay(w7, p);
check('回答之后不再问', w7.pending === null && w7.day === dayAtFoodAsk + 1);
tickDay(w7, p);
check('没问题可答时 answerAsk 返回 false', !answerAsk(w7, 'forage'));
check(
  '断粮那行只记一次',
  w7.log.filter((line) => line.includes('断粮的处理方式定为')).length === 1,
  String(w7.log.filter((line) => line.includes('断粮的处理方式定为')).length),
);

console.log('\n== 据点之外的位置 ==');
const w8 = demoWorld();
const u8 = w8.units[0]!;
const s8a = w8.sites[0]!;
const s8b = w8.sites[1]!;
const pt8 = unitPoint(w8, u8);
check('驻军算出来的位置就是那座据点的坐标', pt8 !== null && pt8.x === s8a.x && pt8.y === s8a.y);
const g8a = siteGarrison(w8, s8a.id);
const g8b = siteGarrison(w8, s8b.id);
check('A 城一支驻军、兵力 500', g8a.count === 1 && g8a.troops === 500, String(g8a.count) + ' 支 / ' + String(g8a.troops));
check('B 城没有驻军', g8b.count === 0 && g8b.troops === 0);
check(
  '目的地怎么写：据点写名字、坐标写两位小数',
  destinationName(w8, s8b.id, 0, 0) === s8b.name &&
    destinationName(w8, null, 1000.456, 2000) === '（1000.46, 2000）',
  destinationName(w8, null, 1000.456, 2000),
);

// 停在据点之外的某一点：这就是「扎营」，队列在这里会启动。
const w9 = demoWorld();
const u9 = w9.units[0]!;
u9.place = { kind: 'camp', x: 1500, y: 1500 };
u9.queue = [{ kind: 'offroad', toSite: null, toX: 2000, toY: 1000, factor: 0.5 }];
const pt9 = unitPoint(w9, u9);
check('停在野地里的坐标就是存下来的那一个', pt9 !== null && pt9.x === 1500 && pt9.y === 1500);
tickDay(w9, p);
check('扎营时队列会启动', placeOf(u9).kind === 'offroad', placeOf(u9).kind);
check(
  '出发那行把倍率写进去',
  w9.log.some((line) => line.includes('离开道路') && line.includes('0.5')),
  w9.log[w9.log.length - 1] ?? '',
);
let days9 = 0;
while (placeOf(u9).kind === 'offroad' && days9 < 400) {
  tickDay(w9, p);
  days9 += 1;
}
const end9 = placeOf(u9);
check(
  '走到那个坐标就停住扎营',
  end9.kind === 'camp' && end9.x === 2000 && end9.y === 1000,
  end9.kind,
);
check('到达之后队列清空', u9.queue.length === 0);

// 倍率就是道路的几成：同样一段路，倍率小的走得慢。
function afterOneDay(factor: number): number {
  const w = demoWorld();
  const u = w.units[0]!;
  u.place = { kind: 'camp', x: 0, y: 0 };
  u.queue = [{ kind: 'offroad', toSite: null, toX: 1000, toY: 0, factor }];
  tickDay(w, p);
  const now = placeOf(u);
  return now.kind === 'offroad' ? now.t : -1;
}
const t10 = afterOneDay(0.4);
const t11 = afterOneDay(1);
check('倍率越小走得越慢', t10 > 0 && t10 < t11, t10.toFixed(3) + ' < ' + t11.toFixed(3));

// 目的地是一座据点时就进城；从城里出发时起点就是那座城。
const w12 = demoWorld();
const u12 = w12.units[0]!;
const s12b = w12.sites[1]!;
u12.place = { kind: 'camp', x: s12b.x + 500, y: s12b.y };
u12.queue = [{ kind: 'offroad', toSite: s12b.id, toX: s12b.x, toY: s12b.y, factor: 1 }];
let n12 = 0;
while (placeOf(u12).kind !== 'site' && n12 < 400) {
  tickDay(w12, p);
  n12 += 1;
}
const end12 = placeOf(u12);
check('离开道路走到据点就进城', end12.kind === 'site' && end12.site === s12b.id, end12.kind);

const w13 = demoWorld();
const u13 = w13.units[0]!;
const s13a = w13.sites[0]!;
u13.queue = [{ kind: 'offroad', toSite: null, toX: s13a.x + 600, toY: s13a.y, factor: 0.2 }];
tickDay(w13, p);
const off13 = placeOf(u13);
check(
  '从城里也能离开道路，起点就是那座城',
  off13.kind === 'offroad' && off13.fromX === s13a.x && off13.fromY === s13a.y,
  off13.kind,
);

// 行军中不接新命令：队列原样留着，人接着走。
const w14 = demoWorld();
const u14 = w14.units[0]!;
u14.place = { kind: 'offroad', fromX: 0, fromY: 0, toX: 1000, toY: 0, toSite: null, t: 0, factor: 1 };
u14.queue = [{ kind: 'offroad', toSite: null, toX: 0, toY: 500, factor: 1 }];
tickDay(w14, p);
const walk14 = placeOf(u14);
check(
  '行军中不启动队列',
  u14.queue.length === 1 && walk14.kind === 'offroad' && walk14.t > 0,
  walk14.kind === 'offroad' ? walk14.t.toFixed(3) : walk14.kind,
);

// 在据点之外想去据点、命令上又没带倍率：作废并记一行，不替 User 挑一个数。
const w15 = demoWorld();
const u15 = w15.units[0]!;
u15.place = { kind: 'camp', x: 10, y: 10 };
u15.queue = [{ kind: 'march', to: w15.sites[1]!.id }];
tickDay(w15, p);
check(
  '在据点之外要去据点、没有倍率：作废并记一行',
  u15.queue.length === 0 && u15.place.kind === 'camp' && w15.log.some((line) => line.includes('得先离开道路')),
  w15.log[w15.log.length - 1] ?? '',
);

// 离开道路那一问：空串、乱填、零与负数都不写回；填一个数就把队列换成那一条命令。
const w16 = demoWorld();
const u16 = w16.units[0]!;
const s16b = w16.sites[1]!;
w16.pending = askOffroadFactor('甲队 要离开道路', u16, { toSite: s16b.id, toX: s16b.x, toY: s16b.y });
check('问的是离开道路那一趟', w16.pending.target.kind === 'unitOffroadOrder');
check(
  '空的、乱的、零与负数都写不回去',
  !answerAsk(w16, '') && !answerAsk(w16, '   ') && !answerAsk(w16, 'abc') &&
    !answerAsk(w16, '0') && !answerAsk(w16, '-2'),
);
check('写不回去时 pending 还挂着', w16.pending !== null);
check('填一个数就写回，队列换成那一条命令', answerAsk(w16, '0.4') && u16.queue.length === 1);
const o16 = u16.queue[0]!;
check('倍率落在命令上', o16.kind === 'offroad' && o16.factor === 0.4, o16.kind);
check('目的地记得是那座据点', o16.kind === 'offroad' && o16.toSite === s16b.id);
check('答完写了日志', w16.log.some((line) => line.includes('领命离开道路')));
check('答完 pending 清空', w16.pending === null);

console.log('\n== 翻页与排序 ==');
// 六张表与日志共用 `src/renderer/paging.ts` 那一层。它是纯函数，所以在这里跑；
// 页面那一头只负责把页码与排序按住，把每页几条从参数表里读出来。
const anyWorld = demoWorld();
const siteRows = tableRows(anyWorld, 'sites', null);
check('据点表两行，顺序就是世界里的顺序', siteRows.length === 2 && siteRows[0]!.name === 'A 城', siteRows.map((r) => r.name).join('、'));
check('连接那一行的名字是「A 城 — B 城」', tableRows(anyWorld, 'links', null)[0]!.name === 'A 城 — B 城', tableRows(anyWorld, 'links', null)[0]!.name);
check('六张表各自的名字都在', PAGE_LISTS.length === 6 && LIST_LABEL.sites === '据点表' && LIST_LABEL.terrains === '地貌表');

check('按编号升序：还是 A 城在前', sortRows(siteRows, { key: 'id', up: true }, (r) => r.name)[0]!.name === 'A 城');
check('按编号降序：B 城在前', sortRows(siteRows, { key: 'id', up: false }, (r) => r.name)[0]!.name === 'B 城');
// 中文按拼音比。按码点比的话「吴」（U+5434）会跑到「蜀」（U+8700）前面，拼音顺序是 蜀 < 魏 < 吴。
const three = [
  { id: 1, name: '魏' },
  { id: 2, name: '蜀' },
  { id: 3, name: '吴' },
];
const byName = sortRows(three, { key: 'name', up: true }, (r) => r.name).map((r) => r.name).join('');
check('按名称排走拼音：蜀 魏 吴', byName === '蜀魏吴', byName);
const byNameDown = sortRows(three, { key: 'name', up: false }, (r) => r.name).map((r) => r.name).join('');
check('按名称倒序：吴 魏 蜀', byNameDown === '吴魏蜀', byNameDown);
// 同名时按编号兜底，翻页时顺序不会跳。
const twins = [
  { id: 7, name: '城' },
  { id: 3, name: '城' },
];
check('同名时按编号兜底', sortRows(twins, { key: 'name', up: true }, (r) => r.name).map((r) => r.id).join() === '3,7');
check('同名倒序也按编号兜底', sortRows(twins, { key: 'name', up: false }, (r) => r.name).map((r) => r.id).join() === '7,3');
check('排完不动原来那个数组', twins[0]!.id === 7 && twins[1]!.id === 3);

// 分页与每页条数。
const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: '据点 ' + String(i + 1) }));
check('120 条、每页 50 条是 3 页', pageCount(many.length, 50) === 3, String(pageCount(many.length, 50)));
check('第 1 页是前 50 条', pageRows(many, 1, 50).length === 50 && pageRows(many, 1, 50)[0]!.id === 1);
check('第 3 页是剩下那 20 条', pageRows(many, 3, 50).length === 20 && pageRows(many, 3, 50)[0]!.id === 101);
check('一条都没有也算一页', pageCount(0, 50) === 1 && pageRows([], 1, 50).length === 0);
check('每页填 0 或负数时按一条算', pageRows(many, 1, 0).length === 1 && pageCount(120, -5) === 120);
check('页码格只收范围内的整数', isPageNumber('2', 3) && !isPageNumber('0', 3) && !isPageNumber('4', 3) && !isPageNumber('1.5', 3) && !isPageNumber('', 3));

// 新增之后跳到那一行：它在排好序的列表里落在第几页。
check('第 60 条落在第 2 页', pageOfRow(many, 60, 50) === 2);
check('第 101 条落在第 3 页', pageOfRow(many, 101, 50) === 3);
check('被筛掉的行返回 0', pageOfRow(many, 999, 50) === 0);

// 据点表的「只看某一支」：这里算出来的行数与表里画的行数是同一个来源。
const wBranch = demoWorld();
const bA = wBranch.sites[0]!;
const bB = wBranch.sites[1]!;
bA.parent = bB.id;
check('只看 B 那一支：两座', tableRows(wBranch, 'sites', { kind: 'site', id: bB.id }).length === 2);
check('只看 A 那一支：一座', tableRows(wBranch, 'sites', { kind: 'site', id: bA.id }).length === 1);

// 日志新的在上：第 1 页是最新的那几条，页内也是新的在上。
const lines = ['1', '2', '3', '4', '5', '6', '7'];
check('日志第 1 页是最新那三条，新的在上', newestFirst(lines, 1, 3).join('') === '765', newestFirst(lines, 1, 3).join(''));
check('日志第 2 页接着往前', newestFirst(lines, 2, 3).join('') === '432');
check('日志最后一页只剩一条', newestFirst(lines, 3, 3).join('') === '1');
check('日志页码超出时给空数组', newestFirst(lines, 9, 3).length === 0);

// 开窗口时每张表都在第 1 页、按编号升序。
const listStates = emptyListStates();
check(
  '默认每张表都在第 1 页、按编号升序',
  PAGE_LISTS.every((l) => listStates[l].page === 1 && listStates[l].sort.key === 'id' && listStates[l].sort.up),
);

console.log('\n== 存档往返 ==');
const text = worldToJson(w4);
const back = worldFromJson(text);
check('JSON 往返一字不差', worldToJson(back) === text, text.length + ' 字节');

console.log('\n== 随机数 ==');
const r1 = mulberry32(7);
const r2 = mulberry32(7);
const r3 = mulberry32(8);
const s1 = [r1(), r1(), r1()].join(',');
const s2 = [r2(), r2(), r2()].join(',');
const s3 = [r3(), r3(), r3()].join(',');
check('同种子同一串', s1 === s2);
check('不同种子不同串', s1 !== s3);
check('取值落在 0 与 1 之间', s1.split(',').every((x) => Number(x) >= 0 && Number(x) < 1));

console.log(bad ? '\n' + bad + ' 项未通过' : '\n全部通过');
process.exit(bad ? 1 : 0);
