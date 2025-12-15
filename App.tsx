
import React, { useState } from 'react';
import { AlertCircle, PieChart, Upload } from 'lucide-react';
import { AppState, AnalysisResult, DocumentInputData, AVAILABLE_TEMPLATES, AnalysisMode } from './types';
import { analyzeDocument, generateInfographicImage, generateInfographicPlan } from './services/gemini';
import { DocumentInput } from './components/DocumentInput';
import { AnalysisView } from './components/AnalysisView';
import { InfographicResult } from './components/InfographicResult';
import { useTranslation } from './contexts/LanguageContext';
import { SelectedFileState } from './components/ChatInputBar';

const App: React.FC = () => {
  const { language, setLanguage, t } = useTranslation();
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]); // Changed to array
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [planText, setPlanText] = useState<string | null>(null);

  // Lifted UI State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(AVAILABLE_TEMPLATES[0].id);
  const [aspectRatio, setAspectRatio] = useState<string>('3:4');
  // Shared chat input state (used on home + review)
  const [chatText, setChatText] = useState<string>('');
  const [chatFile, setChatFile] = useState<SelectedFileState | null>(null);
  const [chatMode, setChatMode] = useState<'AUTO' | AnalysisMode>('AUTO');
  
  // Store original config
  const [pendingInputConfig, setPendingInputConfig] = useState<DocumentInputData | null>(null);

  const buildPayloadFromChat = (): DocumentInputData => {
    const currentTemplate = AVAILABLE_TEMPLATES.find(t => t.id === selectedTemplateId) || AVAILABLE_TEMPLATES[0];
    const payload: DocumentInputData = {
      type: 'text',
      content: '',
      templateFileName: currentTemplate.filename
    };

    if (chatMode !== 'AUTO') {
      payload.preferredMode = chatMode;
    }

    if (chatFile) {
      if (chatFile.base64) {
        payload.type = 'file';
        payload.content = chatFile.base64;
        payload.mimeType = chatFile.type;
        payload.fileName = chatFile.name;
      } else if (chatFile.extractedText) {
        payload.type = 'text';
        payload.content = chatFile.extractedText;
        payload.fileName = chatFile.name;
      }
      // If user also typed something, treat it as context
      if (chatText.trim().length > 0) {
        payload.userContext = chatText.trim();
      }
    } else if (chatText.trim().length > 0) {
      payload.type = 'text';
      payload.content = chatText.trim();
    }

    return payload;
  };

  const handleAnalyzeFromChat = async () => {
    const payload = buildPayloadFromChat();
    // Guard: need content
    if (!payload.content) return;
    await handleAnalyze(payload);
  };

  // STEP 1: Analyze Document -> Review State
  const handleAnalyze = async (input: DocumentInputData) => {
    console.log("[App] handleAnalyze called with:", input);
    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setAnalysisData(null);
    setImageUrls([]);
    setPlanText(null);
    setPendingInputConfig(input);

    // If payload has a template (from auto-detect or default), sync our state
    if (input.templateFileName) {
        const match = AVAILABLE_TEMPLATES.find(t => t.filename === input.templateFileName);
        if (match) setSelectedTemplateId(match.id);
    }

    try {
      console.log("[App] Starting Analysis...");
      const data = await analyzeDocument(input, language); // Pass language
      setAnalysisData(data);
      setAppState(AppState.REVIEW); // Transition to Review
    } catch (err: any) {
      console.error("[App] Analysis Failed:", err);
      setAppState(AppState.ERROR);
      setErrorMsg(err.message || "Analysis failed.");
    }
  };

  // STEP 2: Generate Image from Reviewed Data
  const handleGenerateImage = async () => {
    if (!analysisData) return;

    console.log("[App] Starting Image Generation...");
    setAppState(AppState.GENERATING_IMAGE);
    setErrorMsg(null);
    setImageUrls([]); // Clear previous results
    setPlanText(null);
    
    try {
      // Find the currently selected template details
      const currentTemplate = AVAILABLE_TEMPLATES.find(t => t.id === selectedTemplateId) || AVAILABLE_TEMPLATES[0];

      // Merge current visual state with original input
      const finalTemplateConfig = {
          data: '', // We don't have the data here, the service loads it by filename usually
          mimeType: 'application/pdf',
          fileName: currentTemplate.filename
      };

      const visualConfig = {
          aspectRatio: aspectRatio, // '3:4' default
          imageSize: '1K'
      };
     
      let planText: string | null = null;
      try {
          planText = await generateInfographicPlan(analysisData, finalTemplateConfig, visualConfig, language);
          setPlanText(planText);
          console.log("[App] Infographic Plan:\n", planText);
      } catch (planErr) {
          console.warn("[App] Plan generation failed. Continuing without plan.", planErr);
      }
      
      const images = await generateInfographicImage(analysisData, finalTemplateConfig, visualConfig, language, planText || undefined);
      
      setImageUrls(images);
      setAppState(AppState.COMPLETE);
    } catch (err: any) {
      console.error("[App] Generation Failed:", err);
      setAppState(AppState.ERROR);
      setErrorMsg(err.message || "Generation failed.");
    }
  };

  const reset = () => {
    setAppState(AppState.IDLE);
    setAnalysisData(null);
    setImageUrls([]);
  };

  // --- RENDER CONTENT BASED ON STATE ---
  const renderContent = () => {
      switch (appState) {
          case AppState.IDLE:
              return (
                <DocumentInput 
                  text={chatText}
                  file={chatFile}
                  modePreference={chatMode}
                  isProcessing={appState === AppState.ANALYZING}
                  onTextChange={setChatText}
                  onFileChange={setChatFile}
                  onModeChange={setChatMode}
                  onSubmit={handleAnalyzeFromChat}
                />
              );
          
          case AppState.ANALYZING:
              // Show Analysis View in loading state
               return (
                  <AnalysisView 
                    data={{ title: "", summary: "", keyPoints: [], mode: 'AUTO_SUMMARY' }}
                    isLoading={true}
                    onDataChange={() => {}}
                    onGenerate={() => {}}
                    onBack={reset}
                    selectedTemplateId={selectedTemplateId}
                    onTemplateChange={setSelectedTemplateId}
                    aspectRatio={aspectRatio}
                    onAspectRatioChange={setAspectRatio}
                    chatText={chatText}
                    chatFile={chatFile}
                    chatModePreference={chatMode}
                    onChatTextChange={setChatText}
                    onChatFileChange={setChatFile}
                    onChatModeChange={setChatMode}
                    onChatSubmit={handleAnalyzeFromChat}
                    isChatProcessing={true}
                  />
               );

          case AppState.REVIEW:
              if (!analysisData) return null;
              return (
                  <AnalysisView 
                    data={analysisData}
                    isLoading={false}
                    onDataChange={setAnalysisData}
                    onGenerate={handleGenerateImage}
                    onBack={reset}
                    selectedTemplateId={selectedTemplateId}
                    onTemplateChange={setSelectedTemplateId}
                    aspectRatio={aspectRatio}
                    onAspectRatioChange={setAspectRatio}
                    chatText={chatText}
                    chatFile={chatFile}
                    chatModePreference={chatMode}
                    onChatTextChange={setChatText}
                    onChatFileChange={setChatFile}
                    onChatModeChange={setChatMode}
                    onChatSubmit={handleAnalyzeFromChat}
                    isChatProcessing={appState === AppState.ANALYZING}
                  />
              );

          case AppState.GENERATING_IMAGE:
          case AppState.COMPLETE:
              return (
                  <div className="w-full h-full lg:h-[calc(100vh-80px)] max-w-[1800px] mx-auto p-4 flex flex-col">
                      <div className="w-full flex justify-between items-center mb-4 flex-none">
                         <span className="text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-wider block">
                            {t.studioWorkspace}
                         </span>

                         <button 
                            onClick={reset} 
                            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white transition-all shadow-sm flex items-center gap-2 text-xs font-bold"
                         >
                            <Upload className="w-3.5 h-3.5" /> {t.startNew}
                         </button>
                      </div>
                      
                      {/* Studio Container - Flexible Height */}
                      <div className="flex-1 min-h-[600px] lg:min-h-0">
                        <InfographicResult 
                            imageUrls={imageUrls} 
                            isLoading={appState === AppState.GENERATING_IMAGE}
                            data={analysisData}
                            onDataChange={(newData) => setAnalysisData(newData)}
                            onRegenerate={handleGenerateImage}
                            aspectRatio={aspectRatio}
                            onAspectRatioChange={setAspectRatio}
                            selectedTemplateId={selectedTemplateId}
                            onTemplateChange={setSelectedTemplateId}
                            planText={planText || undefined}
                        />
                      </div>
                  </div>
              );

          case AppState.ERROR:
              return (
                <div className="max-w-xl mx-auto mt-20 p-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/50 rounded-lg flex flex-col items-center text-center">
                    <AlertCircle className="w-10 h-10 text-red-500 dark:text-red-400 mb-4" />
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-200">{t.error}</h3>
                    <p className="text-red-700 dark:text-red-300 mt-2 mb-6">{errorMsg}</p>
                    <button onClick={reset} className="px-6 py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors">
                        {t.startOver}
                    </button>
                </div>
              );
              
          default:
              return null;
      }
  };

  return (
    // Changed bg-blue-ish to bg-slate-50 (Zinc 50) and dark:bg-slate-950 (Zinc 950)
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 font-sans selection:bg-slate-200 dark:selection:bg-slate-700 flex flex-col transition-colors duration-300">
      <style>{`@keyframes fadeSlideIn { from { opacity: 0; transform: translateY(12px);} to { opacity: 1; transform: translateY(0);} }`}</style>
      
      {/* Global Header */}
      <header className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 sticky top-0 z-50 flex-none transition-colors duration-300">
        <div className="w-full max-w-[1800px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
             <div className="w-7 h-7 bg-slate-900 dark:bg-white rounded-md flex items-center justify-center text-white dark:text-slate-950 font-bold shadow-sm">
                <PieChart className="w-4 h-4" />
             </div>
             <span className="font-bold text-base text-slate-900 dark:text-white tracking-tight">{t.appTitle}</span>
          </div>
          
          {/* Segmented Control Language Switcher */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors">
            <button
              onClick={() => setLanguage('en')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                language === 'en'
                  ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setLanguage('zh')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                language === 'zh'
                  ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              中文
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`w-full flex-1 ${appState === AppState.COMPLETE ? 'overflow-hidden' : 'pb-10'} overflow-hidden`}>
        <div style={{ animation: 'fadeSlideIn 0.35s ease' }}>
          {renderContent()}
        </div>
      </main>

    </div>
  );
};

export default App;
