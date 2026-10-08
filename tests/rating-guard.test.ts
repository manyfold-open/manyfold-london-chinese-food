import { describe, expect, it } from 'vitest';
import { findRating } from '../src/shared/rating-guard';

/** Texts that give a reviewer's score away, and must be refused. */
const RATINGS: readonly string[] = [
  '★★★★☆',
  'Food ★★★★',
  '⭐⭐⭐⭐⭐ amazing',
  '🌟🌟🌟',
  'I give it 4/5',
  'Solid 8/10 for the noodles.',
  '9.5/10 would come back',
  '4.5 / 5',
  '17/20 overall',
  'An easy 85/100.',
  '10/10 dumplings',
  'Four out of 5 for the duck',
  '4 out of 5',
  '7 out of 10, the rice was cold',
  '4 stars',
  '5 star service',
  '4.5-star meal',
  'a five-star experience',
  'three stars from me',
  'Two and a half stars',
  'half a star off for the wait',
  'Rated 4 by locals',
  'rating: 8',
  'Hygiene rating 5',
  'score of 9',
  'scored 7 out of ten',
  '4.5星',
  '五星好评',
  '三颗星',
  '给5颗星',
  '五星级的服务',
  '两星',
  '8分',
  '4.5分',
  '给了9分',
  '打分：8',
  '我给满分',
  '评分不高',
  '大众点评评分4.5',
  '口味4.5 环境4.2 服务4.0',
  '口味：5',
  '性价比 4',
  '推荐指数：★★★★',
  '必吃指数很高',
  'Ｇｏｏｄ ４/５', // full-width digits are folded first
];

/** Texts that only look like scores, and must pass. */
const PLAIN: readonly string[] = [
  'The har gow had thin, almost translucent skins with a whole prawn inside.',
  'Open 24/7 near the station.',
  'We went on 12/10/2024 for lunch.',
  'Booked for 1/2 past seven.',
  'A half portion of noodles is plenty.',
  'Braised beef with star anise and cinnamon.',
  'It holds a Michelin star.',
  'The star of the meal was the fish.',
  'Rated highly by the people we spoke to.',
  'Scores of students queue here every lunchtime.',
  '等了5分钟就上菜了',
  '分量很足，两个人吃不完',
  '七分甜少冰',
  '三分糖的奶茶刚刚好',
  '牛排七分熟',
  '吃到八分饱就好',
  '十分好吃',
  '部分菜品偏咸',
  '这家是分店，总店在曼城',
  '星期六人很多',
  '星巴克旁边的那家',
  '星洲炒米粉很香',
  '口味3种可选',
  '环境2楼比较安静',
  '服务员很热情',
  '15分钟内上齐了',
  'Lunch set for £12.80',
  'Table for 4 at 7pm',
  'Bus 24 stops outside',
  '3 dumplings for £5',
  'We waited 10 minutes.',
  'The 5-spice pork belly was crisp.',
  'Five of us shared six dishes.',
  'Since 2019 the menu has grown.',
  '辣度可以选1到3',
  '人均20镑左右',
  '营业到晚上11点',
  '2楼有包间',
  '一共点了8道菜',
  '小笼包一笼6个',
  'The menu has 120 items.',
  '这里没有评分，读历史自己判断。',
];

describe('the rating guard', () => {
  it('has both sides covered, at least 80 cases', () => {
    expect(RATINGS.length + PLAIN.length).toBeGreaterThanOrEqual(80);
  });

  it.each(RATINGS)('refuses %s', (text) => {
    expect(findRating(text)).not.toBeNull();
  });

  it.each(PLAIN)('lets %s through', (text) => {
    expect(findRating(text)).toBeNull();
  });

  it('names the fragment that gave the score away', () => {
    expect(findRating('Lovely noodles, 4/5 overall')).toBe('4/5');
    expect(findRating('环境不错，4.5星')).toBe('4.5星');
  });
});
