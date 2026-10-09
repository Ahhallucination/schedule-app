// 本地持久化：localStorage，自动保存 + 恢复
import type { DB, Project, Prefs } from './types';
import { defaultPrefs, defaultGlobalRules } from './types';
import { daysInMonth, dateISO } from './utils';
import { uid } from './utils';

const KEY = 'schedkeeper.db.v1';

export function emptyDB(): DB {
  return { version: 1, projects: [], activeId: null, prefs: defaultPrefs() };
}

/** 形状校验与修复，避免脏数据导致崩溃 */
function sanitizeProject(p: any): Project | null {
  if (!p || typeof p !== 'object') return null;
  const year = Number(p.year) || new Date().getFullYear();
  const month = Number(p.month);
  const proj: Project = {
    id: String(p.id || uid()),
    name: String(p.name || '未命名排班'),
    year,
    month: Number.isFinite(month) && month >= 0 && month <= 11 ? month : 0,
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
    employees: Array.isArray(p.employees) ? p.employees : [],
    shifts: Array.isArray(p.shifts) ? p.shifts : [],
    requirements: p.requirements && typeof p.requirements === 'object' ? p.requirements : {},
    rules: Array.isArray(p.rules) ? p.rules : [],
    globalRules: { ...defaultGlobalRules(), ...(p.globalRules || {}) },
    schedule: p.schedule && typeof p.schedule === 'object' ? p.schedule : null,
    locks: p.locks && typeof p.locks === 'object' ? p.locks : {},
    scheduleMeta: p.scheduleMeta || null,
    notes: String(p.notes || ''),
  };
  return proj;
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDB();
    const data = JSON.parse(raw);
    const db: DB = {
      version: 1,
      projects: (Array.isArray(data.projects) ? data.projects : [])
        .map(sanitizeProject)
        .filter((p: Project | null): p is Project => p !== null),
      activeId: typeof data.activeId === 'string' ? data.activeId : null,
      prefs: { ...defaultPrefs(), ...(data.prefs || {}) } as Prefs,
    };
    if (db.activeId && !db.projects.some((p) => p.id === db.activeId)) db.activeId = null;
    return db;
  } catch {
    return emptyDB();
  }
}

export function saveDB(db: DB): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return { ok: true };
  } catch (e: any) {
    const msg =
      e && e.name === 'QuotaExceededError'
        ? '浏览器存储空间不足，无法保存。可删除不再使用的排班项目后重试。'
        : `保存失败：${e?.message || '未知错误'}`;
    return { ok: false, error: msg };
  }
}

export function estimateStorageKB(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Math.round((raw.length * 2) / 1024) : 0;
  } catch {
    return 0;
  }
}

export function clearAllData() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 常见三班模板（用户可自由修改/删除，程序不写死任何班次逻辑） */
export function defaultShiftTemplates() {
  const mk = (name: string, shortLabel: string, start: string, end: string, note: string) => ({
    id: uid(),
    name,
    shortLabel,
    startTime: start,
    endTime: end,
    crossDay: end <= start,
    defaultCount: 1,
    allowConsecutive: true,
    maxConsecutiveDays: 0,
    fairnessWeight: 2 as const,
    note,
    color: 0,
  });
  return [
    { ...mk('白班', '白', '08:00', '17:00', '日班'), color: 0 },
    { ...mk('中班', '中', '16:00', '00:00', '傍晚至午夜，跨天'), color: 1 },
    { ...mk('夜班', '夜', '00:00', '08:00', '凌晨班，跨天'), color: 2, maxConsecutiveDays: 3 },
  ];
}

export interface CreateProjectOpts {
  name: string;
  year: number;
  month: number;
  useTemplate: boolean;
  copyFromId?: string | null;
}

export function createProject(db: DB, opts: CreateProjectOpts): Project {
  const days = daysInMonth(opts.year, opts.month);
  let employees = [] as Project['employees'];
  let shifts = [] as Project['shifts'];
  let rules = [] as Project['rules'];
  let globalRules = defaultGlobalRules();

  if (opts.copyFromId) {
    const src = db.projects.find((p) => p.id === opts.copyFromId);
    if (src) {
      employees = structuredClone(src.employees);
      shifts = structuredClone(src.shifts);
      rules = structuredClone(src.rules);
      globalRules = structuredClone(src.globalRules);
    }
  } else if (opts.useTemplate) {
    shifts = defaultShiftTemplates() as Project['shifts'];
  }

  const requirements: Record<string, Record<string, number>> = {};
  for (let d = 0; d < days; d++) {
    const iso = dateISO(opts.year, opts.month, d + 1);
    const row: Record<string, number> = {};
    for (const s of shifts) row[s.id] = s.defaultCount;
    requirements[iso] = row;
  }

  const project: Project = {
    id: uid(),
    name: opts.name,
    year: opts.year,
    month: opts.month,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    employees,
    shifts,
    requirements,
    rules,
    globalRules,
    schedule: null,
    locks: {},
    scheduleMeta: null,
    notes: '',
  };
  return project;
}

export function newShiftFor(project: Project): Project['shifts'][number] {
  return {
    id: uid(),
    name: '',
    shortLabel: '',
    startTime: '08:00',
    endTime: '17:00',
    crossDay: false,
    defaultCount: 1,
    allowConsecutive: true,
    maxConsecutiveDays: 0,
    fairnessWeight: 2,
    note: '',
    color: project.shifts.length % 10,
  };
}

/** 新增班次后，为所有日期补齐该班次的默认需求 */
export function prefillShiftRequirements(project: Project, shiftId: string, count: number) {
  const days = daysInMonth(project.year, project.month);
  for (let d = 0; d < days; d++) {
    const iso = dateISO(project.year, project.month, d + 1);
    if (!project.requirements[iso]) project.requirements[iso] = {};
    if (project.requirements[iso][shiftId] === undefined) {
      project.requirements[iso][shiftId] = count;
    }
  }
}

/** 删除班次时清理需求、规则与排班引用 */
export function removeShiftEverywhere(project: Project, shiftId: string) {
  project.shifts = project.shifts.filter((s) => s.id !== shiftId);
  for (const iso of Object.keys(project.requirements)) {
    delete project.requirements[iso][shiftId];
  }
  project.rules = project.rules.filter((r) => r.shiftId !== shiftId);
  for (const emp of project.employees) {
    emp.preferences.preferredShifts = emp.preferences.preferredShifts.filter((id) => id !== shiftId);
    emp.preferences.avoidShifts = emp.preferences.avoidShifts.filter((id) => id !== shiftId);
  }
  if (project.schedule) {
    for (const empId of Object.keys(project.schedule)) {
      project.schedule[empId] = project.schedule[empId].map((v) => (v === shiftId ? null : v));
    }
  }
}
