import React, { useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Confirm, Empty, Field, Modal, NumInput, Sel, TextInput, Toggle, useToast, Badge, PageHeader } from '../components/ui';
import { SHIFT_PALETTE } from '../types';
import type { Shift } from '../types';
import { fmtMinutes, shiftCrossDay, parseHM, shiftDurationMinutes } from '../utils';
import { newShiftFor, prefillShiftRequirements, removeShiftEverywhere } from '../storage';

export default function ShiftsPage() {
  const { active, mutate } = useStore();
  const { toast } = useToast();
  const project = active!;
  const [editShift, setEditShift] = useState<Shift | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);

  const saveShift = (s: Shift) => {
    if (!s.name.trim()) { toast('请输入班次名称', 'warn'); return; }
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.startTime) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.endTime)) {
      toast('时间格式应为 HH:mm，如 08:00', 'error');
      return;
    }
    if (s.startTime === s.endTime) { toast('开始与结束时间不能相同', 'error'); return; }
    const nameDup = project.shifts.some((x) => x.name === s.name.trim() && x.id !== s.id);
    if (nameDup) { toast(`已存在同名班次「${s.name.trim()}」`, 'error'); return; }
    const crossDay = shiftCrossDay(s.startTime, s.endTime);
    const clean: Shift = {
      ...s,
      name: s.name.trim(),
      shortLabel: s.shortLabel.trim() || s.name.trim().slice(0, 2),
      crossDay,
    };
    mutate((p) => {
      const idx = p.shifts.findIndex((x) => x.id === clean.id);
      if (idx >= 0) {
        p.shifts[idx] = clean;
      } else {
        p.shifts.push(clean);
        prefillShiftRequirements(p, clean.id, clean.defaultCount);
      }
    });
    setEditShift(null);
    toast(isNew ? '已创建班次并初始化每日需求' : '已保存班次', 'success');
  };

  const move = (idx: number, dir: -1 | 1) => {
    mutate((p) => {
      const j = idx + dir;
      if (j < 0 || j >= p.shifts.length) return;
      const arr = [...p.shifts];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      p.shifts = arr;
    });
  };

  const delTarget = project.shifts.find((s) => s.id === delId);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="班次管理"
        desc="班次完全自定义：名称、时间、跨天、连续安排限制、公平权重"
        actions={<Btn variant="primary" onClick={() => { setIsNew(true); setEditShift(newShiftFor(project)); }}>+ 新建班次</Btn>}
      />

      {project.shifts.length === 0 ? (
        <Empty
          title="还没有班次"
          desc="创建班次后才能设置人力需求并自动排班。一天可以有 1 个、3 个或更多班次，完全由你决定。"
          action={<Btn variant="primary" onClick={() => { setIsNew(true); setEditShift(newShiftFor(project)); }}>创建第一个班次</Btn>}
        />
      ) : (
        <div className="grid gap-3">
          {project.shifts.map((s, i) => {
            const color = SHIFT_PALETTE[s.color % SHIFT_PALETTE.length];
            const dur = shiftDurationMinutes(s.startTime, s.endTime);
            return (
              <Card key={s.id} className="px-5 py-4 flex items-center gap-4">
                <div className={`w-2.5 h-10 rounded-full ${color.dot}`} />
                <div className="w-44 min-w-0">
                  <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                  <div className="text-xs text-slate-400">显示为「{s.shortLabel}」</div>
                </div>
                <div className="w-52">
                  <div className="text-sm text-slate-600 font-mono">{fmtMinutes(parseHM(s.startTime))} - {fmtMinutes(parseHM(s.endTime))}</div>
                  <div className="text-xs text-slate-400">
                    {Math.floor(dur / 60)}小时{dur % 60 ? `${dur % 60}分` : ''}
                    {s.crossDay && <Badge tone="indigo"> 跨天</Badge>}
                  </div>
                </div>
                <div className="w-32">
                  <div className="text-sm text-slate-600">{s.defaultCount} 人/天</div>
                  <div className="text-xs text-slate-400">默认需求</div>
                </div>
                <div className="w-44">
                  <div className="text-sm text-slate-600">
                    {s.allowConsecutive
                      ? s.maxConsecutiveDays > 0 ? `最多连续 ${s.maxConsecutiveDays} 天` : '允许连续'
                      : '不允许连续两天'}
                  </div>
                  <div className="text-xs text-slate-400">连续安排</div>
                </div>
                <div className="w-24">
                  <div className="text-sm text-slate-600">{['低', '中', '高'][s.fairnessWeight - 1]}</div>
                  <div className="text-xs text-slate-400">公平权重</div>
                </div>
                <div className="flex-1 text-xs text-slate-400 truncate">{s.note}</div>
                <div className="flex items-center gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} title="上移">↑</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === project.shifts.length - 1} title="下移">↓</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => { setIsNew(false); setEditShift(structuredClone(s)); }}>编辑</Btn>
                  <Btn size="sm" variant="dangerSoft" onClick={() => setDelId(s.id)}>删除</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 编辑弹窗 */}
      <Modal open={!!editShift} onClose={() => setEditShift(null)} title={isNew ? '新建班次' : '编辑班次'} footer={
        <>
          <Btn onClick={() => setEditShift(null)}>取消</Btn>
          <Btn variant="primary" onClick={() => editShift && saveShift(editShift)}>保存</Btn>
        </>
      }>
        {editShift && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="班次名称 *">
                <TextInput value={editShift.name} onChange={(e) => setEditShift({ ...editShift, name: e.target.value })} placeholder="如：长白班 / 早班 / 值班" autoFocus />
              </Field>
              <Field label="表格简称" hint="留空自动取名称前2字">
                <TextInput value={editShift.shortLabel} onChange={(e) => setEditShift({ ...editShift, shortLabel: e.target.value })} placeholder="如：白 / 夜" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始时间">
                <TextInput value={editShift.startTime} onChange={(e) => setEditShift({ ...editShift, startTime: e.target.value })} placeholder="08:00" />
              </Field>
              <Field label="结束时间" hint="结束时间早于开始时间时自动视为跨天">
                <TextInput value={editShift.endTime} onChange={(e) => setEditShift({ ...editShift, endTime: e.target.value })} placeholder="17:00" />
              </Field>
            </div>
            {/^([01]?\d|2[0-3]):[0-5]\d$/.test(editShift.startTime) && /^([01]?\d|2[0-3]):[0-5]\d$/.test(editShift.endTime) && editShift.startTime !== editShift.endTime && (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                实际时长 {Math.floor(shiftDurationMinutes(editShift.startTime, editShift.endTime) / 60)} 小时{shiftDurationMinutes(editShift.startTime, editShift.endTime) % 60 ? ` ${shiftDurationMinutes(editShift.startTime, editShift.endTime) % 60} 分` : ''}
                {shiftCrossDay(editShift.startTime, editShift.endTime) && '，跨天（次日结束）'}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="默认每日需求人数">
                <NumInput value={editShift.defaultCount} min={0} max={999} onChange={(v) => setEditShift({ ...editShift, defaultCount: v ?? 0 })} />
              </Field>
              <Field label="分配公平权重" hint="越高表示该班次越需要均匀分配">
                <Sel value={editShift.fairnessWeight} onChange={(v) => setEditShift({ ...editShift, fairnessWeight: Number(v) as 1 | 2 | 3 })}>
                  <option value={1}>低</option>
                  <option value={2}>中</option>
                  <option value={3}>高（如夜班）</option>
                </Sel>
              </Field>
            </div>
            <div className="flex items-center gap-5">
              <Toggle
                checked={editShift.allowConsecutive}
                onChange={(v) => setEditShift({ ...editShift, allowConsecutive: v })}
                label="允许员工连续安排"
              />
              {editShift.allowConsecutive && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  最多连续
                  <NumInput className="!w-16 !py-1 !px-2" value={editShift.maxConsecutiveDays} min={0} max={31}
                    onChange={(v) => setEditShift({ ...editShift, maxConsecutiveDays: v ?? 0 })} />
                  天（0 = 不限）
                </div>
              )}
            </div>
            <Field label="备注">
              <TextInput value={editShift.note} onChange={(e) => setEditShift({ ...editShift, note: e.target.value })} placeholder="可选" />
            </Field>
          </div>
        )}
      </Modal>

      {/* 删除确认 */}
      <Confirm
        open={!!delId}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) mutate((p) => removeShiftEverywhere(p, delId));
          toast('已删除班次及其相关数据', 'success');
        }}
        title="删除班次"
        danger
        confirmText="删除"
        message={<>确定删除「{delTarget?.name}」吗？<br />该班次的人力需求、相关规则和排班表中已排该班次的记录（转为休息）将一并清理。</>}
      />
    </div>
  );
}
