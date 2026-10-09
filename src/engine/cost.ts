// 成本函数：软约束成本 + 硬约束违反计数（构造与局部搜索共用）
import type { Model } from './model';
import type { SolveInput } from './types';
import { restGapMinutes } from './time';

/** 构造期的“未决定”哨兵 */
export const UND = -2;
export type Cell = number | null;
export type AssignMat = Cell[][];

export interface CostCtx {
  input: SolveInput;
  model: Model;
  /** 每员工工作天数 */
  wd: number[];
  /** 每员工各班次次数 */
  shiftCnt: number[][];
  /** 每员工周末工作天数 */
  wkCnt: number[];
  /** filled[day][shift] */
  filled: number[][];
  weekend: boolean[];
}

export function makeCostCtx(input: SolveInput, model: Model): CostCtx {
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;
  const weekend: boolean[] = [];
  for (let d = 0; d < D; d++) {
    const w = new Date(input.year, input.month, d + 1).getDay();
    weekend.push(w === 0 || w === 6);
  }
  return {
    input, model, weekend,
    wd: Array(E).fill(0),
    shiftCnt: Array.from({ length: E }, () => Array(S).fill(0)),
    wkCnt: Array(E).fill(0),
    filled: Array.from({ length: D }, () => Array(S).fill(0)),
  };
}

export function isWorked(v: Cell): boolean {
  return v !== null && v !== UND;
}

/** 应用一次单元格变化，维护增量计数器 */
export function applyChange(ctx: CostCtx, e: number, d: number, prev: Cell, next: Cell) {
  if (prev === next) return;
  if (isWorked(prev)) {
    ctx.wd[e]--;
    ctx.shiftCnt[e][prev as number]--;
    ctx.filled[d][prev as number]--;
    if (ctx.weekend[d]) ctx.wkCnt[e]--;
  }
  if (isWorked(next)) {
    ctx.wd[e]++;
    ctx.shiftCnt[e][next as number]++;
    ctx.filled[d][next as number]++;
    if (ctx.weekend[d]) ctx.wkCnt[e]++;
  }
}

/** 员工软约束成本（越小越好） */
export function empCost(ctx: CostCtx, A: AssignMat, e: number): number {
  const { input, model } = ctx;
  const D = input.days;
  const emp = input.employees[e];
  const w = input.weights;
  let cost = 0;

  // 出勤目标
  if (emp.targetWorkDays != null) {
    const wd = ctx.wd[e];
    if (emp.targetHard) {
      const lo = emp.targetWorkDays - emp.targetTolerance;
      const hi = emp.targetWorkDays + emp.targetTolerance;
      if (wd < lo) cost += 500 * (lo - wd);
      else if (wd > hi) cost += 500 * (wd - hi);
    } else {
      cost += 8 * Math.abs(wd - emp.targetWorkDays);
    }
  }

  // 班次分配公平（含夜班公平）：Σ cnt²
  const wFS = w.fairnessShift / 3;
  for (let s = 0; s < input.shifts.length; s++) {
    const c = ctx.shiftCnt[e][s];
    if (c > 0) cost += wFS * input.shifts[s].fairnessWeight * c * c * 0.5;
  }
  // 出勤均衡
  cost += (w.fairnessWork / 3) * 0.5 * ctx.wd[e] * ctx.wd[e];
  // 周末公平
  cost += (w.fairnessWeekend / 3) * ctx.wkCnt[e] * ctx.wkCnt[e];

  // 员工偏好
  const wP = w.preference / 3;
  if (wP > 0) {
    for (let d = 0; d < D; d++) {
      const v = A[e][d];
      if (model.preferRestAt[e][d] && isWorked(v)) cost += 6 * wP;
      if (isWorked(v)) {
        const s = v as number;
        if (model.avoidAt[e][d][s]) cost += 6 * wP;
        if (model.preferShiftAt[e][d] >= 0 && s !== model.preferShiftAt[e][d]) cost += 3 * wP;
        if (emp.preferredShifts.size > 0 && !emp.preferredShifts.has(s)) cost += 1 * wP;
        if (emp.preferWeekendRest && ctx.weekend[d]) cost += 3 * wP;
      } else if (model.preferShiftAt[e][d] >= 0 && v === null) {
        cost += 1 * wP;
      }
    }
  }

  // 尽量避免连续工作（软）
  const comfort = input.comfortConsec;
  if (comfort > 0 && w.avoidConsecutive > 0) {
    const wC = w.avoidConsecutive / 3;
    let run = 0;
    for (let d = 0; d < D; d++) {
      if (isWorked(A[e][d])) run++;
      else {
        if (run > comfort) cost += wC * 2 * (run - comfort) * (run - comfort);
        run = 0;
      }
    }
    if (run > comfort) cost += wC * 2 * (run - comfort) * (run - comfort);
  }

  return cost;
}

