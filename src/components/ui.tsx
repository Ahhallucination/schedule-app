// 通用 UI 组件：按钮、弹窗、表单、Toast、空状态
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- 按钮 ----------
export function Btn({
  children, onClick, variant = 'secondary', size = 'md', disabled, title, className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors select-none whitespace-nowrap';
  const sizes = { sm: 'text-xs px-2.5 py-1.5', md: 'text-sm px-3.5 py-2' };
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50',
    ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    dangerSoft: 'text-rose-600 hover:bg-rose-50',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${sizes[size]} ${variants[variant]} ${disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

// ---------- 表单 ----------
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white ${props.className || ''}`}
    />
  );
}

export function NumInput({
  value, onChange, min, max, className = '', placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value === null ? '' : value}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') onChange(null);
        else {
          let n = Number(v);
          if (!Number.isFinite(n)) return;
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          onChange(n);
        }
      }}
      className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white ${className}`}
    />
  );
}

export function Sel({
  value, onChange, children, className = '',
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white ${className}`}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 select-none"
    >
      <span
        className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-4.5 left-[18px]' : 'left-0.5'}`}
        />
      </span>
      {label && <span className="text-sm text-slate-600">{label}</span>}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value, onChange, options, size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-md font-medium transition-colors ${
            value === o.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'rose' | 'indigo' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

// ---------- 弹窗 ----------
export function Modal({
  open, onClose, title, children, footer, width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] bg-slate-900/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${width} mx-4 max-h-[80vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="font-semibold text-slate-800">{title}</div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center" title="关闭 (Esc)">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-slate-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Toast ----------
interface ToastItem { id: number; msg: string; tone: 'info' | 'success' | 'warn' | 'error' }
const ToastCtx = createContext<{ toast: (msg: string, tone?: ToastItem['tone']) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const toast = useCallback((msg: string, tone: ToastItem['tone'] = 'info') => {
    const id = ++idRef.current;
    setItems((prev) => [...prev.slice(-4), { id, msg, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);
  const tones = {
    info: 'bg-slate-800 text-white',
    success: 'bg-emerald-600 text-white',
    warn: 'bg-amber-500 text-white',
    error: 'bg-rose-600 text-white',
  };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
        {items.map((t) => (
          <div key={t.id} className={`px-4 py-2.5 rounded-xl shadow-lg text-sm max-w-[70vw] ${tones[t.tone]}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

// ---------- 确认弹窗 ----------
export function Confirm({
  open, onClose, onConfirm, title, message, confirmText = '确认', danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md" footer={
      <>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Btn>
      </>
    }>
      <div className="text-sm text-slate-600 leading-relaxed">{message}</div>
    </Modal>
  );
}

// ---------- 空状态 ----------
export function Empty({
  icon, title, desc, action,
}: {
  icon?: React.ReactNode;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-400 flex items-center justify-center mb-4">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>
          </svg>
        )}
      </div>
      <div className="font-semibold text-slate-700">{title}</div>
      {desc && <div className="text-sm text-slate-400 mt-1.5 max-w-md leading-relaxed">{desc}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-slate-200/80 shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {desc && <div className="text-sm text-slate-400 mt-1">{desc}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5"/>
      <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
