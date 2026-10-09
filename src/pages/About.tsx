import React, { useState } from 'react';
import { Card, Modal, PageHeader, useToast } from '../components/ui';
import wechatDonate from '../assets/wechat-donate.jpg';

const APP_VERSION = '1.0.0';
const GITHUB_URL = 'https://github.com/Ahhallucination/schedule-app';
const EMAIL = 'sumatsuri@outlook.com';

// 复制文本到剪贴板，兼容非安全上下文（如本地 file:// 打开）
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级处理 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function AboutPage() {
  const { toast } = useToast();
  const [showQR, setShowQR] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);

  const handleCopyEmail = async () => {
    const ok = await copyText(EMAIL);
    if (ok) {
      setEmailCopied(true);
      toast('邮箱地址已复制', 'success');
      setTimeout(() => setEmailCopied(false), 2000);
    } else {
      toast('复制失败，请手动选择文本复制', 'error');
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader title="关于" desc="排班管家 · 开发者信息与支持" />

      <Card className="p-6 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11M15 9v11M3 14.5h18"/></svg>
          </div>
          <div>
            <div className="text-base font-bold text-slate-800">排班管家</div>
            <div className="text-sm text-slate-400">智能排班管理软件 · v{APP_VERSION}</div>
          </div>
        </div>
        <p className="text-sm text-slate-500 leading-relaxed mt-4">
          一款面向管理者与排班负责人的本地排班工具。通过确定性的约束优化算法自动生成公平、满足规则的排班表，
          支持员工与班次管理、人力需求设置、规则冲突检测、手工微调、统计分析以及 Excel 导入导出。
        </p>
      </Card>

      <Card className="p-6 mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-4">关于开发者</div>
        <div className="space-y-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors group"
          >
            <span className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5A11.5 11.5 0 0 0 .5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.2.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg>
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-700 group-hover:text-indigo-700">GitHub 开源仓库</span>
              <span className="block text-xs text-slate-400 truncate select-text">{GITHUB_URL}</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 group-hover:text-indigo-400 shrink-0"><path d="M7 17 17 7M9 7h8v8"/></svg>
          </a>

          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200">
            <span className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3 7 9 6 9-6"/></svg>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-700">反馈与联系开发者</div>
              <div className="text-xs text-slate-400 truncate select-text cursor-text" title="点击可全选，或使用右侧复制按钮">{EMAIL}</div>
            </div>
            <button
              type="button"
              onClick={handleCopyEmail}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                emailCopied
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              {emailCopied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  已复制
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                  复制
                </>
              )}
            </button>
          </div>
        </div>
      </Card>

      <Card className="p-6 mb-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">支持开发者</div>
        <div className="text-xs text-slate-400 mb-4">
          如果你觉得这款工具对你有帮助，欢迎通过微信扫码请开发者喝杯咖啡，你的支持是持续维护的动力。
        </div>
        <div className="flex items-start gap-5">
          <button
            type="button"
            onClick={() => setShowQR(true)}
            className="w-40 shrink-0 group text-left"
            title="点击放大二维码"
          >
            <div className="relative rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white group-hover:border-indigo-300 group-hover:shadow-md transition-all">
              <img
                src={wechatDonate}
                alt="微信赞赏二维码"
                className="w-full h-auto block"
              />
              <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/70 text-white text-xs px-2.5 py-1 rounded-lg inline-flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                  放大
                </span>
              </div>
            </div>
            <div className="text-center text-xs text-slate-400 mt-2">微信扫码 · 点击放大</div>
          </button>
          <div className="flex-1 text-sm text-slate-500 leading-relaxed">
            <p className="mb-2">感谢你的认可！任何金额的支持都会被珍惜，并用于软件的持续改进。</p>
            <p>扫码时可点击二维码放大显示，方便微信扫一扫识别。</p>
            <p>如果你在使用中遇到问题、有新的想法或建议，欢迎通过上方邮箱直接联系开发者。</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 border-emerald-100">
        <div className="flex gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-700 mb-1.5">隐私与数据安全</div>
            <p className="text-sm text-slate-500 leading-relaxed">
              本软件仅在本地运行与存储：所有排班数据都保存在你当前设备的浏览器中，
              不会上传到任何服务器，也不会进行任何网络传输或云端同步。请放心使用。
            </p>
          </div>
        </div>
      </Card>

      <Modal open={showQR} onClose={() => setShowQR(false)} title="微信赞赏二维码" width="max-w-md">
        <div className="flex flex-col items-center">
          <img
            src={wechatDonate}
            alt="微信赞赏二维码（大图）"
            className="w-full max-w-xs h-auto rounded-xl border border-slate-200"
          />
          <div className="text-sm text-slate-500 mt-4">请打开微信「扫一扫」，扫描上方二维码赞赏支持</div>
        </div>
      </Modal>
    </div>
  );
}
