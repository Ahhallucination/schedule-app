import React, { useRef, useState } from 'react';
import { useStore } from '../store';
import { Btn, Card, Confirm, PageHeader, Toggle, useToast } from '../components/ui';
import { download } from '../utils';

export default function SettingsPage() {
  const { db, updatePrefs, exportBackup, importBackup, clearAll, storageKB } = useStore();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader title="设置" />

      <Card className="p-5 mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-3">视图偏好</div>
        <Toggle
          checked={db.prefs.showCodeColumn}
          onChange={(v) => updatePrefs((p) => { p.showCodeColumn = v; })}
          label="排班表姓名列显示员工编号"
        />
      </Card>

      <Card className="p-5 mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">数据备份</div>
        <div className="text-xs text-slate-400 mb-4">
          数据保存在本机浏览器中（约占用 {storageKB} KB）。建议定期导出备份文件。
        </div>
        <div className="flex gap-2">
          <Btn onClick={() => {
            const json = exportBackup();
            download(new Blob([json], { type: 'application/json' }), `排班管家备份_${new Date().toISOString().slice(0, 10)}.json`);
            toast('已导出备份文件', 'success');
          }}>
            导出全部数据备份 (JSON)
          </Btn>
          <Btn onClick={() => fileRef.current?.click()}>导入备份</Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const text = await f.text();
              const r = importBackup(text);
              toast(r.msg, r.ok ? 'success' : 'error');
            }}
          />
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">键盘快捷键</div>
        <div className="text-sm text-slate-500 leading-7 mt-2">
          ⌘/Ctrl + S 保存 · ⌘/Ctrl + Z 撤销 · ⌘/Ctrl + Shift + Z 重做 · ⌘/Ctrl + F 搜索员工 · Esc 关闭弹窗
          <br />
          排班表格内：方向键移动选中格 · Enter 编辑 · 0 设为休息 · 1~9 选班次 · L 锁定/解锁
        </div>
      </Card>

      <Card className="p-5 border-rose-100">
        <div className="text-sm font-semibold text-rose-600 mb-1">危险操作</div>
        <div className="text-xs text-slate-400 mb-4">清空后所有排班项目将被删除，不可恢复。请先导出备份。</div>
        <Btn variant="danger" onClick={() => setClearConfirm(true)}>清空全部数据</Btn>
      </Card>

      <Confirm
        open={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => {
          clearAll();
          toast('已清空全部数据', 'success');
        }}
        title="清空全部数据"
        danger
        confirmText="确认清空"
        message={<>确定删除全部 {db.projects.length} 个排班项目及所有数据吗？<b>此操作不可恢复。</b></>}
      />
    </div>
  );
}
