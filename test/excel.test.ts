// Excel 导出/导入测试：多Sheet、格式化、员工导入往返
import { solveSchedule } from '../src/engine/solve';
import { buildSolveInput, assignmentsToSchedule } from '../src/engine/input';
import { parseEmployeeFile } from '../src/excel';
import ExcelJS from 'exceljs';
import * as fs from 'node:fs';
import type { Employee, Project, Shift } from '../src/types';
import { defaultGlobalRules } from '../src/types';
import { dateISO, daysInMonth } from '../src/utils';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ FAIL:', msg); }
}

let idc = 0;
const nid = () => `x${++idc}`;

function mkProjectTest({ empCount }: { empCount: number }): Project {
  const year = 2026, month = 10;
  const days = daysInMonth(year, month);
  const employees: Employee[] = Array.from({ length: empCount }, (_, i) => ({
    id: nid(), name: `员工${i + 1}`, employeeCode: `A${1000 + i}`, skills: [], active: true,
    targetWorkDays: null, targetTolerance: 0, targetHard: false,
    preferences: { preferredShifts: [], avoidShifts: [], preferWeekendRest: false },
  }));
  const mkShift = (name: string, short: string, start: string, end: string, color: number): Shift => ({
    id: nid(), name, shortLabel: short, startTime: start, endTime: end, crossDay: end <= start,
    defaultCount: 1, allowConsecutive: true, maxConsecutiveDays: name === '夜班' ? 3 : 0,
    fairnessWeight: 2, note: '', color,
  });
  const shifts = [mkShift('白班', '白', '08:00', '17:00', 0), mkShift('中班', '中', '16:00', '00:00', 1), mkShift('夜班', '夜', '00:00', '08:00', 2)];
  const requirements: Record<string, Record<string, number>> = {};
  for (let d = 0; d < days; d++) {
    const w = new Date(year, month, d + 1).getDay();
    const we = w === 0 || w === 6;
    requirements[dateISO(year, month, d + 1)] = {
      [shifts[0].id]: we ? 5 : 8,
      [shifts[1].id]: we ? 4 : 6,
      [shifts[2].id]: we ? 3 : 4,
    };
  }
  return {
    id: nid(), name: 'Excel测试项目', year, month, createdAt: Date.now(), updatedAt: Date.now(),
    employees, shifts, requirements, rules: [], globalRules: defaultGlobalRules(),
    schedule: null, locks: {}, scheduleMeta: null, notes: '',
  };
}

