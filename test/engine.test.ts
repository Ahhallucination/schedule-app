// 排班引擎测试：覆盖需求文档第三十四章的测试矩阵
import { solveSchedule } from '../src/engine/solve';
import { buildSolveInput, evaluateProject, assignmentsToSchedule } from '../src/engine/input';
import { buildModel } from '../src/engine/model';
import { evaluateSchedule } from '../src/engine/evaluate';
import { parseNameList, dateISO, daysInMonth } from '../src/utils';
import type { Employee, Project, Shift, SpecialRule } from '../src/types';
import { defaultGlobalRules } from '../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error('  ✗ FAIL:', msg);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string) {
  assert(actual === expected, `${msg}（期望 ${expected}，实际 ${actual}）`);
}

let idCounter = 0;
const nid = () => `t${++idCounter}`;

function mkEmployee(name: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id: nid(), name, employeeCode: '', skills: [], active: true,
    targetWorkDays: null, targetTolerance: 0, targetHard: false,
    preferences: { preferredShifts: [], avoidShifts: [], preferWeekendRest: false },
    ...overrides,
  };
}

function mkShift(name: string, start: string, end: string, overrides: Partial<Shift> = {}): Shift {
  return {
    id: nid(), name, shortLabel: name.slice(0, 2), startTime: start, endTime: end,
    crossDay: end <= start, defaultCount: 1, allowConsecutive: true,
    maxConsecutiveDays: 0, fairnessWeight: 2, note: '', color: 0,
    ...overrides,
  };
}

interface ProjectOpts {
  empCount?: number;
  year?: number;
  month?: number;
  shifts: Shift[];
  /** (dayIdx, shiftIdx) -> 需求 */
  demand: (day: number, shift: number, days: number, weekend: boolean) => number;
  employees?: Employee[];
  rules?: SpecialRule[];
  globalOverrides?: Partial<ReturnType<typeof defaultGlobalRules>>;
  schedule?: Record<string, (string | null)[]>;
  locks?: Record<string, boolean[]>;
}

function mkProject(opts: ProjectOpts): Project {
  const year = opts.year ?? 2026;
  const month = opts.month ?? 10; // 11月
  const days = daysInMonth(year, month);
  const employees = opts.employees ?? Array.from({ length: opts.empCount ?? 10 }, (_, i) => mkEmployee(`员工${i + 1}`));
  const requirements: Record<string, Record<string, number>> = {};
  for (let d = 0; d < days; d++) {
    const iso = dateISO(year, month, d + 1);
    const w = new Date(year, month, d + 1).getDay();
    const weekend = w === 0 || w === 6;
    const row: Record<string, number> = {};
    opts.shifts.forEach((s, si) => {
      row[s.id] = opts.demand(d, si, days, weekend);
    });
    requirements[iso] = row;
  }
  return {
    id: nid(), name: '测试项目', year, month, createdAt: Date.now(), updatedAt: Date.now(),
    employees, shifts: opts.shifts, requirements,
    rules: opts.rules ?? [],
    globalRules: { ...defaultGlobalRules(), ...opts.globalOverrides },
    schedule: opts.schedule ?? null,
    locks: opts.locks ?? {},
    scheduleMeta: null, notes: '',
  };
}

const SHIFTS3 = () => [
  mkShift('白班', '08:00', '17:00'),
  mkShift('中班', '16:00', '00:00'),
  mkShift('夜班', '00:00', '08:00', { maxConsecutiveDays: 3 }),
];

