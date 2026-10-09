// 局部搜索优化：确定性、时间预算可控、支持取消、不冻结界面
// 移动类型：补缺调入 / 同日转移 / 同日班次交换 / 周末↔工作日同班次换日
import type { Model } from './model';
import type { SolveInput } from './types';
import { applyChange, demandSlotCost, empCost, empHardViol, makeCostCtx, type AssignMat, type CostCtx } from './cost';

export interface ImproveOpts {
  onProgress?: (pct: number, msg: string) => void;
  isCancelled?: () => boolean;
  /** 总时间预算（毫秒） */
  timeBudgetMs: number;
  /** 进度区间 */
  progressFrom: number;
  progressTo: number;
}

export interface ImproveResult {
  iterations: number;
  cancelled: boolean;
  ctx: CostCtx;
}

interface Change { e: number; d: number; v: number | null }

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function improveSchedule(
  input: SolveInput,
  model: Model,
  A: AssignMat,
  opts: ImproveOpts
): Promise<ImproveResult> {
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;
  const ctx = makeCostCtx(input, model);

  // 初始化计数器
  for (let e = 0; e < E; e++) {
    for (let d = 0; d < D; d++) {
      applyChange(ctx, e, d, null, A[e][d]);
    }
  }

  const start = Date.now();
  const deadline = start + opts.timeBudgetMs;
  let iterations = 0;
  let cancelled = false;
  let moveChecks = 0;

  const isLocked = (e: number, d: number) => !!input.lockedMask[e]?.[d];

  /** 计算一组受影响员工的 (软成本 + 1000*硬违反) */
  const empPart = (emps: number[]): number => {
    let c = 0;
    for (const e of emps) c += empCost(ctx, A, e) + 1000 * empHardViol(ctx, A, e);
    return c;
  };

  /** 尝试一组变更；若总成本下降则保留，否则回滚 */
  const tryMove = (changes: Change[]): boolean => {
    const emps = [...new Set(changes.map((c) => c.e))];
    const slots = new Set<string>();
    for (const c of changes) {
      if (A[c.e][c.d] !== null && A[c.e][c.d] !== undefined) slots.add(`${c.d}:${A[c.e][c.d]}`);
      if (c.v !== null) slots.add(`${c.d}:${c.v}`);
    }
    let before = empPart(emps);
    for (const key of slots) {
      const [d, s] = key.split(':').map(Number);
      before += demandSlotCost(ctx, d, s);
    }

    const prevs = changes.map((c) => A[c.e][c.d]);
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      applyChange(ctx, c.e, c.d, prevs[i], c.v);
      A[c.e][c.d] = c.v;
    }

    let after = empPart(emps);
    for (const key of slots) {
      const [d, s] = key.split(':').map(Number);
      after += demandSlotCost(ctx, d, s);
    }

    if (after < before) {
      iterations++;
      return true;
    }
    // 回滚
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      applyChange(ctx, c.e, c.d, c.v, prevs[i]);
      A[c.e][c.d] = prevs[i];
    }
    return false;
  };

  const maybeYield = async () => {
    moveChecks++;
    if ((moveChecks & 511) === 0) {
      if (Date.now() > deadline || opts.isCancelled?.()) {
        cancelled = true;
      }
      opts.onProgress?.(
        Math.min(opts.progressTo,
          opts.progressFrom + (opts.progressTo - opts.progressFrom) * Math.min(1, (Date.now() - start) / opts.timeBudgetMs)),
        '正在优化排班公平性与偏好…'
      );
      await tick();
    }
  };

  const weekendDays: number[] = [];
  const weekdayDays: number[] = [];
  for (let d = 0; d < D; d++) {
    (ctx.weekend[d] ? weekendDays : weekdayDays).push(d);
  }

  let pass = 0;
  outer: while (pass < 60) {
    pass++;
    let improvedAny = false;

    // --- 移动1：缺口补员（休息 → 上班） ---
    for (let d = 0; d < D && !cancelled; d++) {
      for (let s = 0; s < S; s++) {
        while (ctx.filled[d][s] < input.demand[d][s]) {
          let done = false;
          for (const emp of input.employees) {
            const e = emp.idx;
            if (A[e][d] !== null || isLocked(e, d) || !model.allowed[e][d][s]) continue;
            if (tryMove([{ e, d, v: s }])) {
              done = true;
              improvedAny = true;
              break;
            }
          }
          if (!done) break;
        }
        if ((moveChecks & 63) === 0) await maybeYield();
      }
    }
    if (cancelled) break outer;

    // --- 移动2：同日转移（上班 → 他人休息位） ---
    for (let d = 0; d < D && !cancelled; d++) {
      // 当天存在硬违反的员工优先尝试移动（修复类转移）
      const hasViol: boolean[] = new Array(E).fill(false);
      let anyViol = false;
      for (let e = 0; e < E; e++) {
        if (empHardViol(ctx, A, e) > 0) { hasViol[e] = true; anyViol = true; }
      }
      void anyViol;
      for (const emp of input.employees) {
        const e1 = emp.idx;
        const s = A[e1][d];
        if (s === null || isLocked(e1, d)) continue;
        // 方向性过滤：均衡改善、偏好改善，或发送者存在硬违反需要修复
        for (const emp2 of input.employees) {
          const e2 = emp2.idx;
          if (A[e2][d] !== null || isLocked(e2, d) || !model.allowed[e2][d][s]) continue;
          if (
            hasViol[e1] ||
            ctx.wd[e1] > ctx.wd[e2] + 1 ||
            ctx.shiftCnt[e1][s] > ctx.shiftCnt[e2][s] + 1 ||
            (ctx.weekend[d] && ctx.wkCnt[e1] > ctx.wkCnt[e2]) ||
            (model.avoidAt[e1][d][s as number] && !model.avoidAt[e2][d][s as number]) ||
            (input.employees[e1].targetHard && ctx.wd[e1] > (input.employees[e1].targetWorkDays ?? 0) + input.employees[e1].targetTolerance)
          ) {
            if (tryMove([
              { e: e1, d, v: null },
              { e: e2, d, v: s },
            ])) {
              improvedAny = true;
              break;
            }
          }
          await maybeYield();
          if (cancelled) break outer;
        }
      }
    }
    if (cancelled) break outer;

    // --- 移动3：同日班次交换（e1:s1 ↔ e2:s2） ---
    for (let d = 0; d < D && !cancelled; d++) {
      const hasViol: boolean[] = new Array(E).fill(false);
      for (let e = 0; e < E; e++) {
        if (empHardViol(ctx, A, e) > 0) hasViol[e] = true;
      }
      for (let e1 = 0; e1 < E; e1++) {
        const s1 = A[e1][d];
        if (s1 === null || isLocked(e1, d)) continue;
        for (let e2 = e1 + 1; e2 < E; e2++) {
          const s2 = A[e2][d];
          if (s2 === null || s2 === s1 || isLocked(e2, d)) continue;
          if (!model.allowed[e1][d][s2] || !model.allowed[e2][d][s1]) continue;
          // 方向性过滤：班次计数/偏好转置，或任一方存在硬违反需要修复
          if (
            hasViol[e1] || hasViol[e2] ||
            (ctx.shiftCnt[e1][s1] > ctx.shiftCnt[e2][s1] + 1 && ctx.shiftCnt[e2][s2] > ctx.shiftCnt[e1][s2] + 1) ||
            (ctx.shiftCnt[e2][s2] > ctx.shiftCnt[e1][s2] + 1 && ctx.shiftCnt[e1][s1] > ctx.shiftCnt[e2][s1] + 1) ||
            (model.avoidAt[e1][d][s1] && !model.avoidAt[e2][d][s1]) ||
            (model.avoidAt[e2][d][s2] && !model.avoidAt[e1][d][s2]) ||
            (model.preferShiftAt[e1][d] === s2 && model.preferShiftAt[e2][d] === s1)
          ) {
            if (tryMove([
              { e: e1, d, v: s2 },
              { e: e2, d, v: s1 },
            ])) {
              improvedAny = true;
            }
          }
          await maybeYield();
          if (cancelled) break outer;
        }
      }
    }
    if (cancelled) break outer;

    // --- 移动4：周末 ↔ 工作日 同班次换日（周末公平） ---
    for (let s = 0; s < S && !cancelled; s++) {
      for (const d1 of weekendDays) {
        const holders1: number[] = [];
        for (let e = 0; e < E; e++) if (A[e][d1] === s) holders1.push(e);
        if (holders1.length === 0) continue;
        for (const d2 of weekdayDays) {
          const holders2: number[] = [];
          for (let e = 0; e < E; e++) if (A[e][d2] === s) holders2.push(e);
          if (holders2.length === 0) continue;
          for (const e1 of holders1) {
            if (isLocked(e1, d1) || isLocked(e1, d2) || A[e1][d2] !== null) continue;
            for (const e2 of holders2) {
              if (e2 === e1 || isLocked(e2, d2) || isLocked(e2, d1) || A[e2][d1] !== null) continue;
              if (ctx.wkCnt[e1] <= ctx.wkCnt[e2]) continue;
              if (!model.allowed[e2][d1][s] || !model.allowed[e1][d2][s]) continue;
              if (tryMove([
                { e: e1, d: d1, v: null },
                { e: e2, d: d1, v: s },
                { e: e2, d: d2, v: null },
                { e: e1, d: d2, v: s },
              ])) {
                improvedAny = true;
              }
              await maybeYield();
              if (cancelled) break outer;
            }
          }
        }
      }
    }
    if (cancelled) break outer;

    // --- 移动5：跨日交换（修复剩余硬违反：双方交换各自的一个工作日） ---
    for (let e1 = 0; e1 < E && !cancelled; e1++) {
      if (empHardViol(ctx, A, e1) === 0) continue;
      for (let d = 0; d < D; d++) {
        const s1 = A[e1][d];
        if (s1 === null || isLocked(e1, d)) continue;
        for (const emp2 of input.employees) {
          const e2 = emp2.idx;
          if (e2 === e1) continue;
          if (A[e2][d] !== null || isLocked(e2, d) || !model.allowed[e2][d][s1]) continue;
          for (let d2 = 0; d2 < D; d2++) {
            if (d2 === d || A[e1][d2] !== null || isLocked(e1, d2)) continue;
            const s2 = A[e2][d2];
            if (s2 === null || isLocked(e2, d2) || !model.allowed[e1][d2][s2]) continue;
            if (tryMove([
              { e: e1, d, v: null },
              { e: e2, d, v: s1 },
              { e: e2, d: d2, v: null },
              { e: e1, d: d2, v: s2 },
            ])) {
              improvedAny = true;
            }
            await maybeYield();
            if (cancelled) break outer;
          }
        }
      }
    }
    if (cancelled) break outer;

    opts.onProgress?.(opts.progressTo - 1, pass >= 60 ? '优化完成' : '正在优化排班公平性与偏好…');
    if (!improvedAny) break;
  }

  return { iterations, cancelled, ctx };
}
