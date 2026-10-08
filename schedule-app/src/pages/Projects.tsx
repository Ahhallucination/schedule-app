import React, { useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Confirm, Empty, Field, Modal, NumInput, PageHeader, TextInput, Toggle, Sel, useToast } from '../components/ui';
import { monthLabel } from '../utils';
import type { PageId } from '../App';

export default function ProjectsPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { db, createProject, openProject, copyProject, deleteProject, renameProject } = useStore();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [renameState, setRenameState] = useState<{ id: string; name: string } | null>(null);

  // 新建表单
  const now = new Date();
  const nextMonth = now.getMonth() === 11 ? { year: now.getFullYear() + 1, month: 0 } : { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [form, setForm] = useState({ name: '', year: nextMonth.year, month: nextMonth.month, useTemplate: true, copyFromId: '' });

  const openCreate = () => {
    setForm({
      name: `${nextMonth.year}年${nextMonth.month + 1}月排班`,
      year: nextMonth.year, month: nextMonth.month, useTemplate: true, copyFromId: '',
    });
    setCreateOpen(true);
  };

  const doCreate = () => {
    if (!form.name.trim()) {
      toast('请输入排班项目名称', 'warn');
      return;
    }
    const p = createProject({
      name: form.name.trim(),
      year: form.year,
      month: form.month,
      useTemplate: form.useTemplate && !form.copyFromId,
      copyFromId: form.copyFromId || null,
    });
    setCreateOpen(false);
    toast(`已创建「${p.name}」`, 'success');
    onNavigate('employees');
  };

  const delTarget = db.projects.find((p) => p.id === delId);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="排班项目"
        desc="一个排班项目 = 员工 + 班次 + 人力需求 + 规则 + 排班结果"
        actions={<Btn variant="primary" onClick={openCreate}>+ 新建排班项目</Btn>}
      />

      {db.projects.length === 0 ? (
        <Empty
          title="还没有排班计划"
          desc="创建一个排班计划开始：选择年、月，支持使用常见三班模板快速开始。"
          action={<Btn variant="primary" onClick={openCreate}>创建第一个排班计划</Btn>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {db.projects.map((p) => {
            const isActive = db.activeId === p.id;
            return (
              <Card key={p.id} className={`p-5 transition-colors ${isActive ? 'border-indigo-300 ring-1 ring-indigo-100' : 'hover:border-slate-300'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{p.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {monthLabel(p.year, p.month)} · {p.employees.length} 名员工 · {p.shifts.length} 个班次
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      {p.scheduleMeta ? (
                        <span className={`text-xs rounded-full px-2.5 py-1 ${p.scheduleMeta.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {p.scheduleMeta.status === 'ok' ? '已完成排班' : '存在冲突'} · {p.scheduleMeta.total}分
                        </span>
                      ) : (
                        <span className="text-xs rounded-full px-2.5 py-1 bg-slate-100 text-slate-500">未排班</span>
                      )}
                      {isActive && <span className="text-xs rounded-full px-2.5 py-1 bg-indigo-50 text-indigo-600">当前项目</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-4">
                  {!isActive && (
                    <Btn size="sm" variant="primary" onClick={() => { openProject(p.id); onNavigate('overview'); }}>打开</Btn>
                  )}
                  <Btn size="sm" onClick={() => { copyProject(p.id); toast('已复制项目', 'success'); }}>复制</Btn>
                  <Btn size="sm" onClick={() => setRenameState({ id: p.id, name: p.name })}>重命名</Btn>
                  <Btn size="sm" variant="dangerSoft" onClick={() => setDelId(p.id)}>删除</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新建弹窗 */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="新建排班项目" footer={
        <>
          <Btn onClick={() => setCreateOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={doCreate}>创建</Btn>
        </>
      }>
        <div className="space-y-4">
          <Field label="项目名称">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：2026年11月客服排班" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="年">
              <NumInput value={form.year} min={2020} max={2100} onChange={(v) => setForm({ ...form, year: v ?? form.year })} />
            </Field>
            <Field label="月">
              <Sel value={form.month} onChange={(v) => setForm({ ...form, month: Number(v) })}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>{i + 1}月</option>
                ))}
              </Sel>
            </Field>
          </div>
          {db.projects.length > 0 && (
            <Field label="从现有项目复制员工和班次（可选）" hint="复制后可在新项目内独立修改，互不影响">
              <Sel value={form.copyFromId} onChange={(v) => setForm({ ...form, copyFromId: v })}>
                <option value="">不复制，从零开始</option>
                {db.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}（{p.employees.length}人/{p.shifts.length}班次）</option>
                ))}
              </Sel>
            </Field>
          )}
          {!form.copyFromId && (
            <Toggle
              checked={form.useTemplate}
              onChange={(v) => setForm({ ...form, useTemplate: v })}
              label="预置常见三班（白班/中班/夜班），可随时修改或删除"
            />
          )}
        </div>
      </Modal>

      {/* 重命名弹窗 */}
      <Modal open={!!renameState} onClose={() => setRenameState(null)} title="重命名项目" width="max-w-sm" footer={
        <>
          <Btn onClick={() => setRenameState(null)}>取消</Btn>
          <Btn variant="primary" onClick={() => {
            if (renameState) renameProject(renameState.id, renameState.name);
            setRenameState(null);
            toast('已重命名', 'success');
          }}>保存</Btn>
        </>
      }>
        <TextInput
          value={renameState?.name ?? ''}
          onChange={(e) => renameState && setRenameState({ ...renameState, name: e.target.value })}
          autoFocus
        />
      </Modal>

      {/* 删除确认 */}
      <Confirm
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) deleteProject(delId);
          toast('已删除项目', 'success');
        }}
        title="删除排班项目"
        danger
        confirmText="删除"
        message={<>确定删除「{delTarget?.name}」吗？<br />该项目的员工、班次、规则和排班结果将一并删除，<b>此操作不可恢复</b>。</>}
      />
    </div>
  );
}
