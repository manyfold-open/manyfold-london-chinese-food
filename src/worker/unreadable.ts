/**
 * Reasons that say an agent could not read the page or image, rather than that it contradicts the
 * record or lead: a timeout, a refused or blocked request, a login or paywall. A maintainer's task
 * is then unsure, and a collector's lead goes on to someone who can open it. A page that is gone
 * (404, 410) is another matter: that can make a record stale.
 */
const COULD_NOT_READ: readonly RegExp[] = [
  /\bunreachable\b/i,
  /\b(?:could ?n[o']t|cannot|can ?not|unable to|failed to|fails to)\s+(?:be\s+)?(?:load|reach|fetch|access|open|retrieve|connect|view|download|see)/i,
  /\b(?:did ?n[o']t|does ?n[o']t|will not|won't|would ?n[o']t)\s+load\b/i,
  /\btim(?:ed|es|ing)?[ -]?out\b|\btimeouts?\b/i,
  /\b(?:HTTP|status|code|error)\s*(?:status\s*)?(?:code\s*)?:?\s*(?:0|403|429|5\d\d)\b/i,
  /\breturned\s+(?:an?\s+)?(?:HTTP\s+)?(?:403|429|5\d\d)\b/i,
  /\b(?:forbidden|access denied|captcha|rate[ -]limit(?:ed)?|too many requests|bot (?:check|protection|challenge|detection))\b/i,
  /\b(?:connection (?:refused|reset|error|failed)|network error|fetch failed|ssl error|certificate error)\b/i,
  /\bblock(?:s|ed|ing)?\b[^.]{0,40}\b(?:requests?|crawlers?|bots?|automated|fetch)\b/i,
  /\b(?:requires?|needs?)\s+(?:a\s+)?(?:log ?in|sign[ -]?in|browser|javascript)\b|\b(?:login|sign[ -]?in)\s+(?:wall|required)\b|\bpaywall/i,
  /打不开|无法(?:打开|访问|加载)|需要登录|验证码/,
];

export const couldNotRead = (reason: string): boolean => COULD_NOT_READ.some((pattern) => pattern.test(reason));