async function testBasic() {
  console.log('▶ 测试1：30人×3班次×31天 基础排班');
  const shifts = SHIFTS3();
  const p = mkProject({
    empCount: 30, shifts,
    demand: (d, s, days, weekend) => (weekend ? [5, 4, 3][s] : [8, 6, 4][s]),
  });
  const built = buildSolveInput(p);
  const res = await solveSchedule(built.input, { mode: 'full' });
  assertEq(res.status, 'ok', '状态应为 ok');
  assertEq(res.evalResult!.shortageCount, 0, '人力缺口应为 0');
  const hard = res.violations.filter((v) => v.hard);
  assertEq(hard.length, 0, `不应有硬约束违反（实际: ${hard.map((h) => h.message).join('; ')}）`);
  // 夜班公平
  const nightCounts = res.evalResult!.perEmp.map((s) => s.shiftCnt[2]);
  const maxN = Math.max(...nightCounts);
  const minN = Math.min(...nightCounts);
  assert(maxN - minN <= 3, `夜班分布应均衡（最多${maxN} 最少${minN}）`);
  // 出勤均衡
  const wds = res.evalResult!.perEmp.map((s) => s.wd);
  assert(Math.max(...wds) - Math.min(...wds) <= 6, `出勤天数应均衡（极差 ${Math.max(...wds) - Math.min(...wds)}）`);
  console.log(`  评分 ${res.score.total}，夜班 ${minN}~${maxN}，出勤 ${Math.min(...wds)}~${Math.max(...wds)}天，耗时 ${res.elapsedMs}ms，优化 ${res.iterations} 步`);
}

async function testSizes() {
  console.log('▶ 测试2：不同人数规模（1/10/50/100人）');
  for (const n of [1, 10, 50, 100]) {
    const shifts = n >= 50
      ? [mkShift('A班', '08:00', '16:00'), mkShift('B班', '16:00', '00:00'), mkShift('C班', '00:00', '08:00'), mkShift('D班', '10:00', '19:00'), mkShift('E班', '12:00', '21:00')]
      : [mkShift('白班', '08:00', '17:00'), mkShift('夜班', '20:00', '08:00', { maxConsecutiveDays: 3 })];
    // 现实负载：约60%利用率
    const perShift = n >= 50
      ? [Math.floor(n * 0.2), Math.floor(n * 0.15), Math.floor(n * 0.12), Math.floor(n * 0.08), Math.floor(n * 0.05)]
      : n === 1 ? [1, 0] : [Math.ceil(n * 0.4), Math.ceil(n * 0.2)];
    const p = mkProject({
      empCount: n, shifts,
      demand: (d, s) => perShift[s] ?? 0,
      // 1人场景：无法轮休，放宽连续限制
      globalOverrides: n === 1 ? { maxConsecutiveWorkDays: 31, comfortConsecutiveDays: 0 } : {},
    });
    const built = buildSolveInput(p);
    const t0 = Date.now();
    const res = await solveSchedule(built.input, { mode: 'full', timeBudgetMs: 15000 });
    const dt = Date.now() - t0;
    const hard = res.violations.filter((v) => v.hard);
    assert(hard.length === 0, `${n}人排班不应有硬约束违反（${hard.map((h) => h.message).slice(0, 3).join('; ')}）`);
    assert(res.evalResult!.shortageCount === 0, `${n}人排班不应有人力缺口`);
    console.log(`  ${n}人×${shifts.length}班次：评分 ${res.score.total}，耗时 ${dt}ms，优化 ${res.iterations} 步`);
    assert(dt < 30000, `${n}人排班耗时应合理（${dt}ms）`);
  }
  // 极端紧凑场景（10人×80%利用率×跨天夜班×12小时休息）：
  // 结构性极难。系统必须诚实报告冲突，而不是假装成功
  {
    const shifts = [mkShift('白班', '08:00', '17:00'), mkShift('夜班', '20:00', '08:00', { maxConsecutiveDays: 3 })];
    const p = mkProject({ empCount: 10, shifts, demand: (d, s) => [5, 3][s] });
    const built = buildSolveInput(p);
    const res = await solveSchedule(built.input, { mode: 'full', timeBudgetMs: 5000 });
    assert(res.status === 'ok' || res.status === 'conflicts', '极端场景应有明确状态');
    if (res.status === 'conflicts') {
      const hard = res.violations.filter((v) => v.hard);
      assert(hard.length > 0 && hard.every((v) => v.message.length > 5), '冲突场景必须给出具体的冲突说明');
      console.log(`  极端紧凑场景：诚实报告 ${hard.length} 项硬冲突（如：${hard[0].message.slice(0, 50)}…）`);
    } else {
      console.log('  极端紧凑场景：成功求解 ✓');
    }
  }
}

