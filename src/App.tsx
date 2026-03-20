/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import * as XLSX from 'xlsx';
import { 
  Upload, 
  FileSpreadsheet, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Receipt,
  Download,
  Plus,
  Volume2,
  Edit2,
  Save,
  X,
  PieChart as PieChartIcon,
  Table as TableIcon,
  RefreshCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip, 
  Legend 
} from 'recharts';

/**
 * Utility for Tailwind class merging
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface ReceiptData {
  Date: string;
  Merchant_Name: string;
  Category: 'Groceries' | 'Utilities' | 'Rent' | 'Transportation' | 'Dining' | 'Healthcare' | 'Entertainment' | 'Miscellaneous';
  Total_Amount: number;
  Short_Description: string;
  unreadable?: boolean;
}

interface ProcessedFile {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  data?: ReceiptData;
  error?: string;
  isEditing?: boolean;
}

// --- Constants ---

const CATEGORIES = [
  'Groceries', 
  'Utilities', 
  'Rent', 
  'Transportation', 
  'Dining', 
  'Healthcare', 
  'Entertainment', 
  'Miscellaneous'
] as const;

const COLORS = [
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#71717a'  // zinc-500
];

const GEMINI_VISION_MODEL = "gemini-3-flash-preview";
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

// --- Main Component ---

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Helpers ---

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const processReceipt = async (processedFile: ProcessedFile) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    try {
      const base64Data = await fileToBase64(processedFile.file);
      
      const response = await ai.models.generateContent({
        model: GEMINI_VISION_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: processedFile.file.type,
                data: base64Data,
              },
            },
            {
              text: `Act as an expert accountant. Read the attached receipt/bill and extract the following information in strict JSON format. 
              If the image is too blurry or not a receipt, return {"unreadable": true}.
              Otherwise, return a JSON object with these fields:
              - Date (Format: YYYY-MM-DD)
              - Merchant_Name (e.g., Walmart, PG&E, Shell)
              - Category (Choose exactly one from: ${CATEGORIES.join(', ')})
              - Total_Amount (Just the float number, no currency symbols)
              - Short_Description (A 3-5 word summary of the items)
              
              Ensure the output is ONLY the JSON object.`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              Date: { type: Type.STRING },
              Merchant_Name: { type: Type.STRING },
              Category: { type: Type.STRING, enum: [...CATEGORIES] },
              Total_Amount: { type: Type.NUMBER },
              Short_Description: { type: Type.STRING },
              unreadable: { type: Type.BOOLEAN }
            }
          }
        }
      });

      const result = JSON.parse(response.text || '{}') as ReceiptData;

      setFiles(prev => prev.map(f => 
        f.id === processedFile.id 
          ? { ...f, status: result.unreadable ? 'error' : 'completed', data: result, error: result.unreadable ? 'Unreadable receipt' : undefined } 
          : f
      ));
    } catch (error) {
      console.error("Error processing receipt:", error);
      setFiles(prev => prev.map(f => 
        f.id === processedFile.id 
          ? { ...f, status: 'error', error: 'Failed to process' } 
          : f
      ));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      const newFiles = Array.from(fileList).map((file: File) => ({
        id: Math.random().toString(36).substring(7),
        file,
        preview: URL.createObjectURL(file),
        status: 'pending' as const,
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove) URL.revokeObjectURL(fileToRemove.preview);
      return prev.filter(f => f.id !== id);
    });
  };

  const clearAll = () => {
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
  };

  const processAll = async () => {
    setIsProcessingAll(true);
    const pendingFiles = files.filter(f => f.status === 'pending');
    
    for (const file of pendingFiles) {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f));
      await processReceipt(file);
    }
    
    setIsProcessingAll(false);
  };

  const toggleEdit = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, isEditing: !f.isEditing } : f));
  };

  const updateFileData = (id: string, newData: Partial<ReceiptData>) => {
    setFiles(prev => prev.map(f => 
      f.id === id && f.data 
        ? { ...f, data: { ...f.data, ...newData } } 
        : f
    ));
  };

  const downloadExcel = () => {
    const completedData = files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);

    if (completedData.length === 0) return;

    const sortedData = [...completedData].sort((a, b) => a.Date.localeCompare(b.Date));

    const itemizedSheet = XLSX.utils.json_to_sheet(sortedData);
    const total = sortedData.reduce((sum, item) => sum + item.Total_Amount, 0);
    XLSX.utils.sheet_add_aoa(itemizedSheet, [
      [],
      ['Total Sum', '', '', total, '']
    ], { origin: -1 });

    const categorySummary = CATEGORIES.map(cat => {
      const catTotal = sortedData
        .filter(item => item.Category === cat)
        .reduce((sum, item) => sum + item.Total_Amount, 0);
      return { Category: cat, Total_Amount: catTotal };
    }).filter(item => item.Total_Amount > 0);

    const summarySheet = XLSX.utils.json_to_sheet(categorySummary);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, itemizedSheet, "Itemized Bills");
    XLSX.utils.book_append_sheet(wb, summarySheet, "Category Summary");

    XLSX.writeFile(wb, `Receipt_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const readAloudSummary = async () => {
    if (isReadingAloud) {
      audioRef.current?.pause();
      setIsReadingAloud(false);
      return;
    }

    const completedData = files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);

    if (completedData.length === 0) return;

    setIsReadingAloud(true);
    const total = completedData.reduce((sum, item) => sum + item.Total_Amount, 0);
    const topCategory = CATEGORIES.map(cat => ({
      cat,
      total: completedData.filter(i => i.cat === cat || i.Category === cat).reduce((s, i) => s + i.Total_Amount, 0)
    })).sort((a, b) => b.total - a.total)[0];

    const promptText = `Summarize this financial report for the user: 
    Total expenses: $${total.toFixed(2)}. 
    Number of receipts processed: ${completedData.length}. 
    The highest spending category was ${topCategory.cat} with a total of $${topCategory.total.toFixed(2)}. 
    Keep it friendly and concise.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_TTS_MODEL,
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBlob = new Blob([Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) URL.revokeObjectURL(audioRef.current.src);
        
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onended = () => setIsReadingAloud(false);
        audio.play();
      }
    } catch (error) {
      console.error("TTS Error:", error);
      setIsReadingAloud(false);
    }
  };

  // --- Computed Data ---

  const chartData = useMemo(() => {
    const completedData = files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);
    
    return CATEGORIES.map(cat => ({
      name: cat,
      value: completedData.filter(item => item.Category === cat).reduce((sum, item) => sum + item.Total_Amount, 0)
    })).filter(item => item.value > 0);
  }, [files]);

  const completedCount = files.filter(f => f.status === 'completed').length;
  const totalCount = files.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Receipt size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Receipt Clarity AI</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {files.some(f => f.status === 'completed') && (
              <>
                <button
                  onClick={readAloudSummary}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95",
                    isReadingAloud ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                  )}
                >
                  {isReadingAloud ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                  {isReadingAloud ? "Reading..." : "Read Summary"}
                </button>
                <button
                  onClick={downloadExcel}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  <Download size={16} />
                  Excel Report
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <section className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold tracking-tight mb-4 text-stone-900">
            Financial Clarity, Simplified.
          </h2>
          <p className="text-stone-600 text-lg leading-relaxed">
            Upload your receipts and let AI organize your expenses. No more manual data entry.
          </p>
        </section>

        {/* Upload Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div 
              className={cn(
                "border-2 border-dashed border-stone-300 rounded-2xl p-8 bg-white transition-all hover:border-emerald-400 group cursor-pointer",
                files.length === 0 ? "h-64 flex flex-col items-center justify-center" : "h-auto"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <Upload size={24} />
              </div>
              <p className="font-medium text-stone-800">Upload Receipts</p>
              <p className="text-xs text-stone-500 mt-1">PNG, JPG, JPEG supported</p>
            </div>

            {files.length > 0 && (
              <div className="mt-6 space-y-4">
                <div className="bg-white rounded-xl p-4 border border-stone-200 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-medium text-stone-700">Processing Progress</p>
                    <p className="text-xs font-mono text-stone-500">{completedCount} / {totalCount}</p>
                  </div>
                  <div className="w-full bg-stone-100 h-2 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={processAll}
                    disabled={isProcessingAll || !files.some(f => f.status === 'pending')}
                    className="flex-grow py-3 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                  >
                    {isProcessingAll ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <RefreshCcw size={18} />
                    )}
                    {isProcessingAll ? "Processing..." : "Analyze All"}
                  </button>
                  <button
                    onClick={clearAll}
                    className="p-3 bg-stone-100 hover:bg-rose-50 text-stone-500 hover:text-rose-600 rounded-xl transition-all"
                    title="Clear All"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="popLayout">
              {files.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white rounded-2xl border border-stone-200 p-12 flex flex-col items-center justify-center text-center h-full min-h-[400px]"
                >
                  <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mb-6 text-stone-300">
                    <FileSpreadsheet size={32} />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Ready to organize?</h3>
                  <p className="text-stone-500 max-w-xs">
                    Upload your physical bills to see the magic happen. Your data will appear here.
                  </p>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  {files.map((file) => (
                    <motion.div
                      key={file.id}
                      layout
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white rounded-xl border border-stone-200 p-4 flex gap-4 items-start group shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="w-20 h-20 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0 border border-stone-200">
                        <img 
                          src={file.preview} 
                          alt="Receipt preview" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      <div className="flex-grow min-w-0">
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-grow">
                            <p className="font-medium text-stone-900 truncate">
                              {file.file.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {file.status === 'pending' && <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>}
                              {file.status === 'processing' && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><Loader2 size={10} className="animate-spin" />Analyzing</span>}
                              {file.status === 'completed' && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><CheckCircle2 size={10} />Success</span>}
                              {file.status === 'error' && <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><AlertCircle size={10} />{file.error || 'Error'}</span>}
                            </div>
                          </div>
                          
                          <div className="flex gap-1">
                            {file.status === 'completed' && (
                              <button 
                                onClick={() => toggleEdit(file.id)}
                                className={cn(
                                  "p-2 rounded-lg transition-colors",
                                  file.isEditing ? "bg-emerald-50 text-emerald-600" : "text-stone-400 hover:text-stone-600 hover:bg-stone-50"
                                )}
                              >
                                {file.isEditing ? <Save size={16} /> : <Edit2 size={16} />}
                              </button>
                            )}
                            <button 
                              onClick={() => removeFile(file.id)}
                              className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {file.data && !file.data.unreadable && (
                          <div className="mt-3">
                            {file.isEditing ? (
                              <div className="grid grid-cols-2 gap-2">
                                <input 
                                  type="date" 
                                  value={file.data.Date}
                                  onChange={(e) => updateFileData(file.id, { Date: e.target.value })}
                                  className="text-xs p-2 border border-stone-200 rounded-md bg-stone-50 focus:outline-emerald-500"
                                />
                                <input 
                                  type="text" 
                                  value={file.data.Merchant_Name}
                                  onChange={(e) => updateFileData(file.id, { Merchant_Name: e.target.value })}
                                  className="text-xs p-2 border border-stone-200 rounded-md bg-stone-50 focus:outline-emerald-500"
                                  placeholder="Merchant"
                                />
                                <select 
                                  value={file.data.Category}
                                  onChange={(e) => updateFileData(file.id, { Category: e.target.value as any })}
                                  className="text-xs p-2 border border-stone-200 rounded-md bg-stone-50 focus:outline-emerald-500"
                                >
                                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input 
                                  type="number" 
                                  value={file.data.Total_Amount}
                                  onChange={(e) => updateFileData(file.id, { Total_Amount: parseFloat(e.target.value) || 0 })}
                                  className="text-xs p-2 border border-stone-200 rounded-md bg-stone-50 focus:outline-emerald-500"
                                  placeholder="Amount"
                                />
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                                  <p className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Date</p>
                                  <p className="text-xs font-medium text-stone-700">{file.data.Date}</p>
                                </div>
                                <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                                  <p className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Merchant</p>
                                  <p className="text-xs font-medium text-stone-700 truncate">{file.data.Merchant_Name}</p>
                                </div>
                                <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                                  <p className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Amount</p>
                                  <p className="text-xs font-bold text-emerald-600">${file.data.Total_Amount.toFixed(2)}</p>
                                </div>
                                <div className="bg-stone-50 p-2 rounded-lg border border-stone-100">
                                  <p className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">Category</p>
                                  <p className="text-xs font-medium text-stone-700">{file.data.Category}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Report Preview & Visualization */}
        {files.some(f => f.status === 'completed' && f.data && !f.data.unreadable) && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-20"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
              <div>
                <h3 className="text-3xl font-bold tracking-tight text-stone-900">Financial Report</h3>
                <p className="text-stone-500 mt-1">
                  Total Spending: <span className="font-bold text-emerald-600">
                    ${files.reduce((sum, f) => sum + (f.data?.Total_Amount || 0), 0).toFixed(2)}
                  </span>
                </p>
              </div>

              <div className="flex bg-stone-100 p-1 rounded-xl self-start">
                <button 
                  onClick={() => setViewMode('table')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    viewMode === 'table' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                  )}
                >
                  <TableIcon size={16} />
                  Table
                </button>
                <button 
                  onClick={() => setViewMode('chart')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    viewMode === 'chart' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                  )}
                >
                  <PieChartIcon size={16} />
                  Visuals
                </button>
              </div>
            </div>
            
            <AnimatePresence mode="wait">
              {viewMode === 'table' ? (
                <motion.div 
                  key="table"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm"
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-200">
                          <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Date</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Merchant</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Category</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Description</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {files
                          .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
                          .map((f) => (
                            <tr key={f.id} className="hover:bg-stone-50/50 transition-colors">
                              <td className="px-6 py-4 text-sm text-stone-600 whitespace-nowrap">{f.data!.Date}</td>
                              <td className="px-6 py-4 text-sm font-medium text-stone-900">{f.data!.Merchant_Name}</td>
                              <td className="px-6 py-4">
                                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-stone-100 text-stone-600 uppercase">
                                  {f.data!.Category}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-stone-500 italic">{f.data!.Short_Description}</td>
                              <td className="px-6 py-4 text-sm font-bold text-stone-900 text-right">
                                ${f.data!.Total_Amount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="chart"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm h-[400px] flex flex-col items-center"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={120}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Total']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Legend verticalAlign="bottom" height={36}/>
                    </PieChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-12 flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={downloadExcel}
                className="flex items-center gap-3 bg-stone-900 hover:bg-stone-800 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
              >
                <Download size={20} />
                Download Excel Report
              </button>
              <button
                onClick={readAloudSummary}
                className={cn(
                  "flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95",
                  isReadingAloud ? "bg-amber-500 text-white" : "bg-white text-stone-900 border border-stone-200"
                )}
              >
                {isReadingAloud ? <X size={20} /> : <Volume2 size={20} />}
                {isReadingAloud ? "Stop Reading" : "Read Summary Aloud"}
              </button>
            </div>
          </motion.section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-stone-200 py-12 bg-white">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-10 h-10 bg-stone-50 rounded-full flex items-center justify-center text-stone-400">
              <Receipt size={20} />
            </div>
          </div>
          <p className="text-stone-400 text-sm font-medium">
            Receipt Clarity AI • Intelligent Financial Organization
          </p>
          <p className="text-stone-300 text-[10px] mt-2 uppercase tracking-widest">
            Powered by Gemini 3.1 Flash & 2.5 TTS
          </p>
        </div>
      </footer>
    </div>
  );
}
