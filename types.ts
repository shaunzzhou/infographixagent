
export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  REVIEW = 'REVIEW',
  GENERATING_IMAGE = 'GENERATING_IMAGE',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

export type Language = 'en' | 'zh';

export interface DocumentInputData {
  type: 'text' | 'file';
  content: string; // The text content OR the base64 string
  mimeType?: string; // e.g. 'application/pdf'
  fileName?: string;
  templateData?: string; // Base64 of the style template
  templateMimeType?: string;
  templateFileName?: string; // Add template file name for display purposes
  userContext?: string; // Specific instructions from user
  
  // Visual Configuration
  aspectRatio?: string; // '1:1', '3:4', '4:3', '9:16', '16:9'
  imageSize?: string; // '1K', '2K'
}

export interface KeyPoint {
  title: string;
  description: string;
  category?: string; // Grouping (e.g. "Phase 1", "HR Dept")
}

// Three distinct modes as requested
export type AnalysisMode = 'AUTO_SUMMARY' | 'TARGETED_ANALYSIS' | 'CREATIVE_GENERATION';

export interface AnalysisResult {
  mode: AnalysisMode; 
  title: string; // Localized title
  summary: string;
  keyPoints: KeyPoint[];
  customVisualPrompt?: string; // Added: User overrides for visual generation
}

export interface GenerationResult {
  imageUrls: string[]; // Changed from single imageUrl to array
  textSummary: string;
  points: KeyPoint[];
}

export const AVAILABLE_TEMPLATES = [
  { 
      id: 'ns_black', 
      name: 'NS Black', 
      filename: 'ns_black_bg.png', 
      description: "", 
      style: "bg-slate-900 text-white" 
  },
  { 
      id: 'ns_white', 
      name: 'NS White', 
      filename: 'ns_white_bg.png', 
      description: "", 
      style: "bg-white border-b border-gray-200 text-slate-800"
  },
  { 
      id: 'aa', 
      name: 'AA', 
      filename: 'aa_bg.png', 
      description: "", 
      style: "bg-gradient-to-br from-blue-900 to-indigo-900 text-white"
  }
];
