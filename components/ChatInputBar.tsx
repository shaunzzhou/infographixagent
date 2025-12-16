import React, { useCallback, useRef, useState } from 'react';
import { FileText, X, Plus, Loader2, ArrowRight } from 'lucide-react';
import { AnalysisMode } from '../types';
// @ts-ignore
import mammoth from 'mammoth';

export interface SelectedFileState {
  name: string;
  type: string;
  base64?: string;
  extractedText?: string;
}

interface ChatInputBarProps {
  text: string;
  onTextChange: (value: string) => void;
  file: SelectedFileState | null;
  onFileChange: (file: SelectedFileState | null) => void;
  modePreference: 'AUTO' | AnalysisMode;
  onModeChange: (mode: 'AUTO' | AnalysisMode) => void;
  isProcessing: boolean;
  onSubmit: () => void;
  placeholder?: string;
  hint?: string;
  ctaLabel?: string;
  compact?: boolean;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  text,
  onTextChange,
  file,
  onFileChange,
  modePreference,
  onModeChange,
  isProcessing,
  onSubmit,
  placeholder = "Paste or type text, or drop PDF/DOCX/TXT anywhere here. You can also click + to upload.",
  hint = "Drop a file here or use the + button.",
  ctaLabel = "Analyze & Generate",
  compact = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFile = (fileObj: File) => {
    const isPdf = fileObj.type === 'application/pdf' || fileObj.name.endsWith('.pdf');
    const isDocx = fileObj.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileObj.name.endsWith('.docx');
    const isTxt = fileObj.type === 'text/plain' || fileObj.name.endsWith('.txt');

    if (!isPdf && !isDocx && !isTxt) {
      alert('Please upload a PDF, DOCX, or Text file.');
      return;
    }

    if (isTxt) {
      const reader = new FileReader();
      reader.onload = (e) => {
        onTextChange((e.target?.result as string) || '');
        onFileChange(null);
      };
      reader.readAsText(fileObj);
      return;
    }

    if (isDocx) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        try {
          const result = await mammoth.extractRawText({ arrayBuffer });
          onFileChange({
            name: fileObj.name,
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            extractedText: result.value
          });
          onTextChange('');
        } catch (err) {
          console.error('DOCX parsing error:', err);
          alert('Failed to read DOCX file.');
        }
      };
      reader.readAsArrayBuffer(fileObj);
      return;
    }

    if (isPdf) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const base64 = result.split(',')[1];
        onFileChange({
          name: fileObj.name,
          type: 'application/pdf',
          base64
        });
        onTextChange('');
      };
      reader.readAsDataURL(fileObj);
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

  const canSubmit = text.trim().length > 0 || !!file;

  const handleSubmit = () => {
    if (!canSubmit || isProcessing) return;
    onSubmit();
  };

  return (
    <div
      className={`w-full rounded-2xl border ${isDragOver ? 'border-blue-500' : 'border-gray-200 dark:border-slate-700'} bg-white dark:bg-slate-900 shadow-lg shadow-slate-200/60 dark:shadow-slate-900/40 overflow-hidden transition-colors`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".pdf,.docx,.txt"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
          }
        }}
      />

      <div className="p-0 space-y-3">
        {file && (
          <div className="px-4 pt-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-gray-100">
              <FileText className="w-4 h-4" />
              <span className="max-w-[200px] truncate">{file.name}</span>
              <button
                onClick={() => onFileChange(null)}
                className="text-slate-400 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                aria-label="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div>
          <div className={`bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 ${compact ? 'py-1.5' : 'py-2'}`}>
            <textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder={placeholder}
              className={`w-full bg-transparent border-none outline-none resize-none text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400 dark:placeholder:text-slate-500 ${compact ? 'min-h-[60px]' : 'min-h-[140px]'}`}
              rows={compact ? 2 : 4}
            />
            <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
              <span>{hint}</span>
              <span>{text.length} characters</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-100 flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700"
            title="Upload file"
          >
            <Plus className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-100 h-11">
            <span className="text-sm font-semibold">Mode:</span>
            <select
              value={modePreference}
              onChange={(e) => onModeChange(e.target.value as 'AUTO' | AnalysisMode)}
              className="h-9 px-3 rounded-lg text-sm font-medium border bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-100 focus:outline-none"
            >
              <option value="AUTO">Auto (detect)</option>
              <option value="CREATIVE_GENERATION">Creative / Poster</option>
              <option value="TARGETED_ANALYSIS">Focused Analysis</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 md:ml-auto">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isProcessing}
            className={`px-4 h-9 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-colors ${
              (!canSubmit || isProcessing)
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isProcessing ? 'Processing' : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
