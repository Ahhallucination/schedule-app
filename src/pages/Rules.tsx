import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Confirm, Empty, Field, Modal, NumInput, Sel, Segmented, TextInput, Toggle, useToast, Badge, PageHeader } from '../components/ui';
import { RULE_TYPE_INFO, type RuleType, type SpecialRule } from '../types';
import { dateISO, daysInMonth, uid, weekdayOf, WEEKDAY_NAMES } from '../utils';

export default function RulesPage() {
  const { active, mutate } = useStore();
  const { toast } = useToast();
  const project = active!;
  const [addOpen, setAddOpen] = useState(false);
  const [delRule, setDelRule] = useState<SpecialRule | null>(null);
  const [filterEmp, setFilterEmp] = useState('');

  const days = daysInMonth(project.year, project.month);
  const empName = (id: string) => project.employees.find((e) => e.id === id)?.name ?? '（已删除）';
  const shiftName = (id?: string) => project.shifts.find((s) => s.id === id)?.name ?? '';

  const rules = useMemo(() => {
    return project.rules.filter((r) => !filterEmp || r.employeeId === filterEmp);
  }, [project.rules, filterEmp]);

  const gr = project.globalRules;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="排班规则" desc="硬约束必须满足，软约束按权重尽量满足。全部设置都会真实影响排班算法。" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {/* 全局硬规则 */}
        <Card className="p-5">
          <div className="text-sm font-semibold text-slate-700 mb-4">全局规则（硬约束）</div>
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">连续工作最多</div>
                <div className="text-xs text-slate-400">超过则判定为规则违反</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <NumInput className="!w-20 text-center" value={gr.maxConsecutiveWorkDays} min={1} max={31}
                  onChange={(v) => mutate((p) => { p.globalRules.maxConsecutiveWorkDays = v ?? 6; })} />
                天
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">班次间至少休息</div>
                <div className="text-xs text-slate-400">按班次实际时间计算（含跨天）</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <NumInput className="!w-20 text-center" value={gr.minRestHours} min={0} max={24}
                  onChange={(v) => mutate((p) => { p.globalRules.minRestHours = v ?? 12; })} />
                小时
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">尽量避免连续超过（软）</div>
                <div className="text-xs text-slate-400">0 = 关闭；低于硬上限时先尽量控制</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <NumInput className="!w-20 text-center" value={gr.comfortConsecutiveDays} min={0} max={31}
                  onChange={(v) => mutate((p) => { p.globalRules.comfortConsecutiveDays = v ?? 5; })} />
                天
              </div>
            </div>
            <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
              各班次的连续限制（如连续夜班最多 3 天）在「班次管理」中按班次设置；
              员工的每月出勤要求在「员工管理」中按员工设置。
            </div>
          </div>
        </Card>

        {/* 软约束权重 */}
        <Card className="p-5">
          <div className="text-sm font-semibold text-slate-700 mb-4">软约束优先级（尽量满足）</div>
          <div className="space-y-3.5">
            {([
              ['fairnessShift', '班次分配公平（含夜班公平）', '每个人上的各类班次次数尽量接近'],
              ['fairnessWork', '出勤天数均衡', '总工作天数尽量接近目标且互相均衡'],
              ['fairnessWeekend', '周末班公平', '周末上班次数尽量均匀'],
              ['preference', '员工偏好', '偏好班次、偏好休息、尽量回避的班次'],
              ['avoidConsecutive', '避免连续工作', '尽量减少长连班（配合软连续上限）'],
            ] as const).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-600">{label}</div>
                  <div className="text-xs text-slate-400">{hint}</div>
                </div>
                <Segmented
                  size="sm"
                  value={gr.weights[key]}
                  onChange={(v) => mutate((p) => { p.globalRules.weights[key] = v; })}
                  options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: ['1', '2', '3', '4', '5'][n - 1], title: `权重 ${n}` }))}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 员工特殊要求 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-slate-700">员工特殊要求</div>
            <div className="text-xs text-slate-400 mt-0.5">日期级 / 班次级 / 时间范围规则，区分“必须满足”与“尽量满足”</div>
          </div>
          <div className="flex items-center gap-2">
            <Sel value={filterEmp} onChange={setFilterEmp} className="!w-36">
              <option value="">全部员工</option>
              {project.employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Sel>
            <Btn variant="primary" onClick={() => setAddOpen(true)}>+ 添加要求</Btn>
          </div>
        </div>

        {rules.length === 0 ? (
          <div className="text-sm text-slate-400 py-8 text-center">
            {project.rules.length === 0 ? '暂无特殊要求。例如：张三 11月10日 必须休息；李四 不能上中班。' : '该员工暂无特殊要求。'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 font-medium">员工</th>
                <th className="text-left py-2 font-medium">类型</th>
                <th className="text-left py-2 font-medium">日期</th>
                <th className="text-left py-2 font-medium">班次</th>
                <th className="text-left py-2 font-medium">性质</th>
                <th className="text-left py-2 font-medium">备注</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const info = RULE_TYPE_INFO[r.type];
                return (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2.5 font-medium text-slate-700">{empName(r.employeeId)}</td>
                    <td className="py-2.5 text-slate-600">{info.label}</td>
                    <td className="py-2.5 text-slate-500">
                      {fmtDate(r.dateStart)}{r.dateEnd !== r.dateStart ? ` ~ ${fmtDate(r.dateEnd)}` : ''}
                    </td>
                    <td className="py-2.5 text-slate-500">{info.needShift ? shiftName(r.shiftId) : '—'}</td>
                    <td className="py-2.5">
                      {info.hard ? <Badge tone="rose">必须满足</Badge> : <Badge tone="indigo">尽量满足</Badge>}
                    </td>
                    <td className="py-2.5 text-slate-400 text-xs">{r.note || '—'}</td>
                    <td className="py-2.5 text-right">
                      <Btn size="sm" variant="dangerSoft" onClick={() => setDelRule(r)}>删除</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* 添加规则弹窗 */}
      <AddRuleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(rule) => {
          mutate((p) => { p.rules.push(rule); });
          setAddOpen(false);
          toast('已添加特殊要求', 'success');
        }}
      />

      {/* 删除确认 */}
      <Confirm
        open={!!delRule}
        onClose={() => setDelRule(null)}
        onConfirm={() => {
          if (delRule) mutate((p) => { p.rules = p.rules.filter((x) => x.id !== delRule.id); });
          toast('已删除', 'success');
        }}
        title="删除特殊要求"
        danger
        confirmText="删除"
        message={<>确定删除「{delRule ? `${empName(delRule.employeeId)} · ${RULE_TYPE_INFO[delRule.type].label}` : ''}」吗？</>}
      />
    </div>
  );
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function AddRuleModal({ open, onClose, onAdd }: {
  open: boolean;
  onClose: () => void;
  onAdd: (r: SpecialRule) => void;
}) {
  const { active } = useStore();
  const { toast } = useToast();
  const project = active!;
  const days = daysInMonth(project.year, project.month);
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<RuleType>('mustRest');
  const [dateStart, setDateStart] = useState(1);
  const [dateEnd, setDateEnd] = useState(1);
  const [shiftId, setShiftId] = useState('');
  const [note, setNote] = useState('');

  const info = RULE_TYPE_INFO[type];
  const emp = project.employees.find((e) => e.id === employeeId) ?? project.employees[0];
  const effEmpId = employeeId || emp?.id || '';
  const effShiftId = shiftId || project.shifts[0]?.id || '';

  const doAdd = () => {
    if (!effEmpId) { toast('请先添加员工', 'warn'); return; }
    if (info.needShift && !effShiftId) { toast('请先创建班次', 'warn'); return; }
    const rule: SpecialRule = {
      id: uid(),
      employeeId: effEmpId,
      type,
      dateStart: dateISO(project.year, project.month, Math.min(dateStart, dateEnd)),
      dateEnd: dateISO(project.year, project.month, Math.max(dateStart, dateEnd)),
      shiftId: info.needShift ? effShiftId : undefined,
      note: note.trim(),
    };
    onAdd(rule);
  };

  return (
    <Modal open={open} onClose={onClose} title="添加员工特殊要求" footer={
      <>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" onClick={doAdd}>添加</Btn>
      </>
    }>
      <div className="space-y-4">
        <Field label="员工">
          <Sel value={effEmpId} onChange={setEmployeeId}>
            {project.employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Sel>
        </Field>
        <Field label="要求类型">
          <Sel value={type} onChange={(v) => setType(v as RuleType)}>
            {(Object.keys(RULE_TYPE_INFO) as RuleType[]).map((t) => (
              <option key={t} value={t}>
                {RULE_TYPE_INFO[t].label}（{RULE_TYPE_INFO[t].hard ? '必须' : '尽量'}）
              </option>
            ))}
          </Sel>
          <div className="text-xs text-slate-400 mt-1.5">{info.desc}</div>
        </Field>
        {info.needShift && (
          <Field label="班次">
            <Sel value={effShiftId} onChange={setShiftId}>
              {project.shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Sel>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={info.allowRange ? '开始日期（日号）' : '日期（日号）'}>
            <NumInput value={dateStart} min={1} max={days} onChange={(v) => setDateStart(v ?? 1)} />
          </Field>
          {info.allowRange && (
            <Field label="结束日期（日号）">
              <NumInput value={dateEnd} min={1} max={days} onChange={(v) => setDateEnd(v ?? 1)} />
            </Field>
          )}
        </div>
        <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
          {emp?.name || '—'} · {info.label} · {project.month + 1}月{Math.min(dateStart, dateEnd)}日{info.allowRange && dateStart !== dateEnd ? ` ~ ${project.month + 1}月${Math.max(dateStart, dateEnd)}日` : ''}
          {info.needShift ? ` · ${project.shifts.find((s) => s.id === effShiftId)?.name || '—'}` : ''}
        </div>
        <Field label="备注（可选）">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：家中有事" />
        </Field>
      </div>
    </Modal>
  );
}
