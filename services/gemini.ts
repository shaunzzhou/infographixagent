
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
    if (!library) return [];
    if (!planText) return library.assets;
    const requested = extractSelectedAssetPaths(planText);
    if (!requested.length) return library.assets;
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
    
    if (matches.length >= MIN_SELECTED_ASSETS) return matches;
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
 * Helper to select key visual assets for planner preview
 * Returns a curated set: some templates, logo, and examples (if available)
 */
const selectPlannerPreviewAssets = (assets: TemplateAssetEntry[], maxTemplates: number = 4): TemplateAssetEntry[] => {
    const result: TemplateAssetEntry[] = [];
    
    // 1. Get template backgrounds (select a variety - first, middle, last)
    const templates = assets.filter(a => 
        a.relativePath.includes('_template/') || a.relativePath.includes('_bg')
    );
    if (templates.length > 0) {
        // Pick strategically: first, one from middle, and last for variety
        const indices = [0];
        if (templates.length > 2) indices.push(Math.floor(templates.length / 2));
        if (templates.length > 1) indices.push(templates.length - 1);
        indices.slice(0, maxTemplates).forEach(i => {
            if (templates[i] && !result.some(r => r.relativePath === templates[i].relativePath)) {
                result.push(templates[i]);
            }
        });
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

    // Select key assets to show the planner (templates, logo, examples)
    const previewAssets = selectPlannerPreviewAssets(availableAssets);
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
2. BRAND & BACKGROUND — You MUST select ONE specific template file as the base layer. State the exact filename. THE TEMPLATE'S COLORS AND VISUAL STYLE MUST REMAIN VISIBLE AND DOMINANT. Custom motifs are small decorative accents ONLY.
3. LOGO & HEADER — You MUST use the logo asset. State the exact filename. Logo goes in top corner with generous padding.
4. BODY SECTIONS — for each key point (if any), give a relative placement region. Use provided text verbatim. If poster mode, state no extra sections.
5. VISUAL SCENE — CRITICAL: Decorative elements (dragons, lanterns, patterns) should be SMALL ACCENTS in corners or borders. They must NOT cover or replace the template background. The template's corporate style is the foundation.
6. FOOTER & BACKGROUND DETAILS — mention any footer/metrics if provided; otherwise note clear footer margin.
7. EXECUTION NOTES — concise do/don't. Remind: no new copy; respect safe zones; PRESERVE template appearance.

⚠️ CRITICAL RULES FOR BRAND + THEME FUSION:
- FUSION RATIO: Template 60% : Theme 40% - The template's visual style should be MORE prominent
- The template provides the FOUNDATION (colors, gradients, layout structure). It must remain recognizable.
- Custom visual motifs (dragons, patterns, lanterns, etc.) should BLEND HARMONIOUSLY with the template:
  * FUSION, not separation - the template colors and theme colors should flow together naturally
  * The template's gradients/colors can transition into or mix with theme colors
  * Template elements should occupy roughly 60% of the visual space
  * Theme/decorative elements should occupy roughly 40% of the visual space
  * Example: Template's blue gradient dominates center/left, red/gold elements flow in from edges
- TYPOGRAPHY must match the template's style:
  * Use the SAME font style as shown in the template (modern sans-serif, script, etc.)
  * Match the template's text weight, spacing, and alignment patterns
  * Font colors should harmonize with both template and theme colors
- The final result should look like a COHESIVE design where corporate identity LEADS and theme elements COMPLEMENT
- Do NOT let theme elements overpower the template - template is the star, theme is supporting
- You MUST reference exact filenames from the AVAILABLE BRAND ASSETS list above.
- Use provided text verbatim (no translation/rewrites).
- Templates may contain placeholder text. IGNORE these - they will be replaced.

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

CRITICAL: Generate ONE complete design that fills the ENTIRE canvas.
- Do NOT split the image into multiple sections/panels
- Do NOT create a collage or grid of multiple designs
- Do NOT show "before/after" or "option A/B" layouts
- The output must be ONE cohesive poster, not multiple posters stacked

REFERENCE IMAGES:
- ${templateBgRef} = CORPORATE TEMPLATE (THIS IS THE BRAND IDENTITY - PRESERVE IT)
- ${logoRef} = LOGO (copy exactly with original colors)
${exampleSection}

CONTENT (USE EXACTLY THIS TEXT - NOTHING ELSE):
- Title: "${data.title}"
- Subtitle: "${data.summary}"
${data.keyPoints.length > 0 ? data.keyPoints.map((kp, i) => `- ${kp.title}: ${kp.description}`).join('\n') : ''}

TEXT RULES - VERY IMPORTANT:
- ONLY use the text provided above. Do NOT add any other text.
- Do NOT copy placeholder text from the template (e.g., "TITLE", "TEXT TEXT TEXT", "Lorem ipsum", etc.)
- Do NOT generate generic labels like "TITLE TITLE TITLE" or "HEADING"
- If the template shows placeholder text, REPLACE it with the actual content above

${data.customVisualPrompt ? `THEME ELEMENTS TO BLEND WITH TEMPLATE: ${data.customVisualPrompt}` : ''}

CRITICAL RULES - FUSION DESIGN:

STEP 1: IDENTIFY TEMPLATE'S KEY VISUAL ELEMENTS (PRESERVE 100%):
Study ${templateBgRef} and identify:
- Geometric shapes (curves, lines, angular shapes) → KEEP EXACTLY AS-IS, DO NOT COVER
- Gradients and color flows → KEEP EXACTLY AS-IS
- Logo area → KEEP CLEAR

STEP 2: IDENTIFY EMPTY/BLANK AREAS (THIS IS WHERE THEME ELEMENTS GO):
Look for:
- White or solid color background areas → PUT THEME ELEMENTS HERE
- Plain areas with no geometric shapes → PUT THEME ELEMENTS HERE
- Areas between/around the geometric shapes → PUT THEME ELEMENTS HERE

STEP 3: PLACE THEME ELEMENTS IN EMPTY AREAS ONLY:
- Theme elements (trees, decorations, etc.) go IN THE BLANK/EMPTY AREAS
- Theme elements should NOT overlap with template's geometric shapes
- Theme elements should look like they're BEHIND or BESIDE the template shapes, not ON TOP
- The template's curves/shapes should remain UNOBSTRUCTED and fully visible

STEP 4: APPLY FUSION (60:40 RATIO):
1. Template's geometric shapes = 100% preserved, untouched
2. Empty areas = filled with theme elements (max 40% of total design)
3. Copy ${logoRef} exactly with its original colors
4. TYPOGRAPHY - Match the template's font style exactly

CRITICAL - WHAT NOT TO DO:
- Do NOT place theme elements ON TOP OF template's curves/shapes
- Do NOT let theme elements overlap or cover geometric shapes
- The blue curves/shapes should be COMPLETELY VISIBLE, theme elements fill the gaps around them
7. TEXT IS CRITICAL:
   - ONLY display the exact text from CONTENT section above
   - NEVER show placeholder text like "TITLE", "TEXT TEXT TEXT", "Lorem ipsum"
   - NEVER generate generic labels like "TITLE TITLE TITLE" or "HEADING"
   - If you see placeholder text in template, REPLACE it with actual content
8. Final result = ONE cohesive design where corporate template and festive theme are seamlessly merged
9. OUTPUT MUST BE A SINGLE COMPLETE POSTER - no splits, no collages, no multiple designs in one image
${exampleRefs.length > 0 ? `10. Study the STYLE EXAMPLES to match the same level of professional quality.` : ''}
`;

    if (planText) {
        const sanitizedPlan = replaceFilenamesWithRefs(planText);
        prompt += `
LAYOUT GUIDANCE (follow for text placement):
${sanitizedPlan}

FINAL REMINDER - FUSION DESIGN (60:40 RATIO):
- Template 60% (dominant) : Theme 40% (supporting)
- Template colors/gradients should BLEND with theme colors
- Template visual style should be MORE visible than theme decorations
- Result = Corporate design enhanced with festive touches
- NOT: Festive design with corporate logo`;
    }

    parts.push({ text: prompt });

    console.log("[Artist] Generating 3 parallel instances...");
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

    // 4. Parallel Generation - generate more for better selection
    const numberOfInstances = 3;
    
    // Helper function for a single generation request
    const generateInstance = async (index: number): Promise<string | null> => {
        try {
            console.log(`[Artist] Requesting instance ${index + 1}...`);
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
                config: {
                    temperature: 0.3,  // Lower temperature for more consistent/stable results
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
