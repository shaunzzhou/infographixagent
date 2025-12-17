
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, DocumentInputData, AnalysisMode, Language } from "../types";

type TemplateSelectionConfig = {
    fileName?: string;
    brandId?: string;
    [key: string]: any;
};

type VisualConfig = {
    aspectRatio: string;
    [key: string]: any;
};

interface BrandAssetConfig {
    name: string;
    promptPath: string;
    lookup: string[];
}

const MIN_SELECTED_ASSETS = 3;

// --- BRAND ASSET CONFIGURATION ---
const BRAND_ASSETS: Record<string, BrandAssetConfig> = {
    'ns_black': {
        name: 'Northstar',
        promptPath: '/template-new/ns_black/prompt_template.txt',
        lookup: ['ns_black', 'Northstar Black']
    },
    'ns_white': {
        name: 'Northstar',
        promptPath: '/template-new/ns_white/prompt_template.txt',
        lookup: ['ns_white', 'Northstar White']
    },
    'aa': {
        name: 'Antalpha',
        promptPath: '/template-new/aa/prompt_template.txt',
        lookup: ['aa/', 'aa_', 'antalpha']
    },
    'es': {
        name: 'ElevateSphere',
        promptPath: '/template-new/es/prompt_template.txt',
        lookup: ['es/', 'es_', 'ElevateSphere']
    }
};

interface TemplateAssetEntry {
    relativePath: string;
    fullPath: string;
    description: string;
}

interface TemplateLibraryData {
    rootPath: string;
    rawText: string;
    usageGuidance: string[];
    assets: TemplateAssetEntry[];
}

const templateLibraryCache: Record<string, TemplateLibraryData> = {};
const templateAssetDataCache: Record<string, { data: string; mimeType: string }> = {};

// Helper to find example images from asset list
const findExampleAssets = (assets: TemplateAssetEntry[], maxExamples: number = 2): TemplateAssetEntry[] => {
    // Look for assets in "Examples/" folder or with "example" in the name
    const examples = assets.filter(a => 
        a.relativePath.toLowerCase().includes('example') && 
        !a.relativePath.includes('_pdf/') // Skip the PDF page extracts, prefer standalone examples
    );
    
    // Prefer standalone example images (aa_example1.png) over PDF pages
    const standalone = examples.filter(e => !e.relativePath.includes('/aa_example_pdf'));
    const toUse = standalone.length > 0 ? standalone : examples;
    
    return toUse.slice(0, maxExamples);
};

const joinTemplatePath = (root: string, relative: string) => {
    if (!relative) return (root || '').trim();
    if (relative.startsWith('/')) return relative;
    const base = (root || '').replace(/\/$/, '');
    return `${base}/${relative.replace(/^\//, '')}`;
};

const parseTemplateLibrary = (text: string): TemplateLibraryData => {
    const lines = text.split(/\r?\n/);
    let rootPath = '';
    const usage: string[] = [];
    const assets: TemplateAssetEntry[] = [];
    let section: 'usage' | 'assets' | null = null;

    for (const line of lines) {
        if (line.startsWith('Template Root:')) {
            rootPath = line.split(':', 2)[1]?.trim() || rootPath;
            continue;
        }
        if (line.startsWith('Usage guidance:')) {
            section = 'usage';
            continue;
        }
        if (line.startsWith('Assets:')) {
            section = 'assets';
            continue;
        }
        if (section === 'usage') {
            if (line.trim().startsWith('-')) usage.push(line.trim());
            continue;
        }
        if (section === 'assets') {
            const trimmed = line.trim();
            if (!trimmed.startsWith('- ')) continue;
            const entry = trimmed.slice(2);
            const sourceIdx = entry.indexOf(' (source:');
            const descIdx = entry.indexOf('::');
            let relativePath: string;
            if (sourceIdx !== -1) relativePath = entry.slice(0, sourceIdx).trim();
            else if (descIdx !== -1) relativePath = entry.slice(0, descIdx).trim();
            else relativePath = entry.trim();
            const description = descIdx !== -1 ? entry.slice(descIdx + 2).trim() : '';
            const sanitized = relativePath.replace(/^\//, '');
            assets.push({
                relativePath: sanitized,
                fullPath: joinTemplatePath(rootPath, sanitized),
                description
            });
        }
    }

    return {
        rootPath: rootPath || '',
        rawText: text,
        usageGuidance: usage,
        assets
    };
};

const resolveBrandKey = (templateConfig: TemplateSelectionConfig): string => {
    if (templateConfig.brandId && BRAND_ASSETS[templateConfig.brandId]) {
        return templateConfig.brandId;
    }
    if (templateConfig.fileName) {
        const entry = Object.entries(BRAND_ASSETS).find(([, asset]) =>
            asset.lookup.some(token => templateConfig.fileName?.toLowerCase().includes(token.toLowerCase()))
        );
        if (entry) return entry[0];
    }
    return 'ns_black';
};

const fetchTemplateLibrary = async (brandKey: string): Promise<TemplateLibraryData | null> => {
    if (templateLibraryCache[brandKey]) return templateLibraryCache[brandKey];
    const asset = BRAND_ASSETS[brandKey];
    if (!asset?.promptPath) return null;
    try {
        const response = await fetch(asset.promptPath);
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }
        const text = (await response.text()).trim();
        const parsed = parseTemplateLibrary(text);
        templateLibraryCache[brandKey] = parsed;
        return parsed;
    } catch (err) {
        console.warn(`[Template] Failed to load prompt template for ${brandKey}:`, err);
        return null;
    }
};

const fetchTemplateAssetInlineData = async (path: string) => {
    if (templateAssetDataCache[path]) return templateAssetDataCache[path];
    const data = await fetchAssetAsBase64(path);
    if (data) {
        templateAssetDataCache[path] = data;
        return data;
    }
    return null;
};

const buildAttachmentParts = async (
    library?: TemplateLibraryData | null,
    selectedAssets?: TemplateAssetEntry[]
) => {
    if (!library) return [];
    const targets = selectedAssets && selectedAssets.length > 0 ? selectedAssets : library.assets;
    const results = await Promise.all(targets.map(async (asset) => {
        const inlineData = await fetchTemplateAssetInlineData(asset.fullPath);
        if (!inlineData) return null;
        return {
            part: { inlineData },
            meta: asset
        };
    }));
    return results.filter((entry): entry is { part: { inlineData: { mimeType: string; data: string } }; meta: TemplateAssetEntry } => Boolean(entry));
};