async function main() {
  console.log('======== Excel 测试 ========\n');

  // 构造一个已排班项目：30人×3班×31天
  const p = mkProjectTest({ empCount: 30 });
  const built = buildSolveInput(p);
  const res = await solveSchedule(built.input, { mode: 'full' });
  assert(res.status === 'ok', '排班应成功');
  p.schedule = assignmentsToSchedule(p, built, res.assignments as (number | null)[][]);

  // 1. 导出
  const { exportProjectExcel } = await import('../src/excel');
  // 劫持 download：Node 环境下改为写文件
  const tmp = '/tmp/sched_test_export.xlsx';
  const ExcelJSMod = (await import('exceljs')).default;
  // 直接复用 exportProjectExcel 内部逻辑：这里改为调用并拦截 download
  // —— 简化：重建工作簿验证 exceljs 可用，再调用 exportProjectExcel（浏览器 download 在 node 中不可用，改为 mock）
  (globalThis as any).__lastBlob = null;
  (globalThis as any).URL = globalThis.URL || {};
  (globalThis as any).URL.createObjectURL = () => 'blob:mock';
  (globalThis as any).URL.revokeObjectURL = () => {};
  (globalThis as any).document = {
    createElement: () => {
      const el: any = { click() {}, remove() {} };
      Object.defineProperty(el, 'href', { set() {} });
      Object.defineProperty(el, 'download', { set() {} });
      return el;
    },
    body: { appendChild() {} },
  };

  // download() 里使用了 Blob —— Node 18+ 支持；拦截保存 buffer：
  const origBlob = (globalThis as any).Blob;
  let captured: Buffer | null = null;
  (globalThis as any).Blob = class extends origBlob {
    constructor(parts: any[], opts?: any) {
      super(parts, opts);
      Promise.resolve()
        .then(() => (this as any).arrayBuffer())
        .then((ab: ArrayBuffer) => { captured = Buffer.from(ab) as Buffer; });
    }
  };

  await exportProjectExcel(p, null as any);
  await new Promise((r) => setTimeout(r, 200));
  const cap = captured as Buffer | null;
  assert(cap !== null && cap.length > 1000, `应生成有效的 xlsx 文件（${cap?.length} 字节）`);

  if (cap) {
    fs.writeFileSync(tmp, cap);
    const wb2 = new ExcelJSMod.Workbook();
    await wb2.xlsx.readFile(tmp);
    const names = wb2.worksheets.map((w) => w.name);
    assert(names.includes('总排班表'), `应包含总排班表（实际: ${names.join(',')}）`);
    assert(names.includes('白班') && names.includes('中班') && names.includes('夜班'), '应包含各班次独立表');
    assert(names.includes('每日统计') && names.includes('员工统计'), '应包含统计表');
    const wsAll = wb2.getWorksheet('总排班表')!;
    assert(wsAll.rowCount >= 32, `总排班表应有标题+表头+30名员工（实际 ${wsAll.rowCount} 行）`);
    // 校验一名员工某天的单元格内容
    const firstEmpName = wsAll.getRow(3).getCell(1).value;
    assert(String(firstEmpName).length > 0, '员工姓名应在第3行');
    // 校验班次独立表有 ✓
    const wsNight = wb2.getWorksheet('夜班')!;
    let ticks = 0;
    wsNight.eachRow((row) => {
      row.eachCell((c) => { if (c.value === '✓') ticks++; });
    });
    const nightDemand = Object.values(p.requirements).reduce((a, row) => a + (row[p.shifts[2].id] || 0), 0);
    assert(ticks === nightDemand, `夜班表 ✓ 数量应等于夜班需求总数（期望 ${nightDemand}，实际 ${ticks}）`);
    console.log(`  导出验证：${names.length} 个Sheet，夜班✓=${ticks}/${nightDemand} ✓`);
  }

  // 2. 导入员工（CSV）
  const csv = '姓名,编号,岗位\n张三,A001,收银\n李四,A002,客服/值班\n张三,A003,收银\n王五,A004,\n';
  const fakeCsvFile = {
    name: 'emps.csv',
    text: async () => csv,
  } as unknown as File;
  const r1 = await parseEmployeeFile(fakeCsvFile);
  assert(r1.rows.length === 3, `CSV 应识别 3 人（实际 ${r1.rows.length}）`);
  assert(r1.rows[0].name === '张三' && r1.rows[0].code === 'A001', 'CSV 表头映射正确');
  assert(r1.rows[1].skills.length === 2, 'CSV 岗位多值解析正确');
  assert(r1.errors.some((e) => e.includes('张三')), 'CSV 重复姓名应有提示');

  // 3. 导入员工（XLSX 无表头）
  const wb3 = new ExcelJSMod.Workbook();
  const ws3 = wb3.addWorksheet('Sheet1');
  const names3 = Array.from({ length: 50 }, (_, i) => `测试员工${i + 1}`);
  names3.forEach((n, i) => ws3.getRow(i + 1).getCell(1).value = n);
  const buf3 = await wb3.xlsx.writeBuffer();
  const fakeXlsxFile = {
    name: 'emps.xlsx',
    arrayBuffer: async () => buf3,
  } as unknown as File;
  const r2 = await parseEmployeeFile(fakeXlsxFile);
  assert(r2.rows.length === 50, `XLSX 应识别 50 人（实际 ${r2.rows.length}）`);
  assert(r2.rows[0].name === '测试员工1', 'XLSX 第一列姓名解析正确');
  console.log('  导入验证：CSV 3人、XLSX 50人、中文/重复处理 ✓');

  console.log('\n======== 结果 ========');
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Excel 测试崩溃:', e);
  process.exit(1);
});
