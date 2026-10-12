// 纯逻辑自检：不碰界面、不碰数据库，直接用 node 跑。
// 用法：node tools/selftest.ts
import { answerAsk } from '../src/engine/ask.ts';
import { DEFAULT_PARAMS } from '../src/engine/params.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { dayOfMonth, isMonthEnd, marchDays, month, tickDay, year } from '../src/engine/tick.ts';
import {
  addDivision,
  demoWorld,
  divisionRankRefusal,
  divisionSites,
  divisionWouldCycle,
  levelRefusal,
  linkLength,
  parentLevelRefusal,
  parentWouldCycle,
  seatRefusal,
  siteBranch,
  siteDivisionNote,
  siteLevels,
  worldFromJson,
  worldToJson,
} from '../src/engine/world.ts';

let bad = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!ok) bad += 1;
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
  '选项是地貌五档',
  w6.pending?.options.length === 5,
  (w6.pending?.options ?? []).map((o) => o.label).join('、'),
);
const dayAtAsk = w6.day;
tickDay(w6, p);
check('没回答之前时间轴不走', w6.day === dayAtAsk, '第 ' + w6.day + ' 天');
check('乱填的值不写回', !answerAsk(w6, 'swamp') && w6.pending !== null);
check('合法的值写回世界', answerAsk(w6, 'hill') && w6.links[0]!.terrain === 'hill');
check('答完 pending 清空', w6.pending === null);
check('答完写了日志', w6.log.some((line) => line.includes('地貌填成 丘陵')));
tickDay(w6, p);
check('答完就能出发', u6.place.kind === 'march', '第 ' + w6.day + ' 天');

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