const extractSelectedAssetPaths = (planText: string): string[] => {
    if (!planText) return [];
    const marker = 'SELECTED_ASSETS:';
    const idx = planText.indexOf(marker);
    if (idx === -1) return [];
    const lines = planText.slice(idx + marker.length).split(/\r?\n/);
    const paths: string[] = [];
    // File extension pattern to filter out non-file entries (e.g., "Custom Visual Overlay")
    const fileExtPattern = /\.(png|jpg|jpeg|gif|svg|pdf|webp)$/i;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('-')) break;
        const withoutDash = trimmed.replace(/^-\s*/, '');
        const [path] = withoutDash.split('::');
        const cleanPath = path?.trim();
        // Only include paths that look like actual files
        if (cleanPath && fileExtPattern.test(cleanPath)) {
            paths.push(cleanPath);
        }
    }
    return paths;
};

const resolveAssetsForPlan = (
    library: TemplateLibraryData | null,
    planText?: string
): TemplateAssetEntry[] => {
    if (!library) {
        console.log('[Assets] No library provided');
        return [];
    }
    if (!planText) {
        console.log('[Assets] No planText provided - returning ALL assets');
        return library.assets;
    }
    const requested = extractSelectedAssetPaths(planText);
    console.log('[Assets] Extracted from SELECTED_ASSETS:', requested);
    if (!requested.length) {
        console.log('[Assets] No assets extracted from plan - returning ALL assets');
        return library.assets;
    }
    const normalized = requested.map(p => p.toLowerCase());
    const matches = library.assets.filter(asset => {
        const rel = asset.relativePath.toLowerCase();
        const file = rel.split('/').pop() || rel;
        // More flexible matching: exact match OR filename match OR partial path match
        return normalized.some(req => {
            const reqFile = req.split('/').pop() || req;
            return req === rel || req === file || reqFile === file || rel.includes(req) || req.includes(file);
        });
    });
    
    // ALWAYS ensure we have a template background and logo, regardless of match count
    const hasTemplate = matches.some(m => 
        m.relativePath.includes('_template/') || m.relativePath.includes('_bg')
    );
    const hasLogo = matches.some(m => 
        m.relativePath.toLowerCase().includes('logo')
    );
    
    // Find and add missing essential assets
    if (!hasTemplate) {
        const templateBg = library.assets.find(a => 
            a.relativePath.includes('_template/') || a.relativePath.includes('_bg')
        );
        if (templateBg) {
            console.log(`[Assets] Adding missing template: ${templateBg.relativePath}`);
            matches.unshift(templateBg); // Add at beginning so it's [File Input 1]
        }
    }
    
    if (!hasLogo) {
        const logo = library.assets.find(a => 
            a.relativePath.toLowerCase().includes('logo')
        );
        if (logo) {
            console.log(`[Assets] Adding missing logo: ${logo.relativePath}`);
            matches.push(logo);
        }
    }
    
    console.log(`[Assets] Matched ${matches.length} assets:`, 
        matches.map(m => m.relativePath));
    
    // If we successfully matched ANY assets from the plan, use them
    // Don't fallback to ALL assets - respect the planner's selection
    if (matches.length > 0) {
        console.log('[Assets] Using matched assets from plan');
        return matches;
    }
    
    // Only fallback to all assets if we matched nothing at all
    console.log('[Assets] No matches found - returning ALL assets as fallback');
    return library.assets;
};

/**
 * Helper to fetch and convert an asset file (Image or PDF) to base64
 */
const fetchAssetAsBase64 = async (path: string): Promise<{ data: string, mimeType: string } | null> => {
    try {
        console.log(`[Asset] Fetching: ${path}`);
        const response = await fetch(path);
        if (!response.ok) {
            console.log(`[Asset] Note: Could not load ${path} - proceeding without it.`);
            return null;
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            return null;
        }

        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        
        let mimeType = contentType || 'image/png';
        if (path.endsWith('.pdf')) mimeType = 'application/pdf';
        else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (path.endsWith('.png')) mimeType = 'image/png';
        
        return { data: base64, mimeType };
    } catch (e) {
        console.warn(`[Asset] Error fetching ${path}:`, e);
        return null;
    }
};

/**
 * Robust JSON Parser with Auto-Repair for truncated responses
 */
const safeJsonParse = (text: string): any => {
    if (!text) return {};

    // 1. Remove Markdown code blocks if present
    let clean = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    
    // 2. Find the outer-most JSON object
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    
    if (start !== -1 && end !== -1) {
        clean = clean.substring(start, end + 1);
    } else {
        // Fallback for simple string responses if the model refuses to output JSON
        if (clean.length < 50 && !clean.includes(':')) {
             return { inputType: "UNKNOWN" };
        }
    }

    // 3. Attempt parsing with error recovery
    try {
        return JSON.parse(clean);
    } catch (e: any) {
        console.warn(`[JSON] Standard parse failed (${e.message}). Attempting repair...`);
        const repairs = [
            clean + '"}',         
            clean + '"]}',        
            clean + '}]}'         
        ];
        for (const fixed of repairs) {
            try { return JSON.parse(fixed); } catch (err) {}
        }
        throw new Error("The AI response was incomplete. Please try analyzing a shorter section.");
    }
};

/**
 * Failsafe to prevent UI breaking from massive LLM hallucinations
 */
const sanitizeResult = (result: AnalysisResult): AnalysisResult => {
    return {
        ...result,
        title: result.title?.substring(0, 100).replace(/[\r\n]+/g, " ").trim() || "Untitled",
        summary: result.summary?.substring(0, 300).replace(/[\r\n]+/g, " ").trim() || "",
        keyPoints: result.keyPoints?.map(kp => ({
            title: kp.title?.substring(0, 100).trim() || "",
            description: kp.description?.substring(0, 500).trim() || "",
            category: kp.category
        })) || [],
        // Preserve or init customVisualPrompt
        customVisualPrompt: result.customVisualPrompt || ""
    };
};

/**
 * INTENT ROUTER: heuristics-first, LLM fallback (no confidence values)
 */
