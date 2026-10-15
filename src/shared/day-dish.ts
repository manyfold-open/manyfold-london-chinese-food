/**
 * The front page's dish of the day: a standard dish many places serve, turning over each London
 * day. It is a dish to read about, not a recommendation of any place; the page shows every place
 * that serves it and what their menus charge.
 */

import { londonDay } from './activity.ts';

/** Standard dishes (kinds/dish-vocab.ts) served widely enough for a day of their own. */
export const DAY_DISHES: readonly string[] = [
  '小笼包', '肉夹馍', '杨枝甘露', '烧鸭', '麻婆豆腐', '虾饺', '担担面', '干炒牛河', '锅贴', '红油抄手', '叉烧包', '珍珠奶茶', '烧卖', '油泼面',
  '水煮鱼', '孜然羊肉', '凉皮', '回锅肉', '蛋挞', '生煎包', '芋头奶茶', '北京烤鸭', '椒盐鱿鱼', '宫保鸡丁', '叉烧', '水饺', '鸡蛋仔', '酸辣粉',
];

/** The dish for a moment's London day: the same all day, a different one tomorrow. */
export function dishOfDay(at: Date): string {
  const day = londonDay(at.toISOString());
  const days = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return DAY_DISHES[((days % DAY_DISHES.length) + DAY_DISHES.length) % DAY_DISHES.length]!;
}
