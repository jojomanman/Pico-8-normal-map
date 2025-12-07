import React, { useState, useRef, ChangeEvent } from 'react';
import { Upload, Copy, RefreshCw, Info, Download, Image as ImageIcon, BarChart3, Settings, Sliders, Layers, Crop as CropIcon, Move } from 'lucide-react';

// --- Types ---
type ProcessingStatus = 'idle' | 'processing' | 'done' | 'error';
type Resolution = 16 | 32 | 64;
type InputMode = 'normal' | 'depth';
type CropState = {
  zoom: number; // 1.0 = fit max square, < 1.0 = smaller square
  panX: number; // 0..1
  panY: number; // 0..1
};
type ImageDimensions = {
  width: number;
  height: number;
};

// --- Components ---

const Header = () => (
  <header className="mb-8 text-center space-y-4">
    <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-red-500">
      Pico-8 Normal Map Converter
    </h1>
    <p className="text-slate-400 max-w-2xl mx-auto">
      Convert normal maps or depth maps into Pico-8 sprite strings.
      Encodes surface gradients into 4-bit pixel pairs (Y-slope, X-slope).
    </p>
  </header>
);

const Card = ({ children, title, className = "" }: { children?: React.ReactNode, title?: string, className?: string }) => (
  <div className={`bg-slate-800/50 border border-slate-700 rounded-xl p-6 backdrop-blur-sm ${className}`}>
    {title && <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">{title}</h3>}
    {children}
  </div>
);

const Button = ({ onClick, children, variant = 'primary', disabled = false, icon: Icon }: any) => {
  const baseStyle = "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-900/20",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200",
    outline: "border border-slate-600 hover:border-slate-500 text-slate-300 hover:bg-slate-700/50"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled}
      className={`${baseStyle} ${variants[variant as keyof typeof variants]}`}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

const Histogram = ({ data }: { data: number[] }) => {
  if (!data || data.length === 0) return null;

  const relevantData = data.slice(1);
  const maxVal = Math.max(...relevantData, 1);

  return (
    <div className="w-full mt-4">
      <div className="flex justify-between text-xs text-slate-500 mb-2 font-mono uppercase tracking-wider">
        <span>Negative Slope</span>
        <span className="text-emerald-500 font-bold">Flat (8)</span>
        <span>Positive Slope</span>
      </div>
      <div className="h-48 flex items-end justify-between gap-1 w-full pb-2 border-b border-slate-700">
        {relevantData.map((count, i) => {
          const value = i + 1; // 1 to 15
          const heightPct = (count / maxVal) * 100;
          const distFromFlat = Math.abs(8 - value);
          
          let colorClass = "bg-red-500";
          if (distFromFlat === 0) colorClass = "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]";
          else if (distFromFlat < 4) colorClass = "bg-emerald-400/80";
          else if (distFromFlat < 6) colorClass = "bg-yellow-400/80";
          
          return (
            <div key={value} className="flex flex-col items-center flex-1 group relative h-full justify-end">
              <div 
                style={{ height: `${Math.max(heightPct, 4)}%` }} 
                className={`w-full min-w-[4px] rounded-t ${colorClass} transition-all duration-300 relative`}
              >
                 <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity"></div>
              </div>
              <span className={`text-[10px] mt-2 font-mono ${value === 8 ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                {value.toString(16).toUpperCase()}
              </span>
              
              <div className="absolute bottom-full mb-2 bg-slate-800 text-xs px-2 py-1 rounded hidden group-hover:block z-20 whitespace-nowrap border border-slate-600 shadow-xl">
                 <div className="font-bold text-slate-200">Value: {value} (0x{value.toString(16)})</div>
                 <div className="text-slate-400">Count: {count.toLocaleString()}</div>
                 <div className="text-slate-500 text-[10px]">
                    {value === 8 ? 'Flat Surface' : value < 8 ? 'Negative Tilt' : 'Positive Tilt'}
                 </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="text-center text-xs text-slate-500 mt-2">
        Distribution of slope values (1-15).
      </div>
    </div>
  );
};

// --- Helper Logic ---

// For Normal Maps: Maps 0-255 directly to 1-15
const mapChannelToNibble = (value: number, factor: number): number => {
  // Center around 127.5 (midpoint of 0-255)
  // Normalized range approx -1.0 to 1.0
  // INVERTED: High input (255) -> Negative Normalized (-1.0)
  const normalized = -(value - 127.5) / 127.5;
  const amplified = normalized * factor;
  const clamped = Math.max(-1, Math.min(1, amplified));
  
  // -1 -> 1, 0 -> 8, 1 -> 15
  let mapped = Math.round(((clamped + 1) / 2) * 14) + 1;
  return Math.max(1, Math.min(15, mapped));
};

// For Depth Maps: Maps gradient (difference) to 1-15
const mapGradientToNibble = (delta: number, factor: number): number => {
  // delta is typically between -255 and 255.
  // 0 is flat (8).
  // We want to match the Normal Map logic: 
  // In Normal Map logic above: 255 (Max Red) -> Mapped to 1 (Low).
  // Usually Max Red = +Slope. So +Slope -> 1.
  // Here, if delta is positive (Slope up), we should map to 1.
  
  // Normalize delta (assume reasonable max slope is 255 across 2 pixels?)
  // Let's say max steepness of interest is within range +/- 64 intensity levels
  const sensitivity = 0.5; // Base sensitivity adjustment
  const normalized = (delta / 255) * sensitivity; 
  
  // Invert because we want Positive Slope -> Low Value (1)
  const inverted = -normalized;

  const amplified = inverted * factor * 5; // Extra boost for depth maps as gradients are often shallow
  const clamped = Math.max(-1, Math.min(1, amplified));

  let mapped = Math.round(((clamped + 1) / 2) * 14) + 1;
  return Math.max(1, Math.min(15, mapped));
};

// --- Main App ---

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<ImageDimensions | null>(null);
  
  const [outputString, setOutputString] = useState<string>("");
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [transparencyThreshold, setTransparencyThreshold] = useState<number>(10);
  const [gradientFactor, setGradientFactor] = useState<number>(1.0);
  const [resolution, setResolution] = useState<Resolution>(32);
  const [histogramData, setHistogramData] = useState<number[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  
  // Crop State
  const [crop, setCrop] = useState<CropState>({ zoom: 1, panX: 0.5, panY: 0.5 });
  
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);

  // Handle file upload
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setImageSrc(url);
      setImgDims(null); // Reset dims until loaded
      setCrop({ zoom: 1, panX: 0.5, panY: 0.5 }); // Reset crop
      setOutputString("");
      setHistogramData([]);
      setStatus('idle');
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setImgDims({ width: naturalWidth, height: naturalHeight });
  };

  const processImage = () => {
    if (!imageSrc || !hiddenCanvasRef.current || !imgDims) return;
    setStatus('processing');

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageSrc;

    img.onload = () => {
      const canvas = hiddenCanvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvas.width = resolution;
      canvas.height = resolution;

      // --- Cropping Logic ---
      const size = Math.min(img.width, img.height) * crop.zoom;
      const maxX = img.width - size;
      const maxY = img.height - size;
      
      const sourceX = maxX * crop.panX;
      const sourceY = maxY * crop.panY;

      // Clear and draw cropped region resized to resolution
      ctx.clearRect(0, 0, resolution, resolution);
      ctx.drawImage(
        img, 
        sourceX, sourceY, size, size, // Source rect
        0, 0, resolution, resolution  // Dest rect
      );

      const imageData = ctx.getImageData(0, 0, resolution, resolution);
      const data = imageData.data;
      
      let gfxString = "";
      const counts = new Array(16).fill(0);
      
      // Pre-calculate greyscale for depth mode to ease neighbor lookup
      let greyPixels: Uint8Array | null = null;
      if (inputMode === 'depth') {
        greyPixels = new Uint8Array(resolution * resolution);
        for(let i=0; i<resolution*resolution; i++) {
           const idx = i * 4;
           // Weighted greyscale
           greyPixels[i] = data[idx]*0.299 + data[idx+1]*0.587 + data[idx+2]*0.114;
        }
      }

      const getDepth = (x: number, y: number) => {
        if (!greyPixels) return 0;
        // Clamp coordinates
        const cx = Math.max(0, Math.min(resolution-1, x));
        const cy = Math.max(0, Math.min(resolution-1, y));
        return greyPixels[cy * resolution + cx];
      };

      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const index = (y * resolution + x) * 4;
          const a = data[index + 3];

          let valX = 0;
          let valY = 0;

          if (a >= transparencyThreshold) {
            if (inputMode === 'normal') {
              // --- Normal Map Mode ---
              const r = data[index];     // Red -> X Slope
              const g = data[index + 1]; // Green -> Y Slope
              valX = mapChannelToNibble(r, gradientFactor);
              valY = mapChannelToNibble(g, gradientFactor);
            } else {
              // --- Depth Map Mode ---
              // Calculate gradients using central difference
              const center = getDepth(x, y);

              // If the pixel is effectively black, treat as void (0000)
              if (center > 8) {
                const left = getDepth(x-1, y);
                const right = getDepth(x+1, y);
                const top = getDepth(x, y-1);
                const bottom = getDepth(x, y+1);

                const dx = right - left;
                const dy = bottom - top;

                valX = mapGradientToNibble(dx, gradientFactor);
                valY = mapGradientToNibble(dy, gradientFactor);
              }
              // Else: center <= 8 is treated as void, valX and valY remain 0
            }
          }

          counts[valX]++;
          counts[valY]++;

          // Order: Y Slope (left pixel), X Slope (right pixel)
          gfxString += valY.toString(16);
          gfxString += valX.toString(16);
        }
      }

      let prefix = "";
      switch (resolution) {
        case 16: prefix = "2010"; break;
        case 32: prefix = "4020"; break;
        case 64: prefix = "8040"; break;
        default: prefix = "4020"; break;
      }

      setOutputString(`[gfx]${prefix}${gfxString}[/gfx]`);
      setHistogramData(counts);
      setStatus('done');
    };

    img.onerror = () => setStatus('error');
  };

  const copyToClipboard = () => navigator.clipboard.writeText(outputString);
  const downloadString = () => {
    const blob = new Blob([outputString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pico8_map_${resolution}x${resolution}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper for crop style calculation
  const getCropStyle = () => {
    if (!imgDims) return {};
    
    // Logic must match processImage exactly
    // size = min(w, h) * zoom
    const size = Math.min(imgDims.width, imgDims.height) * crop.zoom;
    
    // Bounds available for top-left corner
    const maxX = imgDims.width - size;
    const maxY = imgDims.height - size;
    
    const leftPx = maxX * crop.panX;
    const topPx = maxY * crop.panY;

    // Convert to percentages for CSS
    return {
      width: `${(size / imgDims.width) * 100}%`,
      height: `${(size / imgDims.height) * 100}%`,
      left: `${(leftPx / imgDims.width) * 100}%`,
      top: `${(topPx / imgDims.height) * 100}%`,
    };
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto flex flex-col">
      <Header />

      <main className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow">
        
        {/* Left Column: Input & Cropper */}
        <div className="space-y-6">
          <Card title="1. Source Image & Crop">
             {!imageSrc ? (
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-12 text-center hover:border-pink-500/50 transition-colors bg-slate-900/30">
                  <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                    <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center text-slate-500 mb-2">
                      <ImageIcon size={32} />
                    </div>
                    <span className="text-lg text-slate-300 font-medium">Upload Image</span>
                    <span className="text-sm text-slate-500">Normal Map or Depth Map</span>
                  </label>
                </div>
             ) : (
                <div className="space-y-4">
                  {/* Cropper Visual - Container adapts to image aspect ratio now */}
                  <div className="relative w-full bg-slate-950 rounded-lg overflow-hidden border border-slate-700 group flex justify-center">
                    {/* The displayed image */}
                    <div className="relative inline-block w-full">
                       <img 
                        src={imageSrc} 
                        className="block w-full h-auto"
                        alt="Source" 
                        onLoad={handleImageLoad}
                      />
                      
                      {/* The Crop Overlay - Only shows if dims are loaded */}
                      {imgDims && (
                        <div 
                           className="absolute border-2 border-pink-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] z-10 box-content cursor-move transition-all duration-75 ease-out"
                           style={getCropStyle()}
                        >
                          {/* Crosshair center indicator */}
                          <div className="absolute top-1/2 left-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 opacity-50 pointer-events-none">
                            <div className="absolute top-1/2 left-0 w-full h-[1px] bg-pink-500"></div>
                            <div className="absolute left-1/2 top-0 h-full w-[1px] bg-pink-500"></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <button 
                       onClick={() => { setImageSrc(null); setFile(null); setImgDims(null); }}
                       className="absolute top-2 right-2 bg-slate-900/80 p-2 rounded-full text-white hover:bg-red-500/80 transition-colors z-20"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  {/* Crop Controls */}
                  <div className="grid grid-cols-1 gap-4 p-4 bg-slate-900/50 rounded-lg">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400 flex items-center gap-2"><CropIcon size={12}/> Crop Size (Zoom)</label>
                      <input 
                        type="range" min="0.1" max="1.0" step="0.01" 
                        value={crop.zoom}
                        onChange={(e) => setCrop(prev => ({ ...prev, zoom: Number(e.target.value) }))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-400 flex items-center gap-2"><Move size={12}/> Pan X</label>
                          <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={crop.panX}
                            onChange={(e) => setCrop(prev => ({ ...prev, panX: Number(e.target.value) }))}
                            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-400 flex items-center gap-2"><Move size={12} className="rotate-90"/> Pan Y</label>
                          <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={crop.panY}
                            onChange={(e) => setCrop(prev => ({ ...prev, panY: Number(e.target.value) }))}
                            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                       </div>
                    </div>
                  </div>
                </div>
             )}
          </Card>

          <Card title="2. Configuration">
            <div className="space-y-6">
              {/* Mode Selector */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                  <Layers size={16} /> Input Mode
                </label>
                <div className="flex bg-slate-900 p-1 rounded-lg">
                  <button 
                    onClick={() => setInputMode('normal')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${inputMode === 'normal' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    Normal Map
                  </button>
                  <button 
                    onClick={() => setInputMode('depth')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${inputMode === 'depth' ? 'bg-slate-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    Depth Map
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {inputMode === 'normal' 
                    ? "Expects RGB colors (Red=X, Green=Y)." 
                    : "Expects Greyscale height. Black (0) is treated as void/transparent."}
                </p>
              </div>

              {/* Resolution Selector */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                  <Settings size={16} /> Target Spatial Resolution
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[16, 32, 64].map((res) => (
                    <button
                      key={res}
                      onClick={() => {
                        setResolution(res as Resolution);
                        setStatus('idle');
                        setOutputString("");
                      }}
                      className={`py-3 px-2 rounded-lg border text-sm font-medium transition-all ${
                        resolution === res 
                          ? 'bg-pink-600/20 border-pink-500 text-pink-400' 
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      <div className="text-lg font-bold">{res}x{res}</div>
                      <div className="text-[10px] opacity-70">
                        Map Area
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Gradient Multiplier */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex justify-between items-center">
                  <span className="flex items-center gap-2"><Sliders size={16}/> Slope Multiplier</span>
                  <span className="text-white font-mono bg-slate-700 px-2 rounded">{gradientFactor.toFixed(1)}x</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={gradientFactor}
                  onChange={(e) => setGradientFactor(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
              </div>

              {/* Threshold */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2 flex justify-between">
                  <span>Transparency Threshold</span>
                  <span className="text-white font-mono bg-slate-700 px-2 rounded">{transparencyThreshold}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={transparencyThreshold}
                  onChange={(e) => setTransparencyThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
              </div>

              <Button 
                onClick={processImage} 
                disabled={!imageSrc} 
                className="w-full"
                icon={RefreshCw}
              >
                Generate Pico-8 GFX
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Output */}
        <div className="space-y-6">
           <Card title="3. Slope Analysis">
              <div className="flex flex-col items-center justify-center min-h-[200px]">
                 {status === 'done' ? (
                   <Histogram data={histogramData} />
                 ) : (
                   <div className="text-slate-500 italic flex items-center gap-2 h-48">
                      <BarChart3 size={24} className="opacity-50" />
                      {status === 'processing' ? 'Calculating...' : 'Process image to see distribution'}
                   </div>
                 )}
              </div>
           </Card>

           <Card title="4. GFX Output">
             <div className="relative">
                <textarea
                  readOnly
                  value={outputString}
                  className="w-full h-40 bg-slate-950 border border-slate-700 rounded p-4 font-mono text-xs text-green-500 resize-none focus:outline-none focus:border-pink-500/50"
                  placeholder="[gfx]...[/gfx]"
                />
                {outputString && (
                  <div className="absolute top-2 right-2 flex gap-2">
                     <button 
                       onClick={copyToClipboard}
                       className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                       title="Copy to Clipboard"
                     >
                       <Copy size={16} />
                     </button>
                     <button 
                       onClick={downloadString}
                       className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors border border-slate-700"
                       title="Download as .txt"
                     >
                       <Download size={16} />
                     </button>
                  </div>
                )}
             </div>
             <p className="text-xs text-slate-500 mt-2 flex justify-between">
                <span>Format: {resolution === 16 ? '32x16' : resolution === 32 ? '64x32' : '128x64'} Sprite</span>
                <span className="font-mono text-pink-400">{outputString.length} chars</span>
             </p>
           </Card>
        </div>
      </main>

      {/* Hidden processing canvas */}
      <canvas ref={hiddenCanvasRef} className="hidden" />
    </div>
  );
}