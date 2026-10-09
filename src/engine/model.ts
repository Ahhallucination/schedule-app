// 约束模型构建：静态可行性矩阵 + 规则冲突检测
import type { Conflict, EngRule, SolveInput } from './types';
import { empName, shiftName } from './types';

export interface Model {
  /** allowed[e][d][s]：员工 e 在 d 日可以上 s 班（仅静态规则） */
  allowed: boolean[][][];
  /** mustRest：硬性休息日 */
  hardRestAt: boolean[][];
  /** mustWork：必须上班日 */
  mustWorkAt: boolean[][];
  /** mustShift[e][d] = shift idx 或 -1 */
  mustShiftAt: number[][];
  /** forbidAt[e][d][s]：被禁止班次 */
  forbidAt: boolean[][][];
  /** preferRestAt：偏好休息日（软） */
  preferRestAt: boolean[][];
  /** preferShiftAt[e][d] = 偏好班次 或 -1（软） */
  preferShiftAt: number[][];
  /** avoidAt[e][d][s]：尽量回避班次（软） */
  avoidAt: boolean[][][];
  /** pools[d][s]：当天该班次静态可用人数 */
  pools: number[][];
  /** 互斥规则冲突（输入错误，需要用户修正） */
  ruleConflicts: Conflict[];
}

export function emptyMat<T>(e: number, d: number, fill: (i: number, j: number) => T): T[][] {
  return Array.from({ length: e }, (_, i) => Array.from({ length: d }, (_, j) => fill(i, j)));
}

export function buildModel(input: SolveInput): Model {
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;

  const allowed: boolean[][][] = Array.from({ length: E }, () =>
    Array.from({ length: D }, () => Array.from({ length: S }, () => true)));
  const hardRestAt = emptyMat(E, D, () => false);
  const mustWorkAt = emptyMat(E, D, () => false);
  const forbidAt = Array.from({ length: E }, () => Array.from({ length: D }, () => Array(S).fill(false) as boolean[]));
  const preferRestAt = emptyMat(E, D, () => false);
  const avoidAt = Array.from({ length: E }, () => Array.from({ length: D }, () => Array(S).fill(false) as boolean[]));
  const mustShiftAt = emptyMat(E, D, () => -1);
  const preferShiftAt = emptyMat(E, D, () => -1);

  const ruleConflicts: Conflict[] = [];
  const addRuleConflict = (msg: string, sug: string) => {
    if (!ruleConflicts.some((c) => c.message === msg)) {
      ruleConflicts.push({ message: msg, suggestions: [sug] });
    }
  };

  // 员工级偏好展开到 avoidAt / preferredShifts（preferredShifts 在成本函数中处理）
  for (const e of input.employees) {
    for (let d = 0; d < D; d++) {
      for (const s of e.avoidShifts) avoidAt[e.idx][d][s] = true;
    }
  }

  const rules: EngRule[] = [...input.rules].sort((a, b) => {
    // 先应用 mustRest，再 mustShift，再 forbid
    const order = (t: EngRule['type']) =>
      t === 'mustRest' ? 0 : t === 'mustShift' ? 1 : t === 'mustWork' ? 2 : t === 'forbidShift' ? 3 : 4;
    return order(a.type) - order(b.type) || a.emp - b.emp || a.d0 - b.d0;
  });

  for (const r of rules) {
    if (r.emp < 0 || r.emp >= E) continue;
    const d0 = Math.max(0, r.d0);
    const d1 = Math.min(D - 1, r.d1);
    if (d0 > d1) continue;
    const e = r.emp;
    for (let d = d0; d <= d1; d++) {
      switch (r.type) {
        case 'mustRest': {
          if (mustShiftAt[e][d] >= 0) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被要求休息，又被要求上「${shiftName(input, mustShiftAt[e][d])}」`,
              `请在「排班规则」中删除其中一条相互矛盾的要求`
            );
          }
          if (mustWorkAt[e][d]) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被要求休息，又被要求必须上班`,
              `请在「排班规则」中删除其中一条相互矛盾的要求`
            );
          }
          hardRestAt[e][d] = true;
          allowed[e][d] = allowed[e][d].map(() => false);
          break;
        }
        case 'mustShift': {
          if (hardRestAt[e][d]) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被要求休息，又被要求上「${shiftName(input, r.shift)}」`,
              `请在「排班规则」中删除其中一条相互矛盾的要求`
            );
          }
          if (mustShiftAt[e][d] >= 0 && mustShiftAt[e][d] !== r.shift) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 被要求同时上「${shiftName(input, mustShiftAt[e][d])}」和「${shiftName(input, r.shift)}」`,
              `请只保留其中一条指定班次要求`
            );
          }
          if (forbidAt[e][d][r.shift]) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被指定上「${shiftName(input, r.shift)}」，又被禁止上该班次`,
              `请删除相互矛盾的规则`
            );
          }
          mustShiftAt[e][d] = r.shift;
          allowed[e][d] = allowed[e][d].map(() => false);
          allowed[e][d][r.shift] = true;
          break;
        }
        case 'mustWork': {
          if (hardRestAt[e][d]) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被要求休息，又被要求必须上班`,
              `请在「排班规则」中删除其中一条相互矛盾的要求`
            );
          }
          mustWorkAt[e][d] = true;
          break;
        }
        case 'forbidShift': {
          if (mustShiftAt[e][d] === r.shift) {
            addRuleConflict(
              `规则冲突：${empName(input, e)} 在 ${input.month + 1}月${d + 1}日 既被指定上「${shiftName(input, r.shift)}」，又被禁止上该班次`,
              `请删除相互矛盾的规则`
            );
          }
          forbidAt[e][d][r.shift] = true;
          allowed[e][d][r.shift] = false;
          break;
        }
        case 'preferRest':
          preferRestAt[e][d] = true;
          break;
        case 'preferShift':
          if (preferShiftAt[e][d] === -1) preferShiftAt[e][d] = r.shift;
          break;
        case 'avoidShift':
          avoidAt[e][d][r.shift] = true;
          break;
      }
    }
  }

  // 统计每天每班次静态可用人数（考虑锁定休息）
  const pools: number[][] = Array.from({ length: D }, () => Array(S).fill(0));
  for (let d = 0; d < D; d++) {
    for (let s = 0; s < S; s++) {
      let c = 0;
      for (const e of input.employees) {
        if (!allowed[e.idx][d][s]) continue;
        if (input.lockedMask[e.idx]?.[d] && input.initial && input.initial[e.idx][d] !== s) continue;
        c++;
      }
      pools[d][s] = c;
    }
  }

  return {
    allowed, hardRestAt, mustWorkAt, mustShiftAt, forbidAt,
    preferRestAt, preferShiftAt, avoidAt, pools, ruleConflicts,
  };
}
