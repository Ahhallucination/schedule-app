import React, { useCallback, useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { ToastProvider, useToast, Btn } from './components/ui';
import { formatTime, monthLabel } from './utils';
import OverviewPage from './pages/Overview';
import ProjectsPage from './pages/Projects';
import EmployeesPage from './pages/Employees';
import ShiftsPage from './pages/Shifts';
import RequirementsPage from './pages/Requirements';
import RulesPage from './pages/Rules';
import SchedulePage from './pages/Schedule';
import StatsPage from './pages/Stats';
import SettingsPage from './pages/Settings';
import AboutPage from './pages/About';

export type PageId =
  | 'overview' | 'projects' | 'employees' | 'shifts' | 'requirements'
  | 'rules' | 'schedule' | 'stats' | 'settings' | 'about';

const NAV: { id: PageId; label: string; icon: React.ReactNode; needProject: boolean }[] = [
  { id: 'overview', label: '排班总览', needProject: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg> },
  { id: 'projects', label: '排班项目', needProject: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> },
  { id: 'employees', label: '员工管理', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16.5 14.6c2.9.4 5 2.8 5 5.4"/></svg> },
  { id: 'shifts', label: '班次管理', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg> },
  { id: 'requirements', label: '人力需求', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19V9M10 19V5M16 19v-8M21 19H3"/></svg> },
  { id: 'rules', label: '排班规则', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4.5"/></svg> },
  { id: 'schedule', label: '排班结果', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/></svg> },
  { id: 'stats', label: '数据统计', needProject: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg> },
  { id: 'settings', label: '设置', needProject: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.5-2-1.5A7 7 0 0 0 19 12z"/></svg> },
  { id: 'about', label: '关于', needProject: false, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg> },
];

function Shell() {
  const [page, setPage] = useState<PageId>('overview');
  const [solveTrigger, setSolveTrigger] = useState(0);
  const store = useStore();
  const { toast } = useToast();
  const { active, savedAt, saveError } = store;

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        store.saveNow();
        toast('已保存到本地');
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (store.canUndo) store.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        if (store.canRedo) store.redo();
      } else if (k === 'f') {
        const el = document.getElementById('emp-search');
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, toast]);

  const goSolve = useCallback(() => {
    if (!active) {
      setPage('projects');
      return;
    }
    setPage('schedule');
    setSolveTrigger((t) => t + 1);
  }, [active]);

  const needProjectGuard = (id: PageId) => {
    const nav = NAV.find((n) => n.id === id)!;
    if (nav.needProject && !active) {
      return (
        <div className="p-8">
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center max-w-lg mx-auto mt-16">
            <div className="text-lg font-semibold text-slate-700 mb-2">还没有打开排班项目</div>
            <div className="text-sm text-slate-400 mb-5">请先创建或打开一个排班项目</div>
            <Btn variant="primary" onClick={() => setPage('projects')}>去创建排班项目</Btn>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full flex">
      {/* 侧边导航 */}
      <aside className="w-52 shrink-0 bg-white border-r border-slate-200/80 flex flex-col">
        <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11M15 9v11M3 14.5h18"/></svg>
          </div>
          <div>
            <div className="font-bold text-slate-800 text-sm leading-tight">排班管家</div>
            <div className="text-[10px] text-slate-400">智能排班管理</div>
          </div>
        </div>
        <nav className="flex-1 px-2.5 py-2 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                page === n.id
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <span className={page === n.id ? 'text-indigo-600' : 'text-slate-400'}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
          数据保存在本机浏览器
          <br />
          {saveError ? (
            <span className="text-rose-500">{saveError}</span>
          ) : savedAt ? (
            <span>已保存 {formatTime(savedAt)}</span>
          ) : null}
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <header className="h-14 shrink-0 bg-white border-b border-slate-200/80 flex items-center px-5 gap-3">
          {active ? (
            <>
              <div className="font-semibold text-slate-700 truncate max-w-64">{active.name}</div>
              <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">{monthLabel(active.year, active.month)}</span>
              {active.scheduleMeta && (
                <span className={`text-xs rounded-full px-2.5 py-1 ${active.scheduleMeta.status === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                  {active.scheduleMeta.status === 'ok' ? '已排班' : '有冲突'} · {active.scheduleMeta.total}分
                </span>
              )}
            </>
          ) : (
            <div className="text-sm text-slate-400">未打开项目</div>
          )}
          <div className="flex-1" />
          <Btn size="sm" variant="ghost" onClick={store.undo} disabled={!store.canUndo} title="撤销 (⌘Z)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>
            撤销
          </Btn>
          <Btn size="sm" variant="ghost" onClick={store.redo} disabled={!store.canRedo} title="重做 (⌘⇧Z)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>
            重做
          </Btn>
          <Btn size="sm" variant="primary" onClick={goSolve} disabled={!active}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4.7 12.3H11L9.5 22l8.3-10.3H12z"/></svg>
            自动排班
          </Btn>
        </header>

        <main className="flex-1 overflow-y-auto">
          {page === 'overview' && <OverviewPage onNavigate={setPage} />}
          {page === 'projects' && <ProjectsPage onNavigate={setPage} />}
          {page === 'employees' && (needProjectGuard('employees') ?? <EmployeesPage />)}
          {page === 'shifts' && (needProjectGuard('shifts') ?? <ShiftsPage />)}
          {page === 'requirements' && (needProjectGuard('requirements') ?? <RequirementsPage />)}
          {page === 'rules' && (needProjectGuard('rules') ?? <RulesPage />)}
          {page === 'schedule' && (needProjectGuard('schedule') ?? <SchedulePage solveTrigger={solveTrigger} />)}
          {page === 'stats' && (needProjectGuard('stats') ?? <StatsPage />)}
          {page === 'settings' && <SettingsPage />}
          {page === 'about' && <AboutPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  );
}
