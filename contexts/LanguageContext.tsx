import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Language } from '../types';

const translations = {
  en: {
    // App
    appTitle: "InfoGraphix Agent",
    secure: "Secure & Enterprise Ready",
    
    // DocumentInput
    heroTitlePrefix: "Generate",
    heroTitleSuffix: "Infographics",
    heroSubtitle: "In Seconds",
    heroDesc: "Upload your financial reports, technical documentation, or meeting notes. Our AI converts them into an professional infographic image.",
    uploadDoc: "Upload Document",
    dragDrop: "Drag & drop your PDF, DOCX, or MD file here, or click to browse.",
    selectDoc: "Upload Document",
    pasteText: "Paste Text",
    ready: "Ready to process",
    typePlaceholder: "Type or paste your content here...",
    chars: "characters",
    optionalContext: "Optional: Add specific instructions (e.g. 'Focus on Q3 results')...",
    analyzeBtn: "Analyze & Generate",
    processing: "Processing",
    cancel: "Cancel",
    clear: "Clear File",
    
    // AnalysisView
    analyzingTitle: "Analyzing Document...",
    analyzingDesc: "Extracting key insights and structuring your image.",
    backUpload: "Back to Upload",
    reviewTitle: "Review Infographic Plan",
    reviewSubtitle: "Edit structure and select a brand style before generation.",
    creativeMode: "Creative Mode",
    researchMode: "Research Mode",
    summaryMode: "Summary Mode",
    generateBtn: "Generate Infographic",
    selectStyle: "Select Brand",
    canvasFormat: "Canvas Format",
    visualInst: "Visual Instructions (Optional)",
    visualPlaceholder: "Describe the subject matter you want to see (e.g., 'A golden horse', 'Global network map'). The AI will render this object using your selected Brand Style.",
    visualTip: "The AI will interpret your request through the lens of the Brand Template (e.g. A 'Red Holiday' theme will be applied as red lighting effects on the corporate background).",
    editContent: "Edit Content",
    cover: "Cover",
    headline: "Headline",
    subtitle: "Subtitle / Abstract",
    posterActive: "Poster Layout Active",
    posterDesc: "The AI detected a creative prompt. It will generate a high-impact poster focusing on your Headline and Subtitle, without bullet points.",
    wantStandard: "Want a standard infographic instead? Click \"Add Infographic Section\" below.",
    addSection: "Add Infographic Section",
    content: "Content",
    deleteSection: "Delete",

    // Result
    designingTitle: "Designing Infographic...",
    designingDesc: "Applying brand styles, arranging layout, and rendering visuals.",
    noGen: "No infographic generated yet.",
    finalOutput: "Final Output",
    download: "Download PNG",
    downloadAll: "Download All (ZIP)",
    refineResult: "Refine Result",
    textContent: "Text Content",
    updateRegenerate: "Update & Regenerate",
    studioWorkspace: "Studio Workspace",
    startNew: "Start New Upload",
    
    // Common
    error: "Something went wrong",
    startOver: "Start Over"
  },
  zh: {
    appTitle: "InfoGraphix 智能助手",
    secure: "安全 & 企业级就绪",
    
    heroTitlePrefix: "生成",
    heroTitleSuffix: "信息图",
    heroSubtitle: "秒级生成",
    heroDesc: "上传财务报告、技术文档或会议纪要，AI 即可将其转化为专业的信息图表。",
    uploadDoc: "上传文档",
    dragDrop: "拖放 PDF, DOCX 或 MD 文件到此处，或点击浏览。",
    selectDoc: "上传文档",
    pasteText: "粘贴文本",
    ready: "准备处理",
    typePlaceholder: "在此处输入或粘贴内容...",
    chars: "字符",
    optionalContext: "可选：添加具体指令（例如“关注第三季度结果”）...",
    analyzeBtn: "分析并生成",
    processing: "处理中",
    cancel: "取消",
    clear: "清除文件",
    
    analyzingTitle: "正在分析文档...",
    analyzingDesc: "正在提取关键见解并构建演示结构。",
    backUpload: "返回上传",
    reviewTitle: "审查信息图方案",
    reviewSubtitle: "在生成之前编辑结构并选择样式。",
    creativeMode: "创意模式",
    researchMode: "研究模式",
    summaryMode: "摘要模式",
    generateBtn: "生成信息图",
    selectStyle: "选择品牌",
    canvasFormat: "画布格式",
    visualInst: "视觉指令（可选）",
    visualPlaceholder: "描述您希望看到的主题（例如，“一匹金马”，“全球网络图”）。AI 将使用您选择的品牌风格渲染此对象。",
    visualTip: "AI 将通过品牌模板的视角解读您的请求（例如，“红色节日”主题将作为红色灯光效果应用到企业背景上）。",
    editContent: "编辑内容",
    cover: "封面",
    headline: "标题",
    subtitle: "副标题 / 摘要",
    posterActive: "海报布局已激活",
    posterDesc: "AI 检测到创意提示。它将生成一个高影响力的海报，专注于您的标题和副标题，没有项目符号。",
    wantStandard: "想要标准信息图？点击下方的“添加信息图部分”。",
    addSection: "添加信息图部分",
    content: "内容",
    deleteSection: "删除",

    designingTitle: "正在设计信息图...",
    designingDesc: "正在应用品牌风格、排列布局并渲染视觉效果。",
    noGen: "尚未生成信息图。",
    finalOutput: "最终产出",
    download: "下载 PNG",
    downloadAll: "全部下载 (ZIP)",
    refineResult: "优化结果",
    textContent: "文本内容",
    updateRegenerate: "更新并重新生成",
    studioWorkspace: "工作室工作区",
    startNew: "开始新上传",

    error: "出错了",
    startOver: "重新开始"
  }
};

type Translations = typeof translations.en;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('en');

  const value = {
    language,
    setLanguage,
    t: translations[language]
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};