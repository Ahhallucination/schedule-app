// 全局状态：DB + 活动项目 + 撤销/重做 + 自动保存
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DB, Prefs, Project } from './types';
import {
  clearAllData, createProject, emptyDB, estimateStorageKB, loadDB, saveDB,
  type CreateProjectOpts,
} from './storage';

export interface StoreCtx {
  db: DB;
  active: Project | null;
  savedAt: number | null;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  storageKB: number;
  createProject: (opts: CreateProjectOpts) => Project;
  openProject: (id: string) => void;
  closeProject: () => void;
  renameProject: (id: string, name: string) => void;
  copyProject: (id: string) => Project | null;
  deleteProject: (id: string) => void;
  mutate: (fn: (p: Project) => void, opts?: { history?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  updatePrefs: (fn: (p: Prefs) => void) => void;
  saveNow: () => void;
  exportBackup: () => string;
  importBackup: (json: string) => { ok: boolean; msg: string };
  clearAll: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

const HISTORY_CAP = 60;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDB] = useState<DB>(() => loadDB());
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const [histTick, setHistTick] = useState(0); // 触发 canUndo/canRedo 更新
  const dbRef = useRef(db);
  dbRef.current = db;

  // 自动保存（防抖）
  useEffect(() => {
    const t = setTimeout(() => {
      const r = saveDB(db);
      if (r.ok) {
        setSavedAt(Date.now());
        setSaveError(null);
      } else {
        setSaveError(r.error || '保存失败');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [db]);

  const active = db.projects.find((p) => p.id === db.activeId) ?? null;

  const mutate = useCallback((fn: (p: Project) => void, opts?: { history?: boolean }) => {
    setDB((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === prev.activeId);
      if (idx < 0) return prev;
      const snapshot = prev.projects[idx];
      const target = structuredClone(snapshot);
      fn(target);
      target.updatedAt = Date.now();
      if (opts?.history !== false) {
        past.current.push(snapshot);
        if (past.current.length > HISTORY_CAP) past.current.shift();
        future.current = [];
      }
      const projects = [...prev.projects];
      projects[idx] = target;
      return { ...prev, projects };
    });
    setHistTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    setDB((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === prev.activeId);
      if (idx < 0) return prev;
      const snap = past.current.pop();
      if (!snap) return prev;
      future.current.push(prev.projects[idx]);
      const projects = [...prev.projects];
      projects[idx] = snap;
      return { ...prev, projects };
    });
    setHistTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    setDB((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === prev.activeId);
      if (idx < 0) return prev;
      const snap = future.current.pop();
      if (!snap) return prev;
      past.current.push(prev.projects[idx]);
      const projects = [...prev.projects];
      projects[idx] = snap;
      return { ...prev, projects };
    });
    setHistTick((t) => t + 1);
  }, []);

  const doCreateProject = useCallback((opts: CreateProjectOpts) => {
    const project = createProject(dbRef.current, opts);
    setDB((prev) => ({
      ...prev,
      projects: [project, ...prev.projects],
      activeId: project.id,
    }));
    past.current = [];
    future.current = [];
    return project;
  }, []);

  const openProject = useCallback((id: string) => {
    setDB((prev) => ({ ...prev, activeId: id }));
    past.current = [];
    future.current = [];
    setHistTick((t) => t + 1);
  }, []);

  const closeProject = useCallback(() => {
    setDB((prev) => ({ ...prev, activeId: null }));
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    setDB((prev) => {
      const projects = prev.projects.map((p) =>
        p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p
      );
      return { ...prev, projects };
    });
  }, []);

  const doCopyProject = useCallback((id: string): Project | null => {
    const src = dbRef.current.projects.find((p) => p.id === id);
    if (!src) return null;
    const copy = structuredClone(src);
    copy.id = crypto.randomUUID();
    copy.name = `${src.name}（副本）`;
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    setDB((prev) => ({ ...prev, projects: [copy, ...prev.projects] }));
    return copy;
  }, []);

  const deleteProject = useCallback((id: string) => {
    setDB((prev) => {
      const projects = prev.projects.filter((p) => p.id !== id);
      const activeId = prev.activeId === id ? null : prev.activeId;
      return { ...prev, projects, activeId };
    });
    past.current = [];
    future.current = [];
    setHistTick((t) => t + 1);
  }, []);

  const updatePrefs = useCallback((fn: (p: Prefs) => void) => {
    setDB((prev) => {
      const prefs = structuredClone(prev.prefs);
      fn(prefs);
      return { ...prev, prefs };
    });
  }, []);

  const saveNow = useCallback(() => {
    const r = saveDB(dbRef.current);
    if (r.ok) {
      setSavedAt(Date.now());
      setSaveError(null);
    } else {
      setSaveError(r.error || '保存失败');
    }
  }, []);

  const exportBackup = useCallback(() => JSON.stringify(dbRef.current, null, 2), []);

  const importBackup = useCallback((json: string): { ok: boolean; msg: string } => {
    try {
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.projects)) {
        return { ok: false, msg: '文件格式不正确：缺少 projects 数据' };
      }
      setDB((prev) => {
        const existing = new Set(prev.projects.map((p) => p.id));
        const incoming = data.projects.filter((p: any) => p && p.id && !existing.has(p.id));
        return {
          ...prev,
          projects: [...incoming, ...prev.projects],
          prefs: { ...prev.prefs, ...(data.prefs || {}) },
        };
      });
      return { ok: true, msg: `成功导入 ${data.projects.length} 个排班项目` };
    } catch (e: any) {
      return { ok: false, msg: `导入失败：${e?.message || '文件不是有效的备份文件'}` };
    }
  }, []);

  const clearAll = useCallback(() => {
    clearAllData();
    past.current = [];
    future.current = [];
    setDB(emptyDB());
    setHistTick((t) => t + 1);
  }, []);

  void histTick;

  const value: StoreCtx = {
    db,
    active,
    savedAt,
    saveError,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    storageKB: estimateStorageKB(),
    createProject: doCreateProject,
    openProject,
    closeProject,
    renameProject,
    copyProject: doCopyProject,
    deleteProject,
    mutate,
    undo,
    redo,
    updatePrefs,
    saveNow,
    exportBackup,
    importBackup,
    clearAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}
