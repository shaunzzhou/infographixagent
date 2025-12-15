import React from 'react';
import { AnalysisMode } from '../types';
import { useTranslation } from '../contexts/LanguageContext';
import { ChatInputBar, SelectedFileState } from './ChatInputBar';

interface DocumentInputProps {
  text: string;
  file: SelectedFileState | null;
  modePreference: 'AUTO' | AnalysisMode;
  isProcessing: boolean;
  onTextChange: (value: string) => void;
  onFileChange: (file: SelectedFileState | null) => void;
  onModeChange: (mode: 'AUTO' | AnalysisMode) => void;
  onSubmit: () => void;
}

export const DocumentInput: React.FC<DocumentInputProps> = ({
  text,
  file,
  modePreference,
  isProcessing,
  onTextChange,
  onFileChange,
  onModeChange,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto mt-8 lg:mt-16 px-4 transition-all">
      {/* Header */}
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

      <ChatInputBar
        text={text}
        onTextChange={onTextChange}
        file={file}
        onFileChange={onFileChange}
        modePreference={modePreference}
        onModeChange={onModeChange}
        isProcessing={isProcessing}
        onSubmit={onSubmit}
        placeholder="Paste or type text, or drop PDF/DOCX/TXT anywhere here. You can also click + to upload."
        hint="Drop a file here or use the + button."
        ctaLabel={t.analyzeBtn}
      />
    </div>
  );
};