const determineIntent = async (input: DocumentInputData, language: Language = 'en'): Promise<AnalysisMode> => {
    console.log("[Router] Evaluating intent...");

    // User override always wins
    if (input.preferredMode) {
        console.log(`[Router] User override: ${input.preferredMode}`);
        return input.preferredMode;
    }

    const content = input.content || "";
    const userContext = input.userContext || "";
    const combined = `${content}\n${userContext}`.trim();
    const length = combined.length;

    const isQuestionLike = (text: string) => {
        const lower = text.toLowerCase();
        return /[\?？]/.test(text) || /^(who|what|when|where|why|how|which|can|should)\b/.test(lower);
    };

    const isCreativeLike = (text: string) => {
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const creativeKeywords = /(poster|banner|greeting|happy|welcome|celebrat|launch|招募|招聘|欢迎|庆祝|海报|宣传|贺|新年|春节|祝)/i;
        // Short headline-ish text with creative cue words
        return wordCount > 0 && wordCount <= 25 && creativeKeywords.test(text);
    };

    // 1) File inputs: default to summary unless strong context
    if (input.type === 'file') {
        const mode = userContext.trim().length > 0 ? 'TARGETED_ANALYSIS' : 'AUTO_SUMMARY';
        console.log(`[Router] File input → ${mode}`);
        return mode;
    }

    // 2) Context differs from content → targeted
    if (content && userContext && content !== userContext) {
        console.log("[Router] Context differs from content → TARGETED_ANALYSIS");
        return 'TARGETED_ANALYSIS';
    }

    // 3) Clear question → targeted
    if (isQuestionLike(combined)) {
        console.log("[Router] Question-like input → TARGETED_ANALYSIS");
        return 'TARGETED_ANALYSIS';
    }

    // 4) Short creative-ish → creative
    if (isCreativeLike(combined)) {
        console.log("[Router] Creative-like short text → CREATIVE_GENERATION");
        return 'CREATIVE_GENERATION';
    }

    // 5) Ambiguous → LLM classification to the 3 modes
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            config: {
                thinkingConfig: {
                    thinkingBudget: 0
                },
                responseMimeType: "application/json",
                temperature: 0.0,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        mode: { 
                            type: Type.STRING,
                            enum: ["CREATIVE_GENERATION", "TARGETED_ANALYSIS", "AUTO_SUMMARY"]
                        }
                    }
                }
            },
            contents: [{
                role: "user",
                parts: [{
                    text: `Classify this input into exactly one mode: CREATIVE_GENERATION (poster-like short slogans/visual asks), TARGETED_ANALYSIS (questions with specific focus), or AUTO_SUMMARY (longer documents to summarize). Reply ONLY with JSON.\nInput:\n"${combined.substring(0, 800)}"`
                }]
            }]
        });
        const result = safeJsonParse(response.text);
        if (result.mode === 'CREATIVE_GENERATION' || result.mode === 'TARGETED_ANALYSIS' || result.mode === 'AUTO_SUMMARY') {
            console.log(`[Router] LLM classified → ${result.mode}`);
            return result.mode;
        }
        console.warn("[Router] LLM returned unexpected mode, falling back to AUTO_SUMMARY");
    } catch (e) {
        console.warn("[Router] LLM classification failed, defaulting to AUTO_SUMMARY.", e);
    }

    return 'AUTO_SUMMARY';
};

/**
 * MAIN: Analyze Document (Text or File) with Retry Logic
 */
export const analyzeDocument = async (input: DocumentInputData, language: Language = 'en'): Promise<AnalysisResult> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelId = "gemini-2.5-flash"; // Fast, structured model

    // 1. Determine Intent
    const mode = await determineIntent(input, language);

    // 2. Prepare System Instruction
    let systemInstruction = "";
    const languageInstruction = language === 'zh' ? "OUTPUT LANGUAGE: Simplified Chinese (zh-CN)." : "OUTPUT LANGUAGE: English.";
    
    if (mode === 'CREATIVE_GENERATION') {
        // --- CREATIVE MODE: ROBUST HANDLING FOR SLOGANS VS COMMANDS ---
        systemInstruction = `
            ROLE: Creative Director & Visual Planner.
            TASK: Transform the user's request into a Visual Poster Plan.
            ${languageInstruction}
            
            INPUT ANALYSIS STRATEGY:
            - If input is a SHORT SLOGAN or GREETING (e.g. "Happy New Year 2026", "Welcome"): 
              -> Use the input text VERBATIM as the "title".
              -> Do NOT summarize it.
            - If input is a COMMAND (e.g. "Make a poster about safety"):
              -> Extract the core topic as the "title".
            
            OUTPUT JSON FORMAT:
            {
              "title": "The main headline text (Max 10 words)",
              "summary": "A short supporting subtitle or slogan (Max 20 words)",
              "visualIdeas": "Detailed instructions for the PAINTER. Describe imagery, mood, colors, objects. (e.g. 'Red background, golden dragon, festive fireworks')",
              "keyPoints": [] 
            }
            
            CRITICAL RULES:
            1. visualIdeas MUST describe *visuals* (what to see), NOT text.
            2. keyPoints MUST be empty [].
            3. Title MUST be the actual text intended for the poster.
        `;
    } else if (mode === 'TARGETED_ANALYSIS') {
        systemInstruction = `
            ROLE: Senior Financial Analyst.
            TASK: Extract specific answers based on the User's Context/Question.
            ${languageInstruction}
            
            RULES:
            1. Title: Short label.
            2. Summary: Direct answer (max 50 words).
            3. KeyPoints: 3-5 evidence points.
            
            OUTPUT FORMAT (JSON):
            { "title": "...", "summary": "...", "keyPoints": [{ "title": "...", "description": "..." }] }
        `;
    } else {
        systemInstruction = `
            ROLE: Executive Assistant.
            TASK: Summarize the provided document.
            ${languageInstruction}
            
            RULES:
            1. Title: Professional title.
            2. Summary: Executive summary (max 40 words).
            3. KeyPoints: Exactly 3-4 crucial takeaways.
            
            OUTPUT FORMAT (JSON):
            { "title": "...", "summary": "...", "keyPoints": [{ "title": "...", "description": "..." }] }
        `;
    }

    // 3. Prepare Content
    const contents = [];
    if (input.type === 'file' && input.mimeType) {
        contents.push({
            role: 'user',
            parts: [
                { inlineData: { mimeType: input.mimeType, data: input.content } },
                { text: input.userContext ? `Focus on: ${input.userContext}` : "Analyze this document." }
            ]
        });
    } else {
        contents.push({
            role: 'user',
            parts: [{ text: `INPUT TEXT:\n${input.content}\n\nCONTEXT:\n${input.userContext || 'None'}` }]
        });
    }

    // 4. Execute with Retry
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            console.log(`[Analyst] Sending request to ${modelId} (Attempt ${attempt + 1})...`);
            
            const response = await ai.models.generateContent({
                model: modelId,
                contents: contents,
                config: {
                    thinkingConfig: {
                        thinkingBudget: 0
                    },
                    systemInstruction: systemInstruction,
                    temperature: 0.2,
                    maxOutputTokens: 2000,
                    responseMimeType: "application/json"
                }
            });

            const json = safeJsonParse(response.text);
            
            // MAP visualIdeas to customVisualPrompt if in creative mode
            if (mode === 'CREATIVE_GENERATION' && json.visualIdeas) {
                json.customVisualPrompt = json.visualIdeas;
            }

            const sanitized = sanitizeResult(json);
            
            return {
                ...sanitized,
                mode: mode
            };

        } catch (e: any) {
            console.warn(`[Analyst] Attempt ${attempt + 1} failed:`, e);
            lastError = e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    throw lastError || new Error("Failed to analyze document after retries.");
};

