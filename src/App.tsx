/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
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
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
];

const GEMINI_MODEL = "gemini-3-flash-preview";

// --- Main Component ---

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        model: GEMINI_MODEL,
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
              Category: { type: Type.STRING, enum: CATEGORIES },
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

  const processAll = async () => {
    setIsProcessingAll(true);
    const pendingFiles = files.filter(f => f.status === 'pending');
    
    // Process sequentially to avoid rate limits and show progress
    for (const file of pendingFiles) {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f));
      await processReceipt(file);
    }
    
    setIsProcessingAll(false);
  };

  const downloadExcel = () => {
    const completedData = files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);

    if (completedData.length === 0) return;

    // Sort by date
    const sortedData = [...completedData].sort((a, b) => a.Date.localeCompare(b.Date));

    // Tab 1: Itemized Bills
    const itemizedSheet = XLSX.utils.json_to_sheet(sortedData);
    
    // Add Total Row
    const total = sortedData.reduce((sum, item) => sum + item.Total_Amount, 0);
    XLSX.utils.sheet_add_aoa(itemizedSheet, [
      [],
      ['Total Sum', '', '', total, '']
    ], { origin: -1 });

    // Tab 2: Category Summary
    const categorySummary = CATEGORIES.map(cat => {
      const catTotal = sortedData
        .filter(item => item.Category === cat)
        .reduce((sum, item) => sum + item.Total_Amount, 0);
      return { Category: cat, Total_Amount: catTotal };
    }).filter(item => item.Total_Amount > 0);

    const summarySheet = XLSX.utils.json_to_sheet(categorySummary);

    // Create Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, itemizedSheet, "Itemized Bills");
    XLSX.utils.book_append_sheet(wb, summarySheet, "Category Summary");

    // Save
    XLSX.writeFile(wb, `Receipt_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // --- Render ---

  const completedCount = files.filter(f => f.status === 'completed').length;
  const totalCount = files.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Receipt size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Receipt Clarity AI</h1>
          </div>
          
          {files.some(f => f.status === 'completed') && (
            <button
              onClick={downloadExcel}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
            >
              <Download size={16} />
              Download Excel
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <section className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold tracking-tight mb-4 text-stone-900">
            Achieve Financial Clarity
          </h2>
          <p className="text-stone-600 text-lg leading-relaxed">
            Turn your messy, unsorted physical bills and receipts into a neatly organized Excel spreadsheet in seconds.
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

                <button
                  onClick={processAll}
                  disabled={isProcessingAll || !files.some(f => f.status === 'pending')}
                  className="w-full py-3 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                >
                  {isProcessingAll ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      Analyze All Receipts
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Results Area */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="popLayout">
              {files.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl border border-stone-200 p-12 flex flex-col items-center justify-center text-center h-full min-h-[400px]"
                >
                  <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mb-6 text-stone-300">
                    <FileSpreadsheet size={32} />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">No receipts uploaded yet</h3>
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
                          <div>
                            <p className="font-medium text-stone-900 truncate max-w-[200px]">
                              {file.file.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {file.status === 'pending' && (
                                <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">Pending</span>
                              )}
                              {file.status === 'processing' && (
                                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Loader2 size={10} className="animate-spin" />
                                  Analyzing
                                </span>
                              )}
                              {file.status === 'completed' && (
                                <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <CheckCircle2 size={10} />
                                  Success
                                </span>
                              )}
                              {file.status === 'error' && (
                                <span className="text-xs bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <AlertCircle size={10} />
                                  {file.error || 'Error'}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <button 
                            onClick={() => removeFile(file.id)}
                            className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        {file.data && !file.data.unreadable && (
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Preview Table */}
        {files.some(f => f.status === 'completed' && f.data && !f.data.unreadable) && (
          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-16"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold tracking-tight">Report Preview</h3>
              <p className="text-sm text-stone-500">
                Total: <span className="font-bold text-emerald-600">
                  ${files.reduce((sum, f) => sum + (f.data?.Total_Amount || 0), 0).toFixed(2)}
                </span>
              </p>
            </div>
            
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200">
                      <th className="px-6 py-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">Merchant</th>
                      <th className="px-6 py-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-4 text-xs font-semibold text-stone-500 uppercase tracking-wider">Description</th>
                      <th className="px-6 py-4 text-xs font-semibold text-stone-500 uppercase tracking-wider text-right">Amount</th>
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
            </div>

            <div className="mt-8 flex justify-center">
              <button
                onClick={downloadExcel}
                className="flex items-center gap-3 bg-stone-900 hover:bg-stone-800 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
              >
                <Download size={20} />
                Download Complete Excel Report
              </button>
            </div>
          </motion.section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-stone-200 py-12 bg-white">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-stone-400 text-sm">
            Powered by Gemini 3.1 Flash Vision • Built for Financial Clarity
          </p>
        </div>
      </footer>
    </div>
  );
}
