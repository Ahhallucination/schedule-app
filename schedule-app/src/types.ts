// 领域数据类型定义（与排班引擎解耦）

/** 班次调色板（柔和、专业） */
export interface ShiftColor {
  /** 单元格背景 Tailwind class */
  bg: string;
  /** 文字 Tailwind class */
  text: string;
  /** Excel 单元格背景 hex */
  hexBg: string;
  /** Excel 文字 hex */
  hexText: string;
  /** 圆点颜色 Tailwind class */
  dot: string;
}

export const SHIFT_PALETTE: ShiftColor[] = [
  { bg: 'bg-sky-100',   text: 'text-sky-700',   hexBg: 'FFE0F2FE', hexText: 'FF0369A1', dot: 'bg-sky-500' },
  { bg: 'bg-amber-100', text: 'text-amber-700', hexBg: 'FFFEF3C7', hexText: 'FFB45309', dot: 'bg-amber-500' },
  { bg: 'bg-violet-100',text: 'text-violet-700',hexBg: 'FFEDE9FE', hexText: 'FF6D28D9', dot: 'bg-violet-500' },
  { bg: 'bg-emerald-100',text:'text-emerald-700',hexBg: 'FFD1FAE5', hexText: 'FF047857', dot: 'bg-emerald-500' },
  { bg: 'bg-rose-100',  text: 'text-rose-700',  hexBg: 'FFFFE4E6', hexText: 'FFBE123C', dot: 'bg-rose-500' },
  { bg: 'bg-teal-100',  text: 'text-teal-700',  hexBg: 'FFCCFBF1', hexText: 'FF0F766E', dot: 'bg-teal-500' },
  { bg: 'bg-orange-100',text: 'text-orange-700',hexBg: 'FFFFEDD5', hexText: 'FFC2410C', dot: 'bg-orange-500' },
  { bg: 'bg-indigo-100',text: 'text-indigo-700',hexBg: 'FFE0E7FF', hexText: 'FF4338CA', dot: 'bg-indigo-500' },
  { bg: 'bg-lime-100',  text: 'text-lime-700',  hexBg: 'FFECFCCB', hexText: 'FF4D7C0F', dot: 'bg-lime-600' },
  { bg: 'bg-cyan-100',  text: 'text-cyan-700',  hexBg: 'FFCFFAFE', hexText: 'FF0E7490', dot: 'bg-cyan-600' },
];

export const REST_COLOR: ShiftColor = {
  bg: 'bg-slate-100', text: 'text-slate-400', hexBg: 'FFF1F5F9', hexText: 'FF94A3B8', dot: 'bg-slate-400',
};

/** 班次（完全自定义，不写死任何班次） */
export interface Shift {
  id: string;
  name: string;
  /** 单元格中的简短显示（如 白 / 中 / 夜） */
  shortLabel: string;
  startTime: string; // "08:00"
  endTime: string;   // "17:00"
  crossDay: boolean; // 是否跨天（end <= start 时自动为 true）
  /** 默认每日需求人数（用于初始化人力需求表） */
  defaultCount: number;
  /** 是否允许员工连续安排该班次 */
  allowConsecutive: boolean;
  /** 允许连续时最多连续天数，0 = 不限 */
  maxConsecutiveDays: number;
  /** 该班次分配公平的优先级 1低 2中 3高 */
  fairnessWeight: 1 | 2 | 3;
  note: string;
  /** 调色板索引 */
  color: number;
}

/** 员工 */
export interface Employee {
  id: string;
  name: string;
  employeeCode: string;
  skills: string[]; // 岗位/技能
  active: boolean;
  /** 本月目标出勤天数 */
  targetWorkDays: number | null;
  /** 允许浮动 ± */
  targetTolerance: number;
  /** 出勤要求是否为硬约束 */
  targetHard: boolean;
  preferences: {
    /** 喜欢的班次 */
    preferredShifts: string[];
    /** 尽量不上的班次 */
    avoidShifts: string[];
    /** 尽量周末休息 */
    preferWeekendRest: boolean;
  };
}

/** 员工特殊排班要求（日期级 / 班次级 / 范围级） */
export type RuleType =
  | 'mustRest'      // 指定日期（范围）必须休息 —— 硬
  | 'mustWork'      // 指定日期必须上班 —— 硬
  | 'mustShift'     // 指定日期必须上某班次 —— 硬
  | 'forbidShift'   // 日期范围内不能上某班次 —— 硬
  | 'preferRest'    // 尽量休息 —— 软
  | 'preferShift'   // 尽量上某班次 —— 软
  | 'avoidShift';   // 尽量不上某班次 —— 软

