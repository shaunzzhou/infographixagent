import React, { useRef, useEffect } from 'react';
import { AnalysisResult, KeyPoint, AVAILABLE_TEMPLATES, AnalysisMode } from '../types';
import { Sparkles, ArrowRight, CheckCircle2, LayoutTemplate, Plus, Trash2, ChevronLeft, ScanSearch, PenTool, FileText, Palette, Monitor, Smartphone } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { ChatInputBar, SelectedFileState } from './ChatInputBar';

interface AnalysisViewProps {
  data: AnalysisResult;
  isLoading?: boolean;
  onDataChange: (newData: AnalysisResult) => void;
  onGenerate: () => void;
  onBack: () => void;
  // New props for Visual Selection Step
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  // Chat input (review-time) props
  chatText: string;
  chatFile: SelectedFileState | null;
  chatModePreference: 'AUTO' | AnalysisMode;
  onChatTextChange: (v: string) => void;
  onChatFileChange: (f: SelectedFileState | null) => void;
  onChatModeChange: (m: 'AUTO' | AnalysisMode) => void;
  onChatSubmit: () => void;
  isChatProcessing: boolean;
}

/**
 * Helper component that automatically adjusts its height to fit content.
 */
const AutoResizeTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            // Reset height to auto to get the correct scrollHeight for shrinking
            textareaRef.current.style.height = 'auto';
            // Set height to scrollHeight to fit content
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [props.value]);

    return (
        <textarea
            {...props}
            ref={textareaRef}
            // Ensure overflow is hidden to prevent scrollbars, and merge custom classes
            className={`${props.className} overflow-hidden resize-none`} 
        />
    );
};

// Helper for Aspect Ratio Icons
const AspectRatioIcon = ({ ratio }: { ratio: string }) => {
    const commonClasses = "border border-current rounded-sm";
    switch (ratio) {
        case '1:1': return <div className={`w-4 h-4 ${commonClasses}`} />;
        case '3:4': return <div className={`w-3 h-4 ${commonClasses}`} />;
        case '4:3': return <div className={`w-4 h-3 ${commonClasses}`} />;
        case '9:16': return <div className={`w-2.5 h-4 ${commonClasses}`} />;
        case '16:9': return <div className={`w-4 h-2.5 ${commonClasses}`} />;
        default: return <div className={`w-3 h-4 ${commonClasses}`} />;
    }
};