/**
 * Template Selection Agent: Uses LLM to select the most relevant templates
 * based on user's mode, text content, and template descriptions
 */
const selectRelevantTemplatesWithLLM = async (
    mode: string,
    textContent: string,
    promptTemplateContent: string,
    availableAssets: TemplateAssetEntry[]
): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelId = "gemini-2.5-flash";

    // Extract only template assets (not logos, examples, backgrounds)
    const templates = availableAssets.filter(a => 
        a.relativePath.includes('_template/') && !a.relativePath.includes('_bg')
    );

    if (templates.length === 0) {
        console.log('[Template Selection] No templates found, returning empty');
        return [];
    }

    // Build a catalog of templates with their "Recommended use" descriptions
    const templateCatalog = templates.map((t, idx) => {
        return `${idx + 1}. ${t.relativePath}\n   Description: ${t.description}`;
    }).join('\n\n');

    const prompt = `You are a template selection expert. Your job is to select the 2-3 MOST RELEVANT templates for the user's content.

USER'S CONTENT MODE: ${mode}
USER'S TEXT CONTENT: "${textContent}"

AVAILABLE TEMPLATES:
${templateCatalog}

INSTRUCTIONS:
1. Read the user's content and mode carefully
2. Look at each template's description and "Recommended use"
3. Select 2-3 templates that are MOST SUITABLE for this content
4. Consider:
   - If mode is "CREATIVE" or "POSTER" → prefer templates with bold visuals, gradients, dynamic layouts
   - If mode is "FOCUSED_ANALYSIS" → prefer templates with data visualization, charts, clean text layouts
   - Match the content type (title page? data analysis? feature showcase? process diagram?)

OUTPUT FORMAT (plain text, one filename per line, NO extra text):
template_folder/template_name.png
template_folder/template_name2.png
template_folder/template_name3.png

EXAMPLE OUTPUT:
aa_template/aa_template_p0.png
aa_template/aa_template_p9.png

Now output 2-3 template filenames (ONLY filenames, one per line, no numbering, no extra text):`;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.3,
            }
        });

        const resultText = response.text?.trim() || '';
        console.log('[Template Selection] LLM raw response:', resultText);

        // Parse the response - extract filenames
        const lines = resultText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const selectedFilenames: string[] = [];

        for (const line of lines) {
            // Look for template filenames in the line
            const template = templates.find(t => line.includes(t.relativePath));
            if (template && !selectedFilenames.includes(template.relativePath)) {
                selectedFilenames.push(template.relativePath);
            }
        }

        console.log('[Template Selection] Selected templates:', selectedFilenames);

        // Ensure we have at least 1 and at most 3
        if (selectedFilenames.length === 0) {
            console.log('[Template Selection] No valid templates selected, falling back to first template');
            return [templates[0].relativePath];
        }

        return selectedFilenames.slice(0, 3);

    } catch (error) {
        console.error('[Template Selection] Error:', error);
        // Fallback: return first template
        return [templates[0].relativePath];
    }
};

/**
 * Helper to select key visual assets for planner preview
 * Returns a curated set: specific templates (from LLM selection), logo, and examples
 */
const selectPlannerPreviewAssets = (assets: TemplateAssetEntry[], selectedTemplateFilenames: string[]): TemplateAssetEntry[] => {
    const result: TemplateAssetEntry[] = [];
    
    // 1. Get only the LLM-selected templates
    if (selectedTemplateFilenames.length > 0) {
        selectedTemplateFilenames.forEach(filename => {
            const template = assets.find(a => a.relativePath === filename);
            if (template && !result.some(r => r.relativePath === template.relativePath)) {
                result.push(template);
            }
        });
    }
    
    // Fallback: if no templates were found, use first available template
    if (result.length === 0) {
        const templates = assets.filter(a => 
            a.relativePath.includes('_template/') || a.relativePath.includes('_bg')
        );
        if (templates.length > 0) {
            result.push(templates[0]);
        }
    }
    
    // 2. Get logo (prefer color version)
    const logos = assets.filter(a => a.relativePath.toLowerCase().includes('logo'));
    const colorLogo = logos.find(l => 
        !l.relativePath.includes('white') && !l.relativePath.includes('black')
    ) || logos[0];
    if (colorLogo && !result.some(r => r.relativePath === colorLogo.relativePath)) {
        result.push(colorLogo);
    }
    
    // 3. Get examples (if available, max 2)
    const examples = findExampleAssets(assets, 2);
    examples.forEach(e => {
        if (!result.some(r => r.relativePath === e.relativePath)) {
            result.push(e);
        }
    });
    
    return result;
};

/**
 * Generate a full infographic plan in text format using Gemini.
 */
