'use client';

import { useState, useRef, useCallback } from 'react';
import { useLanguage } from '@/hooks';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import MindMapViewer from '@/components/MindMapViewer';
import NodeEditorPanel from '@/components/NodeEditorPanel';
import HistoryDrawer from '@/components/HistoryDrawer';
import type { MindMapData } from '@/types/mindmap';
import { ensureNodeIds, updateNodeTitle } from '@/types/mindmap';
import { saveRecord, bufferToBase64, base64ToBuffer, type HistoryRecord } from '@/lib/history';

export default function Home() {
  const { t } = useLanguage();
  const [schoolName, setSchoolName] = useState('');
  const [programName, setProgramName] = useState('');
  const [targetWords, setTargetWords] = useState('1000');
  const [isOpen, setIsOpen] = useState(false);
  const [detailLevel, setDetailLevel] = useState(50);
  const [stylePreference, setStylePreference] = useState(50);
  
  // New states for file upload and generation
  const [files, setFiles] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [mindMapData, setMindMapData] = useState<MindMapData | null>(null);
  const [xmindBuffer, setXmindBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectUrl, setProjectUrl] = useState('');
  const [curriculumUrl, setCurriculumUrl] = useState('');
  const [activitiesUrl, setActivitiesUrl] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const options = [
    { value: '500', label: t.word500 },
    { value: '750', label: t.word750 },
    { value: '1000', label: t.word1000 },
    { value: '1500', label: t.word1500 },
    { value: '2000', label: t.word2000 },
  ];

  const handleGenerate = async () => {
    if (!schoolName || !programName) {
      setError('请填写学校名称和专业名称');
      return;
    }

    setIsGenerating(true);
    setError('');
    setRetryCount(0);
    setProgressMsg('');
    setMindMapData(null);
    setXmindBuffer(null);

    try {
      const formData = new FormData();
      formData.append('schoolName', schoolName);
      formData.append('programName', programName);
      formData.append('projectWebsite', projectUrl);
      formData.append('curriculumLink', curriculumUrl);
      formData.append('activitiesLink', activitiesUrl);
      formData.append('detailLevel', String(detailLevel));
      formData.append('stylePreference', String(stylePreference));
      // retry 时带上已有 jobId，后端会从 checkpoint 继续而不是重新开始
      if (currentJobId) {
        formData.append('jobId', currentJobId);
      }

      files.forEach(file => {
        formData.append('files', file);
      });

      // Step 1: 提交任务，立即返回 jobId
      setProgressMsg('正在提交任务…');
      const initRes = await fetch('/api/generate/init', {
        method: 'POST',
        body: formData,
      });

      if (!initRes.ok) {
        const data = await initRes.json();
        throw new Error(data.error || '任务提交失败');
      }

      const { jobId } = await initRes.json();
      setCurrentJobId(jobId);

      // Step 2: 轮询任务状态
      setProgressMsg('等待 AI 生成中…');
      await pollJobStatus(jobId);

    } catch (err: any) {
      setError(err.message || '生成失败，请重试');
    } finally {
      setIsGenerating(false);
      setRetryCount(0);
      setProgressMsg('');
    }
  };

  /** 轮询 job 状态直到完成/失败 */
  const pollJobStatus = async (jobId: string): Promise<void> => {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const res = await fetch(`/api/generate/init?jobId=${jobId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '查询任务状态失败');
      }

      const { status, progress, result, error } = await res.json();

      if (status === 'processing' || status === 'pending') {
        setProgressMsg(progress || 'AI 生成中…');
      } else if (status === 'completed') {
        setCurrentJobId(''); // 完成或出错后清空，下次重试会创建新 jobId
        const mapData: MindMapData = {
          ...result,
          structure: ensureNodeIds(result.structure),
        };
        setMindMapData(mapData);

        // 生成 xmind 文件（允许失败，不阻塞预览）
        setProgressMsg('正在生成 XMind 文件…');
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const xmindRes = await fetch('/api/generate-xmind', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ structure: mapData }),
            });
            if (!xmindRes.ok) {
              const errText = await xmindRes.text();
              throw new Error(`HTTP ${xmindRes.status}: ${errText}`);
            }
            const blob = await xmindRes.blob();
            const buffer = await blob.arrayBuffer();
            setXmindBuffer(buffer);
            try {
              saveRecord({
                schoolName,
                programName,
                mindMapData: mapData,
                xmindBase64: bufferToBase64(buffer),
              });
            } catch (e) {
              console.warn('历史记录保存失败', e);
            }
            break; // 成功就跳出
          } catch (e) {
            console.warn(`XMind 生成失败 (第${attempt}次):`, e);
            if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
          }
        }
        break;

      } else if (status === 'error') {
        throw new Error(error || '生成失败');
      }
    }
  };

  const handleDownloadXMind = () => {
    // 直接用已生成的 buffer 下载，无需重新请求
    if (!xmindBuffer) return;
    const blob = new Blob([xmindBuffer], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindmap.xmind';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // 更新单个节点后重新生成 xmind
  const handleNodeUpdate = useCallback(async (nodeId: string, newTitle: string) => {
    if (!mindMapData) return;
    const newStructure = updateNodeTitle(mindMapData.structure, nodeId, newTitle);
    const newData: MindMapData = { ...mindMapData, structure: newStructure };
    setMindMapData(newData);

    // 重新生成 xmind 文件
    try {
      const res = await fetch('/api/generate-xmind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structure: newData }),
      });
      if (res.ok) {
        const blob = await res.blob();
        setXmindBuffer(await blob.arrayBuffer());
      }
    } catch (e) {
      console.warn('XMind 重新生成失败', e);
    }
  }, [mindMapData]);

  const handleLoadHistory = (record: HistoryRecord) => {
    setSchoolName(record.schoolName);
    setProgramName(record.programName);
    setMindMapData(record.mindMapData);
    setXmindBuffer(base64ToBuffer(record.xmindBase64));
    setError('');
    setHistoryOpen(false);
  };

  const handleReset = () => {
    setSchoolName('');
    setProgramName('');
    setTargetWords('1000');
    setFiles([]);
    setDetailLevel(50);
    setStylePreference(50);
    setMindMapData(null);
    setXmindBuffer(null);
    setError('');
    setProjectUrl('');
    setCurriculumUrl('');
    setActivitiesUrl('');
  };

  return (
    <main className="h-screen flex overflow-hidden bg-gray-50 text-[#3e3832]">
      {/* Left Sidebar */}
      <div className="w-[420px] flex-shrink-0 border-r bg-white shadow-sm flex flex-col">
        <div className="bg-card text-card-foreground gap-6 rounded-xl border py-6 shadow-sm h-full flex flex-col">
          {/* Header */}
          <div className="px-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                    <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                    <path d="M10 9H8"></path>
                    <path d="M16 13H8"></path>
                    <path d="M16 17H8"></path>
                  </svg>
                  <span className="leading-none font-semibold flex items-center gap-2 text-[#3e3832]">{t.appName}</span>
                </div>
                <p className="text-[#3e3832] opacity-70 text-sm mt-1">{t.appSubtitle}</p>
              </div>
              <span className="inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden border-transparent bg-primary text-primary-foreground hover:bg-pink-700 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 mr-1"><path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11 3 3L22 4"></path></svg>
                {t.remainingUses}
              </span>
            </div>
            <div className="mt-4">
              <div role="progressbar" data-state="indeterminate" data-max="100" className="bg-primary/20 relative w-full overflow-hidden rounded-full h-2">
                <div data-state="indeterminate" data-max="100" className="bg-primary h-full w-full flex-1 transition-all" style={{ transform: 'translateX(0%)' }}></div>
              </div>
              <p className="text-xs text-[#3e3832] opacity-70 mt-1">{t.dailyLimit}</p>
            </div>
          </div>

          {/* Form */}
          <form className="flex-1 flex flex-col overflow-hidden" onSubmit={(e) => e.preventDefault()}>
            <div className="px-6 flex-1 overflow-y-auto space-y-4">

              {/* School & Program */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm leading-none font-medium select-none flex items-center gap-1 text-[#3e3832]" htmlFor="schoolName">
                      {t.schoolName}
                      <span className="text-red-500 text-xs">*</span>
                    </label>
                    <input
                      id="schoolName"
                      placeholder="e.g., National University of Singapore"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      className="flex h-9 w-full min-w-0 rounded-md border border-[rgba(62,56,50,0.2)] bg-transparent px-3 py-1 text-base shadow-sm transition-[color,box-shadow] outline-none placeholder:text-[#3e3832] placeholder:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm leading-none font-medium select-none flex items-center gap-1 text-[#3e3832]" htmlFor="programName">
                      {t.programName}
                      <span className="text-red-500 text-xs">*</span>
                    </label>
                    <input
                      id="programName"
                      placeholder="e.g., MSc Computer Science"
                      value={programName}
                      onChange={(e) => setProgramName(e.target.value)}
                      className="flex h-9 w-full min-w-0 rounded-md border border-[rgba(62,56,50,0.2)] bg-transparent px-3 py-1 text-base shadow-sm transition-[color,box-shadow] outline-none placeholder:text-[#3e3832] placeholder:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                {/* Target Words */}
                <div className="space-y-2">
                  <label className="text-sm leading-none font-medium select-none flex items-center gap-1 text-[#3e3832]" htmlFor="targetWordCount">{t.targetWords}</label>
                  <div className="relative">
                    <button
                      type="button"
                      role="combobox"
                      aria-controls="radix-"
                      aria-expanded="false"
                      aria-autocomplete="none"
                      dir="ltr"
                      data-state="closed"
                      className="border-[rgba(62,56,50,0.2)] flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-sm transition-[color,box-shadow] outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-[#3e3832] data-[placeholder]:opacity-50 h-9 text-[#3e3832]"
                      onClick={() => setIsOpen(!isOpen)}
                    >
                      <span>{options.find(o => o.value === targetWords)?.label}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 opacity-50"><path d="m6 9 6 6 6-6"></path></svg>
                    </button>

                    {isOpen && (
                      <div className="absolute z-50 w-full mt-1 bg-white rounded-xl border border-[rgba(62,56,50,0.2)] shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                        {options.map((opt) => (
                          <div
                            key={opt.value}
                            className={`px-3 py-2.5 text-sm cursor-pointer hover:bg-[#b20155]/5 hover:text-[#b20155] transition-colors ${targetWords === opt.value ? 'bg-[#b20155]/5 text-[#b20155] font-medium' : 'text-[#3e3832]'}`}
                            onClick={() => {
                              setTargetWords(opt.value);
                              setIsOpen(false);
                            }}
                          >
                            {opt.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quality Control */}
              <div className="space-y-4 pt-4 border-t border-[rgba(62,56,50,0.2)]">
                {/* 详细程度 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm leading-none font-medium select-none text-[#3e3832]">{t.detailLevel}</label>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#b20155]/10 text-[#b20155] font-medium">
                      {detailLevel <= 30 ? t.detailConcise : detailLevel >= 70 ? t.detailDetailed : t.detailStandard}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={detailLevel}
                    onChange={(e) => setDetailLevel(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[rgba(62,56,50,0.12)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#b20155] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-shadow [&::-webkit-slider-thumb]:hover:shadow-lg"
                  />
                  <div className="flex justify-between text-[10px] text-[#3e3832] opacity-40">
                    <span>{t.detailConcise}</span>
                    <span>{t.detailStandard}</span>
                    <span>{t.detailDetailed}</span>
                  </div>
                </div>

                {/* 写作风格 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm leading-none font-medium select-none text-[#3e3832]">{t.stylePreference}</label>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#b20155]/10 text-[#b20155] font-medium">
                      {stylePreference <= 30 ? t.styleAcademic : stylePreference >= 70 ? t.stylePractical : t.styleCreative}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={stylePreference}
                    onChange={(e) => setStylePreference(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[rgba(62,56,50,0.12)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#b20155] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-shadow [&::-webkit-slider-thumb]:hover:shadow-lg"
                  />
                  <div className="flex justify-between text-[10px] text-[#3e3832] opacity-40">
                    <span>{t.styleAcademic}</span>
                    <span>{t.styleCreative}</span>
                    <span>{t.stylePractical}</span>
                  </div>
                </div>
              </div>

              {/* Reference Links */}
              <div className="space-y-4 pt-4 border-t border-[rgba(62,56,50,0.2)]">
                <div className="flex items-center gap-2 text-sm text-[#3e3832] opacity-70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                  <span>{t.referenceLinks} {t.optional}</span>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm leading-none font-medium select-none text-[#3e3832]" htmlFor="projectUrl">{t.projectUrl}</label>
                    <input
                      id="projectUrl"
                      type="url"
                      placeholder="https://example.edu/project"
                      value={projectUrl}
                      onChange={(e) => setProjectUrl(e.target.value)}
                      className="flex h-9 w-full min-w-0 rounded-md border border-[rgba(62,56,50,0.2)] bg-transparent px-3 py-1 text-base shadow-sm transition-[color,box-shadow] outline-none placeholder:text-[#3e3832] placeholder:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm leading-none font-medium select-none text-[#3e3832]" htmlFor="curriculumUrl">{t.curriculumUrl}</label>
                    <input
                      id="curriculumUrl"
                      type="url"
                      placeholder="https://example.edu/curriculum"
                      value={curriculumUrl}
                      onChange={(e) => setCurriculumUrl(e.target.value)}
                      className="flex h-9 w-full min-w-0 rounded-md border border-[rgba(62,56,50,0.2)] bg-transparent px-3 py-1 text-base shadow-sm transition-[color,box-shadow] outline-none placeholder:text-[#3e3832] placeholder:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm leading-none font-medium select-none text-[#3e3832]" htmlFor="activitiesUrl">{t.activitiesUrl}</label>
                    <input
                      id="activitiesUrl"
                      type="url"
                      placeholder="https://example.edu/activities"
                      value={activitiesUrl}
                      onChange={(e) => setActivitiesUrl(e.target.value)}
                      className="flex h-9 w-full min-w-0 rounded-md border border-[rgba(62,56,50,0.2)] bg-transparent px-3 py-1 text-base shadow-sm transition-[color,box-shadow] outline-none placeholder:text-[#3e3832] placeholder:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>

              {/* Upload Box */}
              <div
                className="flex flex-col gap-4 rounded-xl py-4 cursor-pointer transition-all duration-300 ease-in-out bg-white/35 border-2 border-dashed border-[rgba(62,56,50,0.2)] hover:bg-[#b20155]/5 hover:border-[#b20155]/40"
                onClick={() => fileInputRef.current?.click()}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.docx,.xmind,.pdf"
                  onChange={handleFileChange}
                  className="sr-only"
                />
                {files.length > 0 ? (
                  <div className="px-4 space-y-2">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-[rgba(62,56,50,0.05)] rounded-lg px-3 py-2">
                        <span className="text-sm text-[#3e3832] truncate max-w-[200px]">{file.name}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeFile(index); }}
                          className="text-[#3e3832] opacity-50 hover:opacity-100"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 px-6 flex flex-col items-center justify-center space-y-3">
                    <div className="text-[#3e3832] opacity-50">
                      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12">
                        <path d="M12 13v8"></path>
                        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
                        <path d="m8 17 4-4 4 4"></path>
                      </svg>
                    </div>
                    <div className="text-center space-y-1 px-4">
                      <p className="text-sm font-semibold text-[#3e3832]">{t.dragDropFiles}</p>
                      <p className="text-xs text-[#3e3832] opacity-60">{t.orClickToBrowse}</p>
                    </div>
                    <div className="flex flex-wrap justify-center items-center gap-3 text-xs text-[#3e3832] opacity-50">
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                          <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                          <path d="M10 9H8"></path>
                          <path d="M16 13H8"></path>
                          <path d="M16 17H8"></path>
                        </svg>
                        <span>DOCX</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                          <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                          <path d="M10 9H8"></path>
                          <path d="M16 13H8"></path>
                          <path d="M16 17H8"></path>
                        </svg>
                        <span>TXT</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
                          <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
                        </svg>
                        <span>MD</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <rect x="16" y="16" width="6" height="6" rx="1"></rect>
                          <rect x="2" y="16" width="6" height="6" rx="1"></rect>
                          <rect x="9" y="2" width="6" height="6" rx="1"></rect>
                          <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path>
                          <path d="M12 12V8"></path>
                        </svg>
                        <span>XMIND</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Error Message */}
              {error && (
                <div className="text-red-500 text-sm p-3 bg-red-50 rounded-md flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    className="flex-shrink-0 text-xs px-3 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors font-medium"
                  >
                    重试
                  </button>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex-shrink-0 p-4 border-t border-[rgba(62,56,50,0.2)] bg-[rgba(62,56,50,0.03)]">
              <div className="flex gap-2">
                {xmindBuffer ? (
                  <button
                    type="button"
                    onClick={handleDownloadXMind}
                    className="flex-1 inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-emerald-600 text-white hover:bg-emerald-700 h-10 rounded-md px-6 has-[>svg]:px-4"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 mr-2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" x2="12" y1="15" y2="3"></line>
                    </svg>
                    {t.downloadXMind || 'Download XMind'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={handleGenerate}
                    className="flex-1 inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-6 has-[>svg]:px-4"
                  >
                    {isGenerating ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 mr-2 animate-spin">
                          <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 mr-2">
                          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path>
                          <path d="M20 3v4"></path>
                          <path d="M22 5h-4"></path>
                        </svg>
                        {t.generateMindMap}
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive border border-[rgba(62,56,50,0.2)] bg-white shadow-xs hover:bg-[rgba(62,56,50,0.05)] text-[#3e3832] h-9 px-4 py-2 has-[>svg]:px-3"
                >
                  {t.reset}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Right Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

        {/* Top Bar / Status */}
        <div className="h-16 border-b border-[rgba(62,56,50,0.2)] bg-white flex items-center px-8 justify-between shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-[#3e3832]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {t.systemRunning}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setHistoryOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-[rgba(62,56,50,0.2)] text-[#3e3832] hover:bg-gray-100 transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              历史记录
            </button>
            <LanguageSwitcher />
            <div className="w-8 h-8 rounded-full bg-[rgba(62,56,50,0.2)] border-2 border-white shadow-sm"></div>
          </div>
        </div>

        {/* Mind Map Area */}
        <div className="flex-1 overflow-auto relative">
          <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50 pointer-events-none"></div>

          {xmindBuffer ? (
            <>
              <MindMapViewer file={xmindBuffer} />
              {mindMapData && (
                <NodeEditorPanel data={mindMapData} onUpdateNode={handleNodeUpdate} />
              )}
            </>
          ) : isGenerating ? (
            <div className="h-full flex flex-col items-center justify-center text-[#3e3832] p-8">
              <svg className="w-10 h-10 animate-spin text-[#b20155]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="mt-4 text-sm text-[#3e3832] opacity-60">
                {retryCount > 0
                  ? `第 ${retryCount} 次重试中，请稍候…`
                  : progressMsg || '正在生成思维导图，请稍候…'}
              </p>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-[#3e3832] p-8">
              <div className="relative">
                <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-24 h-24 opacity-20">
                  <rect x="16" y="16" width="6" height="6" rx="1"></rect>
                  <rect x="2" y="16" width="6" height="6" rx="1"></rect>
                  <rect x="9" y="2" width="6" height="6" rx="1"></rect>
                  <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path>
                  <path d="M12 12V8"></path>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 border-2 border-dashed border-[rgba(62,56,50,0.3)] rounded-full animate-pulse"></div>
                </div>
              </div>

              <h2 className="text-2xl font-semibold text-[#3e3832] opacity-50 mt-6">{t.noMindMap}</h2>
              <p className="text-[#3e3832] opacity-40 mt-2 text-center max-w-sm">{t.emptyStateDescription}</p>

              <div className="mt-6 flex gap-2">
                <span className="inline-flex items-center justify-center rounded-full border border-[rgba(62,56,50,0.2)] px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 text-[#3e3832] gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  {t.generationTime}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* History Drawer */}
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} onLoad={handleLoadHistory} />
    </main>
  );
}
