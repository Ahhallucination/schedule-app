import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Confirm, Empty, Field, Modal, NumInput, useToast, PageHeader, TextInput } from '../components/ui';
import { dateISO, daysInMonth, isWeekend, monthLabel, weekdayOf, WEEKDAY_NAMES } from '../utils';

/** 每一天 × 每个班次需要多少人 */
export default function RequirementsPage() {
  const { active, mutate } = useStore();
  const { toast } = useToast();
  const project = active!;
  const days = daysInMonth(project.year, project.month);
  const [weekTplOpen, setWeekTplOpen] = useState(false);
  const [copyWeekOpen, setCopyWeekOpen] = useState(false);
  const [copyDayOpen, setCopyDayOpen] = useState(false);
  const [deltaOpen, setDeltaOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  // 批量模板：每班次的工作日/周末需求
  const [tpl, setTpl] = useState<Record<string, { wd: number; we: number }>>({});
  const [weekStart, setWeekStart] = useState(1);
  const [copyFrom, setCopyFrom] = useState(1);
  const [copyTo, setCopyTo] = useState<{ a: number; b: number }>({ a: 1, b: 1 });
  const [delta, setDelta] = useState<Record<string, number>>({});

  const getReq = (d: number, shiftId: string) => project.requirements[dateISO(project.year, project.month, d)]?.[shiftId] ?? 0;

  const setReq = (d: number, shiftId: string, v: number) => {
    mutate((p) => {
      const iso = dateISO(p.year, p.month, d);
      if (!p.requirements[iso]) p.requirements[iso] = {};
      p.requirements[iso][shiftId] = Math.max(0, Math.min(999, v));
    });
  };

  const totals = useMemo(() => {
    let total = 0;
    const perShift: Record<string, number> = {};
    for (const s of project.shifts) perShift[s.id] = 0;
    for (let d = 1; d <= days; d++) {
      for (const s of project.shifts) {
        const v = getReq(d, s.id);
        total += v;
        perShift[s.id] += v;
      }
    }
    return { total, perShift };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.requirements, project.shifts, days]);

  const activeEmps = project.employees.filter((e) => e.active).length;
  const estCapacity = activeEmps * Math.ceil(days * 0.85); // 粗估（考虑休息）

  if (project.shifts.length === 0) {
    return (
      <div className="p-8">
        <Empty title="请先创建班次" desc="人力需求是按班次设置的，请先在「班次管理」创建班次。" />
      </div>
    );
  }

  const applyWeekTpl = () => {
    mutate((p) => {
      for (let d = 1; d <= days; d++) {
        const iso = dateISO(p.year, p.month, d);
        const we = isWeekend(p.year, p.month, d);
        if (!p.requirements[iso]) p.requirements[iso] = {};
        for (const s of p.shifts) {
          const t = tpl[s.id];
          p.requirements[iso][s.id] = Math.max(0, we ? (t?.we ?? 0) : (t?.wd ?? 0));
        }
      }
    });
    setWeekTplOpen(false);
    toast('已按工作日/周末模板填充', 'success');
  };

  const applyCopyWeek = () => {
    if (weekStart < 1 || weekStart > days) return;
    mutate((p) => {
      // 以 weekStart 所在的周一为源周模板
      for (let d = 1; d <= days; d++) {
        const wd = weekdayOf(p.year, p.month, d);
        // 源周同星期几的日期
        const srcD = weekStart - weekdayOf(p.year, p.month, weekStart) + wd;
        if (srcD < 1 || srcD > days) continue;
        const srcISO = dateISO(p.year, p.month, srcD);
        const dstISO = dateISO(p.year, p.month, d);
        if (srcD === d) continue;
        p.requirements[dstISO] = { ...(p.requirements[srcISO] || {}) };
      }
    });
    setCopyWeekOpen(false);
    toast(`已把 ${weekStart}日 所在周的需求模式复制到全月`, 'success');
  };

  const applyCopyDay = () => {
    mutate((p) => {
      const srcISO = dateISO(p.year, p.month, copyFrom);
      const row = p.requirements[srcISO];
      if (!row) return;
      for (let d = Math.min(copyTo.a, copyTo.b); d <= Math.min(days, Math.max(copyTo.a, copyTo.b)); d++) {
        if (d === copyFrom) continue;
        p.requirements[dateISO(p.year, p.month, d)] = { ...row };
      }
    });
    setCopyDayOpen(false);
    toast(`已把 ${copyFrom}日 的需求复制到 ${Math.min(copyTo.a, copyTo.b)}日~${Math.min(days, Math.max(copyTo.a, copyTo.b))}日`, 'success');
  };

  const applyDelta = () => {
    mutate((p) => {
      for (let d = 1; d <= days; d++) {
        const iso = dateISO(p.year, p.month, d);
        if (!p.requirements[iso]) p.requirements[iso] = {};
        for (const s of p.shifts) {
          const dv = delta[s.id] || 0;
          if (dv !== 0) p.requirements[iso][s.id] = Math.max(0, (p.requirements[iso][s.id] ?? 0) + dv);
        }
      }
    });
    setDeltaOpen(false);
    toast('已批量调整需求', 'success');
  };

  return (
    <div className="p-6 max-w-full">
      <PageHeader
        title="人力需求"
        desc={`${monthLabel(project.year, project.month)} · 共需 ${totals.total} 人次 · ${activeEmps} 名在岗员工约可提供 ${estCapacity} 人次${totals.total > estCapacity ? '（⚠ 需求可能超过可用人力）' : ''}`}
        actions={
          <>
            <Btn onClick={() => {
              const init: Record<string, { wd: number; we: number }> = {};
              for (const s of project.shifts) init[s.id] = { wd: s.defaultCount, we: s.defaultCount };
              setTpl(init);
              setWeekTplOpen(true);
            }}>工作日/周末模板</Btn>
            <Btn onClick={() => setCopyWeekOpen(true)}>按周复制</Btn>
            <Btn onClick={() => setCopyDayOpen(true)}>复制某天到范围</Btn>
            <Btn onClick={() => setDeltaOpen(true)}>批量增减</Btn>
            <Btn variant="dangerSoft" onClick={() => setClearConfirm(true)}>全部清零</Btn>
          </>
        }
      />

      <Card className="overflow-auto max-h-[calc(100vh-190px)]">
        <table className="sched-grid text-sm min-w-full">
          <thead>
            <tr>
              <th className="corner sticky-col px-3 py-2.5 text-left text-xs text-slate-500 font-medium min-w-[120px]">日期</th>
              {project.shifts.map((s) => (
                <th key={s.id} className="px-2 py-2.5 text-center text-xs text-slate-500 font-medium min-w-[76px]">
                  {s.name}
                </th>
              ))}
              <th className="px-2 py-2.5 text-center text-xs text-slate-400 font-medium min-w-[60px]">合计</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const we = isWeekend(project.year, project.month, d);
              const rowTotal = project.shifts.reduce((a, s) => a + getReq(d, s.id), 0);
              return (
                <tr key={d} className={we ? 'bg-rose-50/40' : ''}>
                  <td className="sticky-col px-3 py-1.5 text-sm">
                    <span className="font-medium text-slate-700">{d}日</span>
                    <span className={`ml-2 text-xs ${we ? 'text-rose-400' : 'text-slate-400'}`}>周{WEEKDAY_NAMES[weekdayOf(project.year, project.month, d)]}</span>
                  </td>
                  {project.shifts.map((s) => (
                    <td key={s.id} className="px-1 py-1 text-center">
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={getReq(d, s.id)}
                        onChange={(e) => setReq(d, s.id, Number(e.target.value) || 0)}
                        className="w-14 text-center rounded-md border border-slate-200 px-1 py-1 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center text-sm text-slate-500">{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50">
              <td className="sticky-col px-3 py-2 text-xs font-medium text-slate-500" style={{ background: '#f8fafc' }}>各班次合计</td>
              {project.shifts.map((s) => (
                <td key={s.id} className="px-2 py-2 text-center text-xs font-medium text-slate-500">{totals.perShift[s.id] ?? 0}</td>
              ))}
              <td className="px-2 py-2 text-center text-xs font-semibold text-slate-600">{totals.total}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* 工作日/周末模板 */}
      <Modal open={weekTplOpen} onClose={() => setWeekTplOpen(false)} title="工作日/周末模板填充" footer={
        <>
          <Btn onClick={() => setWeekTplOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={applyWeekTpl}>应用到全月</Btn>
        </>
      }>
        <div className="text-xs text-slate-400 mb-3">分别设置周一至周五与周六、周日的需求人数，应用到全月（会覆盖现有设置）。</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="text-left py-1.5">班次</th>
              <th className="text-center py-1.5">周一至周五</th>
              <th className="text-center py-1.5">周六</th>
              <th className="text-center py-1.5">周日</th>
            </tr>
          </thead>
          <tbody>
            {project.shifts.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2">{s.name}</td>
                <td className="py-2 text-center">
                  <NumInput className="!w-16 !py-1 !px-1.5 inline-block text-center" value={tpl[s.id]?.wd ?? 0} min={0} max={999}
                    onChange={(v) => setTpl({ ...tpl, [s.id]: { wd: v ?? 0, we: tpl[s.id]?.we ?? 0 } })} />
                </td>
                <td className="py-2 text-center">
                  <NumInput className="!w-16 !py-1 !px-1.5 inline-block text-center" value={tpl[s.id]?.we ?? 0} min={0} max={999}
                    onChange={(v) => setTpl({ ...tpl, [s.id]: { wd: tpl[s.id]?.wd ?? 0, we: v ?? 0 } })} />
                </td>
                <td className="py-2 text-center">
                  <NumInput className="!w-16 !py-1 !px-1.5 inline-block text-center" value={tpl[s.id]?.we ?? 0} min={0} max={999}
                    onChange={(v) => setTpl({ ...tpl, [s.id]: { wd: tpl[s.id]?.wd ?? 0, we: v ?? 0 } })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs text-slate-400 mt-2">注：周六、周日共用一列（周末需求）。</div>
      </Modal>

      {/* 按周复制 */}
      <Modal open={copyWeekOpen} onClose={() => setCopyWeekOpen(false)} title="按周复制需求" width="max-w-sm" footer={
        <>
          <Btn onClick={() => setCopyWeekOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={applyCopyWeek}>复制</Btn>
        </>
      }>
        <div className="text-sm text-slate-600 mb-3">
          选择一个日期，把它所在那一周（周一~周日）的需求模式，按星期对齐复制到全月。
        </div>
        <Field label="源周中的任意一天（日号）">
          <NumInput value={weekStart} min={1} max={days} onChange={(v) => setWeekStart(v ?? 1)} />
        </Field>
      </Modal>

      {/* 复制某天到范围 */}
      <Modal open={copyDayOpen} onClose={() => setCopyDayOpen(false)} title="复制某天到日期范围" width="max-w-sm" footer={
        <>
          <Btn onClick={() => setCopyDayOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={applyCopyDay}>复制</Btn>
        </>
      }>
        <div className="space-y-3">
          <Field label="源日期（日号）">
            <NumInput value={copyFrom} min={1} max={days} onChange={(v) => setCopyFrom(v ?? 1)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="范围起（日号）">
              <NumInput value={copyTo.a} min={1} max={days} onChange={(v) => setCopyTo({ ...copyTo, a: v ?? 1 })} />
            </Field>
            <Field label="范围止（日号）">
              <NumInput value={copyTo.b} min={1} max={days} onChange={(v) => setCopyTo({ ...copyTo, b: v ?? 1 })} />
            </Field>
          </div>
        </div>
      </Modal>

      {/* 批量增减 */}
      <Modal open={deltaOpen} onClose={() => setDeltaOpen(false)} title="批量增减需求" width="max-w-sm" footer={
        <>
          <Btn onClick={() => setDeltaOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={applyDelta}>应用</Btn>
        </>
      }>
        <div className="text-xs text-slate-400 mb-3">为每个班次指定增减量（如 -1 表示每天该班次减 1 人，不会低于 0）。</div>
        <div className="space-y-2.5">
          {project.shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="w-20 text-sm text-slate-600">{s.name}</span>
              <NumInput value={delta[s.id] ?? 0} min={-999} max={999}
                onChange={(v) => setDelta({ ...delta, [s.id]: v ?? 0 })} />
            </div>
          ))}
        </div>
      </Modal>

      {/* 清零确认 */}
      <Confirm
        open={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => {
          mutate((p) => {
            for (let d = 1; d <= days; d++) {
              const iso = dateISO(p.year, p.month, d);
              if (!p.requirements[iso]) p.requirements[iso] = {};
              for (const s of p.shifts) p.requirements[iso][s.id] = 0;
            }
          });
          toast('已清空全部人力需求', 'success');
        }}
        title="清空人力需求"
        danger
        confirmText="清空"
        message="确定把本月所有日期、所有班次的需求人数都设为 0 吗？"
      />
    </div>
  );
}
