import React, { useState, useCallback, useRef, useEffect } from 'react';
import { UploadCloud, FileText, X, File as FileIcon, Sparkles, Search, Lightbulb, Loader2, PenTool, Image as ImageIcon, BoxSelect, ArrowRight, Type } from 'lucide-react';
import { DocumentInputData, AVAILABLE_TEMPLATES } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
// @ts-ignore
import mammoth from 'mammoth';

interface DocumentInputProps {
  onAnalyze: (data: DocumentInputData) => void;
  isProcessing: boolean;
}

interface SelectedFileState {
    name: string;
    type: string;
    base64?: string;
    extractedText?: string;
}

export const DocumentInput: React.FC<DocumentInputProps> = ({ onAnalyze, isProcessing }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [userContext, setUserContext] = useState(''); 
  const [selectedFile, setSelectedFile] = useState<SelectedFileState | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default to first template, but user will confirm in next step
  const defaultTemplate = AVAILABLE_TEMPLATES[0];

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // If user clears text, don't automatically switch back, let them choose to cancel
  };

  const processFile = (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx');
    const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt');

    if (!isPdf && !isDocx && !isTxt) {
        alert('Please upload a PDF, DOCX, or Text file.');
        return;
    }

    if (isTxt) {
        const reader = new FileReader();
        reader.onload = (e) => {
            setText(e.target?.result as string);
            setSelectedFile(null);
            setInputMode('text');
        };
        reader.readAsText(file);
    } else if (isDocx) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            try {
                const result = await mammoth.extractRawText({ arrayBuffer });
                setSelectedFile({
                    name: file.name,
                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    extractedText: result.value
                });
                setText('');
                setInputMode('file');
            } catch (error) {
                console.error("DOCX parsing error:", error);
                alert("Failed to read DOCX file.");
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (isPdf) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            const base64 = result.split(',')[1]; 
            setSelectedFile({
                name: file.name,
                type: 'application/pdf',
                base64: base64
            });
            setText(''); 
            setInputMode('file');
        };
        reader.readAsDataURL(file);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          processFile(e.target.files[0]);
      }
  };

  // Removed arbitrary limits (>10 chars) so button is active as soon as there is input
  const hasSourceMaterial = (inputMode === 'text' && text.trim().length > 0) || (inputMode === 'file' && !!selectedFile);
  const canSubmit = hasSourceMaterial || userContext.trim().length > 0;

  const handleSubmit = () => {
    // Construct payload
    const payload: DocumentInputData = {
        type: 'text',
        content: '',
        userContext: userContext.trim(),
        templateFileName: defaultTemplate.filename, // Default, will be editable in Review
        templateMimeType: 'application/pdf'
    };

    if (inputMode === 'file' && selectedFile) {
        if (selectedFile.base64) {
             payload.type = 'file';
             payload.content = selectedFile.base64;
             payload.mimeType = selectedFile.type;
             payload.fileName = selectedFile.name;
        } else if (selectedFile.extractedText) {
             payload.type = 'text';
             payload.content = selectedFile.extractedText;
             payload.fileName = selectedFile.name;
        }
    } else if (inputMode === 'text' && text.trim().length > 0) {
        payload.type = 'text';
        payload.content = text;
    } else if (userContext.trim().length > 0) {
        payload.type = 'text';
        payload.content = userContext; 
    }

    onAnalyze(payload);
  };

  const clearAll = () => {
      setText('');
      setSelectedFile(null);
      setUserContext('');
      setInputMode('file');
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- HERO UI ---
  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto mt-8 lg:mt-16 px-4 transition-all">
        
        {/* Header Section */}
        <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
                {t.heroTitlePrefix} <span className="text-blue-600 dark:text-blue-500">Antalpha</span> {t.heroTitleSuffix}
                <br />
                <span className="text-gray-400 dark:text-gray-500 block mt-2 text-3xl font-light">{t.heroSubtitle}</span>
            </h1>
            <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto text-sm md:text-base leading-relaxed">
                {t.heroDesc}
            </p>
        </div>

        {/* Input Card */}
        {/* Removed rounded-3xl, shadow-blue */}
        <div className="w-full bg-white dark:bg-slate-900 rounded-xl shadow-xl shadow-gray-200/50 dark:shadow-none p-1.5 overflow-hidden border border-gray-100 dark:border-slate-800 relative transition-colors">
            
            {/* Clear Button */}
            {(hasSourceMaterial || inputMode === 'text') && (
                <div className="absolute top-5 right-6 flex gap-2 z-10">
                    <button onClick={clearAll} className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-3 py-1.5 rounded-md transition-colors shadow-sm">
                        {inputMode === 'text' ? t.cancel : t.clear}
                    </button>
                </div>
            )}

            <div 
                className={`relative rounded-lg border-2 border-dashed transition-all duration-300 min-h-[320px] flex flex-col items-center justify-center p-8
                    ${isDragOver 
                        ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-900/10' 
                        : 'border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900'
                    }
                `}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
            >
                <input 
                    type="file" 
                    ref={fileInputRef}
                    className="hidden"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileSelect}
                />

                {/* VIEW: FILE SELECTED */}
                {inputMode === 'file' && selectedFile && (
                    <div className="text-center animate-in zoom-in duration-300">
                         <div className="w-16 h-16 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 mx-auto shadow-sm">
                            <FileText className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{selectedFile.name}</h3>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t.ready}</p>
                    </div>
                )}

                {/* VIEW: TEXT INPUT */}
                {inputMode === 'text' && (
                    <div className="w-full h-full flex flex-col animate-in fade-in duration-300">
                        <textarea 
                            value={text}
                            onChange={handleTextChange}
                            className="w-full h-48 p-4 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none mb-4 transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-600"
                            placeholder={t.typePlaceholder}
                            autoFocus
                        />
                        <div className="text-right text-xs text-gray-400 dark:text-gray-600">
                            {text.length} {t.chars}
                        </div>
                    </div>
                )}

                {/* VIEW: DEFAULT UPLOAD */}
                {inputMode === 'file' && !selectedFile && (
                    <div className="text-center">
                        <div className="w-16 h-16 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl flex items-center justify-center text-gray-900 dark:text-white mb-6 mx-auto transition-transform hover:scale-105 duration-200 cursor-pointer shadow-sm" onClick={() => fileInputRef.current?.click()}>
                            <UploadCloud className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{t.uploadDoc}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto mb-6">
                            {t.dragDrop}
                        </p>
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-slate-900 rounded-lg font-medium hover:bg-black dark:hover:bg-gray-100 transition-colors shadow-sm hover:shadow-md text-sm flex items-center"
                            >
                                <FileIcon className="w-4 h-4 mr-2" />
                                {t.selectDoc}
                            </button>
                            <button 
                                onClick={() => setInputMode('text')}
                                className="px-5 py-2.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm flex items-center shadow-sm"
                            >
                                <Type className="w-4 h-4 mr-2" />
                                {t.pasteText}
                            </button>
                        </div>
                    </div>
                )}
            </div>
            
            {/* Action Bar - ALWAYS VISIBLE */}
            <div className="p-4 bg-gray-50 dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between transition-colors">
                <div className="flex-1 mr-4">
                    <input 
                        type="text" 
                        value={userContext}
                        onChange={(e) => setUserContext(e.target.value)}
                        placeholder={t.optionalContext}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    />
                </div>
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || isProcessing}
                    className={`px-6 py-2.5 rounded-lg font-bold transition-colors shadow-sm text-sm flex items-center gap-2
                        ${(!canSubmit || isProcessing) 
                            ? 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-gray-600 cursor-not-allowed' 
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }
                    `}
                >
                    {isProcessing ? (
                        <> <Loader2 className="w-4 h-4 animate-spin" /> {t.processing} </>
                    ) : (
                        <> {t.analyzeBtn} <ArrowRight className="w-4 h-4" /> </>
                    )}
                </button>
            </div>
        </div>
    </div>
  );
};