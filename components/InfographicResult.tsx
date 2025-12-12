import React, { useState, useEffect } from 'react';
import { Download, Sparkles, RefreshCw, Type, Palette, Monitor, LayoutTemplate, CheckCircle2, Package, Loader2 } from 'lucide-react';
import { AnalysisResult, AVAILABLE_TEMPLATES } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
// @ts-ignore
import JSZip from 'jszip';

interface InfographicResultProps {
  imageUrls: string[]; // Changed from single imageUrl
  isLoading: boolean;
  data: AnalysisResult | null;
  onDataChange: (newData: AnalysisResult) => void;
  onRegenerate: () => void;
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
}

// Helper for Aspect Ratio Icons
const AspectRatioIcon = ({ ratio }: { ratio: string }) => {
    const commonClasses = "border border-current rounded-sm";
    switch (ratio) {
        case '1:1': return <div className={`w-3.5 h-3.5 ${commonClasses}`} />;
        case '3:4': return <div className={`w-2.5 h-3.5 ${commonClasses}`} />;
        case '4:3': return <div className={`w-3.5 h-2.5 ${commonClasses}`} />;
        case '9:16': return <div className={`w-2 h-3.5 ${commonClasses}`} />;
        case '16:9': return <div className={`w-3.5 h-2 ${commonClasses}`} />;
        default: return <div className={`w-3 h-4 ${commonClasses}`} />;
    }
};

