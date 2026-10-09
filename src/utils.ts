// 通用工具函数

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** day1: 1-based */
export function dateISO(year: number, month: number, day1: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day1).padStart(2, '0')}`;
}

export function parseISODate(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { year: +m[1], month: +m[2] - 1, day: +m[3] };
}

export const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** day1: 1-based; returns 0(周日)-6 */
export function weekdayOf(year: number, month: number, day1: number): number {
  return new Date(year, month, day1).getDay();
}

export function isWeekend(year: number, month: number, day1: number): boolean {
  const w = weekdayOf(year, month, day1);
  return w === 0 || w === 6;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseHM(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return 0;
  return +m[1] * 60 + +m[2];
}

export function fmtMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 班次实际时长（分钟） */
export function shiftDurationMinutes(start: string, end: string): number {
  const s = parseHM(start);
  const e = parseHM(end);
  return e > s ? e - s : e + 1440 - s;
}

export function shiftCrossDay(start: string, end: string): boolean {
  return parseHM(end) <= parseHM(start);
}

/**
 * 解析粘贴的员工名单：支持换行、制表符、逗号、顿号、分号、空格分隔；
 * 自动清理多余空格、空行、重复姓名。
 */
export function parseNameList(text: string): { names: string[]; duplicates: string[] } {
  const tokens = text
    .split(/[\n\r\t,，、;；|]+|\s{1,}/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '姓名' && t !== '名字' && t !== 'name');
  const seen = new Set<string>();
  const names: string[] = [];
  const duplicates: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) {
      if (!duplicates.includes(t)) duplicates.push(t);
    } else {
      seen.add(t);
      names.push(t);
    }
  }
  return { names, duplicates };
}

/** 极简 CSV 解析（支持引号包裹与转义） */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',' || c === '\t') {
      row.push(cell.trim()); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function monthLabel(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
