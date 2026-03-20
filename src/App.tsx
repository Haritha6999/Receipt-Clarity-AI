/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
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
  VolumeX,
  Edit2,
  Save,
  X,
  PieChart as PieChartIcon,
  Table as TableIcon,
  RefreshCw,
  Info,
  Accessibility,
  MessageSquare,
  Bug,
  Send,
  Mail,
  History,
  Filter,
  Calendar,
  LogOut,
  LogIn,
  User as UserIcon,
  Search
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  getDocs,
  setDoc,
  getDocFromServer
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip, 
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import toast, { Toaster } from 'react-hot-toast';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  onAuthStateChanged, 
  User,
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';

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
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [filterMonth, setFilterMonth] = useState<string>("");
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isEnhancedAI, setIsEnhancedAI] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'ui' | 'performance'>('bug');
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // --- Auth & History Sync ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Save user profile
        try {
          await setDoc(doc(db, 'users', currentUser.uid), {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: new Date().toISOString()
          }, { merge: true });
        } catch (error) {
          console.error("Error saving user profile:", error);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'receipts'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistory(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'receipts');
    });

    return () => unsubscribe();
  }, [user]);

  const saveReceiptToFirestore = async (data: ReceiptData, imageUrl?: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'receipts'), {
        ...data,
        userId: user.uid,
        createdAt: new Date().toISOString(),
        date: data.Date, // Ensure field name matches rules
        merchant: data.Merchant_Name,
        category: data.Category,
        amount: data.Total_Amount,
        currency: 'USD', // Default
        shortDescription: data.Short_Description,
        imageUrl: imageUrl || null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'receipts');
    }
  };

  const deleteFromHistory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'receipts', id));
      toast.success("Deleted from history");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'receipts');
    }
  };

  // --- Accessibility Helpers ---
  const announce = useCallback((message: string) => {
    setAnnouncement(message);
    if (isVoiceMode) {
      speakText(message);
    }
  }, [isVoiceMode]);

  const speakText = async (text: string) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_TTS_MODEL,
        contents: [{ parts: [{ text }] }],
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
        const audio = new Audio(audioUrl);
        audio.play();
      }
    } catch (error) {
      console.error("Voice Mode Error:", error);
    }
  };

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
      announce(`Analyzing receipt from ${processedFile.file.name}`);
      
      // Upload to Firebase Storage first
      let imageUrl = '';
      if (user) {
        const storageRef = ref(storage, `receipts/${user.uid}/${Date.now()}_${processedFile.file.name}`);
        const uploadResult = await uploadBytes(storageRef, processedFile.file);
        imageUrl = await getDownloadURL(uploadResult.ref);
      }

      const base64Data = await fileToBase64(processedFile.file);
      
      const tools = isEnhancedAI ? [{ googleSearch: {} }] : [];
      
      const response = await ai.models.generateContent({
        model: GEMINI_VISION_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: processedFile.file.type,
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
              
              ${isEnhancedAI ? "Use Google Search to verify the merchant's category if it's not clear from the receipt." : ""}
              
              Ensure the output is ONLY the JSON object.`,
            },
          ],
        },
        config: {
          tools,
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

      if (result.unreadable) {
        announce(`Could not read receipt from ${processedFile.file.name}. It might be blurry.`);
        toast.error(`Unreadable receipt: ${processedFile.file.name}`);
      } else {
        announce(`Successfully analyzed ${result.Merchant_Name}. Total amount: $${result.Total_Amount.toFixed(2)}.`);
        toast.success(`Processed ${result.Merchant_Name}`);
        if (user) {
          await saveReceiptToFirestore(result, imageUrl);
        }
      }

      setFiles(prev => prev.map(f => 
        f.id === processedFile.id 
          ? { ...f, status: result.unreadable ? 'error' : 'completed', data: result, error: result.unreadable ? 'Unreadable receipt' : undefined } 
          : f
      ));
    } catch (error) {
      console.error("Error processing receipt:", error);
      announce(`Error processing ${processedFile.file.name}`);
      toast.error(`Error processing ${processedFile.file.name}`);
      setFiles(prev => prev.map(f => 
        f.id === processedFile.id 
          ? { ...f, status: 'error', error: 'Failed to process' } 
          : f
      ));
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;

    const selectedFiles = Array.from(fileList);
    const newProcessedFiles: ProcessedFile[] = [];
    let zipCount = 0;

    for (const file of selectedFiles) {
      const f = file as File;
      if (f.name.toLowerCase().endsWith('.zip')) {
        zipCount++;
        try {
          const zip = new JSZip();
          const contents = await zip.loadAsync(f);
          const imageEntries = Object.values(contents.files).filter(
            entry => !entry.dir && entry.name.match(/\.(jpg|jpeg|png|webp)$/i)
          );

          for (const entry of imageEntries) {
            const blob = await entry.async('blob');
            const imageFile = new File([blob], entry.name, { type: `image/${entry.name.split('.').pop()}` });
            newProcessedFiles.push({
              id: Math.random().toString(36).substring(7),
              file: imageFile,
              preview: URL.createObjectURL(imageFile),
              status: 'pending' as const,
            });
          }
        } catch (error) {
          console.error("Error unzipping file:", error);
          toast.error(`Failed to unzip ${f.name}`);
        }
      } else if (f.type.startsWith('image/')) {
        newProcessedFiles.push({
          id: Math.random().toString(36).substring(7),
          file: f,
          preview: URL.createObjectURL(f),
          status: 'pending' as const,
        });
      }
    }

    if (newProcessedFiles.length > 0) {
      setFiles(prev => [...prev, ...newProcessedFiles]);
      const msg = zipCount > 0 
        ? `Extracted and added ${newProcessedFiles.length} images from ${zipCount} ZIP file(s).`
        : `Added ${newProcessedFiles.length} files for processing.`;
      announce(msg);
      toast.success(msg);
    } else if (zipCount > 0) {
      toast.error("No valid images found in the ZIP file(s).");
    }
  };

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setIsSubmittingFeedback(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log("Feedback Submitted:", { type: feedbackType, text: feedbackText });
    toast.success("Thank you! Your feedback has been sent to our team.");
    
    setIsSubmittingFeedback(false);
    setIsFeedbackOpen(false);
    setFeedbackText("");
  };

  const toggleVoiceControl = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice Control is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      announce("Listening for commands. You can say: Analyze all, Clear all, or Download report.");
    };

    recognition.onresult = (event: any) => {
      const command = event.results[0][0].transcript.toLowerCase();
      console.log("Voice Command:", command);

      if (command.includes("analyze all") || command.includes("process all")) {
        processAll();
      } else if (command.includes("clear all") || command.includes("remove all")) {
        clearAll();
      } else if (command.includes("download") || command.includes("excel")) {
        downloadExcel();
      } else if (command.includes("summary") || command.includes("read aloud")) {
        readAloudSummary();
      } else {
        announce(`I heard ${command}, but I don't know that command.`);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech Recognition Error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
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
    announce(`Starting analysis of ${pendingFiles.length} receipts.`);
    
    for (const file of pendingFiles) {
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'processing' } : f));
      await processReceipt(file);
    }
    
    setIsProcessingAll(false);
    announce("All receipts have been processed.");
    toast.success("All receipts processed! You can now download or email your report.", { duration: 5000 });
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

  const downloadExcel = (dataToExport?: any[]) => {
    const sourceData = dataToExport || files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);

    if (sourceData.length === 0) return;

    const sortedData = [...sourceData].sort((a, b) => {
      const dateA = a.Date || a.date;
      const dateB = b.Date || b.date;
      return dateA.localeCompare(dateB);
    }).map(item => ({
      Date: item.Date || item.date,
      Merchant: item.Merchant_Name || item.merchant,
      Category: item.Category || item.category,
      Amount: item.Total_Amount || item.amount,
      Description: item.Short_Description || item.shortDescription
    }));

    const itemizedSheet = XLSX.utils.json_to_sheet(sortedData);
    const total = sortedData.reduce((sum, item) => sum + item.Amount, 0);
    XLSX.utils.sheet_add_aoa(itemizedSheet, [
      [],
      ['Total Sum', '', '', total, '']
    ], { origin: -1 });

    const categorySummary = CATEGORIES.map(cat => {
      const catTotal = sortedData
        .filter(item => item.Category === cat)
        .reduce((sum, item) => sum + item.Amount, 0);
      return { Category: cat, Total_Amount: catTotal };
    }).filter(item => item.Total_Amount > 0);

    const summarySheet = XLSX.utils.json_to_sheet(categorySummary);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, itemizedSheet, "Itemized Bills");
    XLSX.utils.book_append_sheet(wb, summarySheet, "Category Summary");

    XLSX.writeFile(wb, `Receipt_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const sendEmailReport = async () => {
    if (!recipientEmail) {
      toast.error("Please enter a recipient email.");
      return;
    }

    const completedData = files
      .filter(f => f.status === 'completed' && f.data && !f.data.unreadable)
      .map(f => f.data!);

    if (completedData.length === 0) {
      toast.error("No data to send.");
      return;
    }

    setIsSendingEmail(true);
    try {
      const sortedData = [...completedData].sort((a, b) => a.Date.localeCompare(b.Date));
      const itemizedSheet = XLSX.utils.json_to_sheet(sortedData);
      const total = sortedData.reduce((sum, item) => sum + item.Total_Amount, 0);
      XLSX.utils.sheet_add_aoa(itemizedSheet, [[], ['Total Sum', '', '', total, '']], { origin: -1 });

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

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = `Receipt_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

      const formData = new FormData();
      formData.append('email', recipientEmail);
      formData.append('file', blob, fileName);

      const response = await fetch('/api/send-email', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success("Report sent successfully!");
        setIsEmailModalOpen(false);
        setRecipientEmail("");
      } else {
        const error = await response.json();
        throw new Error(error.error || "Failed to send email");
      }
    } catch (error: any) {
      console.error("Email Error:", error);
      toast.error(error.message || "Failed to send email. Check your SMTP settings.");
    } finally {
      setIsSendingEmail(false);
    }
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
      <a 
        href="#main-content" 
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-emerald-600 focus:text-white focus:rounded-lg focus:shadow-xl outline-none ring-2 ring-offset-2 ring-emerald-500"
      >
        Skip to content
      </a>

      <Toaster position="bottom-right" />
      
      {/* Screen Reader Live Region */}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

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
            {!user ? (
              <button
                onClick={loginWithGoogle}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 transition-all shadow-sm active:scale-95"
              >
                <LogIn size={16} />
                <span>Login</span>
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full border border-stone-200">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <UserIcon size={16} className="text-stone-400" />
                  )}
                  <span className="text-xs font-medium text-stone-700 hidden sm:inline">{user.displayName || user.email}</span>
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
                  title="Logout"
                >
                  <LogOut size={18} />
                </button>
              </div>
            )}

            <div className="h-6 w-px bg-stone-200 mx-1" />

            <button
              onClick={() => setIsEmailModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all shadow-sm active:scale-95"
              aria-label="Send Report via Email"
              title="Email the generated Excel report"
            >
              <Mail size={16} />
              <span className="hidden sm:inline">Email Report</span>
            </button>

            <button
              onClick={() => {
                setIsEnhancedAI(!isEnhancedAI);
                toast(isEnhancedAI ? "Enhanced AI Disabled" : "Enhanced AI Enabled (with Google Search)", { icon: '🔍' });
              }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95",
                isEnhancedAI ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              )}
              aria-label={isEnhancedAI ? "Disable Enhanced AI" : "Enable Enhanced AI"}
              title="Enable Google Search Grounding for better accuracy"
            >
              <RefreshCw size={16} className={cn(isEnhancedAI && "animate-spin-slow")} />
              <span className="hidden sm:inline">Enhanced AI</span>
            </button>

            <button
              onClick={toggleVoiceControl}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95",
                isListening ? "bg-rose-100 text-rose-700 animate-pulse" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              )}
              aria-label={isListening ? "Stop Listening" : "Start Voice Control"}
              title="Voice Control: Say commands like 'Analyze all'"
            >
              <Volume2 size={16} />
              <span className="hidden sm:inline">{isListening ? "Listening..." : "Voice Control"}</span>
            </button>

            <button
              onClick={() => {
                setIsVoiceMode(!isVoiceMode);
                toast(isVoiceMode ? "Voice Mode Disabled" : "Voice Mode Enabled", { icon: '🎙️' });
              }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95",
                isVoiceMode ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              )}
              aria-label={isVoiceMode ? "Disable Voice Mode" : "Enable Voice Mode"}
              title="Accessibility: Voice Mode"
            >
              {isVoiceMode ? <Accessibility size={16} /> : <Accessibility size={16} className="opacity-50" />}
              <span className="hidden sm:inline">Voice Mode</span>
            </button>

            {files.some(f => f.status === 'completed') && (
              <>
                <button
                  onClick={readAloudSummary}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95",
                    isReadingAloud ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                  )}
                  aria-label={isReadingAloud ? "Stop reading summary" : "Read financial summary aloud"}
                >
                  {isReadingAloud ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
                  <span className="hidden sm:inline">{isReadingAloud ? "Reading..." : "Read Summary"}</span>
                </button>
                <button
                  onClick={downloadExcel}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm hover:shadow-md active:scale-95"
                  aria-label="Download Excel Report"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Excel Report</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="max-w-5xl mx-auto px-6 py-12 outline-none">
        {/* Tabs */}
        <div className="flex justify-center mb-12">
          <div className="bg-stone-100 p-1 rounded-2xl flex gap-1">
            <button
              onClick={() => setActiveTab('upload')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                activeTab === 'upload' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              <Upload size={18} />
              Upload
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all",
                activeTab === 'history' ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
              )}
            >
              <History size={18} />
              History
            </button>
          </div>
        </div>

        {activeTab === 'upload' ? (
          <>
            {/* Hero Section */}
            <section className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold tracking-tight mb-4 text-stone-900">
            Financial Clarity, Simplified.
          </h2>
          <p className="text-stone-600 text-lg leading-relaxed">
            Upload your receipts and let AI organize your expenses. No more manual data entry.
          </p>
          
          {/* Accessibility Info */}
          <div className="mt-6 flex items-center justify-center gap-2 text-stone-400 text-sm bg-stone-100/50 py-2 px-4 rounded-full w-fit mx-auto">
            <Info size={14} />
            <span>Screen reader friendly. Try <strong>Voice Mode</strong> for automatic audio feedback.</span>
          </div>
        </section>

        {/* Upload Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1">
            <div 
              className={cn(
                "border-2 border-dashed border-stone-300 rounded-2xl p-8 bg-white transition-all hover:border-emerald-400 group cursor-pointer focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 outline-none",
                files.length === 0 ? "h-64 flex flex-col items-center justify-center" : "h-auto"
              )}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  fileInputRef.current?.click();
                }
              }}
              tabIndex={0}
              role="button"
              aria-label="Upload Receipts or ZIP folders. Supports PNG, JPG, JPEG, and ZIP."
            >
              <input 
                type="file" 
                multiple 
                accept="image/*,.zip" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileSelect}
              />
              <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <Upload size={24} />
              </div>
              <p className="font-medium text-stone-800">Upload Receipts or ZIP</p>
              <p className="text-xs text-stone-500 mt-1">Images or ZIP archives supported</p>
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
                      <RefreshCw size={18} />
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
                            <p className="font-medium text-stone-900 truncate" aria-label={`File name: ${file.file.name}`}>
                              {file.file.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1" role="status">
                              {file.status === 'pending' && <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full uppercase font-bold">Pending</span>}
                              {file.status === 'processing' && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><Loader2 size={10} className="animate-spin" />Analyzing</span>}
                              {file.status === 'completed' && <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><CheckCircle2 size={10} />Success</span>}
                              {file.status === 'error' && <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase font-bold"><AlertCircle size={10} />{file.error || 'Error'}</span>}
                            </div>
                          </div>
                          
                          <div className="flex gap-1">
                            {file.status === 'completed' && user && (
                              <button 
                                onClick={() => saveReceiptToFirestore(file.data)}
                                className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                aria-label="Save to history"
                                title="Save to history"
                              >
                                <Save size={16} />
                              </button>
                            )}
                            {file.status === 'completed' && (
                              <button 
                                onClick={() => toggleEdit(file.id)}
                                className={cn(
                                  "p-2 rounded-lg transition-colors",
                                  file.isEditing ? "bg-emerald-50 text-emerald-600" : "text-stone-400 hover:text-stone-600 hover:bg-stone-50"
                                )}
                                aria-label={file.isEditing ? "Save changes" : "Edit receipt data"}
                              >
                                {file.isEditing ? <Save size={16} /> : <Edit2 size={16} />}
                              </button>
                            )}
                            <button 
                              onClick={() => removeFile(file.id)}
                              className="p-2 text-stone-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                              aria-label={`Remove ${file.file.name}`}
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

            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm">
                <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Download className="text-stone-400" size={20} />
                  Local Export
                </h4>
                <p className="text-sm text-stone-500 mb-6">
                  Download your data as a professional Excel spreadsheet for offline use or tax preparation.
                </p>
                <button
                  onClick={downloadExcel}
                  className="w-full flex items-center justify-center gap-3 bg-stone-900 hover:bg-stone-800 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
                >
                  <Download size={20} />
                  Download Excel
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm">
                <h4 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Mail className="text-emerald-600" size={20} />
                  Email Delivery
                </h4>
                <p className="text-sm text-stone-500 mb-6">
                  Send this report directly to your inbox or your accountant. Fast, secure, and convenient.
                </p>
                <div className="space-y-4">
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="Enter recipient email..."
                    className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                  <button
                    onClick={sendEmailReport}
                    disabled={isSendingEmail || !recipientEmail}
                    className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:shadow-xl active:scale-95"
                  >
                    {isSendingEmail ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    {isSendingEmail ? "Sending..." : "Send to Email"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
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
          </>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight text-stone-900">Receipt History</h2>
                <p className="text-stone-500 mt-1">View and manage your past financial records.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2 shadow-sm">
                  <Filter size={16} className="text-stone-400" />
                  <select 
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="text-sm font-medium bg-transparent focus:outline-none"
                  >
                    <option value="">All Months</option>
                    {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(m => (
                      <option key={m} value={m}>{new Date(2024, parseInt(m)-1).toLocaleString('default', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2 shadow-sm">
                  <Search size={16} className="text-stone-400" />
                  <input 
                    type="date"
                    value={filterMonth === "custom" ? filterYear : ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        setFilterMonth("custom");
                        setFilterYear(e.target.value);
                      } else {
                        setFilterMonth("");
                        setFilterYear(new Date().getFullYear().toString());
                      }
                    }}
                    className="text-sm font-medium bg-transparent focus:outline-none"
                  />
                </div>

                <button
                  onClick={async () => {
                    if (!user) return;
                    if (!confirm("Are you sure you want to clear all history?")) return;
                    try {
                      const q = query(collection(db, "receipts"), where("userId", "==", user.uid));
                      const snapshot = await getDocs(q);
                      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
                      await Promise.all(deletePromises);
                      setHistory([]);
                      toast.success("History cleared");
                    } catch (error) {
                      console.error("Error clearing history:", error);
                      toast.error("Failed to clear history");
                    }
                  }}
                  className="flex items-center gap-2 bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-rose-100 transition-all shadow-md active:scale-95"
                >
                  <Trash2 size={16} />
                  Clear All
                </button>

                <button
                  onClick={() => {
                    if (user) {
                      const q = query(collection(db, "receipts"), where("userId", "==", user.uid), orderBy("date", "desc"));
                      onSnapshot(q, (snapshot) => {
                        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        setHistory(data);
                      });
                      toast.success("History refreshed");
                    }
                  }}
                  className="flex items-center justify-center w-10 h-10 bg-stone-100 text-stone-600 rounded-xl hover:bg-stone-200 transition-all shadow-md active:scale-95"
                >
                  <RefreshCw size={16} />
                </button>

                <button
                  onClick={() => {
                    const filtered = history.filter(item => {
                      const date = item.date || item.Date;
                      if (filterMonth === "custom") {
                        return date === filterYear;
                      }
                      const [y, m] = date.split('-');
                      return (filterYear ? y === filterYear : true) && (filterMonth ? m === filterMonth : true);
                    });
                    downloadExcel(filtered);
                  }}
                  className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-stone-800 transition-all shadow-md active:scale-95"
                >
                  <Download size={16} />
                  Export Filtered
                </button>
              </div>
            </div>

            {!user ? (
              <div className="bg-white rounded-3xl border border-stone-200 p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6 text-stone-300">
                  <UserIcon size={32} />
                </div>
                <h3 className="text-xl font-bold mb-2">Login to view history</h3>
                <p className="text-stone-500 mb-8 max-w-xs mx-auto">Your receipt history is securely stored and synced across your devices.</p>
                <button
                  onClick={loginWithGoogle}
                  className="inline-flex items-center gap-2 bg-stone-900 text-white px-8 py-4 rounded-2xl font-bold hover:bg-stone-800 transition-all shadow-lg active:scale-95"
                >
                  <LogIn size={20} />
                  Login with Google
                </button>
              </div>
            ) : history.length === 0 ? (
              <div className="bg-white rounded-3xl border border-stone-200 p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6 text-stone-300">
                  <History size={32} />
                </div>
                <h3 className="text-xl font-bold mb-2">No history yet</h3>
                <p className="text-stone-500 max-w-xs mx-auto">Start uploading receipts to build your financial history.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {history
                  .filter(item => {
                    const date = item.date || item.Date;
                    const [y, m] = date.split('-');
                    return (filterYear ? y === filterYear : true) && (filterMonth ? m === filterMonth : true);
                  })
                  .map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white rounded-2xl border border-stone-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                          <Receipt size={24} />
                        </div>
                        <div>
                          <h4 className="font-bold text-stone-900">{item.merchant || item.Merchant_Name}</h4>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-stone-400 flex items-center gap-1">
                              <Calendar size={12} />
                              {item.date || item.Date}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 uppercase">
                              {item.category || item.Category}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-6">
                        <div className="text-right">
                          <p className="text-lg font-bold text-stone-900">${(item.amount || item.Total_Amount).toFixed(2)}</p>
                          <p className="text-[10px] text-stone-400 italic truncate max-w-[150px]">{item.shortDescription || item.Short_Description}</p>
                        </div>
                        <button
                          onClick={() => deleteFromHistory(item.id)}
                          className="p-2 text-stone-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Email Report Modal */}
      <AnimatePresence>
        {isEmailModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-stone-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-emerald-50">
                <div className="flex items-center gap-2">
                  <Mail className="text-emerald-600" size={20} />
                  <h3 className="font-bold text-lg">Email Report</h3>
                </div>
                <button 
                  onClick={() => setIsEmailModalOpen(false)}
                  className="p-2 hover:bg-stone-200 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <p className="text-sm text-stone-600">
                    Enter the recipient's email address to send the generated Excel report.
                  </p>
                  <div>
                    <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Recipient Email</label>
                    <input
                      type="email"
                      required
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="example@email.com"
                      className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-3">
                  <Info className="text-amber-600 flex-shrink-0" size={18} />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>Note:</strong> Ensure <code>EMAIL_USER</code> and <code>EMAIL_PASS</code> are configured in the app's Secrets panel.
                  </p>
                </div>

                <button
                  onClick={sendEmailReport}
                  disabled={isSendingEmail || !recipientEmail}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white rounded-2xl font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  {isSendingEmail ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Send size={20} />
                  )}
                  {isSendingEmail ? "Sending..." : "Send Report"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Feedback Modal */}
      <AnimatePresence>
        {isFeedbackOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-stone-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50">
                <div className="flex items-center gap-2">
                  <MessageSquare className="text-emerald-600" size={20} />
                  <h3 className="font-bold text-lg">Report an Issue</h3>
                </div>
                <button 
                  onClick={() => setIsFeedbackOpen(false)}
                  className="p-2 hover:bg-stone-200 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={submitFeedback} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Issue Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['bug', 'ui', 'performance'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFeedbackType(type)}
                        className={cn(
                          "py-2 px-3 rounded-xl text-xs font-bold capitalize transition-all border",
                          feedbackType === type 
                            ? "bg-emerald-600 border-emerald-600 text-white shadow-md" 
                            : "bg-white border-stone-200 text-stone-500 hover:border-emerald-200"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Description</label>
                  <textarea
                    required
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Describe the issue you encountered..."
                    className="w-full h-32 p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingFeedback}
                  className="w-full py-4 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  {isSubmittingFeedback ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Send size={20} />
                  )}
                  {isSubmittingFeedback ? "Sending..." : "Submit Report"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
          
          <button 
            onClick={() => setIsFeedbackOpen(true)}
            className="mt-8 inline-flex items-center gap-2 text-stone-400 hover:text-emerald-600 text-xs font-bold uppercase tracking-widest transition-colors"
          >
            <Bug size={14} />
            Report a Bug or UI Issue
          </button>
        </div>
      </footer>
    </div>
  );
}
