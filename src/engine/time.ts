// 班次时间计算：跨天、绝对时间、休息间隔
import type { EngShift } from './types';

/** 班次在 day 天开始工作的绝对分钟数 */
export function startAbs(s: EngShift, day: number): number {
  return day * 1440 + s.startMin;
}

/** 班次在 day 天开始工作的结束绝对分钟数（跨天则落在 day+1） */
export function endAbs(s: EngShift, day: number): number {
  return day * 1440 + (s.crossDay ? s.endMin + 1440 : s.endMin);
}

/**
 * 员工先上 s1（day1），之后上 s2（day2 > day1），两次工作之间的休息分钟数。
 * 注意必须用班次实际时间而非“日期”计算。
 */
export function restGapMinutes(s1: EngShift, day1: number, s2: EngShift, day2: number): number {
  return startAbs(s2, day2) - endAbs(s1, day1);
}

/** 班次时长的文字描述，用于解释面板 */
export function shiftTimeText(s: EngShift): string {
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hh(s.startMin)}-${hh(s.endMin)}${s.crossDay ? '（次日）' : ''}`;
}