/** 员工硬约束违反数量（0 = 完全满足） */
export function empHardViol(ctx: CostCtx, A: AssignMat, e: number): number {
  const { input, model } = ctx;
  const D = input.days;
  let viol = 0;

  // 连续工作上限 / 同班次连续上限
  let run = 0;
  let sRun = 0;
  let sRunShift = -1;
  const checkRun = (len: number, shift: number) => {
    if (len > input.maxConsec) viol += len - input.maxConsec;
    const eff = input.shifts[shift]?.effMaxConsec ?? Infinity;
    if (Number.isFinite(eff) && len > eff) viol += len - eff;
  };
  for (let d = 0; d < D; d++) {
    const v = A[e][d];
    if (isWorked(v)) {
      run++;
      const s = v as number;
      if (s === sRunShift) sRun++;
      else {
        if (sRunShift >= 0) checkRun(sRun, sRunShift);
        sRunShift = s;
        sRun = 1;
      }
    } else {
      if (sRunShift >= 0) checkRun(sRun, sRunShift);
      sRunShift = -1;
      sRun = 0;
      if (run > input.maxConsec) viol += run - input.maxConsec;
      run = 0;
    }
  }
  if (sRunShift >= 0) checkRun(sRun, sRunShift);
  if (run > input.maxConsec) viol += run - input.maxConsec;

  // 班次间休息时间（按实际时间计算，跨天也考虑）
  const minRest = input.minRestHours * 60;
  if (minRest > 0) {
    let prevD = -1;
    for (let d = 0; d < D; d++) {
      if (!isWorked(A[e][d])) continue;
      if (prevD >= 0) {
        const gap = restGapMinutes(input.shifts[A[e][prevD] as number], prevD, input.shifts[A[e][d] as number], d);
        if (gap < minRest) viol++;
      }
      prevD = d;
    }
  }

  // 日期级硬规则
  for (let d = 0; d < D; d++) {
    const v = A[e][d];
    if (v === UND) continue;
    if (model.hardRestAt[e][d] && isWorked(v)) viol++;
    if (model.mustWorkAt[e][d] && !isWorked(v)) viol++;
    const ms = model.mustShiftAt[e][d];
    if (ms >= 0 && v !== ms) viol++;
    if (isWorked(v) && model.forbidAt[e][d][v as number]) viol++;
  }

  return viol;
}

/** 某天某班次的人力需求成本（缺口重罚，超员轻罚） */
export function demandSlotCost(ctx: CostCtx, d: number, s: number): number {
  const req = ctx.input.demand[d][s];
  const f = ctx.filled[d][s];
  if (f < req) return 1000 * (req - f);
  if (f > req) return 2 * (f - req);
  return 0;
}

export function totalDemandCost(ctx: CostCtx): number {
  let c = 0;
  for (let d = 0; d < ctx.input.days; d++) {
    for (let s = 0; s < ctx.input.shifts.length; s++) c += demandSlotCost(ctx, d, s);
  }
  return c;
}

/** 综合成本（软成本 + 硬违反×1000 + 需求成本），用于调试与整体比较 */
export function totalCost(ctx: CostCtx, A: AssignMat): number {
  let c = totalDemandCost(ctx);
  for (let e = 0; e < ctx.input.employees.length; e++) {
    c += empCost(ctx, A, e) + 1000 * empHardViol(ctx, A, e);
  }
  return c;
}
