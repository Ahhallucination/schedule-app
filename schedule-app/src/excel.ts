// Excel 导入导出（exceljs）：多 Sheet 格式化排班表 + 员工导入
import type { Project } from './types';
import { REST_COLOR, SHIFT_PALETTE } from './types';
import { dateISO, daysInMonth, download, isWeekend, parseCSV, weekdayOf, WEEKDAY_NAMES } from './utils';
import { evaluateProject } from './engine/input';
import type { EvalResult } from './engine/types';

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? (mod as any);
}

type EvalBundle = ReturnType<typeof evaluateProject>;

/** 导出完整排班工作簿 */
export async function exportProjectExcel(project: Project, ev?: EvalBundle): Promise<void> {
  if (!project.schedule) throw new Error('还没有排班结果，请先生成排班');
  const ExcelJS = await loadExcelJS();
  const evalBundle = ev ?? evaluateProject(project);
  const days = daysInMonth(project.year, project.month);
  const wb = new ExcelJS.Workbook();
  wb.creator = '排班管家';
  wb.created = new Date();

  const thinBorder = {
    top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
  };
  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF1F5F9' } };
  const weekendHeaderFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFE4E6' } };

  const setupColumns = (ws: any, dayWidth: number, nameWidth = 12) => {
    ws.columns = [
      { width: nameWidth },
      ...Array.from({ length: days }, () => ({ width: dayWidth })),
    ];
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  };

  const addTitleAndHeader = (ws: any, title: string) => {
    ws.mergeCells(1, 1, 1, days + 1);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
    t.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 26;

    const head = ws.getRow(2);
    head.getCell(1).value = '姓名';
    for (let d = 1; d <= days; d++) {
      const c = head.getCell(d + 1);
      const we = isWeekend(project.year, project.month, d);
      c.value = `${d}\n周${WEEKDAY_NAMES[weekdayOf(project.year, project.month, d)]}`;
      c.fill = we ? weekendHeaderFill : headerFill;
      c.font = { size: 9, bold: true, color: { argb: we ? 'FFFB7185' : 'FF64748B' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = thinBorder;
    }
    head.getCell(1).fill = headerFill;
    head.getCell(1).font = { size: 10, bold: true, color: { argb: 'FF64748B' } };
    head.getCell(1).alignment = { vertical: 'middle' };
    head.getCell(1).border = thinBorder;
    head.height = 30;
  };

  const empRows = project.employees.filter((e) => project.schedule![e.id]);

  // ---- Sheet 1：总排班表 ----
  const wsAll = wb.addWorksheet('总排班表');
  setupColumns(wsAll, 5.6);
  addTitleAndHeader(wsAll, `${project.name}（${project.year}年${project.month + 1}月）总排班表`);
  empRows.forEach((e, i) => {
    const row = wsAll.getRow(i + 3);
    row.getCell(1).value = e.name;
    row.getCell(1).font = { size: 10, bold: true, color: { argb: 'FF334155' } };
    row.getCell(1).border = thinBorder;
    row.getCell(1).alignment = { vertical: 'middle' };
    row.height = 18;
    for (let d = 1; d <= days; d++) {
      const c = row.getCell(d + 1);
      const v = project.schedule![e.id]?.[d - 1] ?? null;
      const shift = project.shifts.find((s) => s.id === v);
      const color = shift ? SHIFT_PALETTE[shift.color % SHIFT_PALETTE.length] : REST_COLOR;
      c.value = shift ? (shift.shortLabel || shift.name.slice(0, 2)) : '休';
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.hexBg } };
      c.font = { size: 9, color: { argb: color.hexText }, bold: !!shift };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.border = thinBorder;
    }
    row.commit();
  });

  // ---- Sheet 2+：每个班次独立表 ----
  for (const shift of project.shifts) {
    const ws = wb.addWorksheet(`${shift.name}`.slice(0, 28));
    setupColumns(ws, 4.6);
    addTitleAndHeader(ws, `${project.name} · ${shift.name}（${shift.startTime}-${shift.endTime}${shift.crossDay ? ' 次日' : ''}）`);
    empRows.forEach((e, i) => {
      const row = ws.getRow(i + 3);
      row.getCell(1).value = e.name;
      row.getCell(1).font = { size: 10, bold: true, color: { argb: 'FF334155' } };
      row.getCell(1).border = thinBorder;
      row.height = 17;
      const color = SHIFT_PALETTE[shift.color % SHIFT_PALETTE.length];
      for (let d = 1; d <= days; d++) {
        const c = row.getCell(d + 1);
        const on = project.schedule![e.id]?.[d - 1] === shift.id;
        c.value = on ? '✓' : '';
        if (on) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.hexBg } };
          c.font = { size: 9, color: { argb: color.hexText }, bold: true };
        }
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = thinBorder;
      }
      row.commit();
    });
  }

  // ---- 统计 Sheets ----
  const evalResult: EvalResult | null = evalBundle?.evalResult ?? null;
  if (evalBundle && evalResult) {
    const { built } = evalBundle;
    const input = built.input;

    // 每日统计
    const wsDaily = wb.addWorksheet('每日统计');
    wsDaily.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    wsDaily.columns = [{ width: 12 }, ...input.shifts.map(() => ({ width: 12 })), { width: 10 }, { width: 8 }];
    const dh = wsDaily.getRow(1);
    dh.values = ['日期', ...input.shifts.map((s) => `${s.name}（实/需）`), '在岗人次', '缺口'];
    styleHeaderRow(dh);
    for (let d = 0; d < days; d++) {
      const row = wsDaily.getRow(d + 2);
      const we = isWeekend(project.year, project.month, d + 1);
      const values: (string | number)[] = [`${d + 1}日 周${WEEKDAY_NAMES[weekdayOf(project.year, project.month, d + 1)]}`];
      input.shifts.forEach((_, s) => {
        values.push(`${evalResult.filled[d][s]}/${input.demand[d][s]}`);
      });
      const gap = input.shifts.reduce((a, _, s) => a + Math.max(0, input.demand[d][s] - evalResult.filled[d][s]), 0);
      values.push(evalResult.filled[d].reduce((a, b) => a + b, 0));
      values.push(gap);
      row.values = values;
      if (we) row.eachCell((c: any) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1F2' } }; });
      if (gap > 0) row.getCell(values.length).font = { bold: true, color: { argb: 'FFDC2626' } };
      row.eachCell((c: any) => { c.border = thinBorder; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
      row.commit();
    }

    // 员工统计
    const wsEmp = wb.addWorksheet('员工统计');
    wsEmp.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    wsEmp.columns = [{ width: 12 }, { width: 9 }, { width: 9 }, { width: 9 }, ...input.shifts.map(() => ({ width: 9 })), { width: 10 }, { width: 12 }];
    const eh = wsEmp.getRow(1);
    eh.values = ['姓名', '工作天数', '休息天数', '周末班', ...input.shifts.map((s) => s.name), '最长连续', '目标达成'];
    styleHeaderRow(eh);
    input.employees.forEach((emp, i) => {
      const st = evalResult.perEmp[i];
      const row = wsEmp.getRow(i + 2);
      const target = emp.targetWorkDays != null ? `${st.wd}/${emp.targetWorkDays}` : '—';
      row.values = [emp.name, st.wd, st.rest, st.weekend, ...st.shiftCnt, `${st.maxRun}天`, target];
      row.eachCell((c: any, col: number) => {
        c.border = thinBorder;
        c.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center' };
      });
      row.commit();
    });

    // 公平与冲突
    const wsFair = wb.addWorksheet('公平与冲突');
    wsFair.columns = [{ width: 60 }];
    const lines: string[] = [
      `综合评分：${evalResult.score.total} 分`,
      `硬约束满足率：${Math.round(evalResult.score.hardRate * 100)}%`,
      `人力需求满足率：${Math.round(evalResult.score.demandRate * 100)}%`,
      `员工偏好满足率：${Math.round(evalResult.score.prefRate * 100)}%`,
      `出勤均衡度：${Math.round(evalResult.score.workFairness * 100)}%`,
      `周末公平度：${Math.round(evalResult.score.weekendFairness * 100)}%`,
      '',
      '【未满足约束】',
      ...(evalResult.violations.length === 0 ? ['无'] : evalResult.violations.map((v) => `${v.hard ? '[硬]' : '[提示]'} ${v.message}`)),
    ];
    lines.forEach((line, i) => {
      const row = wsFair.getRow(i + 1);
      row.getCell(1).value = line;
      row.getCell(1).font = { size: 10, color: { argb: line.startsWith('[硬]') ? 'FFDC2626' : 'FF334155' } };
      row.commit();
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${project.name}_排班表.xlsx`);
}

function styleHeaderRow(row: any) {
  row.eachCell((c: any) => {
    c.font = { bold: true, size: 10, color: { argb: 'FF64748B' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });
  row.height = 22;
}

// ---------- 员工导入 ----------
export interface ImportedEmployee {
  name: string;
  code: string;
  skills: string[];
}

export async function parseEmployeeFile(file: File): Promise<{ rows: ImportedEmployee[]; errors: string[] }> {
  const errors: string[] = [];
  const name = file.name.toLowerCase();

  let table: string[][] = [];
  if (name.endsWith('.csv')) {
    const text = await file.text();
    table = parseCSV(text);
  } else {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(await file.arrayBuffer());
    } catch {
      throw new Error('无法读取 Excel 文件，请确认是有效的 .xlsx 文件');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Excel 文件中没有工作表');
    ws.eachRow((row: any) => {
      const cells: string[] = [];
      for (let c = 1; c <= 6; c++) {
        const v = row.getCell(c).value;
        cells.push(v === null || v === undefined ? '' : String(typeof v === 'object' && v.text ? v.text : v).trim());
      }
      table.push(cells);
    });
  }

  table = table.filter((r) => r.some((c) => c !== ''));
  if (table.length === 0) return { rows: [], errors: ['文件中没有数据'] };

  // 表头识别
  const headerKeywords = {
    name: /姓名|名字|^name$/i,
    code: /编号|工号|员工号|code|no\./i,
    skill: /岗位|技能|职位|skill|role|position/i,
  };
  const firstRow = table[0];
  let nameCol = 0, codeCol = -1, skillCol = -1;
  const hasHeader = firstRow.some((c) => headerKeywords.name.test(c));
  if (hasHeader) {
    firstRow.forEach((c, i) => {
      if (headerKeywords.name.test(c)) nameCol = i;
      if (headerKeywords.code.test(c)) codeCol = i;
      if (headerKeywords.skill.test(c)) skillCol = i;
    });
    table = table.slice(1);
  } else {
    // 无表头：第1列为姓名
    if (table.length && table[0].length > 1) {
      errors.push('未识别到表头，已按“第一列为姓名”导入');
    }
  }

  const seen = new Set<string>();
  const rows: ImportedEmployee[] = [];
  for (const r of table) {
    const nm = (r[nameCol] || '').trim();
    if (!nm) continue;
    if (seen.has(nm)) {
      errors.push(`重复姓名「${nm}」已自动去重`);
      continue;
    }
    seen.add(nm);
    rows.push({
      name: nm,
      code: codeCol >= 0 ? (r[codeCol] || '').trim() : '',
      skills: skillCol >= 0 ? (r[skillCol] || '').split(/[/、,，]/).map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  return { rows, errors };
}