export const generateInfographicPlan = async (
    data: AnalysisResult,
    templateConfig: TemplateSelectionConfig,
    visualConfig: VisualConfig,
    language: Language = 'en'
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelId = "gemini-2.5-flash";

    const assetKey = resolveBrandKey(templateConfig);
    const assets = BRAND_ASSETS[assetKey];
    console.log(`[Planner] Using assets for: ${assets.name} (${assetKey})`);

    const templateLibrary = await fetchTemplateLibrary(assetKey);
    const availableAssets = templateLibrary?.assets || [];

    const ratio = visualConfig.aspectRatio || '3:4';
    const [widthRatio, heightRatio] = ratio.split(':').map(n => parseFloat(n)) as [number, number];
    const orientation = widthRatio >= heightRatio ? 'Landscape' : 'Portrait';

    // 🆕 STEP 1: Template Selection Agent - Let LLM choose relevant templates
    const userText = data.title || data.summary || '';
    const userMode = data.mode || 'AUTO';
    const promptTemplateText = templateLibrary?.rawText || '';
    
    console.log(`[Template Selection] Calling LLM to select templates for mode="${userMode}", text="${userText.slice(0, 100)}..."`);
    const selectedTemplateFilenames = await selectRelevantTemplatesWithLLM(
        userMode,
        userText,
        promptTemplateText,
        availableAssets
    );
    console.log(`[Template Selection] LLM selected ${selectedTemplateFilenames.length} templates:`, selectedTemplateFilenames);

    // STEP 2: Select key assets to show the planner (LLM-selected templates + logo + examples)
    const previewAssets = selectPlannerPreviewAssets(availableAssets, selectedTemplateFilenames);
    const previewAttachments = await buildAttachmentParts(templateLibrary, previewAssets);
    
    console.log(`[Planner] Attaching ${previewAttachments.length} preview images:`, 
        previewAssets.map(a => a.relativePath));

    const assetCatalogText = availableAssets.length > 0
        ? availableAssets.map((asset, idx) => `${idx + 1}. ${asset.relativePath} :: ${asset.description}`).join('\n')
        : "No cataloged assets.";

    const usageGuidanceText = templateLibrary?.usageGuidance?.length
        ? templateLibrary.usageGuidance.join('\n')
        : "No special usage notes.";

    // Build visual reference section for the prompt
    const visualRefSection = previewAttachments.length > 0
        ? `\n📸 VISUAL REFERENCES ATTACHED (study these carefully before planning):
${previewAttachments.map((entry, idx) => {
    const isTemplate = entry.meta.relativePath.includes('_template/') || entry.meta.relativePath.includes('_bg');
    const isLogo = entry.meta.relativePath.toLowerCase().includes('logo');
    const isExample = entry.meta.relativePath.toLowerCase().includes('example');
    const type = isExample ? 'EXAMPLE (completed design)' : isTemplate ? 'TEMPLATE OPTION' : isLogo ? 'LOGO' : 'ASSET';
    return `[Image ${idx + 1}] = ${entry.meta.relativePath} (${type})`;
}).join('\n')}

⚠️ IMPORTANT: Look at the attached images! Choose a template that best fits the user's content and mood.
If there are EXAMPLE images, study them to understand the brand's actual design style.
`
        : '';

    // Start with image attachments
    const parts: any[] = previewAttachments.map(entry => entry.part);
    
    let prompt = `
ROLE: Senior Infographic Layout Director.
OUTPUT LANGUAGE: ${language === 'zh' ? 'Simplified Chinese (zh-CN)' : 'English'} ONLY.
TASK: Produce a complete infographic plan using the ${assets.name} brand library. You MUST select specific template files from the asset list below as visual references.
${visualRefSection}
⚠️ MANDATORY BRAND RULES (YOU MUST FOLLOW THESE):
${usageGuidanceText}

CANVAS SETTINGS:
- Aspect Ratio: ${ratio}
- Orientation: ${orientation}

CONTENT PROVIDED BY USER:
- Title: "${data.title}"
- Summary: "${data.summary}"
- Sections: ${
        data.keyPoints.length > 0
            ? data.keyPoints.map((kp, idx) => `Section ${idx + 1}: ${kp.title} -> ${kp.description}`).join('\n  ')
            : 'Poster mode (no sections beyond headline/subtitle)'
    }
- Custom Visual Motif: ${data.customVisualPrompt?.trim() || 'None'}

AVAILABLE BRAND ASSETS (YOU MUST SELECT FROM THIS LIST):
${assetCatalogText}

PLAN FORMAT (PLAIN TEXT ONLY, NO JSON, NO MARKDOWN):
1. CANVAS OVERVIEW — describe grid and safe margins qualitatively (e.g., "comfortable padding top/left/right/bottom"). Do NOT provide numeric coordinates/percentages.
2. BRAND & BACKGROUND — You MUST select ONE specific template file as the base layer. State the exact filename. THE TEMPLATE'S COLORS AND VISUAL STYLE MUST REMAIN VISIBLE AND DOMINANT.
3. LOGO & HEADER — You MUST use the logo asset. State the exact filename. Logo goes in top corner with generous padding.
4. BODY SECTIONS — for each key point (if any), give a relative placement region. Use provided text verbatim. If poster mode, state no extra sections.
5. DIRECTIONAL PLACEMENT — YOU MUST explicitly state ONE direction for theme elements. Format: "Theme elements direction: LEFT" (or TOP/BOTTOM/RIGHT). Look at the attached template preview to choose wisely.
6. VISUAL SCENE — Describe the theme elements and how they occupy the chosen direction. State: "The [theme description] will occupy the [LEFT/RIGHT/TOP/BOTTOM] side, with a smooth gradient transition to the template's area." The template's key visual features (curves, gradients) must remain visible and untouched.
7. FOOTER & BACKGROUND DETAILS — mention any footer/metrics if provided; otherwise note clear footer margin.
8. EXECUTION NOTES — concise do/don't. Remind: no new copy; respect safe zones; PRESERVE template appearance; smooth transition between areas.


⚠️ LAYOUT STRATEGY - CRITICAL RULES:

STEP 1: STUDY THE ATTACHED TEMPLATE PREVIEW
- Look at the attached template images carefully
- Identify where the template's KEY VISUAL FEATURES are (curves, shapes, gradients, patterns)
- Example: If you see a blue curve on the RIGHT side, that's a key feature

STEP 2: CHOOSE ONE DIRECTION FOR THEME ELEMENTS
- Choose ONE direction: TOP, BOTTOM, LEFT, or RIGHT
- Preferably choose the direction WITHOUT template's key features
- But if theme colors match template, they can share space with smooth blending

STEP 3: OUTPUT THE DIRECTION IN SECTION 5
- In your "5. DIRECTIONAL PLACEMENT" section, write EXACTLY:
  "Theme elements direction: [LEFT/RIGHT/TOP/BOTTOM]"
- This is MANDATORY - do not skip this line

STEP 4: DESCRIBE THE VISUAL SCENE IN SECTION 6
- Describe how theme elements occupy the chosen direction
- Mention smooth gradient transition to template area
- Emphasize that template's key features remain visible

EXAMPLE OUTPUT:
5. DIRECTIONAL PLACEMENT — Theme elements direction: LEFT
6. VISUAL SCENE — The festive winter scene with Christmas tree and warm lights will occupy the LEFT side of the canvas. The RIGHT side preserves the template's distinctive blue infinity curve. A smooth color gradient in the middle creates a seamless transition between the festive left and the corporate right, maintaining a cohesive, professional appearance.

GOAL: Clear directional separation with smooth gradient transition
- You MUST reference exact filenames from the AVAILABLE BRAND ASSETS list above.
- Use provided text verbatim (no translation/rewrites).
- Templates may contain placeholder text. IGNORE these - they will be replaced.

⚠️ CRITICAL REMINDERS BEFORE YOU WRITE YOUR PLAN:
1. You MUST include "5. DIRECTIONAL PLACEMENT — Theme elements direction: [LEFT/RIGHT/TOP/BOTTOM]" in your plan
2. Study the attached template preview images to see where key features are located
3. The template's key visual features (curves, shapes, gradients) MUST remain visible in final output
4. Do NOT say "corners" or "small accents" - choose ONE full direction for theme elements
5. Mention "smooth gradient transition" between template and theme areas in section 6

AT THE END OF YOUR PLAN, ADD THIS SECTION EXACTLY:
SELECTED_ASSETS:
- <exact_filename_from_list> :: brief reason
- You MUST include AT LEAST ${MIN_SELECTED_ASSETS} entries from the asset list above.
- Entry 1: A template/background file (e.g., "- ns_template_white/ns_template_white_p3.png :: Base layout with starry header")
- Entry 2: The logo file (e.g., "- ns_logo_white.png :: Brand logo for top corner")
- Entry 3+: Any additional relevant assets
- ONLY use filenames that exist in AVAILABLE BRAND ASSETS above. NO fictional names.
- Format: "- filename :: reason" (one per line, no extra text)
`;

    if (!templateLibrary) {
        prompt += `\nNOTE: Template library metadata unavailable. Use best judgement with provided content.\n`;
    }

    parts.push({ text: prompt });

    console.log("[Planner] Request payload:", {
        brand: assets.name,
        templateFile: templateConfig.fileName,
        aspectRatio: visualConfig.aspectRatio,
        title: data.title,
        mode: data.mode,
        templateLibraryIncluded: !!templateLibrary,
        previewImagesCount: previewAttachments.length,
        previewImages: previewAssets.map(a => a.relativePath),
        promptPreview: prompt.slice(0, 500) + (prompt.length > 500 ? "..." : "")
    });

    const response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts }],
        config: {
            thinkingConfig: {
                thinkingBudget: 0  // Disable thinking for cleaner output
            },
            temperature: 0.5,
            maxOutputTokens: 4000,
            responseMimeType: "text/plain"
        }
    });

    const planText = response.text?.trim();
    if (!planText) {
        throw new Error("Plan generation returned empty text.");
    }
    console.log("[Planner] Generated Infographic Plan:\n", planText);
    return planText;
};

