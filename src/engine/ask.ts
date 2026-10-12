// 问询：引擎遇到缺数据就停下来写一个 Ask，User 答完由这里写回世界。
import { FOOD_POLICY_LABEL, isFoodPolicy } from './labels.ts';
import type { Ask, Id, Link, Unit, World } from './types.ts';
import { destinationName, linkName, terrainById } from './world.ts';

/**
 * 地貌没填时的那一问。选项就是 User 自己那一串地貌（一档一行，按表里的次序排），
 * 一个都不给候选时说明地貌表是空的——那种情况下这一问答不了，所以界面会拦着不让删到只剩零档。
 */
export function askLinkTerrain(world: World, subject: string, link: Link): Ask {
  const options = world.terrains.map((t) => ({ value: String(t.id), label: t.name }));
  return {
    subject,
    question: '这条连接还没填地貌，行军速度按哪一档算？',
    options,
    fallback: options.length > 0 ? (options[0] as { value: string }).value : '',
    target: { kind: 'linkTerrain', link: link.id },
  };
}

/** 随身粮草见底时的那一问（设计 §五 第 11 条，三种处理方式）。 */
export function askFoodPolicy(subject: string, unit: Unit): Ask {
  return {
    subject,
    question: '随身粮草吃完了，这支部队怎么办？',
    options: (['attrition', 'forage', 'restrict'] as const).map((v) => ({ value: v, label: FOOD_POLICY_LABEL[v] })),
    fallback: 'attrition',
    target: { kind: 'unitFoodPolicy', unit: unit.id },
  };
}

/**
 * 离开道路行军之前的那一问：这一趟的代价由 User 定，填一个相对道路速度的倍率。
 * 一个候选也不给——数由 User 自己写（界面那一头本来就是个能直接键入的输入框），
 * 默认值也留空，免得「直接确认」变成引擎替 User 挑了一个数。
 */
export function askOffroadFactor(
  subject: string,
  unit: Unit,
  to: { toSite: Id | null; toX: number; toY: number },
): Ask {
  return {
    subject,
    question: '这一趟离开道路，速度按道路的几成算？填一个数，0.4 就是道路的四成。',
    options: [],
    fallback: '',
    target: { kind: 'unitOffroadOrder', unit: unit.id, toSite: to.toSite, toX: to.toX, toY: to.toY },
  };
}

/**
 * 把答案写回世界。写成了就清掉 pending 并记一行日志，返回 true；
 * 值不合法或找不到对象就原样留着 pending，返回 false。
 */
export function answerAsk(world: World, value: string): boolean {
  const ask = world.pending;
  if (!ask) return false;

  const target = ask.target;
  if (target.kind === 'linkTerrain') {
    const link = world.links.find((l) => l.id === target.link);
    // 答案是一个地貌编号：填出来的编号得真有那么一档才算数。
    const id = Number(value.trim());
    const terrain = Number.isFinite(id) ? terrainById(world, id) : undefined;
    if (!link || !terrain) return false;
    link.terrain = terrain.id;
    world.log.push(`第 ${world.day} 天：把 ${linkName(world, link)} 的地貌填成 ${terrain.name}。`);
  } else if (target.kind === 'unitFoodPolicy') {
    const unit = world.units.find((u) => u.id === target.unit);
    if (!unit || !isFoodPolicy(value)) return false;
    unit.foodPolicy = value;
    world.log.push(`第 ${world.day} 天：${unit.name} 断粮的处理方式定为「${FOOD_POLICY_LABEL[value]}」。`);
  } else {
    // 离开道路那一趟的倍率。空串与乱填都过不了这一关，pending 留着等 User 重填。
    const unit = world.units.find((u) => u.id === target.unit);
    const factor = Number(value.trim());
    if (!unit || !Number.isFinite(factor) || factor <= 0) return false;
    unit.queue = [
      { kind: 'offroad', toSite: target.toSite, toX: target.toX, toY: target.toY, factor },
    ];
    world.log.push(
      `第 ${world.day} 天：${unit.name} 领命离开道路，前往 ` +
        `${destinationName(world, target.toSite, target.toX, target.toY)}，倍率 ${String(factor)}。`,
    );
  }

  world.pending = null;
  return true;
}