export const InfographicResult: React.FC<InfographicResultProps> = ({ 
  imageUrls, 
  isLoading, 
  data, 
  onDataChange, 
  onRegenerate, 
  aspectRatio, 
  onAspectRatioChange,
  selectedTemplateId,
  onTemplateChange
}) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isZipping, setIsZipping] = useState(false);

  // Reset selected index when new images arrive
  useEffect(() => {
    if (imageUrls.length > 0) {
        setSelectedIndex(0);
    }
  }, [imageUrls]);
  
  const handleDownload = () => {
    const currentImage = imageUrls[selectedIndex];
    if (currentImage) {
      const link = document.createElement('a');
      link.href = currentImage;
      link.download = `infographic-var-${selectedIndex + 1}-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleDownloadAll = async () => {
      setIsZipping(true);
      try {
          const zip = new JSZip();
          
          imageUrls.forEach((url, index) => {
              // Data URL format: data:image/png;base64,....
              // We need to strip the prefix to get just the base64 data
              const parts = url.split(',');
              if (parts.length === 2) {
                  zip.file(`infographic-var-${index + 1}.png`, parts[1], { base64: true });
              }
          });

          const content = await zip.generateAsync({ type: "blob" });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(content);
          link.download = `infographic-set-${Date.now()}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
      } catch (e) {
          console.error("Failed to generate zip", e);
          alert("Could not generate ZIP file.");
      } finally {
          setIsZipping(false);
      }
  };

  const handleVisualPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (data) onDataChange({ ...data, customVisualPrompt: e.target.value });
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (data) onDataChange({ ...data, title: e.target.value });
  };

  const handleSummaryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (data) onDataChange({ ...data, summary: e.target.value });
  };

  const ASPECT_RATIOS = [
    { id: '1:1', label: 'Square' },
    { id: '3:4', label: 'Portrait' },
    { id: '4:3', label: 'Landscape' },
    { id: '9:16', label: 'Story' },
    { id: '16:9', label: 'Wide' },
  ];

  // --- LOADING VIEW ---
  if (isLoading) {
    return (
      <div className="h-full min-h-[600px] bg-slate-950 rounded-xl flex flex-col items-center justify-center p-8 text-white relative overflow-hidden shadow-2xl border border-slate-900">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-transparent"></div>
        <div className="relative z-10 flex flex-col items-center animate-in fade-in duration-700">
          <div className="relative">
            <div className="w-20 h-20 border-2 border-t-transparent border-white/50 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-white/80 animate-pulse" />
            </div>
          </div>
          <h3 className="text-2xl font-bold mt-8 mb-2 tracking-tight">{t.designingTitle}</h3>
          <p className="text-slate-400 text-center max-w-sm leading-relaxed">
            {t.designingDesc}
          </p>
          <p className="text-slate-500 text-xs mt-4">Generating 5 parallel variations...</p>
        </div>
      </div>
    );
  }

  // --- EMPTY STATE ---
  if (imageUrls.length === 0 || !data) {
    return (
      <div className="h-full bg-gray-50 dark:bg-slate-900/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-800 flex items-center justify-center p-8 transition-colors">
        <p className="text-gray-400 dark:text-gray-500 font-medium">{t.noGen}</p>
      </div>
    );
  }

  // --- STUDIO VIEW (SPLIT LAYOUT) ---
  return (
    <div className="flex flex-col lg:flex-row h-full gap-4 lg:gap-6 pb-4 lg:pb-0">
        
        {/* LEFT COLUMN: VISUAL OUTPUT (Flexible Width) */}
        <div className="flex-1 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col min-h-[400px] transition-colors">
             {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center bg-white dark:bg-slate-900 z-10 flex-none gap-3 sm:gap-0">
                <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                        {t.finalOutput}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-xs font-medium">
                        {selectedIndex + 1} / {imageUrls.length}
                    </span>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {/* Download ZIP */}
                    <button 
                        onClick={handleDownloadAll}
                        disabled={isZipping}
                        className="flex-1 sm:flex-none px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm flex items-center justify-center gap-2 text-xs font-bold disabled:opacity-50"
                    >
                         {isZipping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                         {t.downloadAll}
                    </button>
                    
                    {/* Download Single */}
                    <button 
                        onClick={handleDownload}
                        className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-900 dark:bg-white dark:text-gray-900 text-white rounded-md hover:bg-black dark:hover:bg-gray-200 transition-colors shadow-sm flex items-center justify-center gap-2 text-xs font-bold"
                    >
                        <Download className="w-3.5 h-3.5" /> {t.download}
                    </button>
                </div>
            </div>

            {/* Main Image Canvas */}
            <div className="flex-1 bg-gray-100 dark:bg-slate-950 relative p-4 lg:p-6 flex items-center justify-center overflow-hidden group transition-colors">
                {/* Subtle Grid Pattern */}
                <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] bg-[radial-gradient(#000000_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none"></div>
                
                {/* The Selected Image */}
                <img 
                    src={imageUrls[selectedIndex]} 
                    alt={`Variation ${selectedIndex + 1}`} 
                    className="max-w-full max-h-full object-contain rounded shadow-xl border border-gray-200 dark:border-slate-800 bg-white transition-transform duration-300"
                />
            </div>

            {/* Thumbnail Strip */}
            <div className="p-4 bg-gray-50 dark:bg-slate-950/50 border-t border-gray-100 dark:border-slate-800 flex justify-center gap-3 overflow-x-auto">
                {imageUrls.map((url, idx) => (
                    <div 
                        key={idx}
                        onClick={() => setSelectedIndex(idx)}
                        className={`relative w-16 h-16 md:w-20 md:h-20 flex-none rounded-lg border-2 cursor-pointer overflow-hidden transition-all
                            ${selectedIndex === idx 
                                ? 'border-blue-500 shadow-md ring-2 ring-blue-500/20' 
                                : 'border-gray-200 dark:border-slate-700 opacity-60 hover:opacity-100 hover:border-gray-300 dark:hover:border-slate-500'
                            }
                        `}
                    >
                        <img src={url} alt={`Var ${idx}`} className="w-full h-full object-cover" />
                        {selectedIndex === idx && (
                            <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-0.5">
                                <CheckCircle2 className="w-3 h-3 text-white" />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>

        {/* RIGHT COLUMN: REFINEMENT CONTROLS (Fixed Width Sidebar) */}
        <div className="w-full lg:w-[400px] xl:w-[450px] bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 flex flex-col h-auto lg:h-full flex-none transition-colors">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex-none bg-white dark:bg-slate-900 rounded-t-xl z-10">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-500" />
                <div>
                    <h4 className="font-bold text-gray-800 dark:text-white text-sm">{t.refineResult}</h4>
                </div>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                
                {/* 1. Visual Instructions */}
                <div>
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                        <Palette className="w-3 h-3" /> {t.visualInst}
                    </label>
                    <textarea 
                        value={data.customVisualPrompt || ''}
                        onChange={handleVisualPromptChange}
                        placeholder={t.visualPlaceholder}
                        className="w-full bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-md p-3 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-950 transition-all outline-none resize-none h-24 placeholder:text-gray-400 dark:placeholder:text-gray-600"
                    />
                </div>

                {/* 2. Format & Style */}
                <div className="grid grid-cols-2 gap-4">
                     {/* Aspect Ratio */}
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                            <Monitor className="w-3 h-3" /> {t.canvasFormat}
                        </label>
                        <div className="flex flex-col gap-1.5">
                            {ASPECT_RATIOS.map((ratio) => {
                                const isSelected = aspectRatio === ratio.id;
                                return (
                                    <button
                                        key={ratio.id}
                                        onClick={() => onAspectRatioChange(ratio.id)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold border transition-all text-left
                                            ${isSelected 
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                                                : 'border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600'
                                            }
                                        `}
                                    >
                                        <AspectRatioIcon ratio={ratio.id} />
                                        {ratio.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    
                    {/* Design Style */}
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                            <LayoutTemplate className="w-3 h-3" /> {t.selectStyle}
                        </label>
                        <div className="flex flex-col gap-1.5">
                            {AVAILABLE_TEMPLATES.map((template) => {
                                const isSelected = selectedTemplateId === template.id;
                                return (
                                    <button
                                        key={template.id}
                                        onClick={() => onTemplateChange(template.id)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold border transition-all text-left
                                            ${isSelected 
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                                                : 'border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600'
                                            }
                                        `}
                                    >
                                        <div className={`w-3 h-3 rounded-full border border-gray-200 ${template.style.includes('bg-slate-900') ? 'bg-slate-900' : template.style.includes('bg-white') ? 'bg-white' : 'bg-gradient-to-br from-blue-900 to-indigo-900'}`}></div>
                                        {template.name}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* 3. Text Content */}
                <div>
                     <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                        <Type className="w-3 h-3" /> {t.textContent}
                    </label>
                    <div className="bg-gray-50 dark:bg-slate-950 rounded-md p-3 border border-gray-200 dark:border-slate-800 space-y-3">
                        <div>
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">{t.headline}</label>
                            <input 
                                type="text" 
                                value={data.title}
                                onChange={handleTitleChange}
                                className="w-full text-sm font-bold border border-gray-200 dark:border-slate-800 rounded-md px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
                                placeholder="Title"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1 block">{t.subtitle}</label>
                            <textarea 
                                value={data.summary}
                                onChange={handleSummaryChange}
                                className="w-full text-sm border border-gray-200 dark:border-slate-800 rounded-md px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none resize-none bg-white dark:bg-slate-900 text-gray-900 dark:text-white min-h-[80px] placeholder:text-gray-300 dark:placeholder:text-gray-600 leading-relaxed"
                                placeholder="Summary"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Action Button */}
            <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-950/50 rounded-b-xl flex-none transition-colors">
                <button 
                    onClick={onRegenerate}
                    className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-bold text-sm shadow-sm hover:bg-blue-700 active:translate-y-0.5 transition-all flex items-center justify-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" />
                    {t.updateRegenerate}
                </button>
            </div>
        </div>
    </div>
  );
};