// 排班结果评估：硬约束违反清单、评分、统计、单元格解释
import type { Model } from './model';
import type { EmpStat, EvalResult, Score, SolveInput, Violation } from './types';
import { dayLabel, empName, shiftName } from './types';
import { restGapMinutes, shiftTimeText } from './time';
import { empHardViol, isWorked, makeCostCtx, applyChange, empCost, type AssignMat } from './cost';

function fairnessRate(counts: number[]): number {
  const n = counts.length;
  if (n === 0) return 1;
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  if (mean <= 0.0001) return 1;
  const varr = counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const sd = Math.sqrt(varr);
  return Math.max(0, Math.min(1, 1 - sd / (mean + 2)));
}

export function evaluateSchedule(input: SolveInput, model: Model, A: AssignMat): EvalResult {
  const E = input.employees.length;
  const D = input.days;
  const S = input.shifts.length;
  const ctx = makeCostCtx(input, model);
  for (let e = 0; e < E; e++) {
    for (let d = 0; d < D; d++) applyChange(ctx, e, d, null, A[e][d]);
  }

  const violations: Violation[] = [];
  let demandTotal = 0;
  let shortageCount = 0;
  let extraCount = 0;

  // 人力需求
  for (let d = 0; d < D; d++) {
    for (let s = 0; s < S; s++) {
      const req = input.demand[d][s];
      demandTotal += req;
      const f = ctx.filled[d][s];
      if (f < req) {
        shortageCount += req - f;
        violations.push({
          emp: -1, day: d, shift: s, hard: true, kind: 'shortage',
          message: `${dayLabel(input, d)}「${shiftName(input, s)}」需求 ${req} 人，当前仅安排 ${f} 人，缺 ${req - f} 人`,
        });
      } else if (f > req) {
        extraCount += f - req;
        violations.push({
          emp: -1, day: d, shift: s, hard: false, kind: 'extra',
          message: `${dayLabel(input, d)}「${shiftName(input, s)}」需求 ${req} 人，当前安排了 ${f} 人（超员 ${f - req} 人）`,
        });
      }
    }
  }

  // 员工维度
  const perEmp: EmpStat[] = [];
  let prefSatisfied = 0;
  let prefTotal = 0;
  let maxRunInfo: { emp: number; len: number } | null = null;

  for (let e = 0; e < E; e++) {
    const emp = input.employees[e];
    const shiftCnt = [...ctx.shiftCnt[e]];
    let maxRun = 0;
    let runs = 0;
    let run = 0;
    let runStart = -1;
    for (let d = 0; d < D; d++) {
      if (isWorked(A[e][d])) {
        if (run === 0) { runs++; runStart = d; }
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        if (run > input.maxConsec) {
          violations.push({
            emp: e, day: runStart + run - 1, shift: -1, hard: true, kind: 'consec',
            message: `${emp.name} ${dayLabel(input, runStart)}起连续工作 ${run} 天，超过最大连续工作 ${input.maxConsec} 天的限制`,
          });
        }
        run = 0;
      }
    }
    if (run > input.maxConsec) {
      violations.push({
        emp: e, day: runStart + run - 1, shift: -1, hard: true, kind: 'consec',
        message: `${emp.name} ${dayLabel(input, runStart)}起连续工作 ${run} 天，超过最大连续工作 ${input.maxConsec} 天的限制`,
      });
    }
    if (!maxRunInfo || maxRun > maxRunInfo.len) maxRunInfo = { emp: e, len: maxRun };

    // 同班次连续上限
    let sRun = 0;
    let sRunShift = -1;
    let sRunStart = -1;
    const checkSRun = (len: number, shift: number, start: number) => {
      const eff = input.shifts[shift]?.effMaxConsec ?? Infinity;
      if (Number.isFinite(eff) && len > eff) {
        violations.push({
          emp: e, day: start, shift, hard: true, kind: 'shiftConsec',
          message: `${emp.name} ${dayLabel(input, start)}起连续 ${len} 天上「${shiftName(input, shift)}」，超过该班次最多连续 ${eff} 天的限制`,
        });
      }
    };
    for (let d = 0; d < D; d++) {
      const v = A[e][d];
      if (isWorked(v)) {
        const s = v as number;
        if (s === sRunShift) sRun++;
        else {
          if (sRunShift >= 0) checkSRun(sRun, sRunShift, sRunStart);
          sRunShift = s; sRun = 1; sRunStart = d;
        }
      } else {
        if (sRunShift >= 0) checkSRun(sRun, sRunShift, sRunStart);
        sRunShift = -1; sRun = 0;
      }
    }
    if (sRunShift >= 0) checkSRun(sRun, sRunShift, sRunStart);

    // 班次间休息时间
    const minRest = input.minRestHours * 60;
    let prevD = -1;
    for (let d = 0; d < D; d++) {
      if (!isWorked(A[e][d])) continue;
      if (prevD >= 0 && minRest > 0) {
        const s1 = input.shifts[A[e][prevD] as number];
        const s2 = input.shifts[A[e][d] as number];
        const gap = restGapMinutes(s1, prevD, s2, d);
        if (gap < minRest) {
          violations.push({
            emp: e, day: d, shift: A[e][d] as number, hard: true, kind: 'rest',
            message: `${emp.name} ${dayLabel(input, prevD)}「${s1.name}」（${shiftTimeText(s1)}）结束与 ${dayLabel(input, d)}「${s2.name}」（${shiftTimeText(s2)}）开始之间仅休息 ${(gap / 60).toFixed(1)} 小时，低于要求的 ${input.minRestHours} 小时`,
          });
        }
      }
      prevD = d;
    }

    // 日期级硬规则
    for (let d = 0; d < D; d++) {
      const v = A[e][d];
      if (model.hardRestAt[e][d] && isWorked(v)) {
        violations.push({
          emp: e, day: d, shift: v as number, hard: true, kind: 'mustRest',
          message: `${emp.name} 要求 ${dayLabel(input, d)} 休息，但当天被安排了「${shiftName(input, v as number)}」`,
        });
      }
      if (model.mustWorkAt[e][d] && !isWorked(v)) {
        violations.push({
          emp: e, day: d, shift: -1, hard: true, kind: 'mustWork',
          message: `${emp.name} 要求 ${dayLabel(input, d)} 必须上班，但当天未被安排`,
        });
      }
      const ms = model.mustShiftAt[e][d];
      if (ms >= 0 && v !== ms) {
        violations.push({
          emp: e, day: d, shift: v as number, hard: true, kind: 'mustShift',
          message: `${emp.name} 要求 ${dayLabel(input, d)} 上「${shiftName(input, ms)}」，实际为${v === null ? '休息' : `「${shiftName(input, v as number)}」`}`,
        });
      }
      if (isWorked(v) && model.forbidAt[e][d][v as number]) {
        violations.push({
          emp: e, day: d, shift: v as number, hard: true, kind: 'forbidShift',
          message: `${emp.name} 被禁止上「${shiftName(input, v as number)}」，但在 ${dayLabel(input, d)} 被安排了该班次`,
        });
      }
      // 软偏好统计
      if (model.preferRestAt[e][d]) {
        prefTotal++;
        if (!isWorked(v)) prefSatisfied++;
      }
      if (isWorked(v)) {
        const s = v as number;
        if (model.avoidAt[e][d][s]) { prefTotal++; }
        else if (model.preferShiftAt[e][d] >= 0) {
          prefTotal++;
          if (s === model.preferShiftAt[e][d]) prefSatisfied++;
        } else if (emp.preferredShifts.size > 0) {
          prefTotal++;
          if (emp.preferredShifts.has(s)) prefSatisfied++;
        }
        if (emp.preferWeekendRest && ctx.weekend[d]) {
          prefTotal++;
        }
      }
    }

    // 硬性出勤目标
    if (emp.targetHard && emp.targetWorkDays != null) {
      const lo = Math.max(0, emp.targetWorkDays - emp.targetTolerance);
      const hi = emp.targetWorkDays + emp.targetTolerance;
      if (ctx.wd[e] < lo) {
        violations.push({
          emp: e, day: -1, shift: -1, hard: true, kind: 'target',
          message: `${emp.name} 本月出勤 ${ctx.wd[e]} 天，低于目标范围 ${lo}~${hi} 天`,
        });
      } else if (ctx.wd[e] > hi) {
        violations.push({
          emp: e, day: -1, shift: -1, hard: true, kind: 'target',
          message: `${emp.name} 本月出勤 ${ctx.wd[e]} 天，超过目标范围 ${lo}~${hi} 天`,
        });
      }
    }

    perEmp.push({
      wd: ctx.wd[e],
      rest: D - ctx.wd[e],
      shiftCnt,
      weekend: ctx.wkCnt[e],
      maxRun,
      runs,
      targetDev: emp.targetWorkDays != null ? ctx.wd[e] - emp.targetWorkDays : 0,
    });
  }

  // 评分
  const hardViolCount = violations.filter((v) => v.hard).length;
  const demandRate = demandTotal > 0 ? 1 - shortageCount / demandTotal : 1;
  const hardRate = demandTotal > 0 ? Math.max(0, 1 - hardViolCount / demandTotal) : hardViolCount === 0 ? 1 : 0;
  const prefRate = prefTotal > 0 ? prefSatisfied / prefTotal : 1;
  const workFairness = fairnessRate(perEmp.map((p) => p.wd));
  const weekendFairness = fairnessRate(perEmp.map((p) => p.weekend));
  const shiftFairness = input.shifts.map((_, s) => fairnessRate(perEmp.map((p) => p.shiftCnt[s])));
  const shiftFairnessAvg = shiftFairness.length
    ? shiftFairness.reduce((a, b, i) => a + b * (input.shifts[i].fairnessWeight / 2), 0) /
      input.shifts.reduce((a, sh) => a + sh.fairnessWeight / 2, 0)
    : 1;
  const fairness = (shiftFairnessAvg + workFairness + weekendFairness) / 3;
  let total = Math.round(100 * (0.4 * hardRate + 0.25 * demandRate + 0.1 * prefRate + 0.25 * fairness));
  if (hardViolCount > 0) total = Math.min(total, 74);
  const score: Score = { total, hardRate, demandRate, prefRate, fairness, workFairness, weekendFairness, shiftFairness };

  return {
    violations, score, filled: ctx.filled, demandTotal,
    shortageCount, extraCount, perEmp, prefSatisfied, prefTotal, maxRun: maxRunInfo,
  };
}

