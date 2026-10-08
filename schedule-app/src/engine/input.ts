// 数据桥接：领域模型（Project） ↔ 引擎输入（SolveInput）
import type { Employee, Project, SpecialRule } from '../types';
import { clamp, dateISO, daysInMonth, isWeekend, parseHM, parseISODate, shiftCrossDay } from '../utils';
import type { EngEmployee, EngRule, EngShift, EvalResult, SolveInput, Weights } from './types';
import { buildModel, type Model } from './model';
import type { AssignMat } from './cost';
import { evaluateSchedule } from './evaluate';

export interface BuiltInput {
  input: SolveInput;
  /** 员工 id -> 引擎 idx */
  empIdx: Map<string, number>;
  /** 班次 id -> 引擎 idx */
  shiftIdx: Map<string, number>;
}

export function buildSolveInput(project: Project): BuiltInput {
  const year = project.year;
  const month = project.month;
  const days = daysInMonth(year, month);
  const activeEmployees = project.employees.filter((e) => e.active);

  const shiftIdx = new Map<string, number>();
  const shifts: EngShift[] = project.shifts.map((s, i) => {
    shiftIdx.set(s.id, i);
    const eff = s.allowConsecutive
      ? (s.maxConsecutiveDays > 0 ? s.maxConsecutiveDays : Infinity)
      : 1;
    return {
      idx: i, id: s.id, name: s.name, shortLabel: s.shortLabel || s.name.slice(0, 2),
      startMin: parseHM(s.startTime), endMin: parseHM(s.endTime),
      crossDay: shiftCrossDay(s.startTime, s.endTime),
      effMaxConsec: eff,
      fairnessWeight: s.fairnessWeight / 2,
    };
  });

  const empIdx = new Map<string, number>();
  const employees: EngEmployee[] = activeEmployees.map((e, i) => {
    empIdx.set(e.id, i);
    return {
      idx: i, id: e.id, name: e.name,
      targetWorkDays: e.targetWorkDays,
      targetTolerance: e.targetTolerance ?? 0,
      targetHard: e.targetHard,
      preferredShifts: new Set(
        e.preferences.preferredShifts.map((id) => shiftIdx.get(id)).filter((x): x is number => x !== undefined)
      ),
      avoidShifts: new Set(
        e.preferences.avoidShifts.map((id) => shiftIdx.get(id)).filter((x): x is number => x !== undefined)
      ),
      preferWeekendRest: e.preferences.preferWeekendRest,
    };
  });

  // 人力需求矩阵
  const demand: number[][] = [];
  for (let d = 0; d < days; d++) {
    const iso = dateISO(year, month, d + 1);
    const row = project.shifts.map((s) => project.requirements[iso]?.[s.id] ?? 0);
    demand.push(row);
  }

  // 特殊规则 -> 引擎规则（日期范围裁剪到本月）
  const rules: EngRule[] = [];
  for (const r of project.rules) {
    const eng = toEngRule(r, project, empIdx, shiftIdx, days);
    if (eng) rules.push(eng);
  }
  // 员工“尽量不上”偏好展开为软规则
  for (const emp of employees) {
    for (const s of emp.avoidShifts) {
      rules.push({ type: 'avoidShift', emp: emp.idx, d0: 0, d1: days - 1, shift: s });
    }
  }

  // 锁定与初始排班
  const E = employees.length;
  const lockedMask: boolean[][] = Array.from({ length: E }, () => Array(days).fill(false));
  let initial: (number | null)[][] | null = null;
  if (project.schedule) {
    initial = Array.from({ length: E }, () => Array(days).fill(null) as (number | null)[]);
    for (const emp of employees) {
      const row = project.schedule[emp.id];
      const lockRow = project.locks[emp.id];
      for (let d = 0; d < days; d++) {
        const v = row?.[d] ?? null;
        const si = v === null ? null : shiftIdx.get(v);
        initial[emp.idx][d] = si !== undefined && si !== null ? si : null;
        if (lockRow?.[d]) lockedMask[emp.idx][d] = true;
      }
    }
  }

  const w = project.globalRules.weights;
  const weights: Weights = {
    fairnessShift: w.fairnessShift,
    fairnessWork: w.fairnessWork,
    fairnessWeekend: w.fairnessWeekend,
    preference: w.preference,
    avoidConsecutive: w.avoidConsecutive,
  };

  const input: SolveInput = {
    year, month, days, employees, shifts, demand, rules,
    lockedMask, initial,
    weights,
    maxConsec: Math.max(1, project.globalRules.maxConsecutiveWorkDays),
    comfortConsec: project.globalRules.comfortConsecutiveDays,
    minRestHours: project.globalRules.minRestHours,
  };

  return { input, empIdx, shiftIdx };
}

function toEngRule(
  r: SpecialRule, project: Project,
  empIdx: Map<string, number>, shiftIdx: Map<string, number>, days: number
): EngRule | null {
  const e = empIdx.get(r.employeeId);
  if (e === undefined) return null;
  let start = parseISODate(r.dateStart);
  let end = parseISODate(r.dateEnd);
  if (!start || !end) return null;
  // 裁剪到项目月份
  if (start.year !== project.year || start.month !== project.month) {
    if (end.year !== project.year || end.month !== project.month) return null;
    start = { year: project.year, month: project.month, day: 1 };
  }
  if (end.year !== project.year || end.month !== project.month) {
    end = { year: project.year, month: project.month, day: daysInMonth(project.year, project.month) };
  }
  const d0 = clamp(start.day - 1, 0, days - 1);
  const d1 = clamp(end.day - 1, 0, days - 1);
  if (d0 > d1) return null;
  const shift = r.shiftId !== undefined ? (shiftIdx.get(r.shiftId) ?? -1) : -1;
  return { type: r.type, emp: e, d0, d1, shift };
}

/** 引擎结果 -> 项目排班表（shift idx -> id） */
export function assignmentsToSchedule(project: Project, built: BuiltInput, A: AssignMat): Record<string, (string | null)[]> {
  const out: Record<string, (string | null)[]> = {};
  for (const emp of project.employees) {
    const ei = built.empIdx.get(emp.id);
    if (ei === undefined) {
      out[emp.id] = Array.from({ length: built.input.days }, () => null);
      continue;
    }
    out[emp.id] = A[ei].map((v) =>
      v === null || v === undefined ? null : project.shifts[v]?.id ?? null
    );
  }
  return out;
}

/** 评估当前排班表（用于手工修改后的即时检查） */
export function evaluateProject(project: Project): { built: BuiltInput; model: Model; evalResult: EvalResult; A: AssignMat } | null {
  if (!project.schedule) return null;
  const built = buildSolveInput(project);
  if (built.input.employees.length === 0) return null;
  const model = buildModel(built.input);
  const A: AssignMat = built.input.initial
    ? built.input.initial.map((r) => [...r])
    : Array.from({ length: built.input.employees.length }, () =>
        Array(built.input.days).fill(null) as (number | null)[]
      );
  const evalResult = evaluateSchedule(built.input, model, A);
  return { built, model, evalResult, A };
}

export function employeeById(project: Project, id: string): Employee | undefined {
  return project.employees.find((e) => e.id === id);
}