export const AnalysisView: React.FC<AnalysisViewProps> = ({ 
  data, 
  isLoading = false,
  onDataChange,
  onGenerate,
  onBack,
  selectedTemplateId,
  onTemplateChange,
  aspectRatio,
  onAspectRatioChange,
  chatText,
  chatFile,
  chatModePreference,
  onChatTextChange,
  onChatFileChange,
  onChatModeChange,
  onChatSubmit,
  isChatProcessing
}) => {
  const { t } = useTranslation();
  
  // --- HANDLERS ---
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDataChange({ ...data, title: e.target.value });
  };

  const handleSummaryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onDataChange({ ...data, summary: e.target.value });
  };

  const handleCustomPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onDataChange({ ...data, customVisualPrompt: e.target.value });
  };

  const handlePointChange = (index: number, field: keyof KeyPoint, value: string) => {
    if (!data.keyPoints) return;
    const newPoints = [...data.keyPoints];
    newPoints[index] = { ...newPoints[index], [field]: value };
    onDataChange({ ...data, keyPoints: newPoints });
  };

  const handleAddPoint = () => {
    const newPoint: KeyPoint = { title: "New Point", description: "Details...", category: "" };
    onDataChange({ ...data, keyPoints: [...(data.keyPoints || []), newPoint] });
  };

  const handleDeletePoint = (index: number) => {
    const newPoints = data.keyPoints.filter((_, i) => i !== index);
    onDataChange({ ...data, keyPoints: newPoints });
  };

  // Helper to determine mode label and color
  const getModeInfo = () => {
    switch (data.mode) {
        case 'CREATIVE_GENERATION':
            return { label: t.creativeMode, color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', icon: <PenTool className="w-3 h-3" /> };
        case 'TARGETED_ANALYSIS':
            return { label: t.researchMode, color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: <ScanSearch className="w-3 h-3" /> };
        default:
            return { label: t.summaryMode, color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: <FileText className="w-3 h-3" /> };
    }
  };

  const modeInfo = getModeInfo();
  const isPosterMode = data.mode === 'CREATIVE_GENERATION' && (!data.keyPoints || data.keyPoints.length === 0);

  const ASPECT_RATIOS = [
    { id: '1:1', label: 'Square' },
    { id: '3:4', label: 'Portrait' },
    { id: '4:3', label: 'Landscape' },
    { id: '9:16', label: 'Story' },
    { id: '16:9', label: 'Widescreen' },
  ];

  if (isLoading) {
      return (
          <div className="w-full max-w-4xl mx-auto mt-8 flex flex-col items-center justify-center min-h-[400px]">
              <div className="w-16 h-16 border-4 border-gray-100 dark:border-slate-800 border-t-blue-600 rounded-full animate-spin mb-6"></div>
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">{t.analyzingTitle}</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-2">{t.analyzingDesc}</p>
          </div>
      );
  }

  return (
    <div className="relative w-full max-w-5xl mx-auto px-4 h-[calc(100vh-140px)] transition-colors overflow-hidden flex flex-col">
      
      {/* Back Button */}
      <div className="pt-6">
        <button 
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
        >
            <ChevronLeft className="w-4 h-4" /> {t.backUpload}
        </button>
      </div>

      {/* HEADER & ACTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 mt-4">
        <div>
            <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.reviewTitle}</h1>
                {/* MODE BADGE */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${modeInfo.color}`}>
                    {modeInfo.icon}
                    {modeInfo.label}
                </div>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t.reviewSubtitle}</p>
        </div>
        <button 
            onClick={onGenerate}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 text-sm"
        >
            <Sparkles className="w-4 h-4" />
            {t.generateBtn} <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto pr-1 pb-4 space-y-8">

      {/* SECTION 1: STYLE SELECTOR & CUSTOM PROMPT */}
      <div className="space-y-6">
        {/* Templates */}
        <div>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide flex items-center gap-2 mb-4">
                <LayoutTemplate className="w-4 h-4" /> {t.selectStyle}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {AVAILABLE_TEMPLATES.map(template => {
                    const isSelected = selectedTemplateId === template.id;
                    return (
                        <div 
                            key={template.id}
                            onClick={() => onTemplateChange(template.id)}
                            className={`relative rounded-lg border cursor-pointer transition-all duration-200 group overflow-hidden flex flex-col
                                ${isSelected 
                                    ? 'border-blue-500 bg-white dark:bg-slate-700 shadow-sm ring-1 ring-blue-500' 
                                    : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-slate-600'
                                }
                            `}
                        >
                            {/* Visual Preview Area */}
                            <div
                                className={`h-32 w-full ${template.style} relative p-4 flex flex-col justify-end overflow-hidden`}
                                style={{
                                  backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.4), rgba(15,23,42,0.6)), url(/template/${template.filename})`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center'
                                }}
                            >
                                {/* Abstract Mock Content using currentColor */}
                                <div className="w-8 h-8 rounded-full bg-current opacity-20 mb-auto backdrop-blur-sm"></div>
                                <div className="w-3/4 h-3 bg-current opacity-20 rounded-sm mb-2 backdrop-blur-sm"></div>
                                <div className="w-1/2 h-2 bg-current opacity-20 rounded-sm backdrop-blur-sm"></div>
                                
                                {isSelected && (
                                    <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1 shadow-sm z-10">
                                        <CheckCircle2 className="w-3 h-3" />
                                    </div>
                                )}
                            </div>

                            {/* Text Info */}
                            <div className="p-4 flex flex-col flex-1">
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className={`font-bold text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-200'}`}>
                                        {template.name}
                                    </h4>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    {template.description}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Canvas Format Selector */}
        <div>
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide flex items-center gap-2 mb-3">
                <Monitor className="w-4 h-4" /> {t.canvasFormat}
            </h3>
            <div className="flex flex-wrap gap-2">
                {ASPECT_RATIOS.map((ratio) => {
                    const isSelected = aspectRatio === ratio.id;
                    return (
                        <button
                            key={ratio.id}
                            onClick={() => onAspectRatioChange(ratio.id)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold border transition-all
                                ${isSelected 
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-500'
                                }
                            `}
                        >
                            <AspectRatioIcon ratio={ratio.id} />
                            {ratio.label} <span className="opacity-50 font-normal ml-0.5">({ratio.id})</span>
                        </button>
                    )
                })}
            </div>
        </div>

        {/* CUSTOM VISUAL PROMPT */}
        <div className="bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4 transition-all focus-within:ring-1 focus-within:ring-blue-500/50">
             <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-2">
                 <Palette className="w-3.5 h-3.5" /> 
                 {t.visualInst}
             </label>
             <AutoResizeTextarea
                value={data.customVisualPrompt || ''}
                onChange={handleCustomPromptChange}
                placeholder={t.visualPlaceholder}
                className="w-full text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700 rounded-md p-3 focus:outline-none focus:border-blue-500 resize-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
                rows={2}
             />
             <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                {t.visualTip}
             </p>
        </div>
      </div>

      {/* SECTION 2: EDITABLE CONTENT */}
      <div className="space-y-4">
         
         <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide flex items-center gap-2 mt-8 mb-2">
            <FileText className="w-4 h-4" /> {t.editContent}
        </h3>

         {/* Title & Summary Card */}
         <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden group focus-within:ring-1 focus-within:ring-blue-500/50 transition-all">
             <div className="bg-gray-50/50 dark:bg-slate-800/50 px-4 py-2 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-300">1</div>
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase">{t.cover}</span>
                </div>
                <select className="text-[10px] bg-transparent text-gray-400 dark:text-gray-500 font-medium outline-none">
                    <option>{t.cover}</option>
                </select>
             </div>
             <div className="p-5">
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{t.headline}</label>
                <input 
                    type="text"
                    value={data.title}
                    onChange={handleTitleChange}
                    className="w-full text-lg font-bold text-gray-900 dark:text-white bg-transparent border-none p-0 focus:ring-0 placeholder-gray-300 dark:placeholder-gray-600 mb-3"
                    placeholder="Enter Infographic Title"
                />
                <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">{t.subtitle}</label>
                <AutoResizeTextarea 
                    value={data.summary}
                    onChange={handleSummaryChange}
                    rows={3}
                    className="w-full text-sm text-gray-600 dark:text-gray-300 bg-transparent border-none p-0 focus:ring-0 placeholder-gray-300 dark:placeholder-gray-600 leading-relaxed block"
                    placeholder="Enter a brief summary..."
                />
             </div>
         </div>

         {/* Poster Mode Message */}
         {isPosterMode && (
            <div className="p-6 bg-purple-50 dark:bg-purple-900/10 rounded-lg border border-purple-100 dark:border-purple-800 flex items-start gap-4">
                <div className="p-2 bg-purple-100 dark:bg-purple-800 rounded-lg text-purple-600 dark:text-purple-300">
                    <Sparkles className="w-5 h-5" />
                </div>
                <div>
                    <h4 className="text-purple-900 dark:text-purple-200 font-bold text-sm mb-1">{t.posterActive}</h4>
                    <p className="text-purple-700 dark:text-purple-300 text-sm leading-relaxed">
                        {t.posterDesc} 
                        <br/><span className="text-purple-600/70 dark:text-purple-400/70 text-xs mt-1 block">{t.wantStandard}</span>
                    </p>
                </div>
            </div>
         )}

         {/* Key Points Cards */}
         {data.keyPoints.map((point, index) => (
             <div key={index} className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden group focus-within:ring-1 focus-within:ring-blue-500/50 transition-all">
                <div className="bg-gray-50/50 dark:bg-slate-800/50 px-4 py-2 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-300">{index + 2}</div>
                        <input 
                            value={point.title}
                            onChange={(e) => handlePointChange(index, 'title', e.target.value)}
                            className="bg-transparent text-sm font-bold text-gray-700 dark:text-gray-200 outline-none w-full"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                         <select className="text-[10px] bg-transparent text-gray-400 dark:text-gray-500 font-medium outline-none">
                            <option>{t.content}</option>
                        </select>
                        <button onClick={() => handleDeletePoint(index)} className="text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                <div className="p-5">
                    <AutoResizeTextarea 
                        value={point.description}
                        onChange={(e) => handlePointChange(index, 'description', e.target.value)}
                        rows={2}
                        className="w-full text-sm text-gray-600 dark:text-gray-300 bg-transparent border-none p-0 focus:ring-0 placeholder-gray-300 dark:placeholder-gray-600 leading-relaxed block"
                        placeholder="Bullet points content..."
                    />
                </div>
             </div>
         ))}

         {/* Add Point Button */}
         <button 
            onClick={handleAddPoint}
            className="w-full py-4 rounded-lg border border-dashed border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500 font-medium hover:border-gray-300 dark:hover:border-slate-600 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-2 text-sm"
         >
            <Plus className="w-4 h-4" /> {t.addSection}
         </button>

      </div>

      
      </div>
{/* Footer chat input for re-run/refine */}
      <div className="flex-none pt-2 pb-4">
          <ChatInputBar
            text={chatText}
            onTextChange={onChatTextChange}
            file={chatFile}
            onFileChange={onChatFileChange}
            modePreference={chatModePreference}
            onModeChange={onChatModeChange}
            isProcessing={isChatProcessing}
            onSubmit={onChatSubmit}
            placeholder="Refine text, add instructions, or drop a new file to re-run analysis..."
            hint="Edits here will re-run analysis and refresh the plan."
            ctaLabel="Re-run Analysis"
          />
        </div>
      </div>
  );
};
