// 纯逻辑自检：不碰界面、不碰数据库，直接用 node 跑。
// 用法：node tools/selftest.ts
import { DEFAULT_PARAMS } from '../src/engine/params.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { dayOfMonth, isMonthEnd, marchDays, month, tickDay, year } from '../src/engine/tick.ts';
import { demoWorld, worldFromJson, worldToJson } from '../src/engine/world.ts';

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
const days = marchDays(u3, wL.distance, 1, p);
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