async function testMonthLengths() {
  console.log('▶ 测试3：28/29/30/31 天月份');
  // 2026年2月=28天；需要闰年29天：2028年2月；2026年4月=30天；2026年11月=31天(已测)
  for (const [y, m, label] of [[2026, 1, '2026年2月(28天)'], [2028, 1, '2028年2月(29天)'], [2026, 3, '2026年4月(30天)']] as const) {
    const shifts = SHIFTS3();
    const p = mkProject({
      empCount: 20, year: y, month: m, shifts,
      demand: (d, s, days, weekend) => (weekend ? [3, 2, 2][s] : [5, 4, 3][s]),
    });
    const built = buildSolveInput(p);
    const res = await solveSchedule(built.input, { mode: 'full' });
    assertEq(built.input.days, daysInMonth(y, m), `${label} 天数`);
    assertEq(res.evalResult!.shortageCount, 0, `${label} 不应有人力缺口`);
    assert(res.violations.filter((v) => v.hard).length === 0, `${label} 不应有硬约束违反`);
    console.log(`  ${label}：评分 ${res.score.total} ✓`);
  }
}

async function testInfeasible() {
  console.log('▶ 测试4：无解情况诊断');
  // 场景A：夜班需求6人，但5人被禁止上夜班，仅剩5人
  {
    const shifts = SHIFTS3();
    const emps = Array.from({ length: 10 }, (_, i) => mkEmployee(`员工${i + 1}`));
    const rules: SpecialRule[] = emps.slice(0, 5).map((e) => ({
      id: nid(), employeeId: e.id, type: 'forbidShift' as const,
      dateStart: '2026-11-01', dateEnd: '2026-11-30', shiftId: shifts[2].id, note: '',
    }));
    const p = mkProject({
      employees: emps, shifts,
      demand: () => 0,
      rules,
    });
    // 设置夜班需求6人
    for (let d = 0; d < 30; d++) {
      const iso = dateISO(2026, 10, d + 1);
      p.requirements[iso][shifts[2].id] = 6;
    }
    const built = buildSolveInput(p);
    const res = await solveSchedule(built.input, { mode: 'full' });
    assertEq(res.status, 'conflicts', '场景A应为冲突状态');
    assert(res.conflicts.some((c) => c.message.includes('只有 5 人')), `场景A应指出夜班仅5人可用（实际: ${res.conflicts[0]?.message}）`);
    assert(res.conflicts[0].suggestions.length > 0, '场景A应提供修改建议');
    console.log(`  场景A：${res.conflicts[0].message}`);
    console.log(`    建议：${res.conflicts[0].suggestions[0]}`);
  }
  // 场景B：容量不足——4人，每天需求3人，最多连续2天
  {
    const shifts = [mkShift('白班', '08:00', '17:00')];
    const p = mkProject({
      empCount: 4, shifts,
      demand: () => 3,
      globalOverrides: { maxConsecutiveWorkDays: 2 },
    });
    const built = buildSolveInput(p);
    const res = await solveSchedule(built.input, { mode: 'full' });
    assertEq(res.status, 'conflicts', '场景B应为冲突状态');
    assert(res.conflicts.some((c) => c.message.includes('最多可提供')), `场景B应指出容量不足（实际: ${res.conflicts.map((c) => c.message).join('; ')}）`);
    console.log(`  场景B：${res.conflicts.find((c) => c.message.includes('最多可提供'))?.message}`);
  }
  // 场景C：规则互斥——同一天既要求休息又要求指定班次
  {
    const shifts = SHIFTS3();
    const emps = Array.from({ length: 10 }, (_, i) => mkEmployee(`员工${i + 1}`));
    const rules: SpecialRule[] = [
      { id: nid(), employeeId: emps[0].id, type: 'mustRest', dateStart: '2026-11-10', dateEnd: '2026-11-10', note: '' },
      { id: nid(), employeeId: emps[0].id, type: 'mustShift', dateStart: '2026-11-10', dateEnd: '2026-11-10', shiftId: shifts[0].id, note: '' },
    ];
    const p = mkProject({ employees: emps, shifts, demand: (d, s) => [2, 1, 1][s], rules });
    const built = buildSolveInput(p);
    const res = await solveSchedule(built.input, { mode: 'full' });
    assertEq(res.status, 'invalid', '场景C应为规则冲突（invalid）');
    assert(res.conflicts.some((c) => c.message.includes('既被要求休息')), '场景C应指出规则矛盾');
    console.log(`  场景C：${res.conflicts[0].message}`);
  }
}

