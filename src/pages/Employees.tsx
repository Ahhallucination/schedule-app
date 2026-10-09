import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Btn, Confirm, Empty, Field, Modal, NumInput, Sel, TextInput, Toggle, useToast, Badge, Card } from '../components/ui';
import { parseNameList, uid } from '../utils';
import { parseEmployeeFile } from '../excel';
import type { Employee, Project } from '../types';

function emptyEmployee(): Employee {
  return {
    id: uid(), name: '', employeeCode: '', skills: [], active: true,
    targetWorkDays: null, targetTolerance: 0, targetHard: false,
    preferences: { preferredShifts: [], avoidShifts: [], preferWeekendRest: false },
  };
}

export default function EmployeesPage() {
  const { active, mutate } = useStore();
  const { toast } = useToast();
  const project = active!;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [filePreview, setFilePreview] = useState<{ rows: { name: string; code: string; skills: string[] }[]; errors: string[] } | null>(null);
  const [delConfirm, setDelConfirm] = useState(false);
  const [batchTargetOpen, setBatchTargetOpen] = useState(false);
  const [batchTarget, setBatchTarget] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim();
    return project.employees.filter((e) => {
      if (filter === 'active' && !e.active) return false;
      if (filter === 'inactive' && e.active) return false;
      if (q && !e.name.includes(q) && !e.employeeCode.includes(q) && !e.skills.some((s) => s.includes(q))) return false;
      return true;
    });
  }, [project.employees, search, filter]);

  const existingNames = useMemo(() => new Set(project.employees.map((e) => e.name)), [project.employees]);

  const addNames = (names: string[], meta?: { code?: string; skills?: string[] }[]) => {
    const dup = names.filter((n) => existingNames.has(n));
    const fresh = names.filter((n) => !existingNames.has(n));
    if (fresh.length === 0) {
      toast(dup.length ? `这 ${dup.length} 个姓名已存在，未导入` : '没有可导入的姓名', 'warn');
      return;
    }
    mutate((p) => {
      fresh.forEach((name, i) => {
        const metaIdx = names.indexOf(name);
        const m = metaIdx >= 0 && meta ? meta[metaIdx] : undefined;
        p.employees.push({
          ...emptyEmployee(),
          id: uid(),
          name,
          employeeCode: m?.code || '',
          skills: m?.skills || [],
        });
        void i;
      });
    });
    toast(`已导入 ${fresh.length} 名员工${dup.length ? `（跳过已存在：${dup.join('、')}）` : ''}`, 'success');
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((e) => e.id)));
  };

  const saveEmp = (emp: Employee) => {
    if (!emp.name.trim()) {
      toast('请输入员工姓名', 'warn');
      return;
    }
    const nameDup = project.employees.some((e) => e.name === emp.name.trim() && e.id !== emp.id);
    if (nameDup) {
      toast(`已存在同名员工「${emp.name.trim()}」，请修改姓名`, 'error');
      return;
    }
    mutate((p) => {
      const idx = p.employees.findIndex((e) => e.id === emp.id);
      const clean = { ...emp, name: emp.name.trim() };
      if (idx >= 0) p.employees[idx] = clean;
      else p.employees.push(clean);
    });
    setEditEmp(null);
    toast('已保存员工信息', 'success');
  };

  const activeCount = project.employees.filter((e) => e.active).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">员工管理</h1>
          <div className="text-sm text-slate-400 mt-0.5">
            共 {project.employees.length} 名，{activeCount} 名在岗
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TextInput
            id="emp-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名/编号/岗位 (⌘F)"
            className="!w-56"
          />
          <Sel value={filter} onChange={(v) => setFilter(v as any)} className="!w-24">
            <option value="all">全部</option>
            <option value="active">在岗</option>
            <option value="inactive">停用</option>
          </Sel>
          <Btn onClick={() => { setPasteText(''); setPasteOpen(true); }}>粘贴导入</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Excel / CSV 导入</Btn>
          <Btn variant="primary" onClick={() => setEditEmp(emptyEmployee())}>+ 添加员工</Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const result = await parseEmployeeFile(f);
                if (result.rows.length === 0) {
                  toast(result.errors[0] || '文件中没有可识别的员工姓名', 'error');
                  return;
                }
                setFilePreview(result);
              } catch (err: any) {
                toast(`文件解析失败：${err?.message || '格式不正确'}`, 'error');
              }
            }}
          />
        </div>
      </div>

      {selected.size > 0 && (
        <Card className="mb-3 px-4 py-2.5 flex items-center gap-3 bg-indigo-50/60 border-indigo-100">
          <span className="text-sm text-indigo-700 font-medium">已选 {selected.size} 人</span>
          <Btn size="sm" onClick={() => {
            mutate((p) => { for (const e of p.employees) if (selected.has(e.id)) e.active = true; });
            setSelected(new Set());
            toast('已批量启用', 'success');
          }}>批量启用</Btn>
          <Btn size="sm" onClick={() => {
            mutate((p) => { for (const e of p.employees) if (selected.has(e.id)) e.active = false; });
            setSelected(new Set());
            toast('已批量停用', 'success');
          }}>批量停用</Btn>
          <Btn size="sm" onClick={() => setBatchTargetOpen(true)}>设置目标出勤</Btn>
          <Btn size="sm" variant="dangerSoft" onClick={() => setDelConfirm(true)}>批量删除</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>取消选择</Btn>
        </Card>
      )}

      {project.employees.length === 0 ? (
        <Empty
          title="还没有员工"
          desc="粘贴员工名单即可快速导入——支持换行、空格、逗号等多种分隔格式。"
          action={<Btn variant="primary" onClick={() => setPasteOpen(true)}>粘贴员工名单</Btn>}
        />
      ) : filtered.length === 0 ? (
        <Empty title="没有匹配的员工" desc="尝试调整搜索关键词或筛选条件" />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="w-10 px-3 py-2.5 text-left">
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-indigo-600" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">姓名</th>
                <th className="px-3 py-2.5 text-left font-medium">编号</th>
                <th className="px-3 py-2.5 text-left font-medium">岗位/技能</th>
                <th className="px-3 py-2.5 text-left font-medium">目标出勤</th>
                <th className="px-3 py-2.5 text-left font-medium">偏好</th>
                <th className="px-3 py-2.5 text-left font-medium">状态</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const ruleCount = project.rules.filter((r) => r.employeeId === e.id).length;
                return (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => {
                          const s = new Set(selected);
                          if (s.has(e.id)) s.delete(e.id); else s.add(e.id);
                          setSelected(s);
                        }}
                        className="accent-indigo-600"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-700">{e.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{e.employeeCode || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">{e.skills.join('、') || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {e.targetWorkDays != null ? (
                        <span>
                          {e.targetWorkDays}{e.targetTolerance > 0 ? `±${e.targetTolerance}` : ''} 天
                          {e.targetHard && <Badge tone="rose"> 硬性</Badge>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">
                      {prefSummary(e, project)}
                      {ruleCount > 0 && <Badge tone="indigo"> {ruleCount} 条特殊要求</Badge>}
                    </td>
                    <td className="px-3 py-2.5">
                      {e.active ? <Badge tone="green">在岗</Badge> : <Badge>停用</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Btn size="sm" variant="ghost" onClick={() => setEditEmp(structuredClone(e))}>编辑</Btn>
                      <Btn size="sm" variant="dangerSoft" onClick={() => {
                        mutate((p) => {
                          p.employees = p.employees.filter((x) => x.id !== e.id);
                          p.rules = p.rules.filter((r) => r.employeeId !== e.id);
                          delete p.locks[e.id];
                          if (p.schedule) delete p.schedule[e.id];
                        });
                        toast(`已删除 ${e.name}`, 'success');
                      }}>删除</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* 员工编辑弹窗 */}
      <Modal open={!!editEmp} onClose={() => setEditEmp(null)} title={editEmp && project.employees.some((e) => e.id === editEmp.id) ? '编辑员工' : '添加员工'} width="max-w-xl" footer={
        <>
          <Btn onClick={() => setEditEmp(null)}>取消</Btn>
          <Btn variant="primary" onClick={() => editEmp && saveEmp(editEmp)}>保存</Btn>
        </>
      }>
        {editEmp && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="姓名 *">
                <TextInput value={editEmp.name} onChange={(e) => setEditEmp({ ...editEmp, name: e.target.value })} placeholder="员工姓名" autoFocus />
              </Field>
              <Field label="员工编号">
                <TextInput value={editEmp.employeeCode} onChange={(e) => setEditEmp({ ...editEmp, employeeCode: e.target.value })} placeholder="可选" />
              </Field>
            </div>
            <Field label="岗位/技能" hint="多个用逗号分隔，如：收银,客服">
              <TextInput
                value={editEmp.skills.join(',')}
                onChange={(e) => setEditEmp({ ...editEmp, skills: e.target.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) })}
                placeholder="可选"
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="本月目标出勤（天）" hint="留空则不设目标">
                <NumInput value={editEmp.targetWorkDays} min={0} max={31} onChange={(v) => setEditEmp({ ...editEmp, targetWorkDays: v })} />
              </Field>
              <Field label="允许浮动 ±" hint="如 1 表示 21~23 天">
                <NumInput value={editEmp.targetTolerance} min={0} max={10} onChange={(v) => setEditEmp({ ...editEmp, targetTolerance: v ?? 0 })} />
              </Field>
              <Field label="出勤要求性质">
                <Toggle
                  checked={editEmp.targetHard}
                  onChange={(v) => setEditEmp({ ...editEmp, targetHard: v })}
                  label={editEmp.targetHard ? '硬性（必须）' : '软性（尽量）'}
                />
              </Field>
            </div>
            <ShiftChips
              label="喜欢的班次（尽量多安排）"
              project={project}
              selected={editEmp.preferences.preferredShifts}
              onChange={(ids) => setEditEmp({ ...editEmp, preferences: { ...editEmp.preferences, preferredShifts: ids } })}
            />
            <ShiftChips
              label="尽量不上的班次"
              project={project}
              selected={editEmp.preferences.avoidShifts}
              onChange={(ids) => setEditEmp({ ...editEmp, preferences: { ...editEmp.preferences, avoidShifts: ids } })}
            />
            <div className="flex items-center gap-6">
              <Toggle
                checked={editEmp.preferences.preferWeekendRest}
                onChange={(v) => setEditEmp({ ...editEmp, preferences: { ...editEmp.preferences, preferWeekendRest: v } })}
                label="尽量安排周末休息"
              />
              <Toggle checked={editEmp.active} onChange={(v) => setEditEmp({ ...editEmp, active: v })} label={editEmp.active ? '在岗' : '停用（不参与排班）'} />
            </div>
          </div>
        )}
      </Modal>

      {/* 粘贴导入 */}
      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="粘贴导入员工名单" footer={
        <>
          <Btn onClick={() => setPasteOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={() => {
            const { names } = parseNameList(pasteText);
            if (names.length === 0) { toast('没有识别到有效姓名', 'warn'); return; }
            addNames(names);
            setPasteOpen(false);
          }}>导入</Btn>
        </>
      }>
        <div className="text-xs text-slate-400 mb-2">
          直接粘贴名单（每行一个、空格分隔、逗号分隔均可），自动清理空格、空行和重复姓名。
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={10}
          placeholder={'张三\n李四\n王五\n赵六'}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-mono"
          autoFocus
        />
        <PastePreview text={pasteText} existing={existingNames} />
      </Modal>

      {/* Excel/CSV 导入预览 */}
      <Modal open={!!filePreview} onClose={() => setFilePreview(null)} title="导入员工" footer={
        <>
          <Btn onClick={() => setFilePreview(null)}>取消</Btn>
          <Btn variant="primary" onClick={() => {
            if (!filePreview) return;
            addNames(filePreview.rows.map((r) => r.name), filePreview.rows.map((r) => ({ code: r.code, skills: r.skills })));
            setFilePreview(null);
          }}>导入</Btn>
        </>
      }>
        {filePreview && (
          <div>
            {filePreview.errors.map((err, i) => (
              <div key={i} className="text-xs text-amber-600 mb-1">⚠ {err}</div>
            ))}
            <div className="text-sm text-slate-600 mb-3">识别到 {filePreview.rows.length} 名员工：</div>
            <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-lg">
              <table className="w-full text-sm">
                <tbody>
                  {filePreview.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-slate-400">{r.code}</td>
                      <td className="px-3 py-1.5 text-slate-400">{r.skills.join('、')}</td>
                      {existingNames.has(r.name) && <td className="px-3 py-1.5 text-amber-500 text-xs">已存在，将跳过</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filePreview.rows.length > 50 && <div className="text-xs text-slate-400 mt-2">仅预览前 50 条，导入时包含全部</div>}
          </div>
        )}
      </Modal>

      {/* 批量删除确认 */}
      <Confirm
        open={delConfirm}
        onClose={() => setDelConfirm(false)}
        onConfirm={() => {
          mutate((p) => {
            p.employees = p.employees.filter((e) => !selected.has(e.id));
            p.rules = p.rules.filter((r) => !selected.has(r.employeeId));
            for (const id of selected) {
              delete p.locks[id];
              if (p.schedule) delete p.schedule[id];
            }
          });
          toast(`已删除 ${selected.size} 名员工`, 'success');
          setSelected(new Set());
        }}
        title="批量删除员工"
        danger
        confirmText="删除"
        message={<>确定删除选中的 {selected.size} 名员工吗？相关的特殊要求与排班数据将一并删除。</>}
      />

      {/* 批量设置目标出勤 */}
      <Modal open={batchTargetOpen} onClose={() => setBatchTargetOpen(false)} title="批量设置目标出勤天数" width="max-w-sm" footer={
        <>
          <Btn onClick={() => setBatchTargetOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={() => {
            mutate((p) => { for (const e of p.employees) if (selected.has(e.id)) e.targetWorkDays = batchTarget; });
            setBatchTargetOpen(false);
            toast('已批量设置目标出勤', 'success');
          }}>应用</Btn>
        </>
      }>
        <Field label="本月目标出勤天数（留空=清除目标）">
          <NumInput value={batchTarget} min={0} max={31} onChange={setBatchTarget} />
        </Field>
      </Modal>
    </div>
  );
}

function prefSummary(e: Employee, project: Project): string {
  const parts: string[] = [];
  if (e.preferences.preferredShifts.length > 0) {
    parts.push('偏好 ' + e.preferences.preferredShifts.map((id) => project.shifts.find((s) => s.id === id)?.name).filter(Boolean).join('/'));
  }
  if (e.preferences.avoidShifts.length > 0) {
    parts.push('回避 ' + e.preferences.avoidShifts.map((id) => project.shifts.find((s) => s.id === id)?.name).filter(Boolean).join('/'));
  }
  if (e.preferences.preferWeekendRest) parts.push('周末休息');
  return parts.join('；') || '—';
}

function ShiftChips({ label, project, selected, onChange }: {
  label: string; project: Project; selected: string[]; onChange: (ids: string[]) => void;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-1.5">{label}</div>
      {project.shifts.length === 0 ? (
        <div className="text-xs text-slate-400">请先在「班次管理」创建班次</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {project.shifts.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onChange(on ? selected.filter((id) => id !== s.id) : [...selected, s.id])}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PastePreview({ text, existing }: { text: string; existing: Set<string> }) {
  if (!text.trim()) return null;
  const { names, duplicates } = parseNameList(text);
  const conflict = names.filter((n) => existing.has(n));
  return (
    <div className="mt-3 text-xs space-y-1">
      <div className="text-slate-500">识别到 <b>{names.length}</b> 个姓名</div>
      {duplicates.length > 0 && <div className="text-amber-600">重复姓名（将自动去重）：{duplicates.join('、')}</div>}
      {conflict.length > 0 && <div className="text-amber-600">与现有员工重名（将跳过）：{conflict.join('、')}</div>}
    </div>
  );
}
