// 求解编排：检查 → 建模 → 可行性 → 构造 → 优化 → 评估
// 分阶段报告进度，支持取消，不冻结界面
import type { Conflict, EvalResult, Score, SolveInput, Violation } from './types';
import { buildModel } from './model';
import { checkFeasibility } from './feasibility';
import { constructSchedule } from './construct';
import { improveSchedule } from './improve';
import { evaluateSchedule } from './evaluate';

export interface SolveOptions {
  onProgress?: (pct: number, msg: string) => void;
  isCancelled?: () => boolean;
  /** full = 全部重新排班；reopt = 保留锁定格，从当前结果继续优化 */
  mode?: 'full' | 'reopt';
  /** 优化阶段时间预算（毫秒），默认 8000 */
  timeBudgetMs?: number;
}

export interface SolveOutput {
  status: 'ok' | 'conflicts' | 'invalid' | 'aborted';
  assignments: (number | null)[][];
  conflicts: Conflict[];
  violations: Violation[];
  score: Score;
  elapsedMs: number;
  iterations: number;
  evalResult: EvalResult | null;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function solveSchedule(input: SolveInput, opts: SolveOptions = {}): Promise<SolveOutput> {
  const t0 = Date.now();
  const prog = opts.onProgress ?? (() => {});
  const cancelled = opts.isCancelled ?? (() => false);
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;

  // 阶段1：建模与规则冲突检测
  prog(6, '正在检查排班规则…');
  await tick();
  const model = buildModel(input);
  if (model.ruleConflicts.length > 0) {
    prog(100, '规则冲突');
    return {
      status: 'invalid', assignments: [], conflicts: model.ruleConflicts,
      violations: [], score: zeroScore(), elapsedMs: Date.now() - t0, iterations: 0, evalResult: null,
    };
  }

  // 阶段2：可行性检测
  prog(14, '正在检查人员数量与班次需求…');
  await tick();
  const feas = checkFeasibility(input, model);
  const conflicts = feas.conflicts;

  // 阶段3+4：构造 + 局部搜索优化（多起点：若仍有硬违反且时间充裕，换顺序重试）
  prog(24, E > 50 ? '正在建立排班模型（人数较多，请稍候）…' : '正在生成初步排班…');
  await tick();

  const budget = opts.timeBudgetMs ?? 8000;
  const t0b = Date.now();

  if (opts.mode === 'reopt' && input.initial) {
    // 热启动：从当前结果继续（锁定格保持不变）
    const A: (number | null)[][] = input.initial.map((row) => [...row]);
    const imp = await improveSchedule(input, model, A, {
      onProgress: opts.onProgress, isCancelled: cancelled,
      timeBudgetMs: budget, progressFrom: 50, progressTo: 95,
    });
    if (imp.cancelled) return aborted(t0);
    return finish(input, model, A, conflicts, t0, imp.iterations, prog);
  }

  let best: { A: (number | null)[][]; hard: number; score: import('./types').Score } | null = null;
  let iterations = 0;
  const orders: import('./construct').ConstructOrder[] = ['scarcity', 'lateFirst'];
  for (let oi = 0; oi < orders.length; oi++) {
    const remaining = budget - (Date.now() - t0b);
    if (remaining < 500 && oi > 0) break;
    const built = constructSchedule(input, model, orders[oi]);
    const share = oi === 0 ? Math.max(1500, remaining * 0.6) : Math.max(1000, remaining);
    const imp = await improveSchedule(input, model, built.A, {
      onProgress: opts.onProgress, isCancelled: cancelled,
      timeBudgetMs: share, progressFrom: 50, progressTo: 95,
    });
    iterations += imp.iterations;
    if (imp.cancelled) return aborted(t0);
    const ev = evaluateSchedule(input, model, built.A);
    const hard = ev.violations.filter((v) => v.hard).length;
    if (!best || hard < best.hard || (hard === best.hard && ev.score.total > best.score.total)) {
      best = { A: built.A, hard, score: ev.score };
    }
    // 首轮若无硬违反且无冲突，无需第二起点
    if (best.hard === 0 && conflicts.length === 0) break;
  }

  return finish(input, model, best!.A, conflicts, t0, iterations, prog);
}

function finish(
  input: SolveInput, model: ReturnType<typeof buildModel>, A: (number | null)[][],
  conflicts: Conflict[], t0: number, iterations: number,
  prog: (pct: number, msg: string) => void
): SolveOutput {
  // 阶段5：评估与报告
  prog(97, '正在生成评分与统计…');
  const evalResult = evaluateSchedule(input, model, A);
  prog(100, '排班完成');

  const hardCount = evalResult.violations.filter((v) => v.hard).length;
  const status: SolveOutput['status'] =
    hardCount === 0 && conflicts.length === 0 ? 'ok' : 'conflicts';

  return {
    status,
    assignments: A,
    conflicts,
    violations: evalResult.violations,
    score: evalResult.score,
    elapsedMs: Date.now() - t0,
    iterations,
    evalResult,
  };
}

function aborted(t0: number): SolveOutput {
  return {
    status: 'aborted', assignments: [], conflicts: [], violations: [],
    score: zeroScore(), elapsedMs: Date.now() - t0, iterations: 0, evalResult: null,
  };
}

function zeroScore(): Score {
  return { total: 0, hardRate: 0, demandRate: 0, prefRate: 0, fairness: 0, workFairness: 0, weekendFairness: 0, shiftFairness: [] };
}