async function testLockAndReopt() {
  console.log('▶ 测试5：锁定排班与重新优化');
  const shifts = SHIFTS3();
  const p = mkProject({
    empCount: 20, shifts,
    demand: (d, s, days, weekend) => (weekend ? [4, 3, 2][s] : [6, 4, 3][s]),
  });
  const built = buildSolveInput(p);
  const res1 = await solveSchedule(built.input, { mode: 'full' });
  assertEq(res1.status, 'ok', '初次排班应成功');

  // 写回项目并锁定 员工1 的 5日、12日、20日
  p.schedule = assignmentsToSchedule(p, built, res1.assignments as (number | null)[][]);
  const emp0 = p.employees[0];
  p.locks[emp0.id] = Array(30).fill(false);
  for (const d of [4, 11, 19]) p.locks[emp0.id][d] = true;
  const lockedBefore = [4, 11, 19].map((d) => p.schedule![emp0.id][d]);

  // 手工改动：员工2 的 8日 设为白班（未锁定）
  const emp1 = p.employees[1];
  p.schedule[emp1.id][7] = shifts[0].id;

  const built2 = buildSolveInput(p);
  const res2 = await solveSchedule(built2.input, { mode: 'reopt' });
  assertEq(res2.status, 'ok', '重新优化应成功');
  const lockedAfter = [4, 11, 19].map((d) => {
    const v = (res2.assignments as (number | null)[][])[0][d];
    return v === null ? null : p.shifts[v].id;
  });
  for (let i = 0; i < 3; i++) {
    assertEq(lockedAfter[i], lockedBefore[i], `锁定格 ${[5, 12, 20][i]}日 不应被重优化改变`);
  }
  console.log('  锁定格保持不变 ✓');
}

async function testMustShiftRule() {
  console.log('▶ 测试6：指定班次/必须休息规则');
  const shifts = SHIFTS3();
  const emps = Array.from({ length: 20 }, (_, i) => mkEmployee(`员工${i + 1}`));
  const rules: SpecialRule[] = [
    { id: nid(), employeeId: emps[0].id, type: 'mustShift', dateStart: '2026-11-15', dateEnd: '2026-11-15', shiftId: shifts[2].id, note: '' }, // 员工1 15日必须夜班
    { id: nid(), employeeId: emps[1].id, type: 'mustRest', dateStart: '2026-11-15', dateEnd: '2026-11-15', note: '' }, // 员工2 15日必须休息
    { id: nid(), employeeId: emps[2].id, type: 'mustWork', dateStart: '2026-11-15', dateEnd: '2026-11-15', note: '' }, // 员工3 15日必须上班
  ];
  const p = mkProject({
    employees: emps, shifts,
    demand: (d, s, days, weekend) => (weekend ? [4, 3, 2][s] : [6, 4, 3][s]),
    rules,
  });
  const built = buildSolveInput(p);
  const res = await solveSchedule(built.input, { mode: 'full' });
  assertEq(res.status, 'ok', '规则场景排班应成功');
  const A = res.assignments as (number | null)[][];
  assertEq(A[0][14], 2, '员工1 15日应为夜班(idx2)');
  assertEq(A[1][14], null, '员工2 15日应为休息');
  assert(A[2][14] !== null, '员工3 15日应已上班');
  console.log('  指定班次/休息/上班规则全部满足 ✓');
}