/** 排班单元格解释（第二十二章） */
export interface CellExplain {
  empName: string;
  dateLabel: string;
  shiftName: string;
  wd: number;
  restDays: number;
  thisShiftCount: number;
  weekend: number;
  curRun: number;
  prevShift: string;
  nextShift: string;
  restGapPrev: { hours: number; ok: boolean } | null;
  restGapNext: { hours: number; ok: boolean } | null;
  ruleHits: { text: string; satisfied: boolean }[];
  staffing: { cur: number; req: number } | null;
  notes: string[];
}

export function explainCell(
  input: SolveInput, model: Model, A: AssignMat, res: EvalResult, e: number, d: number
): CellExplain {
  const emp = input.employees[e];
  const D = input.days;
  const v = A[e][d];
  const s = isWorked(v) ? (v as number) : -1;
  const stat = res.perEmp[e];

  // 当前连续工作天数（含当天）
  let curRun = 0;
  for (let i = d; i >= 0 && isWorked(A[e][i]); i--) curRun++;
  for (let i = d + 1; i < D && isWorked(A[e][i]); i++) curRun++;

  const prevWorked = (() => {
    for (let i = d - 1; i >= 0; i--) if (isWorked(A[e][i])) return i;
    return -1;
  })();
  const nextWorked = (() => {
    for (let i = d + 1; i < D; i++) if (isWorked(A[e][i])) return i;
    return -1;
  })();

  const gapInfo = (from: number, to: number): { hours: number; ok: boolean } | null => {
    if (from < 0 || to < 0) return null;
    const gap = restGapMinutes(input.shifts[A[e][from] as number], from, input.shifts[A[e][to] as number], to);
    return { hours: Math.round(gap / 60 * 10) / 10, ok: gap >= input.minRestHours * 60 };
  };

  const ruleHits: { text: string; satisfied: boolean }[] = [];
  if (model.hardRestAt[e][d]) ruleHits.push({ text: '要求当天休息（硬性）', satisfied: s < 0 });
  if (model.mustWorkAt[e][d]) ruleHits.push({ text: '要求当天必须上班（硬性）', satisfied: s >= 0 });
  if (model.mustShiftAt[e][d] >= 0) ruleHits.push({ text: `要求当天上「${shiftName(input, model.mustShiftAt[e][d])}」（硬性）`, satisfied: s === model.mustShiftAt[e][d] });
  if (model.forbidAt[e][d].some((f, si) => f)) {
    const forbiddens = model.forbidAt[e][d].map((f, si) => (f ? shiftName(input, si) : null)).filter(Boolean);
    ruleHits.push({ text: `禁止上班次：${forbiddens.join('、')}（硬性）`, satisfied: s < 0 || !model.forbidAt[e][d][s] });
  }
  if (model.preferRestAt[e][d]) ruleHits.push({ text: '偏好当天休息（尽量）', satisfied: s < 0 });
  if (model.preferShiftAt[e][d] >= 0) ruleHits.push({ text: `偏好上「${shiftName(input, model.preferShiftAt[e][d])}」（尽量）`, satisfied: s === model.preferShiftAt[e][d] });
  if (s >= 0 && model.avoidAt[e][d][s]) ruleHits.push({ text: `尽量回避「${shiftName(input, s)}」`, satisfied: false });
  if (emp.preferWeekendRest && ctx_weekend(input, d)) ruleHits.push({ text: '尽量周末休息', satisfied: s < 0 });

  const notes: string[] = [];
  if (curRun > input.maxConsec) notes.push(`当前连续工作 ${curRun} 天，已超过上限 ${input.maxConsec} 天`);
  else if (input.comfortConsec > 0 && curRun > input.comfortConsec) notes.push(`连续工作已达 ${curRun} 天，接近上限`);
  if (emp.targetWorkDays != null) {
    notes.push(`目标出勤 ${emp.targetWorkDays}±${emp.targetTolerance} 天，当前已安排 ${stat.wd} 天`);
  }

  return {
    empName: emp.name,
    dateLabel: dayLabel(input, d),
    shiftName: s >= 0 ? shiftName(input, s) : '休息',
    wd: stat.wd,
    restDays: stat.rest,
    thisShiftCount: s >= 0 ? stat.shiftCnt[s] : 0,
    weekend: stat.weekend,
    curRun,
    prevShift: prevWorked >= 0 ? shiftName(input, A[e][prevWorked] as number) : '—',
    nextShift: nextWorked >= 0 ? shiftName(input, A[e][nextWorked] as number) : '—',
    restGapPrev: gapInfo(prevWorked, d),
    restGapNext: gapInfo(d, nextWorked),
    ruleHits,
    staffing: s >= 0 ? { cur: res.filled[d][s], req: input.demand[d][s] } : null,
    notes,
  };
}

function ctx_weekend(input: SolveInput, d: number): boolean {
  const w = new Date(input.year, input.month, d + 1).getDay();
  return w === 0 || w === 6;
}

/** 导出用：评估摘要（供评分展示与统计页使用） */
export function evalSummary(res: EvalResult): string {
  return `硬违反 ${res.violations.filter((v) => v.hard).length} 项，缺口 ${res.shortageCount} 人次，超员 ${res.extraCount} 人次`;
}

export { empCost, empHardViol };
