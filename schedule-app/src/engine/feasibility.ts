// 可行性检测：人力池、每日最大匹配（max-flow / 匈牙利增广）、全局容量
// 输出明确的冲突原因与修改建议
import type { Conflict, SolveInput } from './types';
import { dayLabel, empName, shiftName } from './types';
import type { Model } from './model';

/** 某员工在 d 日是否可上 s 班（静态规则 + 锁定约束） */
function canWork(input: SolveInput, model: Model, e: number, d: number, s: number): boolean {
  if (!model.allowed[e][d][s]) return false;
  if (input.lockedMask[e]?.[d] && input.initial) return input.initial[e][d] === s;
  return true;
}

/** 一天内：每人最多一个班次，验证需求能否被满足（二部图最大匹配，Kuhn 增广） */
function dayMaxMatch(input: SolveInput, model: Model, d: number): { matched: number; perShift: number[] } {
  const E = input.employees.length;
  const S = input.shifts.length;
  const slots: number[] = [];
  for (let s = 0; s < S; s++) {
    for (let k = 0; k < input.demand[d][s]; k++) slots.push(s);
  }
  if (slots.length === 0 || E === 0) return { matched: 0, perShift: Array(S).fill(0) };

  // 邻接缓存：slot 的班次 -> 可用员工列表
  const adj: number[][] = Array.from({ length: S }, () => []);
  for (let s = 0; s < S; s++) {
    for (let e = 0; e < E; e++) if (canWork(input, model, e, d, s)) adj[s].push(e);
  }

  const matchEmp = new Int32Array(E).fill(-1); // 员工 -> slot
  const used = new Uint8Array(E);
  let matched = 0;

  const augment = (si: number): boolean => {
    const s = slots[si];
    for (const e of adj[s]) {
      if (used[e]) continue;
      used[e] = 1;
      if (matchEmp[e] === -1 || augment(matchEmp[e])) {
        matchEmp[e] = si;
        return true;
      }
    }
    return false;
  };

  for (let si = 0; si < slots.length; si++) {
    used.fill(0);
    if (augment(si)) matched++;
  }

  const perShift = Array(S).fill(0);
  for (let e = 0; e < E; e++) {
    if (matchEmp[e] >= 0) perShift[slots[matchEmp[e]]]++;
  }
  return { matched, perShift };
}

/** 员工当月最大可工作天数（考虑连续工作上限与硬性休息日） */
function empCapacity(input: SolveInput, model: Model, e: number): number {
  const D = input.days;
  let freeDays = 0;
  for (let d = 0; d < D; d++) {
    if (model.hardRestAt[e][d]) continue;
    if (input.lockedMask[e]?.[d] && input.initial && input.initial[e][d] === null) continue;
    if (input.shifts.some((_, s) => model.allowed[e][d][s])) freeDays++;
  }
  const L = Math.max(1, input.maxConsec);
  const consecCap = D - Math.floor(D / (L + 1));
  return Math.min(freeDays, consecCap);
}

export interface FeasibilityResult {
  conflicts: Conflict[];
}