export interface SpecialRule {
  id: string;
  employeeId: string;
  type: RuleType;
  /** ISO 日期 yyyy-mm-dd；范围为起始日 */
  dateStart: string;
  /** 单日规则时与 dateStart 相同 */
  dateEnd: string;
  /** 班次相关规则的班次 id */
  shiftId?: string;
  note: string;
}

export const RULE_TYPE_INFO: Record<RuleType, {
  label: string; hard: boolean; needShift: boolean; allowRange: boolean; desc: string;
}> = {
  mustRest:    { label: '必须休息', hard: true,  needShift: false, allowRange: true,  desc: '指定日期（或范围）必须休息，不安排任何班次' },
  mustWork:    { label: '必须上班', hard: true,  needShift: false, allowRange: false, desc: '指定日期必须安排上班（任一班次）' },
  mustShift:   { label: '指定班次', hard: true,  needShift: true,  allowRange: false, desc: '指定日期必须上某个班次' },
  forbidShift: { label: '禁止班次', hard: true,  needShift: true,  allowRange: true,  desc: '日期范围内不能上某个班次' },
  preferRest:  { label: '尽量休息', hard: false, needShift: false, allowRange: true,  desc: '尽量在指定日期安排休息' },
  preferShift: { label: '偏好班次', hard: false, needShift: true,  allowRange: true,  desc: '尽量安排上某个班次' },
  avoidShift:  { label: '回避班次', hard: false, needShift: true,  allowRange: true,  desc: '尽量不安排上某个班次' },
};

/** 全局排班规则 */
export interface GlobalRules {
  /** 连续工作最多 N 天（硬） */
  maxConsecutiveWorkDays: number;
  /** 尽量避免连续工作超过 N 天（软，0 = 关闭） */
  comfortConsecutiveDays: number;
  /** 两次工作之间至少休息 N 小时（硬，按班次实际时间计算） */
  minRestHours: number;
  /** 软约束权重 1-5 */
  weights: {
    fairnessShift: number;   // 班次分配公平（含夜班公平）
    fairnessWork: number;    // 出勤天数均衡
    fairnessWeekend: number; // 周末班公平
    preference: number;      // 员工偏好满足
    avoidConsecutive: number;// 尽量避免连续工作
  };
}

export function defaultGlobalRules(): GlobalRules {
  return {
    maxConsecutiveWorkDays: 6,
    comfortConsecutiveDays: 5,
    minRestHours: 12,
    weights: { fairnessShift: 4, fairnessWork: 3, fairnessWeekend: 3, preference: 3, avoidConsecutive: 2 },
  };
}

/** 排班结果元信息 */
export interface ScheduleMeta {
  generatedAt: number;
  status: 'ok' | 'conflicts';
  total: number;
  hardRate: number;
  demandRate: number;
  prefRate: number;
  fairness: number;
  elapsedMs: number;
}

/** 排班项目：员工 + 班次 + 规则 + 排班结果 + 设置 */
export interface Project {
  id: string;
  name: string;
  year: number;
  /** 0-11 */
  month: number;
  createdAt: number;
  updatedAt: number;
  employees: Employee[];
  shifts: Shift[];
  /** dateISO -> shiftId -> 需求人数 */
  requirements: Record<string, Record<string, number>>;
  /** 员工特殊要求 */
  rules: SpecialRule[];
  globalRules: GlobalRules;
  /** empId -> [dayIdx] -> shiftId | null(休) */
  schedule: Record<string, (string | null)[]> | null;
  /** empId -> [dayIdx] -> 是否锁定 */
  locks: Record<string, boolean[]>;
  scheduleMeta: ScheduleMeta | null;
  notes: string;
}

/** 应用偏好 */
export interface Prefs {
  showCodeColumn: boolean;
  /** 隐藏的班次页签 shiftId */
  hiddenShiftTabs: string[];
}

export interface DB {
  version: 1;
  projects: Project[];
  activeId: string | null;
  prefs: Prefs;
}

export function defaultPrefs(): Prefs {
  return { showCodeColumn: false, hiddenShiftTabs: [] };
}
