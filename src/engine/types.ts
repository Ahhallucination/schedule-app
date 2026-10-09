// 排班引擎类型定义（纯算法层，不依赖 UI / DOM）

export interface EngEmployee {
  idx: number;
  id: string;
  name: string;
  targetWorkDays: number | null;
  targetTolerance: number;
  targetHard: boolean;
  /** 喜欢的班次（shift idx） */
  preferredShifts: Set<number>;
  /** 尽量不上的班次（shift idx） */
  avoidShifts: Set<number>;
  /** 尽量周末休息 */
  preferWeekendRest: boolean;
}

export interface EngShift {
  idx: number;
  id: string;
  name: string;
  shortLabel: string;
  startMin: number;
  endMin: number;
  crossDay: boolean;
  /** 有效连续上限：Infinity=不限；1=不允许连续两天 */
  effMaxConsec: number;
  /** 公平权重 0.5 / 1 / 1.5 */
  fairnessWeight: number;
}

export type ERuleType =
  | 'mustRest' | 'mustWork' | 'mustShift' | 'forbidShift'
  | 'preferRest' | 'preferShift' | 'avoidShift';

export interface EngRule {
  type: ERuleType;
  /** 员工 idx */
  emp: number;
  /** 起始日 idx（含） */
  d0: number;
  /** 结束日 idx（含） */
  d1: number;
  /** 班次 idx，-1 = 无 */
  shift: number;
}

export interface Weights {
  fairnessShift: number;
  fairnessWork: number;
  fairnessWeekend: number;
  preference: number;
  avoidConsecutive: number;
}

export interface SolveInput {
  year: number;
  /** 0-11 */
  month: number;
  days: number;
  employees: EngEmployee[];
  shifts: EngShift[];
  /** demand[day][shift] */
  demand: number[][];
  rules: EngRule[];
  /** lockedMask[emp][day]：锁定后不可被算法改变 */
  lockedMask: boolean[][];
  /** initial[emp][day]：锁定值 / 热启动来源；可为 null */
  initial: (number | null)[][] | null;
  weights: Weights;
  maxConsec: number;
  comfortConsec: number;
  minRestHours: number;
}

export interface Violation {
  emp: number; // -1 = 无特定员工
  day: number; // -1 = 无特定日期
  shift: number; // -1 = 无特定班次
  kind: string;
  message: string;
  hard: boolean;
}

export interface Conflict {
  message: string;
  suggestions: string[];
}

export interface Score {
  total: number;
  hardRate: number;
  demandRate: number;
  prefRate: number;
  fairness: number;
  workFairness: number;
  weekendFairness: number;
  /** 每个班次的公平度 */
  shiftFairness: number[];
}

export interface EmpStat {
  wd: number;
  rest: number;
  shiftCnt: number[];
  weekend: number;
  maxRun: number;
  runs: number;
  targetDev: number;
}

export interface EvalResult {
  violations: Violation[];
  score: Score;
  /** filled[day][shift] */
  filled: number[][];
  demandTotal: number;
  shortageCount: number;
  extraCount: number;
  perEmp: EmpStat[];
  prefSatisfied: number;
  prefTotal: number;
  maxRun: { emp: number; len: number } | null;
}

export function dayLabel(input: SolveInput, d: number): string {
  return `${input.month + 1}月${d + 1}日`;
}

export function empName(input: SolveInput, e: number): string {
  return input.employees[e]?.name ?? '?';
}

export function shiftName(input: SolveInput, s: number): string {
  return input.shifts[s]?.name ?? '?';
}
