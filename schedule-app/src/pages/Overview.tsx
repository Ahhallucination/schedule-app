import React from 'react';
import { useStore } from '../store';
import { Btn, Card, Empty, PageHeader } from '../components/ui';
import { monthLabel } from '../utils';
import type { PageId } from '../App';

export default function OverviewPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { db, active, openProject } = useStore();

  if (!active) {
    return (
      <div className="p-8">
        <Empty
          title={db.projects.length === 0 ? '还没有排班计划' : '未打开排班项目'}
          desc={db.projects.length === 0
            ? '新建排班 → 粘贴员工名单 → 设置班次与人力需求 → 点击自动排班，几分钟即可完成一个月的排班。'
            : '选择一个项目开始使用。'}
          action={<Btn variant="primary" onClick={() => onNavigate('projects')}>
            {db.projects.length === 0 ? '创建第一个排班计划' : '选择排班项目'}
          </Btn>}
        />
        {db.projects.length > 0 && (
          <div className="max-w-2xl mx-auto grid gap-3 mt-4">
            {db.projects.slice(0, 4).map((p) => (
              <Card key={p.id} className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:border-indigo-200 transition-colors" >
                <button className="flex-1 text-left" onClick={() => openProject(p.id)}>
                  <div className="font-medium text-slate-700">{p.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{monthLabel(p.year, p.month)} · {p.employees.length} 名员工 · {p.shifts.length} 个班次</div>
                </button>
                {p.scheduleMeta && (
                  <span className={`text-xs rounded-full px-2.5 py-1 ${p.scheduleMeta.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                    {p.scheduleMeta.total} 分
                  </span>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  const hasSchedule = !!active.schedule;
  const reqCount = Object.values(active.requirements).reduce(
    (sum, row) => sum + Object.values(row).reduce((a, b) => a + (b || 0), 0), 0
  );
  const steps: { label: string; done: boolean; detail: string; page: PageId }[] = [
    { label: '员工', done: active.employees.length > 0, detail: `${active.employees.filter((e) => e.active).length} 人在岗`, page: 'employees' },
    { label: '班次', done: active.shifts.length > 0, detail: `${active.shifts.length} 个班次`, page: 'shifts' },
    { label: '人力需求', done: reqCount > 0, detail: reqCount > 0 ? `共需 ${reqCount} 人次` : '尚未设置', page: 'requirements' },
    { label: '排班规则', done: true, detail: `${active.rules.length} 条特殊要求`, page: 'rules' },
    { label: '排班结果', done: hasSchedule, detail: hasSchedule ? (active.scheduleMeta ? `${active.scheduleMeta.total} 分` : '已生成') : '未生成', page: 'schedule' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader title={active.name} desc={`${monthLabel(active.year, active.month)} · 最后更新 ${new Date(active.updatedAt).toLocaleString('zh-CN')}`} />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
        {steps.map((s, i) => (
          <button key={s.label} onClick={() => onNavigate(s.page)}
            className={`text-left bg-white rounded-xl border p-4 transition-colors hover:border-indigo-200 ${s.done ? 'border-slate-200/80' : 'border-amber-200 bg-amber-50/40'}`}>
            <div className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-semibold ${s.done ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                {s.done ? '✓' : i + 1}
              </span>
              <span className="font-medium text-sm text-slate-700">{s.label}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1.5">{s.detail}</div>
          </button>
        ))}
      </div>

      {active.scheduleMeta && (
        <Card className="p-6 mb-6">
          <div className="text-sm font-semibold text-slate-700 mb-4">最近一次排班质量</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <ScoreItem label="综合评分" value={`${active.scheduleMeta.total}`} big />
            <ScoreItem label="硬约束满足率" value={`${Math.round(active.scheduleMeta.hardRate * 100)}%`} />
            <ScoreItem label="人力需求满足率" value={`${Math.round(active.scheduleMeta.demandRate * 100)}%`} />
            <ScoreItem label="偏好满足率" value={`${Math.round(active.scheduleMeta.prefRate * 100)}%`} />
            <ScoreItem label="公平度" value={`${Math.round(active.scheduleMeta.fairness * 100)}%`} />
          </div>
          <div className="mt-5 flex gap-2">
            <Btn variant="primary" onClick={() => onNavigate('schedule')}>查看排班结果</Btn>
            <Btn onClick={() => onNavigate('stats')}>数据统计</Btn>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <div className="text-sm font-semibold text-slate-700 mb-3">快速开始</div>
        <div className="text-sm text-slate-500 leading-7">
          1. 在「员工管理」粘贴员工名单快速导入<br />
          2. 在「班次管理」创建班次（支持任意自定义班次）<br />
          3. 在「人力需求」设置每天每个班次需要多少人<br />
          4. 在「排班规则」设置连续工作上限、休息时间与员工特殊要求<br />
          5. 点击右上角「自动排班」，系统自动生成排班表并评分<br />
          6. 在「排班结果」中检查、微调、锁定后重新优化，最后导出 Excel
        </div>
      </Card>
    </div>
  );
}

function ScoreItem({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`font-bold text-slate-800 ${big ? 'text-3xl' : 'text-xl'}`}>{value}</div>
    </div>
  );
}
