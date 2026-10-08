import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Empty, PageHeader, useToast } from '../components/ui';
import { dateISO, daysInMonth, isWeekend, monthLabel, weekdayOf, WEEKDAY_NAMES } from '../utils';
import { evaluateProject } from '../engine/input';
import { exportProjectExcel } from '../excel';

export default function StatsPage() {
  const { active } = useStore();
  const { toast } = useToast();
  const project = active!;
  const days = daysInMonth(project.year, project.month);
  const [subTab, setSubTab] = useState<'daily' | 'emp' | 'fair'>('daily');

  const ev = useMemo(() => {
    if (!project.schedule) return null;
    try { return evaluateProject(project); } catch { return null; }
  }, [project]);

  if (!project.schedule || !ev) {
    return (
      <div className="p-8">
        <Empty title="还没有排班结果" desc="先在「排班结果」中生成排班，统计信息会自动计算。" />
      </div>
    );
  }

  const { evalResult, built } = ev;
  const input = built.input;
  const demand = input.demand;
  const filled = evalResult.filled;

  const dayGap = (d: number) => {
    let gap = 0;
    for (let s = 0; s < input.shifts.length; s++) gap += Math.max(0, demand[d][s] - filled[d][s]);
    return gap;
  };

  const totalGap = Array.from({ length: days }, (_, d) => dayGap(d)).reduce((a, b) => a + b, 0);

  // 公平性汇总
  const fair = useMemo(() => {
    const per = evalResult.perEmp;
    const emps = input.employees;
    const byMetric = input.shifts.map((sh, s) => {
      const counts = per.map((p) => p.shiftCnt[s]);
      const max = Math.max(...counts);
      const min = Math.min(...counts);
      const maxNames = emps.filter((_, i) => counts[i] === max).map((e) => e.name);
      const minNames = emps.filter((_, i) => counts[i] === min).map((e) => e.name);
      return { shift: sh.name, max, min, maxNames, minNames };
    });
    const wds = per.map((p) => p.wd);
    const wks = per.map((p) => p.weekend);
    return {
      byMetric,
      wdSpread: Math.max(...wds) - Math.min(...wds),
      wkSpread: Math.max(...wks) - Math.min(...wks),
      maxRun: evalResult.maxRun,
    };
  }, [evalResult, input]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="数据统计"
        desc={`${monthLabel(project.year, project.month)} · 人力缺口共 ${totalGap} 人次 · 综合评分 ${evalResult.score.total} 分`}
        actions={
          <Btn onClick={async () => {
            try {
              await exportProjectExcel(project, ev);
              toast('已导出 Excel（含统计表）', 'success');
            } catch (err: any) {
              toast(`导出失败：${err?.message || '未知错误'}`, 'error');
            }
          }}>导出 Excel</Btn>
        }
      />

      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 mb-4 w-fit">
        {([['daily', '每日统计'], ['emp', '员工统计'], ['fair', '公平性统计']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${subTab === id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {subTab === 'daily' && (
        <Card className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                <th className="px-4 py-2.5 text-left font-medium">日期</th>
                {input.shifts.map((s) => (
                  <th key={s.id} className="px-3 py-2.5 text-center font-medium">{s.name}</th>
                ))}
                <th className="px-3 py-2.5 text-center font-medium">在岗人次</th>
                <th className="px-3 py-2.5 text-center font-medium">缺口</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: days }, (_, d) => {
                const we = isWeekend(project.year, project.month, d + 1);
                const gap = dayGap(d);
                const onDuty = filled[d].reduce((a, b) => a + b, 0);
                return (
                  <tr key={d} className={`border-t border-slate-100 ${we ? 'bg-rose-50/30' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-700">{d + 1}日</span>
                      <span className={`ml-2 text-xs ${we ? 'text-rose-400' : 'text-slate-400'}`}>周{WEEKDAY_NAMES[weekdayOf(project.year, project.month, d + 1)]}</span>
                    </td>
                    {input.shifts.map((s, si) => {
                      const req = demand[d][si];
                      const f = filled[d][si];
                      const short = f < req;
                      const over = f > req;
                      return (
                        <td key={s.id} className={`px-3 py-2 text-center ${short ? 'text-rose-600 font-medium' : over ? 'text-amber-600' : 'text-slate-600'}`}>
                          {f} / {req}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center text-slate-600">{onDuty}</td>
                    <td className={`px-3 py-2 text-center ${gap > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{gap}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {subTab === 'emp' && (
        <Card className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 sticky top-0">
                <th className="px-4 py-2.5 text-left font-medium">姓名</th>
                <th className="px-3 py-2.5 text-center font-medium">工作天数</th>
                <th className="px-3 py-2.5 text-center font-medium">休息天数</th>
                <th className="px-3 py-2.5 text-center font-medium">周末班</th>
                {input.shifts.map((s) => (
                  <th key={s.id} className="px-3 py-2.5 text-center font-medium">{s.name}</th>
                ))}
                <th className="px-3 py-2.5 text-center font-medium">最长连续</th>
                <th className="px-3 py-2.5 text-center font-medium">目标</th>
              </tr>
            </thead>
            <tbody>
              {input.employees.map((emp, i) => {
                const st = evalResult.perEmp[i];
                return (
                  <tr key={emp.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-700">{emp.name}</td>
                    <td className="px-3 py-2 text-center">{st.wd}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{st.rest}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{st.weekend}</td>
                    {input.shifts.map((_, s) => (
                      <td key={s} className="px-3 py-2 text-center text-slate-500">{st.shiftCnt[s]}</td>
                    ))}
                    <td className="px-3 py-2 text-center text-slate-500">{st.maxRun} 天</td>
                    <td className="px-3 py-2 text-center">
                      {emp.targetWorkDays != null ? (
                        <span className={st.targetDev === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                          {st.wd} / {emp.targetWorkDays}{st.targetDev === 0 ? ' ✓' : ''}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {subTab === 'fair' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="text-sm font-semibold text-slate-700 mb-3">班次分配公平</div>
            <div className="space-y-3">
              {fair.byMetric.map((m) => (
                <div key={m.shift}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{m.shift}</span>
                    <span className="text-slate-400 text-xs">最多 {m.max} 次 / 最少 {m.min} 次</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    最多：{m.maxNames.slice(0, 4).join('、')}{m.maxNames.length > 4 ? ` 等${m.maxNames.length}人` : ''} ·
                    最少：{m.minNames.slice(0, 4).join('、')}{m.minNames.length > 4 ? ` 等${m.minNames.length}人` : ''}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <div className="space-y-4">
            <Card className="p-5">
              <div className="text-sm font-semibold text-slate-700 mb-3">整体公平指标</div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">工作天数差异（极差）</span><span className="font-medium text-slate-700">{fair.wdSpread} 天</span></div>
                <div className="flex justify-between"><span className="text-slate-500">周末班差异（极差）</span><span className="font-medium text-slate-700">{fair.wkSpread} 天</span></div>
                <div className="flex justify-between"><span className="text-slate-500">最长连续工作</span><span className="font-medium text-slate-700">{fair.maxRun ? `${fair.maxRun.len} 天（${input.employees[fair.maxRun.emp]?.name}）` : '—'}</span></div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-slate-700 mb-3">评分明细</div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">硬约束满足率</span><span className="font-medium">{Math.round(evalResult.score.hardRate * 100)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-500">人力需求满足率</span><span className="font-medium">{Math.round(evalResult.score.demandRate * 100)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-500">员工偏好满足率</span><span className="font-medium">{Math.round(evalResult.score.prefRate * 100)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-500">出勤均衡度</span><span className="font-medium">{Math.round(evalResult.score.workFairness * 100)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-500">周末公平度</span><span className="font-medium">{Math.round(evalResult.score.weekendFairness * 100)}%</span></div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
