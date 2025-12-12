
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { AnalysisResult, DocumentInputData, AnalysisMode, Language } from "../types";

// --- BRAND ASSET CONFIGURATION ---
const BRAND_ASSETS: Record<string, { 
    name: string;
    logoPath: string;
    templatePath: string;
    brandDNA: string; // New: Text description of the visual style
}> = {
    'ns_black': {
        name: 'Northstar', 
        logoPath: '/template/ns_black_logo.png',
        templatePath: '/template/ns_black_bg.png',
        brandDNA: "High-tech, dark mode aesthetic. Deep slate/navy gradients, glowing cyber-blue accents, geometric hexagons/triangles, clean white sans-serif typography. Professional, futuristic, premium."
    },
    'ns_white': {
        name: 'Northstar', 
        logoPath: '/template/ns_white_logo.png',
        templatePath: '/template/ns_black_bg.png',
        brandDNA: "Clean corporate minimalism. White backgrounds, subtle light-gray shadows, sharp navy blue text, generous whitespace. Professional, trustworthy, clinical."
    },
    'aa': { 
        name: 'Antalpha',
        logoPath: '/template/aa_logo.png',
        templatePath: '/template/aa_bg.png',
        brandDNA: "Modern finance. Deep blue to indigo gradients, abstract financial data waves, gold/orange accent highlights for key metrics. Sophisticated, dynamic, reliable."
    }
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
 * INTELLIGENT ROUTER: Determines the user's intent
 * Now uses Strict Classification Categories
 */
const determineIntent = async (input: DocumentInputData): Promise<AnalysisMode> => {
    console.log("[Router] Evaluating intent...");
    
    // 1. Files are Explicit
    if (input.type === 'file') {
        const mode = (input.userContext && input.userContext.trim().length > 0)
            ? 'TARGETED_ANALYSIS'
            : 'AUTO_SUMMARY';
        console.log(`[Router] File detected. Mode: ${mode}`);
        return mode;
    }

    // 2. Text Input Ambiguity
    // If context differs significantly from content, it's targeted
    if (input.content && input.userContext && input.content !== input.userContext) {
        return 'TARGETED_ANALYSIS';
    }

    // 3. Length Heuristic: Very long text is likely a document to summarize
    if (input.content.length > 2000) {
         return 'AUTO_SUMMARY';
    }

    // 4. Robust Text Classification via LLM
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            config: {
                responseMimeType: "application/json",
                temperature: 0.0, // Zero temperature for maximum determinism
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        inputType: { 
                            type: Type.STRING, 
                            // GREETING_SLOGAN: "Happy New Year", "Merry Christmas", "Welcome Team"
                            // VISUAL_REQUEST: "Make a poster of a cat", "Draw a chart"
                            // DOCUMENT_CONTENT: "Q3 financial results showing 30% growth..."
                            // SPECIFIC_QUESTION: "What is the revenue?"
                            enum: ["GREETING_SLOGAN", "VISUAL_REQUEST", "DOCUMENT_CONTENT", "SPECIFIC_QUESTION", "UNKNOWN"],
                            description: "Classify the user input text." 
                        }
                    }
                }
            },
            contents: [{
                role: "user",
                parts: [{ text: `Classify this text strictly. If it is a holiday greeting, short slogan, or visual description, mark it as GREETING_SLOGAN or VISUAL_REQUEST.\n\nInput Text: "${input.content.substring(0, 500)}"` }]
            }]
        });
        
        const result = safeJsonParse(response.text);
        console.log(`[Router] AI Classification: ${result.inputType}`);

        if (['GREETING_SLOGAN', 'VISUAL_REQUEST'].includes(result.inputType)) {
            return 'CREATIVE_GENERATION';
        }
        if (result.inputType === 'SPECIFIC_QUESTION') {
            return 'TARGETED_ANALYSIS';
        }
    } catch (e) {
        console.warn("[Router] Classification failed, defaulting to SUMMARY.", e);
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
    const mode = await determineIntent(input);

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
 * Generate a full infographic plan in text format using Gemini.
 */
export const generateInfographicPlan = async (
    data: AnalysisResult,
    templateConfig: { fileName?: string },
    visualConfig: { aspectRatio: string },
    language: Language = 'en'
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const modelId = "gemini-2.5-flash";

    let assetKey = Object.keys(BRAND_ASSETS).find(key => BRAND_ASSETS[key].templatePath.includes(templateConfig.fileName || '')) || 'ns_black';
    const assets = BRAND_ASSETS[assetKey];
    console.log(`[Planner] Using assets for: ${assets.name}`);

    const [logo, templateRef] = await Promise.all([
        fetchAssetAsBase64(assets.logoPath),
        fetchAssetAsBase64(assets.templatePath)
    ]);

    const ratio = visualConfig.aspectRatio || '3:4';
    const [widthRatio, heightRatio] = ratio.split(':').map(n => parseFloat(n)) as [number, number];
    const orientation = widthRatio >= heightRatio ? 'Landscape' : 'Portrait';

    const parts: any[] = [];
    let prompt = `
ROLE: Senior Infographic Layout Director.
OUTPUT LANGUAGE: ${language === 'zh' ? 'Simplified Chinese (zh-CN)' : 'English'} ONLY.
TASK: Produce a complete infographic plan AFTER the user has approved their copy and brand selection.

BRAND DNA:
"${assets.brandDNA}"

CANVAS SETTINGS:
- Aspect Ratio: ${ratio}
- Orientation: ${orientation}
- Template Reference: ${templateRef ? `[File Input REF_${assets.name}]` : 'Not Available'}

CONTENT PROVIDED BY USER:
- Title: "${data.title}"
- Summary: "${data.summary}"
- Sections: ${
        data.keyPoints.length > 0
            ? data.keyPoints.map((kp, idx) => `Section ${idx + 1}: ${kp.title} -> ${kp.description}`).join('\n  ')
            : 'Poster mode (no sections beyond headline/subtitle)'
    }
- Custom Visual Motif: ${data.customVisualPrompt?.trim() || 'None'}

PLAN FORMAT (TEXT ONLY, ABSOLUTELY NO JSON):
1. CANVAS OVERVIEW — describe grid units, safe margins (use percent values, e.g., "Top margin 8%").
2. BRAND & BACKGROUND — explain how to reuse [File Input ...] template layers and apply brand colors/texture.
3. LOGO & HEADER — exact placement (coordinates 0-100 for X/Y anchors), size guidance, hierarchy of text.
4. BODY SECTIONS — for each section/key point, specify:
   - placement rectangle using normalized percentages (Left %, Top %, Width %, Height %),
   - whether it is text, chart placeholder, or visual,
   - how to incorporate the user-provided text verbatim.
5. VISUAL SCENE — instructions for illustrations/photo treatments referencing ${data.customVisualPrompt ? 'the custom motif AND' : ''} the brand DNA.
6. FOOTER & BACKGROUND DETAILS — call out any footer text, icons, or supporting metrics.
7. EXECUTION NOTES — bullet list of do/don’t (e.g., "Do not add new copy", "Respect safe zones").

IMPORTANT:
- Refer to attachments exactly as [File Input N] when describing template/logo usage.
- Use normalized percentages (0-100) for any placement values (example: "Main title block spans X:10-90, Y:12-25").
- Never invent extra marketing copy; always reuse provided text.
- Return polished prose, not bullet gibberish.
`;

    let assetIndex = 1;
    if (templateRef) {
        parts.push({ inlineData: { mimeType: templateRef.mimeType, data: templateRef.data } });
        prompt = prompt.replace(`[File Input REF_${assets.name}]`, `[File Input ${assetIndex}]`);
        assetIndex++;
    }
    if (logo) {
        parts.push({ inlineData: { mimeType: logo.mimeType, data: logo.data } });
        prompt += `\nNOTE: [File Input ${assetIndex}] is the logo. Specify its placement clearly.`;
        assetIndex++;
    } else {
        prompt += `\nNOTE: Logo asset unavailable. Instruct designer to use text logo "${assets.name}".`;
    }

    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
        model: modelId,
        contents: [{ role: 'user', parts }],
        config: {
            temperature: 0.35,
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
    templateConfig: { fileName?: string },
    visualConfig: { aspectRatio: string },
    language: Language = 'en',
    planText?: string
): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = "gemini-3-pro-image-preview"; // Use Pro for highest visual quality

    // 1. Resolve Assets
    let assetKey = Object.keys(BRAND_ASSETS).find(key => BRAND_ASSETS[key].templatePath.includes(templateConfig.fileName || '')) || 'ns_black';
    const assets = BRAND_ASSETS[assetKey];
    
    console.log(`[Artist] Using assets for: ${assets.name}`);

    // Load assets (Logo + Template)
    const [logo, templateRef] = await Promise.all([
        fetchAssetAsBase64(assets.logoPath),
        fetchAssetAsBase64(assets.templatePath)
    ]);

    // 2. Construct Prompt with Explicit Indexing for Robustness
    const parts: any[] = [];
    
    // We construct the prompt to force "Brand Integration" rather than "Brand Override"
    let prompt = `
        ROLE: Corporate Brand Designer.
        TASK: Create a professional Corporate Infographic/Poster.
        
        OBJECTIVE:
        You must blend the **User's Requested Subject Matter** into the **Company's Strict Design Language**.
        The result must look like an OFFICIAL company announcement, not a generic illustration.

        BRAND DNA (The Rules of the Universe):
        "${assets.brandDNA}"
        
        INPUT ASSETS:
    `;

    let assetIndex = 1;
    let logoIndex = -1;
    let templateIndex = -1;

    // Add Template (PDF or Image)
    if (templateRef) {
        parts.push({ inlineData: { mimeType: templateRef.mimeType, data: templateRef.data } });
        templateIndex = assetIndex;
        prompt += `\n[File Input ${assetIndex}]: **TEMPLATE WIREFRAME**. \nUsage: Use this strictly for Layout, Margins, and Font Hierarchy. This defines the "Container".\n`;
        assetIndex++;
    }

    const templateReferenceLabel = templateIndex > 0 ? `[File Input ${templateIndex}]` : "the brand guidelines described above";

    // Add Logo
    if (logo) {
         parts.push({ inlineData: { mimeType: logo.mimeType, data: logo.data } });
         logoIndex = assetIndex;
         prompt += `\n[File Input ${assetIndex}]: **LOGO**. This must be pasted in the top corner.\n`;
         assetIndex++;
    }

    // 3. Inject User's Custom Visual Instructions with "Interpretation" logic
    if (data.customVisualPrompt && data.customVisualPrompt.trim().length > 0) {
        prompt += `
        \n--------------------------------------------------
        USER SUBJECT MATTER REQUEST:
        "${data.customVisualPrompt}"
        
        DESIGN SYNTHESIS INSTRUCTIONS:
        
        1. **BACKGROUND & STRUCTURE (Brand Dominance)**:
           - You MUST maintain the core background texture, geometry, and layout style of ${templateIndex > 0 ? `[File Input ${templateIndex}]` : "the official brand system"}.
           - Do NOT simply delete the corporate background to replace it with a generic photo.
           
        2. **THEME INTEGRATION (Harmonious Blend)**:
           - Interpret the User's Request *using* the Brand DNA.
           - Example: If the Brand is "Dark Blue Tech" and User wants "Red Holiday":
             -> Do NOT make a flat red paper background.
             -> INSTEAD: Keep the Dark Blue Tech background, but add *glowing red data streams*, *ruby-colored geometric accents*, or a *central 3D red object*.
             -> The result should look like "The Tech Company's version of Holiday", not "A Holiday Card".
        
        3. **CENTRAL VISUAL**:
           - Place the requested subject matter (e.g. Horse, Globe, Chart) in the center, rendered in a style that matches the template (e.g. 3D, Glass, Minimalist).
        --------------------------------------------------\n
        `;
    } else {
        prompt += `\nNOTE: No specific visual instruction provided. Adhere strictly to the colors and style of ${templateReferenceLabel}.\n`;
    }

    prompt += `
        STRICT EXECUTION GUIDELINES:

        1. **Logo Integration**:
           ${logoIndex > 0 
                ? `- **REQUIRED**: Place [File Input ${logoIndex}] in the top corner (matching the Template's logo position).
                   - **PADDING**: The logo must be inset from the edge. Add meaningful padding.
                   - **INTEGRITY**: The logo must be **entirely visible** and **uncropped**.
                   - **LAYER**: The logo sits on top of all other graphics.` 
                : `- Render the brand name "${assets.name}" as a text logo in the top corner.`
           }

        2. **Text Content**:
           - Main Title: "${data.title}" (Legible, Dominant, Matching Brand Font)
           - Summary: "${data.summary}"
           ${data.keyPoints.length > 0 ? "- content sections:" : ""}
           ${data.keyPoints.map((kp, i) => `- ${kp.title}: ${kp.description}`).join('\n')}

        3. **Layout Compliance**:
           ${planText
                ? `- Follow the approved plan exactly as described below. Do not rearrange or improvise new sections.`
                : `- Use the provided template wireframe for structure. Maintain generous margins and align sections symmetrically.`
           }

        4. **Content Integrity**:
           - Use only the provided text.
           - No extra slogans, timestamps, or AI disclaimers.
    `;

    if (planText) {
        prompt += `
        --------------------------------------------------
        APPROVED LAYOUT PLAN (FOLLOW EXACTLY):
        ${planText}
        --------------------------------------------------
        `;
    } else {
        prompt += `
        NOTE: No explicit layout plan provided. Adhere closely to ${templateReferenceLabel} for spacing and hierarchy.
        `;
    }

    parts.push({ text: prompt });

    console.log("[Artist] Generating 3 parallel instances...");

    // 4. Parallel Generation
    const numberOfInstances = 3;
    
    // Helper function for a single generation request
    const generateInstance = async (index: number): Promise<string | null> => {
        try {
            console.log(`[Artist] Requesting instance ${index + 1}...`);
            const response = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
                config: {
                    imageConfig: {
                        aspectRatio: visualConfig.aspectRatio || "3:4", 
                        imageSize: "4K"
                    }
                }
            });

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
            return null;
        } catch (e) {
            console.error(`[Artist] Instance ${index + 1} failed:`, e);
            return null;
        }
    };

    // Execute all 5 requests in parallel
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
