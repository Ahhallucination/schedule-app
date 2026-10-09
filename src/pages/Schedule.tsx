import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Empty, Modal, useToast, Badge, Segmented, Spinner, PageHeader } from '../components/ui';
import { REST_COLOR, SHIFT_PALETTE, type Project } from '../types';
import { dateISO, daysInMonth, isWeekend, monthLabel, weekdayOf, WEEKDAY_NAMES } from '../utils';
import { buildSolveInput, assignmentsToSchedule, evaluateProject } from '../engine/input';
import { solveSchedule, type SolveOutput } from '../engine/solve';
import { explainCell } from '../engine/evaluate';
import type { Violation } from '../engine/types';
import { exportProjectExcel } from '../excel';

interface CellPos { empId: string; day: number }

export default function SchedulePage({ solveTrigger }: { solveTrigger: number }) {
  const { active, mutate, updatePrefs, db } = useStore();
  const { toast } = useToast();
  const project = active!;
  const days = daysInMonth(project.year, project.month);
  const hiddenTabs = db.prefs.hiddenShiftTabs;

  const [tab, setTab] = useState<string>('all'); // 'all' | shiftId
  const [solving, setSolving] = useState<{ pct: number; msg: string } | null>(null);
  const cancelRef = useRef(false);
  const [summary, setSummary] = useState<SolveOutput | null>(null);
  const [popover, setPopover] = useState<{ pos: CellPos; x: number; y: number } | null>(null);
  const [activeCell, setActiveCell] = useState<CellPos | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [viewOptsOpen, setViewOptsOpen] = useState(false);
  const lastTrigger = useRef(0);

  const employees = project.employees;
  const emps = useMemo(() => {
    const q = searchQ.trim();
    if (!q) return employees;
    return employees.filter((e) => e.name.includes(q) || e.employeeCode.includes(q));
  }, [employees, searchQ]);

  const visibleShiftTabs = project.shifts.filter((s) => !hiddenTabs.includes(s.id));

  // 实时评估（手工修改后即时检查规则）
  const liveEval = useMemo(() => {
    if (!project.schedule) return null;
    try {
      return evaluateProject(project);
    } catch {
      return null;
    }
  }, [project]);

  const hardViolations = useMemo(
    () => liveEval?.evalResult.violations.filter((v) => v.hard) ?? [],
    [liveEval]
  );
  const softViolations = useMemo(
    () => liveEval?.evalResult.violations.filter((v) => !v.hard) ?? [],
    [liveEval]
  );

  const violByCell = useMemo(() => {
    const map = new Map<string, Violation[]>();
    if (!liveEval) return map;
    for (const v of liveEval.evalResult.violations) {
      if (v.emp >= 0 && v.day >= 0) {
        const empId = liveEval.built.input.employees[v.emp]?.id;
        if (!empId) continue;
        const key = `${empId}:${v.day}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(v);
      }
    }
    return map;
  }, [liveEval]);

  const runSolve = async (mode: 'full' | 'reopt') => {
    if (solving) return;
    // 前置检查
    const activeEmps = project.employees.filter((e) => e.active).length;
    if (activeEmps === 0) { toast('没有可排班的员工，请先在「员工管理」添加员工', 'error'); return; }
    if (project.shifts.length === 0) { toast('没有班次，请先在「班次管理」创建班次', 'error'); return; }
    const demandTotal = Object.values(project.requirements).reduce((a, row) => a + Object.values(row).reduce((x, y) => x + (y || 0), 0), 0);
    if (demandTotal === 0) { toast('人力需求为空，请先在「人力需求」设置每天需要的人数', 'error'); return; }
    if (mode === 'reopt' && !project.schedule) { toast('还没有排班结果，请先「自动排班」', 'warn'); return; }

    cancelRef.current = false;
    setSolving({ pct: 3, msg: '正在检查输入与规则…' });
    try {
      const built = buildSolveInput(project);
      const res = await solveSchedule(built.input, {
        mode,
        onProgress: (pct, msg) => setSolving({ pct, msg }),
        isCancelled: () => cancelRef.current,
        timeBudgetMs: 8000,
      });
      setSolving(null);
      if (res.status === 'aborted') {
        toast('已取消计算', 'warn');
        return;
      }
      if (res.status === 'invalid') {
        setSummary(res);
        return;
      }
      const sched = assignmentsToSchedule(project, built, res.assignments);
      mutate((p) => {
        p.schedule = sched;
        p.scheduleMeta = {
          generatedAt: Date.now(),
          status: res.status as 'ok' | 'conflicts',
          total: res.score.total,
          hardRate: res.score.hardRate,
          demandRate: res.score.demandRate,
          prefRate: res.score.prefRate,
          fairness: res.score.fairness,
          elapsedMs: res.elapsedMs,
        };
      }, { history: true });
      setSummary(res);
      if (res.status === 'ok') toast(`排班完成，综合评分 ${res.score.total} 分`, 'success');
      else toast('已生成排班，但存在未解决的冲突，请查看详情', 'warn');
    } catch (err: any) {
      setSolving(null);
      console.error(err);
      toast(`排班计算出错：${err?.message || '未知错误'}`, 'error');
    }
  };

  // 顶栏“自动排班”触发
  useEffect(() => {
    if (solveTrigger > lastTrigger.current) {
      lastTrigger.current = solveTrigger;
      runSolve('full');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveTrigger]);

  // 手工修改
  const setCell = (empId: string, day: number, shiftId: string | null) => {
    mutate((p) => {
      if (!p.schedule) return;
      if (!p.schedule[empId]) p.schedule[empId] = Array(days).fill(null);
      p.schedule[empId][day] = shiftId;
    });
    const vAfter = shiftId === null ? '休息' : project.shifts.find((s) => s.id === shiftId)?.name || shiftId;
    const emp = project.employees.find((e) => e.id === empId);
    toast(`${emp?.name} ${project.month + 1}月${day + 1}日 已改为${vAfter}`, 'info');
  };

  const toggleLock = (empId: string, day: number) => {
    mutate((p) => {
      if (!p.locks[empId]) p.locks[empId] = Array(days).fill(false);
      p.locks[empId][day] = !p.locks[empId][day];
    });
  };

  const lockAll = (lock: boolean) => {
    mutate((p) => {
      for (const e of p.employees) p.locks[e.id] = Array(days).fill(lock);
    });
    toast(lock ? '已锁定全部排班，重新优化不会改变任何一格' : '已解锁全部排班', 'info');
  };

  // 键盘操作
  useEffect(() => {
    if (!project.schedule) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (popover) return; // 弹层开着时交给 Esc/点击
      if (!activeCell) return;
      const rowIdx = emps.findIndex((x) => x.id === activeCell.empId);
      const d = activeCell.day;
      const move = (dr: number, dc: number) => {
        const ni = Math.max(0, Math.min(emps.length - 1, rowIdx + dr));
        const nd = Math.max(0, Math.min(days - 1, d + dc));
        setActiveCell({ empId: emps[ni].id, day: nd });
        e.preventDefault();
      };
      if (e.key === 'ArrowUp') move(-1, 0);
      else if (e.key === 'ArrowDown') move(1, 0);
      else if (e.key === 'ArrowLeft') move(0, -1);
      else if (e.key === 'ArrowRight') move(0, 1);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const el = document.querySelector(`[data-cell="${activeCell.empId}:${activeCell.day}"]`) as HTMLElement;
        if (el) {
          const r = el.getBoundingClientRect();
          setPopover({ pos: activeCell, x: r.left + r.width / 2, y: r.bottom + 6 });
        }
      } else if (/^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (n === 0) setCell(activeCell.empId, d, null);
        else {
          const s = project.shifts[n - 1];
          if (s) setCell(activeCell.empId, d, s.id);
        }
      } else if (e.key.toLowerCase() === 'l') {
        toggleLock(activeCell.empId, d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCell, emps, popover, project, days]);

  const shiftById = useMemo(() => new Map(project.shifts.map((s) => [s.id, s])), [project.shifts]);

  // ---- 渲染 ----
  const hasSchedule = !!project.schedule;

  return (
    <div className="p-4 h-full flex flex-col min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >
            总表
          </button>
          {visibleShiftTabs.map((s) => (
            <button
              key={s.id}
              onClick={() => setTab(s.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === s.id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <input
          id="emp-search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="搜索员工 (⌘F)"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 w-36"
        />
        <div className="flex-1" />
        {hasSchedule && (
          <>
            {hardViolations.length > 0 && (
              <Badge tone="rose">⚠ {hardViolations.length} 项硬冲突</Badge>
            )}
            {softViolations.length > 0 && hardViolations.length === 0 && (
              <Badge tone="amber">{softViolations.length} 项提示</Badge>
            )}
            <Btn size="sm" variant="ghost" onClick={() => setViewOptsOpen(true)}>视图选项</Btn>
            <Btn size="sm" onClick={() => lockAll(true)}>锁定全部</Btn>
            <Btn size="sm" onClick={() => lockAll(false)}>全部解锁</Btn>
            <Btn size="sm" onClick={() => runSolve('reopt')} disabled={!!solving} title="只调整未锁定的排班，锁定的格子保持不变">
              重新优化（未锁定）
            </Btn>
            <Btn size="sm" variant="primary" onClick={() => runSolve('full')} disabled={!!solving}>自动排班</Btn>
            <Btn size="sm" onClick={async () => {
              try {
                await exportProjectExcel(project, liveEval);
                toast('已导出 Excel 排班表', 'success');
              } catch (err: any) {
                toast(`导出失败：${err?.message || '未知错误'}`, 'error');
              }
            }}>
              导出 Excel
            </Btn>
          </>
        )}
      </div>

      {/* 冲突提示条 */}
      {hasSchedule && (hardViolations.length > 0 || softViolations.length > 0) && (
        <ViolationsBar hard={hardViolations} soft={softViolations} />
      )}

      {/* 主体 */}
      <div className="flex-1 min-h-0">
        {!hasSchedule ? (
          <Empty
            title="还没有生成排班"
            desc="确认员工、班次和人力需求已设置后，点击自动排班。算法使用确定性约束优化（非随机、非AI）。"
            action={
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-6 text-sm">
                  <Checklist ok={project.employees.filter((e) => e.active).length > 0} label={`员工 ${project.employees.filter((e) => e.active).length} 名`} />
                  <Checklist ok={project.shifts.length > 0} label={`班次 ${project.shifts.length} 个`} />
                  <Checklist
                    ok={Object.values(project.requirements).some((row) => Object.values(row).some((v) => (v || 0) > 0))}
                    label="人力需求已设置"
                  />
                </div>
                <Btn variant="primary" onClick={() => runSolve('full')} disabled={!!solving}>
                  开始自动排班
                </Btn>
              </div>
            }
          />
        ) : (
          <Card className="h-full overflow-auto">
            <ScheduleGrid
              project={project}
              tab={tab}
              emps={emps}
              violByCell={violByCell}
              activeCell={activeCell}
              showCode={db.prefs.showCodeColumn}
              onCellClick={(empId, day, x, y) => {
                setActiveCell({ empId, day });
                setPopover({ pos: { empId, day }, x, y });
              }}
              onCellFocus={(empId, day) => setActiveCell({ empId, day })}
            />
          </Card>
        )}
      </div>

      {/* 图例 */}
      {hasSchedule && (
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded ${REST_COLOR.bg}`} />休息</span>
          {project.shifts.map((s) => {
            const c = SHIFT_PALETTE[s.color % SHIFT_PALETTE.length];
            return <span key={s.id} className="flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded ${c.bg}`} />{s.name}</span>;
          })}
          <span className="ml-2">🔒 锁定 · 红框 = 规则冲突 · 键盘：方向键移动、Enter 编辑、0 休息、1~9 选班次、L 锁定</span>
        </div>
      )}

      {/* 求解遮罩 */}
      {solving && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-7 w-[380px] text-center">
            <Spinner className="mx-auto text-indigo-600 mb-4 w-7 h-7" />
            <div className="font-semibold text-slate-800 mb-1.5">正在计算排班…</div>
            <div className="text-sm text-slate-500 mb-4 min-h-[20px]">{solving.msg}</div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
              <div className="h-full bg-indigo-600 transition-all duration-200" style={{ width: `${solving.pct}%` }} />
            </div>
            <Btn size="sm" onClick={() => { cancelRef.current = true; }}>取消计算</Btn>
          </div>
        </div>
      )}

      {/* 排班结果摘要 */}
      <Modal open={!!summary} onClose={() => setSummary(null)} title={summary?.status === 'invalid' ? '规则冲突，无法排班' : summary?.status === 'ok' ? '排班完成' : '排班完成（存在未解决冲突）'} width="max-w-2xl" footer={
        <Btn variant="primary" onClick={() => setSummary(null)}>知道了</Btn>
      }>
        {summary && (
          <div>
            {summary.status === 'invalid' ? (
              <ConflictsList conflicts={summary.conflicts} />
            ) : (
              <>
                <div className="grid grid-cols-5 gap-3 mb-4">
                  <ScoreCard label="综合评分" value={`${summary.score.total}`} big tone={summary.status === 'ok' ? 'good' : 'warn'} />
                  <ScoreCard label="硬约束满足率" value={`${Math.round(summary.score.hardRate * 100)}%`} />
                  <ScoreCard label="人力满足率" value={`${Math.round(summary.score.demandRate * 100)}%`} />
                  <ScoreCard label="偏好满足率" value={`${Math.round(summary.score.prefRate * 100)}%`} />
                  <ScoreCard label="公平度" value={`${Math.round(summary.score.fairness * 100)}%`} />
                </div>
                <div className="text-xs text-slate-400 mb-3">
                  用时 {(summary.elapsedMs / 1000).toFixed(1)} 秒 · 优化 {summary.iterations} 步 · 出勤均衡 {Math.round(summary.score.workFairness * 100)}% · 周末公平 {Math.round(summary.score.weekendFairness * 100)}%
                </div>
                {summary.conflicts.length > 0 && <ConflictsList conflicts={summary.conflicts} />}
                {summary.violations.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm font-medium text-slate-700 mb-2">未满足的约束（{summary.violations.length} 项）</div>
                    <div className="max-h-56 overflow-y-auto space-y-1.5">
                      {summary.violations.map((v, i) => (
                        <div key={i} className={`text-sm px-3 py-2 rounded-lg ${v.hard ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          {v.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 单元格弹层：编辑 + 解释 */}
      {popover && project.schedule && (
        <CellPopover
          project={project}
          pos={popover.pos}
          x={popover.x}
          y={popover.y}
          liveEval={liveEval}
          onClose={() => setPopover(null)}
          onSet={(shiftId) => { setCell(popover.pos.empId, popover.pos.day, shiftId); setPopover(null); }}
          onLock={() => { toggleLock(popover.pos.empId, popover.pos.day); }}
        />
      )}

      {/* 视图选项 */}
      <Modal open={viewOptsOpen} onClose={() => setViewOptsOpen(false)} title="视图选项" width="max-w-sm">
        <div className="text-xs text-slate-400 mb-3">选择在排班结果中显示哪些班次独立视图（总表始终显示）。班次顺序可在「班次管理」中调整。</div>
        <div className="space-y-2 mb-4">
          {project.shifts.map((s) => {
            const hidden = hiddenTabs.includes(s.id);
            return (
              <label key={s.id} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => {
                    updatePrefs((p) => {
                      if (p.hiddenShiftTabs.includes(s.id)) {
                        p.hiddenShiftTabs = p.hiddenShiftTabs.filter((x) => x !== s.id);
                      } else {
                        p.hiddenShiftTabs.push(s.id);
                      }
                    });
                    if (!hidden && tab === s.id) setTab('all');
                  }}
                  className="accent-indigo-600"
                />
                {s.name} 独立视图
              </label>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 border-t border-slate-100 pt-3">
          <input
            type="checkbox"
            checked={db.prefs.showCodeColumn}
            onChange={(e) => updatePrefs((p) => { p.showCodeColumn = e.target.checked; })}
            className="accent-indigo-600"
          />
          在姓名列显示员工编号
        </label>
      </Modal>
    </div>
  );
}

function Checklist({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${ok ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>✓</span>
      <span className={ok ? 'text-slate-600' : 'text-slate-400'}>{label}</span>
    </div>
  );
}

function ScoreCard({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'good' | 'warn' }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 text-center ${tone === 'good' ? 'bg-emerald-50' : tone === 'warn' ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className={`font-bold ${big ? 'text-2xl' : 'text-lg'} ${tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-700'}`}>{value}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function ConflictsList({ conflicts }: { conflicts: { message: string; suggestions: string[] }[] }) {
  return (
    <div>
      <div className="text-sm font-medium text-rose-600 mb-2">
        {conflicts.length > 0 ? `当前条件无法同时满足（${conflicts.length} 处冲突）` : ''}
      </div>
      <div className="space-y-3 max-h-72 overflow-y-auto">
        {conflicts.map((c, i) => (
          <div key={i} className="bg-rose-50/60 border border-rose-100 rounded-xl p-3.5">
            <div className="text-sm text-rose-700 font-medium">{c.message}</div>
            {c.suggestions.length > 0 && (
              <div className="mt-2 text-xs text-slate-500">
                <div className="font-medium text-slate-600 mb-1">建议：</div>
                {c.suggestions.map((s, j) => (
                  <div key={j}>· {s}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ViolationsBar({ hard, soft }: { hard: Violation[]; soft: Violation[] }) {
  const [open, setOpen] = useState(false);
  const all = [...hard, ...soft];
  return (
    <div className={`mb-3 rounded-xl border px-4 py-2.5 text-sm ${hard.length > 0 ? 'bg-rose-50/70 border-rose-100' : 'bg-amber-50/70 border-amber-100'}`}>
      <button className="flex items-center gap-2 w-full text-left" onClick={() => setOpen(!open)}>
        <span className={hard.length > 0 ? 'text-rose-600' : 'text-amber-600'}>
          ⚠ 当前排班存在 {hard.length > 0 ? `${hard.length} 项规则冲突` : ''}{hard.length > 0 && soft.length > 0 ? '、' : ''}{soft.length > 0 ? `${soft.length} 项提示` : ''}
        </span>
        <span className="text-xs text-slate-400 ml-auto">{open ? '收起 ▲' : '查看冲突 ▼'}</span>
      </button>
      {open && (
        <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
          {all.map((v, i) => (
            <div key={i} className={`text-xs px-2.5 py-1.5 rounded-lg ${v.hard ? 'bg-rose-100/60 text-rose-700' : 'bg-amber-100/60 text-amber-700'}`}>
              {v.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 排班表格 ----------
function ScheduleGrid({
  project, tab, emps, violByCell, activeCell, showCode, onCellClick, onCellFocus,
}: {
  project: Project;
  tab: string;
  emps: Project['employees'];
  violByCell: Map<string, Violation[]>;
  activeCell: CellPos | null;
  showCode: boolean;
  onCellClick: (empId: string, day: number, x: number, y: number) => void;
  onCellFocus: (empId: string, day: number) => void;
}) {
  const days = daysInMonth(project.year, project.month);
  const shiftById = new Map(project.shifts.map((s) => [s.id, s]));
  const schedule = project.schedule!;

  return (
    <table className="sched-grid text-xs min-w-full">
      <thead>
        <tr>
          <th className="corner sticky-col px-3 py-2 text-left text-slate-500 font-medium min-w-[110px] bg-slate-50">
            姓名
          </th>
          {Array.from({ length: days }, (_, d) => {
            const we = isWeekend(project.year, project.month, d + 1);
            return (
              <th key={d} className={`px-0.5 py-1.5 text-center font-medium min-w-[40px] ${we ? 'text-rose-400 bg-rose-50/60' : 'text-slate-500'}`}>
                <div className="text-[13px] text-slate-600">{d + 1}</div>
                <div className="text-[10px]">{WEEKDAY_NAMES[weekdayOf(project.year, project.month, d + 1)]}</div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {emps.map((e) => (
          <tr key={e.id}>
            <td className="sticky-col px-3 py-1 whitespace-nowrap">
              <div className="font-medium text-slate-700 text-[13px] leading-tight">{e.name}</div>
              {showCode && e.employeeCode && (
                <div className="text-[10px] text-slate-400 leading-tight">{e.employeeCode}</div>
              )}
            </td>
            {Array.from({ length: days }, (_, d) => {
              const v = schedule[e.id]?.[d] ?? null;
              const locked = project.locks[e.id]?.[d];
              const cellViol = violByCell.get(`${e.id}:${d}`);
              const hasHard = cellViol?.some((x) => x.hard);
              const we = isWeekend(project.year, project.month, d + 1);
              const isActive = activeCell?.empId === e.id && activeCell?.day === d;
              const isShiftTab = tab !== 'all';
              const match = !isShiftTab || v === tab;
              return (
                <td key={d} className="p-0.5 text-center">
                  <button
                    data-cell={`${e.id}:${d}`}
                    onClick={(ev) => {
                      const r = (ev.target as HTMLElement).getBoundingClientRect();
                      onCellClick(e.id, d, r.left + r.width / 2, r.bottom + 4);
                    }}
                    onFocus={() => onCellFocus(e.id, d)}
                    title={cellViol?.map((x) => x.message).join('\n')}
                    className={`w-9 h-8 rounded-md text-[11px] font-medium relative transition-shadow ${
                      match ? cellClass(v, shiftById.get(v ?? '') ?? null) : 'bg-slate-50 text-slate-300'
                    } ${we ? 'ring-inset' : ''} ${hasHard ? 'ring-2 ring-rose-400' : cellViol ? 'ring-2 ring-amber-300' : ''} ${
                      isActive ? 'outline outline-2 outline-indigo-500' : ''
                    }`}
                  >
                    {match ? cellLabel(v, shiftById.get(v ?? '') ?? null) : '·'}
                    {locked && (
                      <span className="absolute -top-1 -right-1 text-[8px] text-slate-500">📌</span>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellClass(v: string | null, shift: Project['shifts'][number] | null): string {
  if (v === null || !shift) return `${REST_COLOR.bg} ${REST_COLOR.text}`;
  const c = SHIFT_PALETTE[shift.color % SHIFT_PALETTE.length];
  return `${c.bg} ${c.text}`;
}

function cellLabel(v: string | null, shift: Project['shifts'][number] | null): string {
  if (v === null || !shift) return '休';
  return shift.shortLabel || shift.name.slice(0, 2);
}

// ---------- 单元格弹层 ----------
function CellPopover({
  project, pos, x, y, liveEval, onClose, onSet, onLock,
}: {
  project: Project;
  pos: CellPos;
  x: number;
  y: number;
  liveEval: ReturnType<typeof evaluateProject>;
  onClose: () => void;
  onSet: (shiftId: string | null) => void;
  onLock: () => void;
}) {
  const emp = project.employees.find((e) => e.id === pos.empId);
  const v = project.schedule![pos.empId]?.[pos.day] ?? null;
  const locked = project.locks[pos.empId]?.[pos.day];
  const shift = project.shifts.find((s) => s.id === v);

  let explain: ReturnType<typeof explainCell> | null = null;
  if (liveEval) {
    const ei = liveEval.built.empIdx.get(pos.empId);
    if (ei !== undefined) {
      try {
        explain = explainCell(liveEval.built.input, liveEval.model, liveEval.A, liveEval.evalResult, ei, pos.day);
      } catch {
        explain = null;
      }
    }
  }

  const left = Math.max(12, Math.min(x - 150, window.innerWidth - 320));
  const top = Math.max(12, Math.min(y, window.innerHeight - 460));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 w-[300px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        style={{ left, top }}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <span className="font-semibold text-slate-800">{emp?.name}</span>
            <span className="text-xs text-slate-400 ml-2">{project.month + 1}月{pos.day + 1}日</span>
          </div>
          <div className={`text-xs px-2 py-0.5 rounded-full ${v === null ? 'bg-slate-100 text-slate-500' : 'bg-indigo-50 text-indigo-600'}`}>
            {v === null ? '休息' : shift?.name}
          </div>
        </div>
        <div className="p-3">
          <div className="text-xs font-medium text-slate-500 mb-2">修改为</div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => onSet(null)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${v === null ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              休息
            </button>
            {project.shifts.map((s, i) => {
              const c = SHIFT_PALETTE[s.color % SHIFT_PALETTE.length];
              return (
                <button
                  key={s.id}
                  onClick={() => onSet(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${v === s.id ? `${c.bg} ${c.text} border-transparent ring-2 ring-indigo-300` : `${c.bg} ${c.text} border-transparent hover:opacity-80`}`}
                  title={`快捷键 ${i + 1}`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={onLock}
              className={`text-xs px-2.5 py-1.5 rounded-lg border ${locked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'border-slate-200 text-slate-500'}`}
            >
              {locked ? '🔒 已锁定（重优化不改变）' : '🔓 锁定此格'}
            </button>
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">关闭 (Esc)</button>
          </div>
          {explain && (
            <div className="mt-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500 space-y-1 max-h-52 overflow-y-auto">
              <div className="font-medium text-slate-600 mb-1">排班信息</div>
              <Row k="本月工作天数" v={`${explain.wd} 天`} />
              <Row k="本月休息天数" v={`${explain.restDays} 天`} />
              {explain.shiftName !== '休息' && <Row k={`「${explain.shiftName}」次数`} v={`${explain.thisShiftCount} 次`} />}
              <Row k="周末上班" v={`${explain.weekend} 天`} />
              <Row k="当前连续工作" v={`${explain.curRun} 天`} />
              <Row k="上一个班次" v={explain.prevShift} />
              <Row k="下一个班次" v={explain.nextShift} />
              {explain.restGapPrev && (
                <Row k="与上次休息间隔" v={`${explain.restGapPrev.hours} 小时 ${explain.restGapPrev.ok ? '✓' : '⚠ 不足'}`} warn={!explain.restGapPrev.ok} />
              )}
              {explain.restGapNext && (
                <Row k="与下次休息间隔" v={`${explain.restGapNext.hours} 小时 ${explain.restGapNext.ok ? '✓' : '⚠ 不足'}`} warn={!explain.restGapNext.ok} />
              )}
              {explain.staffing && (
                <Row k="当日该班人力" v={`${explain.staffing.cur} / 需 ${explain.staffing.req} 人`} warn={explain.staffing.cur < explain.staffing.req} />
              )}
              {explain.ruleHits.map((r, i) => (
                <Row key={i} k={r.satisfied ? '✓' : '⚠'} v={r.text} warn={!r.satisfied} />
              ))}
              {explain.notes.map((n, i) => (
                <div key={i} className="text-[11px] text-slate-400">· {n}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-400 shrink-0">{k}</span>
      <span className={`text-right ${warn ? 'text-amber-600' : 'text-slate-600'}`}>{v}</span>
    </div>
  );
}
