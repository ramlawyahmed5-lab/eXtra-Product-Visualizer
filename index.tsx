
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, GenerateContentResponse, VideosOperation, Type } from '@google/genai';

// --- Types ---
interface ImageAsset {
  data: string; // base64
  mimeType: string;
  previewUrl: string;
}

// --- Helper Functions ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const readFileAsAsset = async (file: File): Promise<ImageAsset> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = encode(new Uint8Array(arrayBuffer));
    const previewUrl = URL.createObjectURL(file);
    return {
      data: base64Data,
      mimeType: file.type,
      previewUrl: previewUrl,
    };
  } catch (e) {
    console.error("Error reading file:", e);
    throw new Error("Could not read the uploaded image. Please try selecting the file again.");
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function apiCallWithRetry<T>(
    apiCall: () => Promise<T>, 
    maxRetries = 5, 
    initialDelay = 2000,
    maxDelay = 15000
): Promise<T> {
    let retries = 0;
    let delay = initialDelay;
    while (true) {
        try {
            return await apiCall();
        } catch (error: any) {
            const errorStr = error.toString();
            const isRateLimitError = errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota');
            
            if (isRateLimitError && retries < maxRetries) {
                retries++;
                const jitter = Math.random() * 1000;
                console.warn(`Rate limit hit. Retrying in ${Math.round((delay + jitter)/1000)}s... (${retries}/${maxRetries})`);
                await sleep(delay + jitter);
                delay = Math.min(delay * 2, maxDelay);
            } else {
                if (isRateLimitError) {
                    throw new Error(`The AI is currently busy with many requests. Please wait a minute and try again. (Error: Quota Exceeded)`);
                }
                throw error;
            }
        }
    }
}

const App = () => {
    // --- State Management ---
    const [appMode, setAppMode] = useState<'image' | 'video'>('image');
    const [uploadedImage, setUploadedImage] = useState<ImageAsset | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Advanced Model Config
    const [temperature, setTemperature] = useState(1.0);
    const [topK, setTopK] = useState(64);
    const [topP, setTopP] = useState(0.95);
    const [seed, setSeed] = useState<number | undefined>(undefined);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Image Generation State
    const [modelChoice, setModelChoice] = useState<'man' | 'woman' | 'none' | 'magic'>('magic');
    const [aiThought, setAiThought] = useState<string | null>(null);
    const [generatedImages, setGeneratedImages] = useState<string[]>([]);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [resizedImages, setResizedImages] = useState<{ portrait: string | null; landscape: string | null; square: string | null }>({ portrait: null, landscape: null, square: null });
    const [isUpscaling, setIsUpscaling] = useState(false);
    const [upscaledImage, setUpscaledImage] = useState<string | null>(null);

    // Video Generation State
    const [apiKeySelected, setApiKeySelected] = useState(false);
    const [firstSceneImage, setFirstSceneImage] = useState<ImageAsset | null>(null);
    const [lastSceneImage, setLastSceneImage] = useState<ImageAsset | null>(null);
    const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [isVideoLoading, setIsVideoLoading] = useState(false);
    const [videoLoadingMessage, setVideoLoadingMessage] = useState('');
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
    
    const videoLoadingMessages = useMemo(() => [
        "Warming up the virtual cameras...",
        "Directing the digital actors...",
        "Rendering the first few frames...",
        "Applying cinematic color grading...",
        "Adding the final touches...",
        "Almost there, preparing for the premiere!",
    ], []);

    useEffect(() => {
        if (appMode === 'video') {
            window.aistudio.hasSelectedApiKey().then(setApiKeySelected);
        }
    }, [appMode]);

    const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY }), []);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                const asset = await readFileAsAsset(e.target.files[0]);
                setUploadedImage(asset);
                setGeneratedImages([]);
                setSelectedImage(null);
                setResizedImages({ portrait: null, landscape: null, square: null });
                setUpscaledImage(null);
                setGeneratedVideoUrl(null);
                setFirstSceneImage(null);
                setLastSceneImage(null);
                setError(null);
                setAiThought(null);
            } catch (err: any) {
                setError(err.message);
            }
        }
    };

    const handleFirstSceneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                const asset = await readFileAsAsset(e.target.files[0]);
                setFirstSceneImage(asset);
            } catch (err: any) {
                setError(err.message);
            }
        }
    };

    const handleLastSceneUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                const asset = await readFileAsAsset(e.target.files[0]);
                setLastSceneImage(asset);
            } catch (err: any) {
                setError(err.message);
            }
        }
    };

    const analyzeProductForEnvironment = async (imageAsset: ImageAsset) => {
        const imagePart = { inlineData: { data: imageAsset.data, mimeType: imageAsset.mimeType } };
        const prompt = "Analyze this product image. Describe the absolute best, most luxurious, and contextually appropriate environment to showcase this product for a high-end advertisement. Be descriptive about the background, lighting (e.g., soft studio lights, golden hour), and overall aesthetic. Provide only the environment description in 3-4 sentences.";
        
        const response = await apiCallWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [imagePart, { text: prompt }] },
            config: {
                temperature,
                topK,
                topP,
                seed
            }
        }));
        
        return response.text || "A clean, modern, high-end studio setting with professional lighting.";
    };

    const generatePrompt = useCallback((model: 'man' | 'woman' | 'none' | 'magic', customEnv?: string) => {
        let basePrompt = customEnv || "Create a high-quality, photorealistic product photograph featuring the provided product. The setting is a luxurious, modern environment that perfectly complements the product category.";
        
        const prefix = "High-end product photography. Photorealistic, 8k resolution, professional lighting. ";

        switch (model) {
            case 'man':
                return `${prefix} ${basePrompt} The product is presented by a handsome Saudi man in traditional Saudi thobe and ghutra.`;
            case 'woman':
                return `${prefix} ${basePrompt} The product is presented by an elegant Saudi woman in a modern abaya.`;
            case 'none':
                return `${prefix} ${basePrompt} Focus entirely on the product with no people.`;
            case 'magic':
                return `${prefix} ${basePrompt} Showcase the product in this ideal setting with premium cinematic quality.`;
        }
    }, []);

    const handleGenerateClick = async () => {
        if (!uploadedImage) {
            setError("Please upload a product image first.");
            return;
        }
    
        setIsLoading(true);
        setError(null);
        setGeneratedImages([]);
        setSelectedImage(null);
        setAiThought("AI is analyzing your product to find the perfect environment...");
    
        const tempImageUrls: string[] = [];
    
        try {
            let envDescription = "";
            if (modelChoice === 'magic') {
                envDescription = await analyzeProductForEnvironment(uploadedImage);
                setAiThought(`AI Plan: ${envDescription}`);
            } else {
                setAiThought("Preparing your visuals...");
            }

            const imagePart = { inlineData: { data: uploadedImage.data, mimeType: uploadedImage.mimeType } };
            const textPrompt = generatePrompt(modelChoice, envDescription);
            
            const baseSeed = seed ?? Math.floor(Math.random() * 1000000);
            
            const variations = [
                "Composition: Wide cinematic hero shot. Lighting: Bright morning sunshine, high-key feel.",
                "Composition: Dramatic close-up macro detail. Lighting: Moody evening glow with sharp, long shadows.",
                "Composition: Clean, minimalist top-down flat-lay. Lighting: Soft, diffused studio lighting, shadowless.",
                "Composition: Dynamic low-angle 'Dutch angle' shot. Lighting: Atmospheric golden hour with lens flares."
            ];

            for (let i = 0; i < 4; i++) {
                if (i > 0) await sleep(2500);
                
                setAiThought(`Creating Variation #${i + 1}: ${variations[i]}`);

                const iterSeed = baseSeed + i;
                const iterPrompt = `${textPrompt} ${variations[i]} Ensure this result looks visually distinct from previous ones in the batch.`;
                const contents = { parts: [imagePart, { text: iterPrompt }] };
    
                const response = await apiCallWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents,
                    config: { 
                        responseModalities: [Modality.IMAGE],
                        temperature,
                        topK,
                        topP,
                        seed: iterSeed
                    },
                }));

                const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                const url = part?.inlineData ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
                
                if (url) {
                    tempImageUrls.push(url);
                    setGeneratedImages([...tempImageUrls]);
                }
            }
    
            if (tempImageUrls.length === 0) {
                 throw new Error(`The generator could not produce images at this time. Please try again.`);
            }
            
            setAiThought(`Generated 4 unique perspectives with base seed ${baseSeed}.`);
    
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleImageSelect = async (imageBase64: string) => {
        if (!imageBase64) return;
        setSelectedImage(imageBase64);
        setUpscaledImage(null);
        setIsResizing(true);
        setResizedImages({ portrait: null, landscape: null, square: imageBase64 });

        try {
            const dataParts = imageBase64.split(',');
            if (dataParts.length < 2) throw new Error("Invalid image data.");
            const base64Data = dataParts[1];
            const mimeType = imageBase64.match(/data:(.*);base64,/)?.[1] || 'image/png';
            const imagePart = { inlineData: { data: base64Data, mimeType } };

            const portraitPrompt = "Outpaint and extend this image to 9:16 aspect ratio. Keep quality consistent.";
            const landscapePrompt = "Outpaint and extend this image to 16:9 aspect ratio. Keep quality consistent.";

            const portraitPromise = apiCallWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [imagePart, { text: portraitPrompt }] },
                config: { responseModalities: [Modality.IMAGE], temperature, topK, topP, seed },
            }));

            await sleep(1500);

            const landscapePromise = apiCallWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [imagePart, { text: landscapePrompt }] },
                config: { responseModalities: [Modality.IMAGE], temperature, topK, topP, seed },
            }));
            
            const [portraitResponse, landscapeResponse] = await Promise.all([portraitPromise, landscapePromise]);
            
            const getUrlFromResponse = (response: GenerateContentResponse) => {
                 const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                 return part?.inlineData ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
            }

            setResizedImages({
                portrait: getUrlFromResponse(portraitResponse),
                landscape: getUrlFromResponse(landscapeResponse),
                square: imageBase64
            });

        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Error during resizing.");
        } finally {
            setIsResizing(false);
        }
    }

    const handleUpscaleClick = async () => {
        if (!selectedImage) return;
        setIsUpscaling(true);
        setError(null);
        try {
            const dataParts = selectedImage.split(',');
            if (dataParts.length < 2) throw new Error("Invalid image data for upscaling.");
            const base64Data = dataParts[1];
            const mimeType = selectedImage.match(/data:(.*);base64,/)?.[1] || 'image/png';
            const imagePart = { inlineData: { data: base64Data, mimeType } };
            const prompt = "Upscale and enhance details. Photorealistic finish.";
            const response = await apiCallWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [imagePart, { text: prompt }] },
                config: { responseModalities: [Modality.IMAGE], temperature, topK, topP, seed },
            }));
            const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            const upscaledUrl = part?.inlineData ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
            if (upscaledUrl) setUpscaledImage(upscaledUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upscaling failed.");
        } finally {
            setIsUpscaling(false);
        }
    };
    
    const handleGenerateVideoClick = async () => {
        const mainVideoAsset = firstSceneImage || uploadedImage;
        if (!mainVideoAsset) return setError("Upload a product image first.");
        setIsVideoLoading(true);
        setGeneratedVideoUrl(null);
        setError(null);
        let messageIndex = 0;
        const messageInterval = setInterval(() => {
            setVideoLoadingMessage(videoLoadingMessages[messageIndex]);
            messageIndex = (messageIndex + 1) % videoLoadingMessages.length;
        }, 4000);

        try {
            const localAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            let lastFramePart = null;
            if (lastSceneImage) {
                lastFramePart = { imageBytes: lastSceneImage.data, mimeType: lastSceneImage.mimeType };
            }
            const prompt = "A cinematic product advertisement with dynamic movement and elegant lighting.";
            let operation = await apiCallWithRetry<VideosOperation>(() => localAi.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt,
                image: { imageBytes: mainVideoAsset.data, mimeType: mainVideoAsset.mimeType },
                config: { numberOfVideos: 1, resolution: '720p', aspectRatio: videoAspectRatio, ...(lastFramePart && { lastFrame: lastFramePart }) }
            }));
            while (!operation.done) {
                await sleep(10000);
                operation = await apiCallWithRetry<VideosOperation>(() => localAi.operations.getVideosOperation({ operation }));
            }
            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
                const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
                const blob = await response.blob();
                setGeneratedVideoUrl(URL.createObjectURL(blob));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Video generation failed.");
        } finally {
            setIsVideoLoading(false);
            clearInterval(messageInterval);
        }
    };

    const triggerDownload = (uri: string, filename: string) => {
        const link = document.createElement('a');
        link.href = uri;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const styles: { [key: string]: React.CSSProperties } = {
        container: { maxWidth: '1200px', margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' },
        header: { textAlign: 'center' },
        title: { fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-color)', textShadow: '0 0 10px var(--primary-red)' },
        description: { fontSize: '1.1rem', color: '#b0b0b0', marginTop: '0.5rem' },
        tabs: { display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' },
        tabButton: { padding: '0.75rem 1.5rem', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-color)', background: 'var(--glass-color)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s' },
        activeTab: { borderColor: 'var(--primary-red)', backgroundColor: 'rgba(229, 57, 53, 0.2)' },
        card: { background: 'var(--glass-color)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '2rem', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)' },
        formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' },
        uploadSection: { display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' },
        uploadBox: { width: '100%', height: '220px', border: '2px dashed var(--border-color)', borderRadius: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'all 0.3s', overflow: 'hidden' },
        imagePreview: { width: '100%', height: '100%', objectFit: 'contain' },
        configSection: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
        radioGroup: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
        radioLabel: { padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.9rem' },
        radioInput: { display: 'none' },
        advancedToggle: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--primary-red)', fontWeight: 600, marginTop: '0.5rem', userSelect: 'none' },
        advancedContent: { padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border-color)' },
        sliderRow: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
        sliderLabel: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', opacity: 0.8 },
        slider: { width: '100%', accentColor: 'var(--primary-red)', cursor: 'pointer' },
        input: { background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', padding: '0.4rem', fontSize: '0.8rem', width: '100%' },
        generateButton: { width: '100%', padding: '1rem', fontSize: '1.2rem', fontWeight: 'bold', color: '#fff', background: 'linear-gradient(90deg, var(--primary-red), var(--secondary-red))', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s' },
        resultsSection: { textAlign: 'center' },
        imageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginTop: '1rem' },
        gridImageWrapper: { position: 'relative', aspectRatio: '1 / 1', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.3s' },
        gridImage: { width: '100%', height: '100%', objectFit: 'cover' },
        reviewSection: { marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' },
        resizedImagesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', width: '100%', textAlign: 'center' },
        resizedImage: { width: '100%', borderRadius: '12px', border: '1px solid var(--border-color)', objectFit: 'contain' },
        downloadButton: { padding: '0.6rem 1.2rem', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-color)', background: 'var(--glass-color)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', marginTop: '0.5rem' },
        upscaleSection: { width: '100%', textAlign: 'center', marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' },
        upscaledImage: { maxWidth: '500px', width: '100%', borderRadius: '12px', border: '2px solid var(--primary-red)', margin: '1rem auto' },
        loader: { border: '4px solid var(--border-color)', borderTop: '4px solid var(--primary-red)', borderRadius: '50%', width: '40px', height: '40px', animation: 'spin 1s linear infinite', margin: '1rem auto' },
        error: { color: '#ff5252', background: 'rgba(255, 82, 82, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255, 82, 82, 0.5)', margin: '1rem 0' },
        aiThoughtBox: { background: 'rgba(255, 255, 255, 0.05)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid var(--primary-red)', fontSize: '0.9rem', fontStyle: 'italic', marginBottom: '1.5rem', textAlign: 'left' }
    };

    return (
        <div style={styles.container}>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } input[type="file"] { display: none; }`}</style>
            <header style={styles.header}>
                <h1 style={styles.title}>eXtra Product Visualizer</h1>
                <p style={styles.description}>AI-powered environment creation & cinematic product visuals.</p>
            </header>
            
            <div style={styles.tabs}>
                <button style={{...styles.tabButton, ...(appMode === 'image' && styles.activeTab)}} onClick={() => setAppMode('image')}>Image Studio</button>
                <button style={{...styles.tabButton, ...(appMode === 'video' && styles.activeTab)}} onClick={() => setAppMode('video')}>Video Studio</button>
            </div>

            {appMode === 'image' && (
                <>
                    <div style={styles.card}>
                        <div style={styles.formGrid}>
                            <div style={styles.uploadSection}>
                                <h3>1. Upload Product</h3>
                                <label htmlFor="file-upload" style={styles.uploadBox}>
                                    <input id="file-upload" type="file" accept="image/png, image/jpeg" onChange={handleImageUpload} />
                                    {uploadedImage ? <img src={uploadedImage.previewUrl} alt="Product preview" style={styles.imagePreview} /> : "Drop Product Image"}
                                </label>
                            </div>
                            <div style={styles.configSection}>
                                <h3>2. Style Selection</h3>
                                <div style={styles.radioGroup}>
                                    {[
                                        { id: 'magic', label: 'AI Suggestion ✨' },
                                        { id: 'none', label: 'Studio Clean' },
                                        { id: 'man', label: 'Saudi Model (M)' },
                                        { id: 'woman', label: 'Saudi Model (W)' },
                                    ].map(option => (
                                        <label key={option.id} style={{...styles.radioLabel, ...(modelChoice === option.id && { borderColor: 'var(--primary-red)', backgroundColor: 'rgba(229, 57, 53, 0.2)' })}}>
                                            <input type="radio" name="model" value={option.id} checked={modelChoice === option.id} onChange={() => setModelChoice(option.id as any)} style={styles.radioInput}/>
                                            {option.label}
                                        </label>
                                    ))}
                                </div>

                                <div style={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
                                    {showAdvanced ? '▼' : '▶'} Advanced Model Parameters
                                </div>
                                
                                {showAdvanced && (
                                    <div style={styles.advancedContent}>
                                        <div style={styles.sliderRow}>
                                            <div style={styles.sliderLabel}>
                                                <span>Temperature</span>
                                                <span>{temperature.toFixed(2)}</span>
                                            </div>
                                            <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} style={styles.slider} />
                                        </div>
                                        <div style={styles.sliderRow}>
                                            <div style={styles.sliderLabel}>
                                                <span>Top K</span>
                                                <span>{topK}</span>
                                            </div>
                                            <input type="range" min="1" max="100" step="1" value={topK} onChange={(e) => setTopK(parseInt(e.target.value))} style={styles.slider} />
                                        </div>
                                        <div style={styles.sliderRow}>
                                            <div style={styles.sliderLabel}>
                                                <span>Top P</span>
                                                <span>{topP.toFixed(2)}</span>
                                            </div>
                                            <input type="range" min="0" max="1" step="0.05" value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} style={styles.slider} />
                                        </div>
                                        <div style={styles.sliderRow}>
                                            <div style={styles.sliderLabel}>
                                                <span>Generation Seed</span>
                                                <span style={{color: 'var(--primary-red)', cursor: 'pointer'}} onClick={() => setSeed(Math.floor(Math.random() * 1000000))}>Randomize</span>
                                            </div>
                                            <input 
                                                type="number" 
                                                placeholder="Enter a number (empty = random)" 
                                                value={seed === undefined ? '' : seed} 
                                                onChange={(e) => setSeed(e.target.value === '' ? undefined : parseInt(e.target.value))} 
                                                style={styles.input} 
                                            />
                                        </div>
                                    </div>
                                )}

                                <h3>3. Generate</h3>
                                <button style={{...styles.generateButton, ...((!uploadedImage || isLoading) && { cursor: 'not-allowed', opacity: 0.6 })}} onClick={handleGenerateClick} disabled={!uploadedImage || isLoading}>
                                    {isLoading ? 'Creating Magic...' : 'Generate 4 Variations'}
                                </button>
                                <p style={{fontSize: '0.8rem', color: '#888', textAlign: 'center'}}>AI creates distinct cinematic environments for your product.</p>
                            </div>
                        </div>
                    </div>

                    {error && <div style={styles.error} role="alert">{error}</div>}

                    {(isLoading || generatedImages.length > 0) && (
                        <div style={{...styles.card, ...styles.resultsSection}}>
                            <h2>Visual Variations</h2>
                            {aiThought && <div style={styles.aiThoughtBox}>{aiThought}</div>}
                            
                            {isLoading && generatedImages.length === 0 ? (
                                <div>
                                    <div style={styles.loader}></div>
                                    <p>Crafting perfect environments... (This takes about 30-60s)</p>
                                </div>
                            ) : (
                                <div style={styles.imageGrid}>
                                    {generatedImages.map((imgSrc, index) => (
                                        <div key={index} style={{...styles.gridImageWrapper, ...(selectedImage === imgSrc && { borderColor: 'var(--primary-red)', transform: 'scale(0.98)'})}} onClick={() => handleImageSelect(imgSrc)} role="button">
                                            <img src={imgSrc} alt={`Option ${index + 1}`} style={styles.gridImage}/>
                                        </div>
                                    ))}
                                    {isLoading && generatedImages.length < 4 && (
                                         <div style={{...styles.gridImageWrapper, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-color)'}}>
                                             <div style={{...styles.loader, margin: 0}}></div>
                                         </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    
                    {selectedImage && (
                        <div style={{...styles.card, ...styles.reviewSection}}>
                            <h2>Final Touches</h2>
                            {isResizing ? (
                                <div><div style={styles.loader}></div><p>Calculating aspect ratios...</p></div>
                            ) : (
                                <div style={styles.resizedImagesGrid}>
                                    {resizedImages.square && <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}><h4>Square (1:1)</h4><img src={resizedImages.square} style={styles.resizedImage}/><button style={styles.downloadButton} onClick={() => triggerDownload(resizedImages.square!, 'extra_square.png')}>Save</button></div>}
                                    {resizedImages.portrait && <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}><h4>Portrait (9:16)</h4><img src={resizedImages.portrait} style={styles.resizedImage}/><button style={styles.downloadButton} onClick={() => triggerDownload(resizedImages.portrait!, 'extra_portrait.png')}>Save</button></div>}
                                    {resizedImages.landscape && <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}><h4>Landscape (16:9)</h4><img src={resizedImages.landscape} style={styles.resizedImage}/><button style={styles.downloadButton} onClick={() => triggerDownload(resizedImages.landscape!, 'extra_landscape.png')}>Save</button></div>}
                                </div>
                            )}
                            <div style={styles.upscaleSection}>
                                <h2>Quality Enhancement</h2>
                                {isUpscaling ? (
                                    <div><div style={styles.loader}></div><p>Applying 4K enhancement...</p></div>
                                ) : upscaledImage ? (
                                    <div style={{textAlign: 'center'}}>
                                        <img src={upscaledImage} alt="Upscaled" style={styles.upscaledImage} />
                                        <button style={styles.downloadButton} onClick={() => triggerDownload(upscaledImage, 'extra_4k.png')}>Download 4K Version</button>
                                    </div>
                                ) : (
                                    <button style={{...styles.generateButton, maxWidth: '300px', ...((isResizing || isUpscaling) && { opacity: 0.6 })}} onClick={handleUpscaleClick} disabled={isResizing || isUpscaling}>
                                        Enhance to 4K
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {appMode === 'video' && (
                 <>
                    <div style={styles.card}>
                        <div style={styles.formGrid}>
                             <div style={styles.uploadSection}>
                                <h3>Asset Selection</h3>
                                <label htmlFor="video-product-upload" style={{...styles.uploadBox, height: '120px'}}>
                                    <input id="video-product-upload" type="file" accept="image/png, image/jpeg" onChange={handleImageUpload} />
                                    {uploadedImage ? <img src={uploadedImage.previewUrl} style={styles.imagePreview} /> : "Product Photo"}
                                </label>
                                <label htmlFor="first-scene-upload" style={{...styles.uploadBox, height: '120px'}}>
                                    <input id="first-scene-upload" type="file" accept="image/png, image/jpeg" onChange={handleFirstSceneUpload} />
                                    {firstSceneImage ? <img src={firstSceneImage.previewUrl} style={styles.imagePreview} /> : "Start Frame (Optional)"}
                                </label>
                                 <label htmlFor="last-scene-upload" style={{...styles.uploadBox, height: '120px'}}>
                                    <input id="last-scene-upload" type="file" accept="image/png, image/jpeg" onChange={handleLastSceneUpload} />
                                    {lastSceneImage ? <img src={lastSceneImage.previewUrl} style={styles.imagePreview} /> : "End Frame (Optional)"}
                                </label>
                            </div>
                             <div style={styles.configSection}>
                                 <h3>Format</h3>
                                 <div style={styles.radioGroup}>
                                    {(['16:9', '9:16'] as const).map(option => (
                                        <label key={option} style={{...styles.radioLabel, ...(videoAspectRatio === option && { borderColor: 'var(--primary-red)', backgroundColor: 'rgba(229, 57, 53, 0.2)' })}}>
                                            <input type="radio" name="aspect" value={option} checked={videoAspectRatio === option} onChange={() => setVideoAspectRatio(option)} style={styles.radioInput}/>
                                            {option === '16:9' ? 'YouTube/TV' : 'TikTok/Reels'}
                                        </label>
                                    ))}
                                 </div>
                                <h3>Process</h3>
                                {!apiKeySelected ? (
                                    <button style={styles.generateButton} onClick={async () => { await window.aistudio.openSelectKey(); setApiKeySelected(true); }}>Authenticate to Start</button>
                                ) : (
                                    <button style={{...styles.generateButton, ...((!(uploadedImage || firstSceneImage) || isVideoLoading) && { opacity: 0.6 })}} onClick={handleGenerateVideoClick} disabled={!(uploadedImage || firstSceneImage) || isVideoLoading}>
                                        {isVideoLoading ? 'Generating Video...' : 'Create Cinematic Video'}
                                    </button>
                                )}
                             </div>
                        </div>
                    </div>
                     {error && <div style={styles.error} role="alert">{error}</div>}
                     {(isVideoLoading || generatedVideoUrl) && (
                         <div style={{...styles.card, ...styles.resultsSection}}>
                             <h2>Production Result</h2>
                             {isVideoLoading ? (
                                <div><div style={styles.loader}></div><p>{videoLoadingMessage || 'Rendering...'}</p></div>
                             ) : (
                                generatedVideoUrl && (
                                    <div>
                                        <video style={{width:'100%', borderRadius:'12px', border:'1px solid var(--border-color)'}} src={generatedVideoUrl} controls autoPlay loop/>
                                        <button style={{...styles.downloadButton, marginTop: '1rem'}} onClick={() => triggerDownload(generatedVideoUrl, 'extra_prod.mp4')}>Download MP4</button>
                                    </div>
                                )
                             )}
                         </div>
                     )}
                </>
            )}
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
