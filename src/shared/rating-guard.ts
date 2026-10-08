/**
 * This site keeps what reviewers wrote, never their scores: there is no rating anywhere on it,
 * so readers judge a place by reading what people said. Every public text a contributor sends
 * (an excerpt, its translation, a quote, a caption) passes through here, and a text that holds
 * a rating is refused with the fragment that gave it away, so the agent can quote another
 * passage.
 *
 * The patterns aim at scores, not at words that merely look like them: "5分钟" (minutes),
 * "分量" (portion), "七分甜" (sweetness), "十分" (very), "24/7", dates and "star anise" pass.
 * tests/rating-guard.test.ts holds both sides.
 */

const PATTERNS: readonly RegExp[] = [
  // Star glyphs, as platforms and reviewers draw ratings.
  /[★☆✩✪✫✬✭✮✯✰⭐🌟]/u,
  // 4/5, 8/10, 9.5/10, 17/20, 85/100 — but not dates (12/10/2024), opening hours (24/7) or halves.
  /(?<![\d/.:-])\d{1,3}(?:[.,]\d{1,2})?\s*\/\s*(?:5|10|20|100)(?![\d/]|[.,:-]\d)/u,
  // 4 out of 5, four out of five
  /\b(?:\d{1,3}(?:[.,]\d{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten)\s+out\s+of\s+(?:5|10|20|100|five|ten)\b/iu,
  // 4 stars, 4.5-star, five-star, three and a half stars, half a star — not star anise
  /\b(?:\d(?:[.,]\d)?|one|two|three|four|five|half)(?:\s+and\s+a\s+half)?(?:\s+an?)?[\s-]*stars?\b(?!\s+anise)/iu,
  // rated 4, rating: 8, score of 9, scored 7, hygiene rating 5
  /\b(?:rated|ratings?|scored?|scores)\s*(?:of|:)?\s*\d/iu,
  // 4.5星, 5颗星, 五星, 三颗星, 五星级 — not 星期 (week), 星座, 星巴克 (Starbucks), 星洲 (Singapore)
  /(?:\d+(?:\.\d+)?|[一二两三四五六七八九十半])\s*颗?\s*星(?!期|座|巴克|洲|空|球|光|河|斑|星)/u,
  // 8分, 4.5分 — not 5分钟, 分量, 分店, 七分甜, 三分糖, 七分熟, 八分饱
  /\d+(?:\.\d+)?\s*分(?!钟|量|店|之|享|别|开|配|布|成|类|析|手|心|糖|甜|冰|熟|辣|饱|贝|段|部|批|散|子|数|期|秒)/u,
  // 评分, 打分, 满分, 给了9分
  /评分|打分|满分|给了?\s*[\d一二两三四五六七八九十]+(?:\.\d+)?\s*分/u,
  // Platform sub-scores: 口味 4.5, 环境：4, 服务4.2, 性价比 5 — not 口味3种, 环境2楼
  /(?:口味|环境|服务|性价比)\s*[:：]?\s*\d(?:\.\d)?(?![\d种个楼层位家道份元镑块])/u,
  // 推荐指数, 必吃指数
  /推荐指数|必吃指数|好吃指数/u,
];

/** The fragment of `text` that gives a rating away, or null when it holds none. */
export function findRating(text: string): string | null {
  const normalized = text.normalize('NFKC');
  for (const pattern of PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) return match[0].trim();
  }
  return null;
}
