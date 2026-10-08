// 确定性贪心构造：锁定/指定班次预置 → 按稀缺度排序填充 → 目标出勤修复
import type { Model } from './model';
import type { SolveInput } from './types';
import {
  applyChange, empCost, empHardViol, makeCostCtx, UND,
  type AssignMat, type Cell, type CostCtx,
} from './cost';

export interface ConstructResult {
  A: AssignMat;
  ctx: CostCtx;
}

/** 单元格临时赋值并计算（硬违反, 软成本），随后还原 */function tentativeScore(ctx: CostCtx, A: AssignMat, e: number, d: number, s: number | null): { hv: number; soft: number } {
  const prev = A[e][d];
  const before = empCost(ctx, A, e);
  A[e][d] = s;
  applyChange(ctx, e, d, prev, s);
  const hv = empHardViol(ctx, A, e);
  let after = empCost(ctx, A, e);
  A[e][d] = prev;
  applyChange(ctx, e, d, s, prev);
  // 同班次连续偏好（blocking 启发式）：连续上同一班次可减少休息间隔冲突，
  // 也是实际排班（尤其夜班）的标准做法
  if (s !== null) {
    const chainBonus = ctx.input.shifts[s].crossDay ? 8 : 4;
    if (d > 0 && A[e][d - 1] === s) after -= chainBonus;
    if (d + 1 < A[e].length && A[e][d + 1] === s) after -= chainBonus / 2;
  }
  return { hv, soft: after - before };
}

export type ConstructOrder = 'scarcity' | 'lateFirst';

export function constructSchedule(input: SolveInput, model: Model, order: ConstructOrder = 'scarcity'): ConstructResult {
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;
  const A: AssignMat = Array.from({ length: E }, () => Array(D).fill(UND) as Cell[]);
  const ctx = makeCostCtx(input, model);

  const assign = (e: number, d: number, v: number | null) => {
    const prev = A[e][d];
    A[e][d] = v;
    applyChange(ctx, e, d, prev, v);
  };

  // 1. 锁定单元格（用户明确固定，优先级最高）
  if (input.initial) {
    for (const emp of input.employees) {
      for (let d = 0; d < D; d++) {
        if (input.lockedMask[emp.idx]?.[d]) {
          assign(emp.idx, d, input.initial[emp.idx][d]);
        }
      }
    }
  }

  // 2. 硬性休息日
  for (const emp of input.employees) {
    for (let d = 0; d < D; d++) {
      if (model.hardRestAt[emp.idx][d] && A[emp.idx][d] === UND) assign(emp.idx, d, null);
    }
  }

  // 3. 指定班次日
  for (const emp of input.employees) {
    for (let d = 0; d < D; d++) {
      const ms = model.mustShiftAt[emp.idx][d];
      if (ms >= 0 && A[emp.idx][d] === UND) assign(emp.idx, d, ms);
    }
  }

  // 4. 主填充：按稀缺度（可用池-缺口）排序，逐格挑选成本最低的候选
  const slots: { d: number; s: number; need: number }[] = [];
  for (let d = 0; d < D; d++) {
    for (let s = 0; s < S; s++) {
      const need = input.demand[d][s] - ctx.filled[d][s];
      if (need > 0) slots.push({ d, s, need });
    }
  }
  // 按天顺序构造（天内按指定顺序），保证休息间隔检查能看到已确定的相邻日
  if (order === 'lateFirst') {
    // 晚结束的班次（如夜班）先填：利于形成夜班连班块，避免夜班→白班的休息冲突
    const lateness = input.shifts.map((s) => (s.crossDay ? s.endMin + 1440 : s.endMin));
    slots.sort((a, b) => a.d - b.d || lateness[b.s] - lateness[a.s] || a.s - b.s);
  } else {
    slots.sort((a, b) => {
      const sa = model.pools[a.d][a.s] - a.need;
      const sb = model.pools[b.d][b.s] - b.need;
      return a.d - b.d || sa - sb || a.s - b.s;
    });
  }

  for (const slot of slots) {
    const { d, s } = slot;
    while (ctx.filled[d][s] < input.demand[d][s]) {
      let bestE = -1;
      let bestScore = Infinity;
      let bestHv = 0;
      for (const emp of input.employees) {
        const e = emp.idx;
        if (A[e][d] !== UND) continue;
        if (input.lockedMask[e]?.[d]) continue;
        if (!model.allowed[e][d][s]) continue;
        const { hv, soft } = tentativeScore(ctx, A, e, d, s);
        const score = hv * 1e6 + soft;
        if (score < bestScore) {
          bestScore = score;
          bestE = e;
          bestHv = hv;
        }
      }
      if (bestE < 0) break; // 无人可排（可行性检测会给出原因）
      assign(bestE, d, s);
      if (bestHv > 0) {
        // 尽力而为模式：接受会产生硬违反的安排，评估阶段会明确列出
        void bestHv;
      }
    }
  }

  // 5. 必须上班日兜底（需求已满时超额安排）
  for (const emp of input.employees) {
    for (let d = 0; d < D; d++) {
      if (!model.mustWorkAt[emp.idx][d]) continue;
      if (A[emp.idx][d] !== UND) continue;
      let bestS = -1;
      let bestScore = Infinity;
      for (let s = 0; s < S; s++) {
        if (!model.allowed[emp.idx][d][s]) continue;
        // 优先填补缺口（demandSlotCost 已包含在软成本以外的全局项，这里直接比较）
        const shortBonus = ctx.filled[d][s] < input.demand[d][s] ? -1000 : 2;
        const { hv, soft } = tentativeScore(ctx, A, emp.idx, d, s);
        const score = hv * 1e6 + soft + shortBonus;
        if (score < bestScore) {
          bestScore = score;
          bestS = s;
        }
      }
      if (bestS >= 0) assign(emp.idx, d, bestS);
    }
  }

  // 6. 硬性出勤目标下限修复：不足则补排（优先缺口班次）
  const hardMin: { e: number; min: number }[] = [];
  for (const emp of input.employees) {
    if (emp.targetHard && emp.targetWorkDays != null) {
      const min = Math.max(0, emp.targetWorkDays - emp.targetTolerance);
      if (min > 0) hardMin.push({ e: emp.idx, min });
    }
  }
  hardMin.sort((a, b) => b.min - a.min || a.e - b.e);
  for (const { e, min } of hardMin) {
    while (ctx.wd[e] < min) {
      let bestD = -1;
      let bestS = -1;
      let bestScore = Infinity;
      for (let d = 0; d < D; d++) {
        if (A[e][d] !== UND && A[e][d] !== null) continue;
        if (input.lockedMask[e]?.[d]) continue;
        for (let s = 0; s < S; s++) {
          if (!model.allowed[e][d][s]) continue;
          const shortBonus = ctx.filled[d][s] < input.demand[d][s] ? -1000 : 2;
          const { hv, soft } = tentativeScore(ctx, A, e, d, s);
          const score = hv * 1e6 + soft + shortBonus;
          if (score < bestScore) {
            bestScore = score;
            bestD = d;
            bestS = s;
          }
        }
      }
      if (bestD < 0) break; // 无法再补，评估阶段报告
      assign(e, bestD, bestS);
    }
  }

  // 7. 其余未决定单元格 = 休息
  for (const emp of input.employees) {
    for (let d = 0; d < D; d++) {
      if (A[emp.idx][d] === UND) assign(emp.idx, d, null);
    }
  }

  return { A, ctx };
}