export function checkFeasibility(input: SolveInput, model: Model): FeasibilityResult {
  const conflicts: Conflict[] = [];
  const D = input.days;
  const S = input.shifts.length;
  const E = input.employees.length;

  if (E === 0) {
    conflicts.push({
      message: '没有可排班的员工（员工列表为空或全部停用）',
      suggestions: ['请到「员工管理」添加或导入员工', '检查员工是否被设置为停用状态'],
    });
    return { conflicts };
  }
  if (S === 0) {
    conflicts.push({
      message: '没有班次，无法排班',
      suggestions: ['请到「班次管理」创建班次'],
    });
    return { conflicts };
  }
  let demandTotal = 0;
  for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) demandTotal += input.demand[d][s];
  if (demandTotal === 0) {
    conflicts.push({
      message: '人力需求为空：每一天、每个班次的需求人数都是 0',
      suggestions: ['请到「人力需求」设置各班次每天需要的人数', '可使用「工作日/周末模板」快速填充'],
    });
    return { conflicts };
  }

  // 1. 每天每班次：可用人力池 < 需求
  for (let d = 0; d < D; d++) {
    for (let s = 0; s < S; s++) {
      const req = input.demand[d][s];
      if (req <= 0) continue;
      if (model.pools[d][s] < req) {
        conflicts.push({
          message: `${dayLabel(input, d)}「${shiftName(input, s)}」需要 ${req} 人，但符合条件且当天可以工作的员工只有 ${model.pools[d][s]} 人`,
          suggestions: [
            `将 ${dayLabel(input, d)}「${shiftName(input, s)}」的需求从 ${req} 人调整为 ${model.pools[d][s]} 人`,
            `放宽当天的限制（检查「排班规则」中该日的休息、禁班要求）`,
            `增加可上「${shiftName(input, s)}」的员工`,
          ],
        });
      }
    }
  }

  // 2. 每日整体匹配（含一天最多一班、锁定占用）
  for (let d = 0; d < D; d++) {
    const total = input.demand[d].reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const { matched, perShift } = dayMaxMatch(input, model, d);
    if (matched < total) {
      const shortShifts: string[] = [];
      for (let s = 0; s < S; s++) {
        const gap = input.demand[d][s] - perShift[s];
        if (gap > 0) shortShifts.push(`「${shiftName(input, s)}」缺 ${gap} 人`);
      }
      conflicts.push({
        message: `${dayLabel(input, d)}人力需求共 ${total} 人，但当天每人最多一班，最多只能安排 ${matched} 人${shortShifts.length ? '（' + shortShifts.join('，') + '）' : ''}`,
        suggestions: [
          `减少 ${dayLabel(input, d)} 的总需求（如降低部分班次人数）`,
          `放宽当天限制员工的规则`,
          `增加当天可上班的员工`,
        ],
      });
    }
  }

  // 3. 全局容量：总需求 vs 员工最大可提供人次
  let capacity = 0;
  for (const e of input.employees) capacity += empCapacity(input, model, e.idx);
  if (demandTotal > capacity) {
    conflicts.push({
      message: `本月总需求 ${demandTotal} 人次，超过 ${E} 名员工在本月最多可提供的 ${capacity} 人次（已考虑连续工作上限与休息要求）`,
      suggestions: [
        '减少每日人力需求',
        '增加员工人数',
        `放宽连续工作限制（当前最多连续 ${input.maxConsec} 天）`,
      ],
    });
  }

  // 4. 硬性出勤目标：合计下限超过需求总量
  let minTargetSum = 0;
  for (const e of input.employees) {
    if (e.targetHard && e.targetWorkDays != null) {
      const cap = empCapacity(input, model, e.idx);
      const minT = Math.max(0, e.targetWorkDays - e.targetTolerance);
      if (minT > cap) {
        conflicts.push({
          message: `${e.name} 的出勤目标至少 ${minT} 天，但该员工本月最多只能安排 ${cap} 天（受休息要求和连续工作上限约束）`,
          suggestions: [`降低 ${e.name} 的目标出勤天数`, '放宽其休息或禁班规则', `放宽连续工作限制`],
        });
      }
      minTargetSum += minT;
    }
  }
  if (minTargetSum > demandTotal) {
    conflicts.push({
      message: `员工硬性出勤目标合计至少 ${minTargetSum} 天，超过本月总需求 ${demandTotal} 人次`,
      suggestions: ['提高每日人力需求', '将部分员工的出勤目标改为“尽量接近”（软约束）', '降低目标天数'],
    });
  }

  // 5. 必须上班日：当天无任何可上班次
  for (const e of input.employees) {
    for (let d = 0; d < D; d++) {
      if (!model.mustWorkAt[e.idx][d]) continue;
      const hasShift = input.shifts.some((_, s) => model.allowed[e.idx][d][s]);
      if (!hasShift) {
        conflicts.push({
          message: `${e.name} 要求 ${dayLabel(input, d)} 必须上班，但当天没有任何可安排的班次（被禁班/休息规则限制）`,
          suggestions: [`删除 ${e.name} 在 ${dayLabel(input, d)} 的禁班或休息规则`, `取消该日“必须上班”要求`],
        });
      }
    }
  }

  return { conflicts };
}