async function testManualEditCheck() {
  console.log('▶ 测试7：手工修改后的规则检查');
  const shifts = [mkShift('白班', '08:00', '17:00'), mkShift('中班', '16:00', '00:00')];
  const p = mkProject({
    empCount: 12, shifts,
    demand: () => 4,
  });
  const built = buildSolveInput(p);
  const res = await solveSchedule(built.input, { mode: 'full' });
  assertEq(res.status, 'ok', '初始排班应成功');
  p.schedule = assignmentsToSchedule(p, built, res.assignments as (number | null)[][]);

  // 破坏1：让员工1连续工作7天（直接构造一段超长连班）
  const emp0 = p.employees[0];
  const row = p.schedule[emp0.id];
  for (let d = 0; d < 7; d++) row[d] = shifts[0].id;
  // 破坏2：制造缺口——移除某天某班次的一个人
  let removed = false;
  for (let d = 0; d < 30 && !removed; d++) {
    for (const e of p.employees.slice(1)) {
      if (p.schedule[e.id][d] === shifts[1].id) {
        p.schedule[e.id][d] = null;
        removed = true;
        break;
      }
    }
  }
  const ev = evaluateProject(p);
  assert(ev !== null, '应能评估手工修改后的排班');
  const hard = ev!.evalResult.violations.filter((v) => v.hard);
  assert(hard.some((v) => v.kind === 'consec'), `应检测出连续工作违反（kinds: ${hard.map((h) => h.kind).join(',')}）`);
  assert(hard.some((v) => v.kind === 'shortage'), '应检测出人力缺口');
  console.log(`  检测到 ${hard.length} 项硬冲突，包含连续工作与人力缺口 ✓`);
}

async function testRestHours() {
  console.log('▶ 测试8：班次间休息时间（按实际时间计算）');
  // 中班 16:00-24:00 结束后次日 08:00 白班只有 8 小时休息 < 12 → 应被判违规
  const shifts = [mkShift('白班', '08:00', '17:00'), mkShift('中班', '16:00', '00:00')];
  const p = mkProject({
    empCount: 4, shifts,
    demand: () => 1,
    globalOverrides: { minRestHours: 12 },
  });
  const built = buildSolveInput(p);
  const model = buildModel(built.input);
  // 强制构造：员工1 全月上中班，员工2 全月上白班，员工3/4 轮换
  const A: (number | null)[][] = built.input.employees.map(() => Array(31).fill(null));
  A[0] = Array(31).fill(0); // 员工1 全月白班
  const ev = evaluateSchedule(built.input, model, A);
  // 1人上白班需求1 → 白班满足；中班缺口31
  assert(ev.violations.some((v) => v.kind === 'shortage'), '中班应存在缺口');
  // 构造休息不足：员工2 第1天中班、第2天白班
  A[1][0] = 1; A[1][1] = 0;
  const ev2 = evaluateSchedule(built.input, model, A);
  assert(ev2.violations.some((v) => v.kind === 'rest' && v.message.includes('小时')), `应检测出休息时间不足（${ev2.violations.map((v) => v.kind).join(',')}）`);
  console.log('  休息间隔检查生效 ✓');
}

function testParseNames() {
  console.log('▶ 测试9：员工名单粘贴解析');
  const r1 = parseNameList('张三\n李四\n王五\n赵六');
  assertEq(r1.names.length, 4, '换行分隔应识别4人');
  const r2 = parseNameList('张三 李四\r\n王五\t赵六');
  assertEq(r2.names.length, 4, '混合分隔符应识别4人');
  const r3 = parseNameList('张三,张三,李四，王五、张三；赵六');
  assertEq(r3.names.length, 4, '中文标点+重复应识别4人');
  assertEq(r3.duplicates.length, 1, '应识别重复姓名张三');
  const r4 = parseNameList('  张三  \n\n  \n 李四 ');
  assertEq(r4.names.length, 2, '应清理空格空行');
  console.log('  解析逻辑全部通过 ✓');
}

async function main() {
  console.log('======== 排班引擎测试 ========\n');
  await testBasic();
  await testSizes();
  await testMonthLengths();
  await testInfeasible();
  await testLockAndReopt();
  await testMustShiftRule();
  await testManualEditCheck();
  await testRestHours();
  testParseNames();
  console.log('\n======== 结果 ========');
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    failures.forEach((f) => console.log('  ✗', f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('测试崩溃:', e);
  process.exit(1);
});