/**
 * GENERATE IMAGE: Gemini 3 Pro
 */
export const generateInfographicImage = async (
    data: AnalysisResult, 
    templateConfig: TemplateSelectionConfig,
    visualConfig: VisualConfig,
    language: Language = 'en',
    planText?: string
): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-pro-image-preview"; // Use Pro for highest visual quality

    // 1. Resolve Assets
    const assetKey = resolveBrandKey(templateConfig);
    const assets = BRAND_ASSETS[assetKey];
    
    console.log(`[Artist] Using assets for: ${assets.name}`);
    console.log(`[Artist] Plan text provided:`, planText ? `Yes (${planText.length} chars)` : 'No');

    const templateLibrary = await fetchTemplateLibrary(assetKey);
    const selectedAssetMetas = resolveAssetsForPlan(templateLibrary, planText);
    
    // Find example images to use as style references
    const allAssets = templateLibrary?.assets || [];
    const exampleAssets = findExampleAssets(allAssets, 2);
    
    // Combine selected assets with examples (examples go at the end as style references)
    const assetsWithExamples = [
        ...selectedAssetMetas,
        ...exampleAssets.filter(e => !selectedAssetMetas.some(s => s.relativePath === e.relativePath))
    ];
    
    console.log(`[Artist] Final assets to attach (${assetsWithExamples.length} total):`, 
        assetsWithExamples.map(a => a.relativePath));
    
    const attachmentEntries = await buildAttachmentParts(templateLibrary, assetsWithExamples);
    
    // Track which indices are examples
    const exampleStartIndex = selectedAssetMetas.length;

    // 2. Construct Prompt with Explicit Indexing for Robustness
    const parts: any[] = attachmentEntries.map(entry => entry.part);
    
    // Create a function to replace all filenames in text with [File Input X] references
    const replaceFilenamesWithRefs = (text: string): string => {
        let result = text;
        attachmentEntries.forEach((entry, idx) => {
            const ref = `[File Input ${idx + 1}]`;
            const relativePath = entry.meta.relativePath;
            const filename = relativePath.split('/').pop() || relativePath;
            
            // Replace various formats: full path, filename only, with or without quotes
            result = result.replace(new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ref);
            result = result.replace(new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ref);
        });
        return result;
    };
    
    // Create simple asset descriptions using only [File Input X] format
    const attachmentSummary = attachmentEntries.length > 0
        ? attachmentEntries
            .map((entry, idx) => `[File Input ${idx + 1}]: ${entry.meta.description}`)
            .join('\n')
        : "No inline brand assets available.";

    // Find the template background and logo indices dynamically
    // Priority: template files (_template/ or _bg), then any other image
    const templateBgIndex = attachmentEntries.findIndex(e => 
        e.meta.relativePath.includes('_template/') || e.meta.relativePath.includes('_bg')
    );
    const logoIndex = attachmentEntries.findIndex(e => 
        e.meta.relativePath.toLowerCase().includes('logo')
    );
    
    // Build a comprehensive list of all attached files for reference (NO filenames, only File Input refs)
    const allFileRefs = attachmentEntries.map((entry, idx) => {
        const isTemplate = entry.meta.relativePath.includes('_template/') || entry.meta.relativePath.includes('_bg');
        const isLogo = entry.meta.relativePath.toLowerCase().includes('logo');
        const type = isTemplate ? 'TEMPLATE' : isLogo ? 'LOGO' : 'ASSET';
        return `[File Input ${idx + 1}] = ${type}`;
    }).join('\n');
    
    const templateBgRef = templateBgIndex !== -1 
        ? `[File Input ${templateBgIndex + 1}]` 
        : '[File Input 1]';
    const logoRef = logoIndex !== -1 
        ? `[File Input ${logoIndex + 1}]` 
        : 'the brand logo';
    
    // Find example indices
    const exampleRefs = attachmentEntries
        .map((entry, idx) => ({ entry, idx }))
        .filter(({ entry }) => entry.meta.relativePath.toLowerCase().includes('example'))
        .map(({ idx }) => `[File Input ${idx + 1}]`);

    const usageGuidanceText = templateLibrary?.usageGuidance?.length
        ? templateLibrary.usageGuidance.join('\n')
        : "No special usage notes.";
    
    // Image generation prompt - template is the highest priority
    const exampleSection = exampleRefs.length > 0 
        ? `\nSTYLE EXAMPLES (reference for final quality):
${exampleRefs.map(ref => `- ${ref} = Completed design example - match this quality and professionalism`).join('\n')}
Study these examples to understand the brand's visual style, text placement, and overall polish.`
        : '';

    let prompt = `Create ONE SINGLE poster/infographic for ${assets.name}.

📎 FILES ATTACHED TO THIS REQUEST (YOU MUST USE THESE):
${allFileRefs}

🚨 MANDATORY: YOU MUST USE THE ATTACHED IMAGE FILES
- The files listed above are NOT optional references
- They are REQUIRED elements that MUST appear in your output
- ${templateBgRef} = You MUST use this as your base layer (look at this file and copy its visual style)
- ${logoRef} = You MUST place this logo EXACTLY as it appears in the file
- DO NOT redesign, recreate, or imagine these elements - USE THE ACTUAL FILES
- LOOK at the files first, then design based on what you SEE in them

CRITICAL: Generate ONE complete design that fills the ENTIRE canvas.
- Do NOT split the image into multiple sections/panels
- Do NOT create a collage or grid of multiple designs
- Do NOT show "before/after" or "option A/B" layouts
- The output must be ONE cohesive poster, not multiple posters stacked

REFERENCE IMAGES:
- ${templateBgRef} = CORPORATE TEMPLATE (THIS IS THE BRAND IDENTITY - PRESERVE IT)
- ${logoRef} = LOGO (copy exactly with original colors)
${exampleSection}

⚠️ CRITICAL WARNING: Text rendering quality is THE MOST IMPORTANT aspect of this task.
- Write every word COMPLETELY and CORRECTLY
- Do NOT break words (e.g., "Christ-mas" or "Christ Christmas")
- Do NOT truncate words (e.g., "pea" instead of "peace")
- If you make text errors, the output will be REJECTED

═══════════════════════════════════════════════════════════════
📝 CONTENT - COPY THIS TEXT EXACTLY, WORD-FOR-WORD:
═══════════════════════════════════════════════════════════════

Title (copy exactly): "${data.title}"
Subtitle (copy exactly): "${data.summary}"
${data.keyPoints.length > 0 ? data.keyPoints.map((kp, i) => `- ${kp.title}: ${kp.description}`).join('\n') : ''}

⚠️ READ AGAIN - THE TITLE IS: "${data.title}"
⚠️ READ AGAIN - THE SUBTITLE IS: "${data.summary}"

Do NOT change, add, or repeat any words. Write it EXACTLY as shown above.

═══════════════════════════════════════════════════════════════

🚨 TEXT RENDERING - EXTREMELY CRITICAL:

RULE 1: EXACT TEXT ONLY - DO NOT CHANGE ANYTHING
- ONLY use the text provided in CONTENT section above
- Write each text line COMPLETELY and EXACTLY as shown
- ❌ DO NOT add extra words
- ❌ DO NOT repeat words (e.g., if title is "Merry Christmas 2025", do NOT write "Merry Merry Christmas")
- ❌ DO NOT remove words (e.g., if title is "Merry Christmas 2025", do NOT write just "Merry 2025")
- ❌ DO NOT change words (e.g., if title is "Christmas", do NOT write "Xmas" or "X-mas")
- ❌ DO NOT copy placeholder text from template (e.g., "TITLE", "TEXT TEXT TEXT", "Lorem ipsum")
- ❌ DO NOT generate generic labels like "TITLE TITLE TITLE" or "HEADING"

RULE 2: DO NOT BREAK OR TRUNCATE WORDS
- ❌ DO NOT split words across lines (e.g., "Christ-mas" or "Christ Christmas")
- ❌ DO NOT truncate words (e.g., "pea" instead of "peace", "sea" instead of "season")
- ❌ DO NOT add extra spaces in the middle of words (e.g., "Christ mas" instead of "Christmas")
- ✅ Keep each word COMPLETE and INTACT
- ✅ If a line is too long, reduce font size slightly to fit the complete text
- ✅ Use proper line breaks only between words, not in the middle of words

RULE 3: SPELL CORRECTLY
- Write "Christmas" as one complete word, not "Christ mas" or "Christ Christmas"
- Write "peace" completely, not "pea" or "pea ce"
- Write "season" completely, not "sea" or "sea son"
- Write "holiday" completely, not "holi day"

RULE 4: TEXT PLACEMENT
- Ensure there is enough space for the complete text
- Do NOT let text overlap with decorative elements
- Do NOT let text get cut off at the edge of the canvas
- If text is too long for one line, break it at natural phrase boundaries (not in middle of words)

EXAMPLE OF CORRECT TEXT:
✅ Title: "Merry Christmas 2025" (exactly as specified, no extra words)
✅ Subtitle: "Wishing you joy and peace this holiday season!" (exactly as specified)

EXAMPLE OF WRONG TEXT (COMMON MISTAKES TO AVOID):
❌ "Merry Merry Christmas 2025" (word repeated - WRONG!)
❌ "Merry Christ Christmas 2025" (word split incorrectly - WRONG!)
❌ "Merry Christmas" (missing "2025" - WRONG!)
❌ "Wishing you joy and pea peace this holiday sea" (words truncated - WRONG!)

FOR THIS SPECIFIC REQUEST:
The title should be: "${data.title}"
NOT: "Merry Merry Christmas", NOT: "Merry Christ Christmas", NOT: "Christmas 2025"
Write it EXACTLY as: "${data.title}"

${data.customVisualPrompt ? `THEME VISUAL ELEMENTS: ${data.customVisualPrompt}` : ''}

CRITICAL DESIGN APPROACH:

STEP 1: USE TEMPLATE AS THE BASE LAYER
   - Start with ${templateBgRef} as your complete background
   - Keep ALL of its visual elements visible AND THEIR ORIGINAL COLORS
   - ❌ DO NOT change the template's colors (e.g., if template has blue curves, keep them blue)
   - ❌ DO NOT recolor template elements to match theme colors
   - ❌ DO NOT change gradients or color schemes from the template
   - ✅ The template's visual elements (curves, shapes, gradients) must remain EXACTLY as they appear in ${templateBgRef}
   - The template fills the entire canvas as the foundation

STEP 2: FOLLOW THE LAYOUT PLAN'S DIRECTIONAL GUIDANCE
   - The layout plan below will specify which direction to place theme elements
   - Follow that direction exactly as specified in the plan

STEP 3: CREATE SMOOTH TRANSITION BETWEEN AREAS
   - Template area keeps its ORIGINAL colors (do NOT change)
   - Theme area has your custom theme colors
   - Middle transition zone: GRADUAL BLUR/FADE where template colors meet theme colors
   - Do NOT create a hard line or sharp boundary
   - Use gradient blending where the two areas meet
   - The transition should feel natural and seamless
   - IMPORTANT: Template's key visual elements (in template area) must maintain their original colors, NOT blended into theme colors

EXAMPLE:
- If plan says theme on LEFT: Left side = theme elements (red/gold Christmas colors), Right side = template features (original blue curves/gradients)
- Middle area = smooth gradient transition (blur/fade) connecting both sides
- Result: Seamless fusion where left is festive (red/gold), right is corporate (blue), middle is smooth blend
- CRITICAL: The template's blue curves on the right side MUST stay blue, NOT changed to red/gold

REQUIREMENTS:

0. 🎨 TEMPLATE COLORS (CRITICAL - MUST PRESERVE):
   - Look at ${templateBgRef} and observe ALL its colors carefully
   - The template's visual elements MUST keep their ORIGINAL COLORS
   - ❌ DO NOT change the template's curves/shapes/gradients to different colors
   - ❌ DO NOT recolor template elements to match your theme (e.g., if template has blue curves, keep them BLUE even if theme is red/gold)
   - ❌ DO NOT make template elements the same color as theme elements
   - ✅ Template area = original template colors (untouched)
   - ✅ Theme area = your custom theme colors
   - ✅ Middle transition = smooth gradient blend between the two
   - EXAMPLE: If template has a blue infinity curve, that curve MUST remain blue in final output

1. 🎨 LOGO PLACEMENT (CRITICAL - MUST FOLLOW):
   - STEP 1: Look at ${logoRef} file carefully - what colors do you see?
   - STEP 2: Copy the logo EXACTLY as shown in the file (same colors, same design)
   - STEP 3: Place it in the top-left corner with generous padding
   - ❌ DO NOT change the logo's colors for any reason
   - ❌ DO NOT make the logo white/black unless it's already white/black in the file
   - ❌ DO NOT redesign or recreate the logo from text description
   - ❌ DO NOT assume the logo is white just because it's on a dark background
   - ✅ The logo should be clearly visible and not covered by other elements
   - ✅ If the logo has blue/green/red colors in the file, KEEP those colors

2. 📝 TYPOGRAPHY (CRITICAL - MUST FOLLOW):
   - STEP 1: Look at ${templateBgRef} carefully - does it have any text?
   - STEP 2: If you see text in the template, observe:
     • Font family (is it sans-serif like Arial/Helvetica, or serif?)
     • Font weight (is the title bold/heavy, or light/thin?)
     • Text alignment (is text left-aligned, centered, or right-aligned?)
     • Text size (how big is the title vs. body text?)
     • Text color (what color is the text - white, black, blue?)
   - STEP 3: Apply the SAME styling to your content text
   - ✅ If template has bold white titles → use bold white titles
   - ✅ If template has left-aligned text → use left-aligned text
   - ✅ If template has large headline + small subtitle → follow same hierarchy
   - ❌ DO NOT use a completely different font style from the template

3. Final design = Template features in one direction + Theme elements in opposite direction

4. TEXT IS CRITICAL:
   - ONLY display the exact text from CONTENT section above
   - NEVER show placeholder text like "TITLE", "TEXT TEXT TEXT", "Lorem ipsum"
   - NEVER generate generic labels like "TITLE TITLE TITLE" or "HEADING"
   - If you see placeholder text in template, REPLACE it with actual content

5. Final result = ONE cohesive design where corporate template and festive theme are seamlessly merged

6. OUTPUT MUST BE A SINGLE COMPLETE POSTER - no splits, no collages, no multiple designs in one image
${exampleRefs.length > 0 ? `
7. STYLE REFERENCE:
   - Study the ${exampleRefs.join(', ')} files
   - Match the same level of professional quality
   - Observe how text is styled in these examples
   - Observe how the logo is placed in these examples` : ''}
`;

    if (planText) {
        const sanitizedPlan = replaceFilenamesWithRefs(planText);
        prompt += `
LAYOUT GUIDANCE (follow for text placement):
${sanitizedPlan}

FINAL CHECKLIST (verify before generating):
✓ I have looked at ${templateBgRef} and will use it as the COMPLETE background foundation
✓ I will PRESERVE the template's ORIGINAL COLORS (curves, shapes, gradients stay as they are in ${templateBgRef})
✓ I will NOT recolor template elements to match theme colors (e.g., blue curves stay blue, not changed to red/gold)
✓ I have looked at ${logoRef} and will copy it EXACTLY with its ORIGINAL COLORS (not changed to white/black unless it already is)
✓ I will follow the layout plan's directional guidance for theme placement
✓ I will create a SMOOTH GRADIENT TRANSITION between template and theme areas (blur/fade, not hard line)
✓ I will match the text styling (font, weight, alignment) from ${templateBgRef}
✓ THE TITLE WILL BE EXACTLY: "${data.title}" (not "Merry Merry Christmas", not "Christ Christmas")
✓ THE SUBTITLE WILL BE EXACTLY: "${data.summary}" (no word truncations like "pea" or "sea")
✓ I will NOT repeat words, NOT truncate words, NOT split words
✓ All words will be spelled correctly and completely (no word splits or truncations)
✓ The result will be ONE seamless design, not two separate sections
✓ The logo will be clearly visible in the top corner with original colors preserved`;
    }

    parts.push({ text: prompt });

    // 4. Parallel Generation - generate 3 instances for selection
    const numberOfInstances = 3;

    console.log(`[Artist] Generating ${numberOfInstances} parallel instances for better text accuracy...`);
    console.log("[Artist] Payload meta:", {
        brand: assets.name,
        templateFile: templateConfig.fileName,
        attachmentCount: attachmentEntries.length,
        selectedAssetPaths: selectedAssetMetas.map(asset => asset.relativePath),
        exampleCount: exampleRefs.length,
        exampleAssets: exampleAssets.map(e => e.relativePath),
        aspectRatio: visualConfig.aspectRatio,
        hasPlanText: !!planText,
        templateLibraryIncluded: !!templateLibrary,
        planTextPreview: planText ? `${planText.slice(0, 120)}...` : null,
        title: data.title,
        mode: data.mode
    });
    
    // Helper function for a single generation request
    const generateInstance = async (index: number): Promise<string | null> => {
        try {
            console.log(`[Artist] Requesting instance ${index + 1}...`);
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
                config: {
                    temperature: 0.15,  // Extremely low temperature for accurate text rendering
                    imageConfig: {
                        aspectRatio: visualConfig.aspectRatio || "3:4", 
                    }
                }
            });

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    console.log(`[Artist] Instance ${index + 1} returned image mime=${part.inlineData.mimeType} size=${part.inlineData.data.length}`);
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
            return null;
        } catch (e) {
            console.error(`[Artist] Instance ${index + 1} failed:`, e);
            return null;
        }
    };

    // Execute all 3 requests in parallel
    const promises = Array.from({ length: numberOfInstances }, (_, i) => generateInstance(i));
    const results = await Promise.all(promises);
    
    // Filter out failed requests   
    const successfulImages = results.filter((img): img is string => img !== null);

    if (successfulImages.length === 0) {
        throw new Error("No images were generated. The model might have refused the request.");
    }

    console.log(`[Artist] Successfully generated ${successfulImages.length} images.`);
    return successfulImages;
};
