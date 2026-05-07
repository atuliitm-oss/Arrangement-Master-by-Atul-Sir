/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  UserX, Search, UserCheck, Clock, Calendar as CalendarIcon, 
  AlertCircle, CheckCircle2, Users, Wand2, Share2, Upload, 
  Trash2, Plus, FileSpreadsheet, X, Save, UserPlus, Info, Check, MessageCircle, Copy, CheckCircle, ShieldAlert, BarChart3, Filter, ArrowLeft
} from 'lucide-react';
import { db } from './lib/firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot, 
  writeBatch,
  serverTimestamp,
  arrayRemove,
  deleteField,
  FieldPath
} from 'firebase/firestore';

// एक्सेल लाइब्रेरी (SheetJS) लोड करने के लिए फंक्शन
const loadXlsxScript = () => {
  return new Promise<void>((resolve) => {
    if ((window as any).XLSX) return resolve();
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
};

interface Teacher {
  id?: string;
  name: string;
  total: number;
  schedule: {
    [day: string]: string[];
  };
}

const extractClassNum = (s: string): number | null => {
  if (!s || s === "—") return null;
  const match = s.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
};

const getClassGroup = (num: number | null): string | null => {
  if (num === null) return null;
  if (num >= 3 && num <= 5) return '3-5';
  if (num >= 6 && num <= 8) return '6-8';
  if (num >= 9 && num <= 12) return '9-12';
  return null;
};

export default function App() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  
  // Persistent Daily Data Structure
  const [dailyRegistry, setDailyRegistry] = useState<{[date: string]: any}>({});
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stagedTeachers, setStagedTeachers] = useState<Teacher[] | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [copyStatus, setCopyStatus] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<'daily' | 'manage'>('daily');
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [teacherToDelete, setTeacherToDelete] = useState<Teacher | null>(null);
  const [selectedNoticeItem, setSelectedNoticeItem] = useState<{name: string, date: string} | null>(null);

  // Derive current day data from registry
  const currentDayData = useMemo(() => {
    return dailyRegistry[selectedDate] || { absent: [], confirmed: false, arrangements: {} };
  }, [selectedDate, dailyRegistry]);

  // New: Derive all future absences for management overview
  const futureAbsences = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const upcoming: { date: string, teachers: string[] }[] = [];
    Object.keys(dailyRegistry).forEach(date => {
      if (date > todayStr && dailyRegistry[date].absent?.length > 0) {
        upcoming.push({ date, teachers: dailyRegistry[date].absent });
      }
    });
    return upcoming.sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyRegistry]);

  const absentTeachers = currentDayData.absent || [];
  const confirmedAbsent = currentDayData.confirmed || false;
  const arrangements = currentDayData.arrangements || {};

  // New: Notice Board Logic (Aggregating upcoming absences by teacher)
  const noticeBoardData = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const teacherMap: { [name: string]: string[] } = {};

    Object.keys(dailyRegistry).forEach(date => {
      // Show only current and future absences on the notice board
      if (date >= todayStr && dailyRegistry[date].absent?.length > 0) {
        dailyRegistry[date].absent.forEach((name: string) => {
          if (!teacherMap[name]) teacherMap[name] = [];
          if (!teacherMap[name].includes(date)) teacherMap[name].push(date);
        });
      }
    });

    return Object.entries(teacherMap)
      .map(([name, dates]) => ({ name, dates: dates.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dailyRegistry]);

  // बिज़नेस रूल्स
  const RESTRICTED_NAMES = ["anju", "vatsa", "neetu"];
  const LOW_PRIORITY_NAMES = ["atul", "madhuri", "rekha", "prabha", "nisha"];
  const MAX_LIMIT = 2; 

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const periods = ["1st P", "2nd P", "3rd P", "4th P", "5th P", "6th P", "7th P", "8th P"];

  const teacherGroupsMap = useMemo(() => {
    const map: {[name: string]: string[]} = {};
    teachers.forEach(t => {
      const groups = new Set<string>();
      (Object.values(t.schedule) as string[][]).forEach(day => {
        day.forEach(cell => {
          const g = getClassGroup(extractClassNum(cell));
          if (g) groups.add(g);
        });
      });
      map[t.name] = Array.from(groups);
    });
    return map;
  }, [teachers]);

  const selectedDay = useMemo(() => {
    if (!selectedDate) return "Monday";
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return dayNames[date.getDay()];
  }, [selectedDate]);

  // सब्स्टिट्यूट काउंट ट्रैकर
  const subCounts = useMemo(() => {
    const counts: {[name: string]: number} = {};
    Object.values(arrangements).forEach(pArr => {
      Object.values(pArr).forEach(sub => { if(sub) counts[sub] = (counts[sub] || 0) + 1; });
    });
    return counts;
  }, [arrangements]);

  const getFreeTeachers = (periodIndex: number, currentPeriodSubs: {[name: string]: string} = {}, targetGroup: string | null = null) => {
    const inThisPeriod = Object.values(currentPeriodSubs);
    return teachers.filter(t => {
      const sched = t.schedule[selectedDay];
      const isFree = sched && (sched[periodIndex] === "—" || !sched[periodIndex] || sched[periodIndex].trim() === "");
      const isBlocked = RESTRICTED_NAMES.some(r => t.name.toLowerCase().includes(r));
      const isAtulSkipped = t.name.toLowerCase().includes("atul") && !["Tuesday", "Thursday"].includes(selectedDay);
      
      const isGroupMatch = !targetGroup || (teacherGroupsMap[t.name] || []).includes(targetGroup);
      
      const myCount = subCounts[t.name] || 0;
      return isFree && !absentTeachers.includes(t.name) && !isBlocked && !isAtulSkipped && isGroupMatch && !inThisPeriod.includes(t.name) && myCount < MAX_LIMIT;
    }).sort((a, b) => {
      const isLowA = LOW_PRIORITY_NAMES.some(lp => a.name.toLowerCase().includes(lp));
      const isLowB = LOW_PRIORITY_NAMES.some(lp => b.name.toLowerCase().includes(lp));
      if (isLowA && !isLowB) return 1;
      if (!isLowA && isLowB) return -1;
      
      const dailyA = (a.schedule?.[selectedDay] || []).filter(p => typeof p === 'string' && p.trim() !== "" && p !== "—").length;
      const dailyB = (b.schedule?.[selectedDay] || []).filter(p => typeof p === 'string' && p.trim() !== "" && p !== "—").length;
      
      if (dailyA !== dailyB) return dailyA - dailyB;
      return (a.total || 0) - (b.total || 0);
    });
  };

  // Load Initial Data
  useEffect(() => {
    loadXlsxScript();
  }, []);

  // Sync Teachers from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "teachers"), (snap) => {
      try {
        const list: Teacher[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || "Unknown",
            total: data.total || 0,
            schedule: data.schedule || {}
          } as Teacher;
        });
        setTeachers(list.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        setIsLoading(false);
      } catch (err) {
        console.error("Teacher Sync Error", err);
        setIsLoading(false);
      }
    }, (error) => {
      console.error("Firestore Listen Error (Teachers):", error);
      setIsLoading(false);
      if (error.code === 'permission-denied') {
        alert("डेटाबेस लोड करने की अनुमति नहीं है। (Permission Denied)");
      }
    });
    return () => unsub();
  }, []);

  // Sync Daily Data from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "dailyData"), (snap) => {
      const reg: {[date: string]: any} = {};
      snap.docs.forEach(d => {
        reg[d.id] = d.data();
      });
      setDailyRegistry(reg);
    }, (error) => {
      console.error("Firestore Listen Error (DailyData):", error);
    });
    return () => unsub();
  }, []);

  // Save Daily Data to Firestore
  const updateDailyData = async (updates: any) => {
    try {
      const docRef = doc(db, "dailyData", selectedDate);
      
      // Try update first as it naturally handles overwriting top-level fields (like arrangements object)
      // without performing a shallow recursive merge like setDoc merge:true does.
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      }).catch(async (e) => {
        // If document doesn't exist, use setDoc to create it
        if (e.code === 'not-found') {
          await setDoc(docRef, {
            absent: [],
            confirmed: false,
            arrangements: {},
            ...updates,
            updatedAt: serverTimestamp()
          });
        } else {
          throw e;
        }
      });
    } catch (err) {
      console.error("Firestore Update Error", err);
    }
  };

  const toggleAbsentTeacher = (name: string) => {
    if (confirmedAbsent) return;
    const newAbsent = absentTeachers.includes(name) 
      ? absentTeachers.filter(t => t !== name) 
      : [...absentTeachers, name];
    
    updateDailyData({ absent: newAbsent });
  };

  const handleConfirmAbsent = (val: boolean) => {
    updateDailyData({ confirmed: val });
  };

  const handleClearTodayAbsent = async () => {
    if (confirmedAbsent) return;
    if (window.confirm("क्या आप आज की अनुपस्थित लिस्ट को पूरी तरह साफ़ करना चाहते हैं?")) {
      updateDailyData({ absent: [] });
    }
  };

  const handleUpdateArrangements = (newArr: any) => {
    updateDailyData({ arrangements: newArr });
  };

  const handleDeleteNoticeItem = async () => {
    if (!selectedNoticeItem) return;
    const { name, date } = selectedNoticeItem;
    const dateFormatted = date.split('-').reverse().join('/');
    
    if (!window.confirm(`${name} का ${dateFormatted} का एब्सेंट रिकॉर्ड हटाना चाहते हैं?`)) return;

    try {
      setIsProcessing(true);
      const docRef = doc(db, "dailyData", date);
      
      // Use arrayRemove for atomic and reliable deletion
      await updateDoc(docRef, {
        absent: arrayRemove(name),
        updatedAt: serverTimestamp()
      });
      
      setSelectedNoticeItem(null);
      alert("रिकॉर्ड सफलतापूर्वक हटा दिया गया है!");
    } catch (err: any) {
      console.error("Notice Board Delete Error:", err);
      
      // Fallback: If document doesn't exist or update fails, try setDoc
      try {
        const docRef = doc(db, "dailyData", date);
        const dayData = dailyRegistry[date] || {};
        const currentAbsent = Array.isArray(dayData.absent) ? dayData.absent : [];
        const newAbsent = currentAbsent.filter((t: string) => t !== name);
        
        await setDoc(docRef, {
          absent: newAbsent,
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        setSelectedNoticeItem(null);
        alert("रिकॉर्ड सफलतापूर्वक हटा दिया गया है!");
      } catch (innerErr) {
        alert("हटाने में विफल: " + (err.message || "डेटाबेस एरर"));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTeacher = async (teacher: Teacher) => {
    if (!teacher.id) {
      alert("डिलीट करने में विफल: टीचर आईडी नहीं मिली।");
      return;
    }

    try {
      setIsProcessing(true);
      const targetId = teacher.id;
      
      await deleteDoc(doc(db, "teachers", targetId));
      
      if (absentTeachers.includes(teacher.name)) {
        const newAbsent = absentTeachers.filter(t => t !== teacher.name);
        await updateDailyData({ absent: newAbsent });
      }
      
      setTeacherToDelete(null);
      alert(`"${teacher.name}" को सफलतापूर्वक हटा दिया गया है।`);
    } catch (err: any) {
      console.error("Delete Error for ID:", teacher.id, err);
      alert(`डिलीट नहीं हो पाया: ${err.code || "Error"} - ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearDatabase = async () => {
    const confirmClear = window.confirm("सावधान! क्या आप वाकई डेटाबेस से सभी टीचर्स को हटाना चाहते हैं? यह प्रक्रिया वापस नहीं ली जा सकती।");
    if (!confirmClear) return;

    try {
      setIsProcessing(true);
      const batch = writeBatch(db);
      teachers.forEach(t => {
        if (t.id) {
          batch.delete(doc(db, "teachers", t.id));
        }
      });
      await batch.commit();
      alert("पूरा डेटाबेस साफ़ कर दिया गया है।");
    } catch (err: any) {
      alert("एरर: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleTeacherSelection = (id: string) => {
    if (!id) return;
    setSelectedTeachers(prev => 
      prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedTeachers.length === 0) {
      alert("डिलीट करने के लिए कोई टीचर सिलेक्ट नहीं किया गया है।");
      return;
    }
    const confirmDelete = window.confirm(`क्या आप वाकई इन ${selectedTeachers.length} टीचर्स को डिलीट करना चाहते हैं?`);
    if (!confirmDelete) return;

    try {
      setIsProcessing(true);
      const batch = writeBatch(db);
      
      const teacherNamesToDelete: string[] = [];
      const idsToProcess = [...selectedTeachers];
      
      idsToProcess.forEach(id => {
        const teacher = teachers.find(t => t.id === id);
        if (teacher) {
          teacherNamesToDelete.push(teacher.name);
        }
        batch.delete(doc(db, "teachers", id));
      });
      
      await batch.commit();
      
      // Update absent list if any deleted teachers were in it
      const newAbsent = absentTeachers.filter(n => !teacherNamesToDelete.includes(n));
      if (newAbsent.length !== absentTeachers.length) {
        await updateDailyData({ absent: newAbsent });
      }

      setSelectedTeachers([]);
      alert("चुने हुए टीचर्स को सफलता पूर्वक डेटाबेस से हटा दिया गया है।");
    } catch (err: any) {
      console.error("Bulk Delete Error:", err);
      alert(`डिलीट करने में त्रुटि: ${err.code || "Unknown"} - ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const autoArrangeAll = () => {
    // Deep clone arrangements to avoid mutation
    const newArr: any = {};
    Object.keys(arrangements).forEach(pIdx => {
      newArr[pIdx] = { ...arrangements[pIdx] };
    });

    const tempCounts = { ...subCounts };
    periods.forEach((_, pIdx) => {
      if (!newArr[pIdx]) newArr[pIdx] = {};
      absentTeachers.forEach(absName => {
        const absT = teachers.find(t => t.name === absName);
        const classInfo = absT?.schedule[selectedDay]?.[pIdx];
        if (classInfo && classInfo !== "—" && !newArr[pIdx][absName]) {
          const targetGroup = getClassGroup(extractClassNum(classInfo));
          let available = getFreeTeachers(pIdx, newArr[pIdx], targetGroup);
          
          if (available.length === 0) {
            available = getFreeTeachers(pIdx, newArr[pIdx], null);
          }
          
          const bestFit = available.find(t => (tempCounts[t.name] || 0) < MAX_LIMIT);
          if (bestFit) {
            newArr[pIdx][absName] = bestFit.name;
            tempCounts[bestFit.name] = (tempCounts[bestFit.name] || 0) + 1;
          }
        }
      });
    });
    handleUpdateArrangements(newArr);
  };

  const generateReport = () => {
    let msg = `*📝 Teacher Arrangement Report - ${selectedDate}*\n`;
    msg += `*Date:* ${selectedDate} (${selectedDay})\n`;
    msg += `*Absent:* ${absentTeachers.join(', ')}\n`;
    msg += `--------------------------\n\n`;
    absentTeachers.forEach(absName => {
      msg += `📍 *Classes for ${absName}:* \n`;
      let hasClass = false;
      periods.forEach((pName, pIdx) => {
        const absT = teachers.find(t => t.name === absName);
        const classInfo = absT?.schedule[selectedDay]?.[pIdx];
        if (classInfo && classInfo !== "—") {
          const sub = (arrangements[pIdx] && arrangements[pIdx][absName]) || "_VACANT_";
          msg += `• ${pName} (${classInfo}): *${sub}*\n`;
          hasClass = true;
        }
      });
      if (!hasClass) msg += `_No classes scheduled today_\n`;
      msg += `\n`;
    });
    msg += `--------------------------\n_Smart ArrangeMaster by Atul Sharma Sir_`;
    return msg;
  };

  const handleCopy = () => {
    const msg = generateReport();
    const el = document.createElement('textarea');
    el.value = msg;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute'; el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); setCopyStatus(true); setTimeout(() => setCopyStatus(false), 2000); } catch (err) { alert('Copy Error'); }
    document.body.removeChild(el);
  };

  const handleShare = () => {
    const msg = generateReport();
    window.location.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setUploadProgress(10);
    const reader = new FileReader();
    
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        setUploadProgress(40);
        const XLSX = (window as any).XLSX;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        const newList: Teacher[] = [];
        const seenNames = new Set<string>();
        let curName = "";
        
        setUploadProgress(70);
        data.forEach((row, idx) => {
          if (idx < 2) return;
          
          const rawCell = row[0] ? row[0].toString().split('\n')[0].trim() : "";
          const cleanedName = rawCell.split(/\s*[-()|/]\s*/)[0].trim();
          
          // Improved: Skip numeric values and class-like patterns (e.g., 10th A, 3rd B, 10-A, VII-B)
          const isNumeric = /^\d+$/.test(cleanedName);
          const isClass = /^\d+\s*(st|nd|rd|th)/i.test(cleanedName) || 
                          cleanedName.toLowerCase().startsWith('class ') ||
                          /^\d+[- ]?[A-Z0-9]$/i.test(cleanedName) ||
                          /^(I|II|III|IV|V|VI|VII|VIII|IX|X)[- ]?[A-Z]$/i.test(cleanedName);
          const finalName = (cleanedName && !isNumeric && !isClass) ? cleanedName : (cleanedName ? "" : curName);
          
          const rawDay = row[1] ? row[1].toString().trim() : "";
          const day = days.find(d => 
            d.toLowerCase().startsWith(rawDay.toLowerCase().substring(0, 3))
          ) || "";

          if (finalName && day) {
            curName = finalName;
            const name = finalName;
            const sched = row.slice(2, 10).map(c => (c !== undefined && c !== null) ? String(c).trim() : "—");
            while (sched.length < 8) sched.push("—");
            if (sched.length > 8) sched.length = 8;

            if (seenNames.has(name)) {
              const existing = newList.find(t => t.name === name);
              if (existing) existing.schedule[day] = sched;
            } else {
              seenNames.add(name);
              const totalVal = row[10] !== undefined ? parseInt(String(row[10])) : 0;
              newList.push({ 
                name, 
                total: isNaN(totalVal) ? 0 : totalVal, 
                schedule: { [day]: sched } 
              });
            }
          }
        });

        if (newList.length === 0) {
          alert("एक्सेल फाइल में कोई टीचर डेटा नहीं मिला। कृपया फॉर्मेट चेक करें।");
        } else {
          setStagedTeachers(newList);
        }
      } catch (err) {
        console.error("Excel Error:", err);
        alert("एक्सेल फाइल पढ़ने में त्रुटि हुई।");
      } finally {
        setIsProcessing(false);
        setUploadProgress(0);
      }
    };
    reader.readAsBinaryString(file);
  };

  const saveStagedData = async () => {
    if (!stagedTeachers || stagedTeachers.length === 0) return;

    setIsProcessing(true);
    setUploadProgress(5);

    try {
      // JSON Serialization is the most reliable way to strip 'undefined' while preserving structure
      const deepSanitize = (obj: any): any => {
        return JSON.parse(
          JSON.stringify(obj, (key, value) => (value === undefined ? null : value))
        );
      };

      const chunkSize = 400;
      const total = stagedTeachers.length;
      
      for (let i = 0; i < total; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = stagedTeachers.slice(i, i + chunkSize);
        let opCount = 0;
        
        chunk.forEach(t => {
          const name = String(t.name || "").trim();
          if (!name) return;
          
          // Sanitization: Firestore IDs cannot contain / and should be well-formed.
          const docId = name.replace(/[\/\.\#\$\[\]]/g, "-").trim().substring(0, 150);
          
          if (docId) {
            const rawTeacher = {
              name: name,
              total: Number(t.total) || 0,
              schedule: t.schedule || {}
            };
            
            // Final safety pass
            const sanitizedTeacher = deepSanitize(rawTeacher);

            const tRef = doc(db, "teachers", docId);
            batch.set(tRef, sanitizedTeacher);
            opCount++;
          }
        });

        if (opCount > 0) {
          await batch.commit();
        }
        
        const progress = Math.floor(((i + chunk.length) / total) * 80);
        setUploadProgress(progress);
      }

      setUploadProgress(90);
      await updateDailyData({ absent: [], confirmed: false, arrangements: {} });
      setUploadProgress(100);
      
      setStagedTeachers(null);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
      
      alert(`बधाई हो! ${total} टीचर्स का डेटा सफलतापूर्वक सेव हो गया है। अब आप टीचर डायरेक्टरी में नाम देख सकते हैं।`);
      
    } catch (err: any) {
      console.error("Firebase Save Error:", err);
      alert("सेव करने में समस्या आई: " + (err.message || "Unknown error"));
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setUploadProgress(0);
      }, 800);
    }
  };

  // सर्च फिल्टर शिक्षक सूची
  const filteredTeachers = teachers.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans pb-32">
      {/* Confirmation Modal */}
      {teacherToDelete && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div 
            className="bg-white rounded-[2.5rem] p-8 max-w-sm w-full shadow-2xl border border-white/20 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-red-600"></div>
            
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 text-red-500 rounded-[2rem] flex items-center justify-center shadow-inner">
                <Trash2 size={40} />
              </div>
              
              <div>
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">ध्यान दें! (Confirm)</h3>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-3 leading-relaxed">
                  क्या आप वाकई <span className="text-red-600 font-black">"{teacherToDelete.name}"</span> को डेटाबेस से हमेशा के लिए हटाना चाहते हैं?
                </p>
              </div>

              <div className="flex gap-3 w-full">
                <button 
                  onClick={() => setTeacherToDelete(null)}
                  className="flex-1 bg-slate-100 text-slate-600 p-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  नहीं, वापस जाएं
                </button>
                <button 
                  onClick={() => handleDeleteTeacher(teacherToDelete)}
                  className="flex-1 bg-red-600 text-white p-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-red-500/30 hover:bg-red-700 transition-all active:scale-95"
                >
                  हाँ, डिलीट करें
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-white/10 p-4 sticky top-0 z-[100] shadow-2xl overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-transparent to-emerald-500/10 pointer-events-none"></div>
        <div className="max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/40">
              <Wand2 className="text-white" size={20}/>
            </div>
            <div className="text-white">
              <h1 className="text-sm font-black tracking-widest leading-none uppercase">ARRANGEMASTER BY ATUL SHARMA SIR</h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[8px] font-bold text-indigo-400 uppercase">Unified Workload & Absentee List</p>
                <span className="text-[7px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-md font-black">
                  DB: {teachers.length} TEACHERS
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-black/40 rounded-xl p-1 flex items-center gap-1 border border-white/5 mr-4 overflow-hidden hidden md:flex">
                <button 
                  onClick={() => setViewMode('daily')}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-2 ${
                    viewMode === 'daily' ? "bg-indigo-600 text-white shadow-lg" : "text-white/40 hover:text-white"
                  }`}
                >
                  <Users size={14}/> अटेंडेंस
                </button>
                <button 
                  onClick={() => setViewMode('manage')}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all flex items-center gap-2 ${
                    viewMode === 'manage' ? "bg-red-600 text-white shadow-lg" : "text-white/40 hover:text-white"
                  }`}
                >
                  <Trash2 size={14}/> मैनेज डाटा
                </button>
              </div>
            
            <div className="bg-black/20 rounded-lg p-1.5 flex items-center gap-2 border border-white/5">
              <CalendarIcon size={14} className="text-indigo-400"/>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} 
                className="bg-transparent border-none text-[10px] font-black text-white outline-none cursor-pointer uppercase"/>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {viewMode === 'daily' ? (
          <div className="space-y-8">
            {/* Notice Board Section (Now at the absolute Top) */}
            {noticeBoardData.length > 0 && (
              <div className="w-full animate-in fade-in slide-in-from-top-4 duration-700">
                <div className="bg-slate-900 rounded-[3rem] p-8 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                  <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl"></div>
                  
                  <div className="relative">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h3 className="text-xl font-black text-white tracking-tight uppercase flex items-center gap-3">
                          <span className="bg-red-500 w-1.5 h-6 rounded-full"></span>
                          सूचना बोर्ड (NOTICE BOARD)
                        </h3>
                        <p className="text-indigo-400 text-[9px] font-black uppercase tracking-[0.2em] mt-1 ml-4">किसी तिथि को सिलेक्ट करके डिलीट करें</p>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {selectedNoticeItem && (
                          <button 
                            onClick={handleDeleteNoticeItem}
                            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase shadow-xl shadow-red-500/40 flex items-center gap-2 animate-in zoom-in-95"
                          >
                            <Trash2 size={16}/> रिकॉर्ड हटाएं
                          </button>
                        )}
                        <div className="hidden md:block">
                          <MessageCircle size={24} className="text-white/10" />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {noticeBoardData.map((item) => {
                        const hasSelection = selectedNoticeItem?.name === item.name;
                        return (
                          <div 
                            key={item.name} 
                            onClick={() => {
                              if (!hasSelection) {
                                setSelectedNoticeItem({ name: item.name, date: item.dates[0] });
                              }
                            }}
                            className={`bg-white/5 border backdrop-blur-md rounded-2xl p-4 hover:bg-white/10 transition-all cursor-pointer ${
                              hasSelection ? "border-indigo-500/50 bg-white/10 shadow-lg shadow-indigo-500/10" : "border-white/10"
                            }`}
                          >
                            <div className="flex items-center gap-3 mb-3">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs transition-colors ${
                                hasSelection ? "bg-indigo-500 text-white" : "bg-indigo-500/20 text-indigo-300"
                              }`}>
                                {item.name.charAt(0)}
                              </div>
                              <h4 className={`font-black text-xs uppercase tracking-tight transition-colors ${
                                hasSelection ? "text-white" : "text-slate-300"
                              }`}>{item.name}</h4>
                            </div>
                            
                            <div className="flex flex-wrap gap-1.5">
                              {item.dates.map(date => {
                                const isToday = date === new Date().toISOString().split('T')[0];
                                const isSelected = selectedNoticeItem?.name === item.name && selectedNoticeItem?.date === date;
                                return (
                                  <button 
                                    key={date} 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedNoticeItem(isSelected ? null : { name: item.name, date });
                                    }}
                                    className={`px-2 py-1 text-[8px] font-black rounded-lg border flex items-center gap-1 transition-all ${
                                      isSelected
                                        ? "bg-red-600 text-white border-red-500 shadow-lg scale-105"
                                        : isToday 
                                          ? "bg-red-500/20 text-red-400 border-red-500/30" 
                                          : "bg-white/5 text-slate-300 border-white/10 hover:border-indigo-500"
                                    }`}
                                  >
                                    {isToday && !isSelected && <div className="w-1 h-1 rounded-full bg-red-400 animate-pulse"></div>}
                                    {date.split('-').reverse().join('/')}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Selection Sidebar */}
            <div className="lg:col-span-5 space-y-4">
                <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Upload size={14} className="text-indigo-500"/> एक्सेल डाटा सोर्स
                    </h3>
                    
                    {!stagedTeachers ? (
                      <div className="relative group border-2 border-dashed border-indigo-50 rounded-2xl p-6 text-center hover:bg-indigo-50 transition-all cursor-pointer">
                        <input type="file" onChange={handleFileChange} accept=".xlsx, .xls" className="absolute inset-0 opacity-0 cursor-pointer" />
                        <FileSpreadsheet className="mx-auto text-indigo-200 mb-2" size={40}/>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">एक्सेल फाइल चुनें</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-indigo-50 p-4 rounded-2xl flex items-center justify-between">
                          <div>
                            <p className="text-[11px] font-black text-indigo-900 uppercase">फाइल तैयार है</p>
                            <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">{stagedTeachers.length} टीचर्स मिले</p>
                          </div>
                          <button onClick={() => setStagedTeachers(null)} className="text-slate-400 hover:text-red-500">
                            <X size={18} />
                          </button>
                        </div>
        
                        <div className="border border-slate-100 rounded-2xl overflow-hidden">
                          <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">प्रिव्यू (Preview)</p>
                          </div>
                          <div className="max-h-[150px] overflow-y-auto bg-white custom-scrollbar divide-y divide-slate-50">
                            {stagedTeachers.map((t, idx) => (
                              <div key={idx} className="px-4 py-2 flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-600">{t.name}</span>
                                <span className="text-[9px] font-black text-slate-400">P/W: {t.total}</span>
                              </div>
                            ))}
                          </div>
                        </div>
        
                        <button 
                          onClick={saveStagedData}
                          className="w-full bg-emerald-600 text-white p-4 rounded-xl font-black text-xs shadow-lg flex items-center justify-center gap-2 uppercase tracking-widest"
                        >
                          <Save size={16}/> डेटाबेस में सेव करें
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <BarChart3 size={14} className="text-indigo-500"/> टीचर डायरेक्टरी
                      </h3>
                      <div className="flex items-center gap-2">
                        {absentTeachers.length > 0 && !confirmedAbsent && (
                          <button 
                            onClick={handleClearTodayAbsent}
                            className="text-[8px] font-black text-red-500 bg-red-50 px-2 py-1 rounded-md border border-red-100 hover:bg-red-100 transition-all uppercase"
                          >
                            लिस्ट साफ़ करें
                          </button>
                        )}
                        <span className="text-[9px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full uppercase">
                          {filteredTeachers.length} / {teachers.length}
                        </span>
                      </div>
                    </div>

                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14}/>
                      <input 
                        type="text" 
                        placeholder="शिक्षक खोजें..." 
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold focus:ring-2 ring-indigo-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>
                    
                    <div className="space-y-1.5 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                      {isLoading ? (
                        <div className="py-12 text-center text-[10px] font-black text-slate-400 uppercase animate-pulse">Loading...</div>
                      ) : (
                        <>
                          {filteredTeachers.map((t) => (
                            <button 
                              key={t.name}
                              disabled={confirmedAbsent}
                              onClick={() => toggleAbsentTeacher(t.name)}
                              className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                                absentTeachers.includes(t.name) 
                                ? "bg-red-50 border-red-200 ring-2 ring-red-500/10 shadow-sm" 
                                : "bg-slate-50 border-transparent hover:border-slate-200"
                              } ${confirmedAbsent ? "opacity-50 grayscale" : ""}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-[10px] ${absentTeachers.includes(t.name) ? "bg-red-500 text-white" : "bg-indigo-50 text-indigo-500"}`}>
                                  {t.name.charAt(0)}
                                </div>
                                <div className="text-left">
                                  <p className={`text-[11px] font-bold ${absentTeachers.includes(t.name) ? "text-red-700" : "text-slate-700"}`}>
                                    {t.name}
                                  </p>
                                </div>
                              </div>
                              {absentTeachers.includes(t.name) && <Check size={12} className="text-red-500" strokeWidth={4}/>}
                            </button>
                          ))}
                        </>
                      )}
                    </div>

                    {absentTeachers.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-slate-100">
                        {!confirmedAbsent ? (
                          <button 
                            onClick={() => handleConfirmAbsent(true)}
                            className="w-full bg-red-600 text-white p-5 rounded-[1.5rem] font-black text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                          >
                            <UserX size={18}/> अनुपस्थित फाइनल करें ({absentTeachers.length})
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleConfirmAbsent(false)} 
                            className="w-full bg-indigo-50 text-indigo-600 font-black text-[10px] p-4 rounded-2xl border border-indigo-100 text-center uppercase tracking-widest hover:bg-indigo-100 transition-all flex items-center justify-center gap-2"
                          >
                            <UserPlus size={14}/> एब्सेंट लिस्ट बदलें
                          </button>
                        )}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-slate-50">
                      <button 
                        onClick={() => { setViewMode('manage'); setSelectedTeachers([]); }}
                        className="w-full text-red-500 font-black text-[9px] py-3 rounded-2xl bg-red-50 hover:bg-red-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                      >
                        <Trash2 size={14}/> टीचर्स डिलीट करें / मैनेज डेटा
                      </button>
                    </div>
                  </div>
            </div>

            {/* Board Column */}
            <div className="lg:col-span-7 space-y-6">
              {!confirmedAbsent ? (
                <div className="bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 h-full min-h-[500px] flex flex-col items-center justify-center text-slate-300 text-center p-12 shadow-inner">
                  <div className="bg-slate-50 p-10 rounded-full mb-6 shadow-inner"><Users size={80} className="opacity-10"/></div>
                  <h2 className="text-xl font-black text-slate-400 uppercase tracking-widest">अरेंजमेंट बोर्ड</h2>
                  <p className="max-w-[250px] text-[10px] font-bold text-slate-400 mt-4 uppercase tracking-tighter leading-relaxed">
                    Step 1: फ़ाइल अपलोड करें<br/>Step 2: टीचर एब्सेंट मार्क करें<br/>Step 3: फाइनल दबाएं
                  </p>
                </div>
              ) : (
                <div className="space-y-6 animate-in slide-in-from-right-8 duration-500 pb-20">
                  <div className="bg-white p-6 rounded-[2.5rem] border shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-black text-slate-800 leading-none">{selectedDay}</h2>
                      <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-2 italic">Substitute Matrix - Atul Sharma Sir</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => handleConfirmAbsent(false)}
                        className="bg-slate-100 text-slate-600 px-5 py-3 rounded-2xl font-black text-[10px] flex items-center gap-2 hover:bg-slate-200 transition-all uppercase tracking-widest"
                      >
                        <UserPlus size={16}/> लिस्ट बदलें (Edit List)
                      </button>
                      <button onClick={autoArrangeAll} className="bg-indigo-600 text-white px-5 py-3 rounded-2xl font-black text-[10px] flex items-center gap-2 shadow-xl active:scale-95 transition-all uppercase tracking-widest">
                        <Wand2 size={16}/> ऑटो-असाइन
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    {periods.map((pName, pIdx) => {
                      const affected = absentTeachers.filter(name => {
                        const t = teachers.find(x => x.name === name);
                        const cls = t?.schedule[selectedDay]?.[pIdx];
                        return cls && cls !== "—" && cls.trim() !== "";
                      });
                      if (affected.length === 0) return null;

                      return (
                        <div key={pIdx} className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm overflow-hidden">
                          <div className="flex items-center gap-4 mb-6 border-b border-slate-50 pb-4">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex flex-col items-center justify-center font-black">
                              <span className="text-xl leading-none">{pIdx + 1}</span>
                              <span className="text-[8px] opacity-60 uppercase tracking-tighter">PER</span>
                            </div>
                            <h4 className="font-black text-slate-800 text-lg uppercase tracking-tight">{pName} Substitution</h4>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {affected.map(absName => {
                              const absT = teachers.find(t => t.name === absName);
                              if (!absT) return null;
                              const classInfo = absT.schedule[selectedDay][pIdx];
                              const targetGroup = getClassGroup(extractClassNum(classInfo));
                              const assigned = arrangements[pIdx]?.[absName];
                              
                              let available = getFreeTeachers(pIdx, arrangements[pIdx] || {}, targetGroup);
                              const isShowingFallback = targetGroup && available.length === 0;
                              if (isShowingFallback) available = getFreeTeachers(pIdx, arrangements[pIdx] || {}, null);

                              return (
                                <div key={absName} className="p-5 rounded-[2.25rem] bg-slate-50 border border-slate-100 group transition-all hover:bg-white hover:shadow-lg">
                                  <div className="mb-4">
                                    <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-1 leading-none">{absName} की जगह</p>
                                    <p className="text-sm font-black text-slate-800 italic tracking-tight">कक्षा: {classInfo}</p>
                                  </div>

                                  {assigned ? (
                                    <div className="bg-emerald-50 text-emerald-800 p-4 rounded-2xl border border-emerald-100 flex items-center justify-between font-black text-[11px] shadow-sm">
                                      <span className="flex items-center gap-2 truncate"><CheckCircle2 size={14}/> {assigned}</span>
                                      <button 
                                        type="button"
                                        onClick={async (e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          try {
                                            const docRef = doc(db, "dailyData", selectedDate);
                                            // Using FieldPath to safely handle keys that might contain dots
                                            await updateDoc(docRef, new FieldPath("arrangements", pIdx.toString(), absName), deleteField());
                                            
                                            // Optimistic local update for immediate UI feedback
                                            const next = { ...arrangements };
                                            if (next[pIdx]) {
                                              next[pIdx] = { ...next[pIdx] };
                                              delete next[pIdx][absName];
                                              setDailyRegistry(prev => ({
                                                ...prev,
                                                [selectedDate]: {
                                                  ...(prev[selectedDate] || {}),
                                                  arrangements: next
                                                }
                                              }));
                                            }
                                          } catch (err) {
                                            console.error("Delete Arrangement Error:", err);
                                            // Fallback to the older method if dot-notation fails
                                            const next = { ...arrangements };
                                            if (next[pIdx]) {
                                              next[pIdx] = { ...next[pIdx] };
                                              delete next[pIdx][absName];
                                              handleUpdateArrangements(next);
                                            }
                                          }
                                        }} 
                                        className="text-slate-300 hover:text-red-500 transition-colors p-2 -mr-2 active:scale-90"
                                        title="डिलीट करें"
                                      >
                                        <Trash2 size={18}/>
                                      </button>
                                    </div>
                                  ) : (
                                    <select 
                                      className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-[10px] font-black outline-none focus:ring-2 ring-indigo-500 cursor-pointer shadow-sm transition-all"
                                      onChange={(e) => {
                                        const next = { ...arrangements };
                                        next[pIdx] = { ...(next[pIdx] || {}) };
                                        next[pIdx][absName] = e.target.value;
                                        handleUpdateArrangements(next);
                                      }}
                                      value=""
                                    >
                                      <option value="">+ असाइन करें</option>
                                      {available.map(t => {
                                        const dailyBusy = (t.schedule?.[selectedDay] || []).filter(p => typeof p === 'string' && p.trim() !== "" && p !== "—").length;
                                        return (
                                          <option key={t.name} value={t.name}>
                                            {t.name} (Busy: {dailyBusy}) ({subCounts[t.name] || 0}/{MAX_LIMIT})
                                          </option>
                                        );
                                      })}
                                    </select>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white p-8 rounded-[3rem] border shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setViewMode('daily')}
                    className="w-10 h-10 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl flex items-center justify-center transition-all active:scale-90"
                    title="वापस जाएं"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Database Management</h2>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Manage all teachers in the system</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {selectedTeachers.length > 0 ? (
                    <button 
                      onClick={handleBulkDelete}
                      className="bg-red-600 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase shadow-xl shadow-red-500/20 flex items-center gap-2 animate-in zoom-in-95 hover:scale-105 active:scale-95 transition-all"
                    >
                      <Trash2 size={16}/> डिलीट करें ({selectedTeachers.length})
                    </button>
                  ) : (
                    teachers.length > 0 && (
                      <button onClick={handleClearDatabase} className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-red-600 hover:text-white transition-all flex items-center gap-2">
                        <Trash2 size={14}/> डेटाबेस साफ़ करें
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Future Absences Section */}
              {futureAbsences.length > 0 && (
                <div className="mb-10 bg-amber-50 rounded-[2rem] border border-amber-100 overflow-hidden">
                  <div className="px-6 py-4 bg-amber-100/50 border-b border-amber-100 flex items-center justify-between">
                    <h4 className="text-[11px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-2">
                      <Clock size={16}/> आने वाली छुट्टियां (Upcoming Absences)
                    </h4>
                    <span className="text-[10px] font-black bg-white text-amber-600 px-3 py-1 rounded-full">{futureAbsences.length} दिन शेड्यूल हैं</span>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {futureAbsences.map(fa => (
                      <div key={fa.date} className="bg-white p-4 rounded-2xl border border-amber-100/50 shadow-sm transition-all hover:shadow-md">
                        <p className="text-[10px] font-black text-amber-500 mb-2 uppercase tracking-tight flex items-center gap-2 font-mono">
                          <CalendarIcon size={12}/> {fa.date.split('-').reverse().join('/')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {fa.teachers.map(name => (
                            <span key={name} className="px-2 py-1 bg-amber-50 text-amber-800 rounded-lg text-[9px] font-bold border border-amber-100">{name}</span>
                          ))}
                        </div>
                        <button 
                          onClick={() => { setSelectedDate(fa.date); setViewMode('daily'); }}
                          className="mt-3 w-full text-[8px] font-black text-amber-600 text-center uppercase tracking-widest hover:underline"
                        >
                          तारीख पर जाएं और एडिट करें →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                <input 
                  type="text" 
                  placeholder="शिक्षक का नाम खोजें..." 
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold focus:ring-2 ring-red-500 outline-none transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="grid gap-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {filteredTeachers.map((t, idx) => (
                  <div 
                    key={t.id || t.name} 
                    onClick={() => t.id && toggleTeacherSelection(t.id)}
                    className={`flex items-center justify-between p-4 border rounded-2xl transition-all cursor-pointer group select-none ${
                    t.id && selectedTeachers.includes(t.id) 
                      ? "bg-red-50 border-red-200 shadow-inner" 
                      : "bg-slate-50 border-slate-100 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 border rounded-xl flex items-center justify-center transition-all ${
                        t.id && selectedTeachers.includes(t.id) 
                        ? "bg-red-500 border-red-400 text-white" 
                        : "bg-white border-slate-200 text-slate-400 group-hover:text-indigo-600 group-hover:border-indigo-100"
                      }`}>
                        {(t.id && selectedTeachers.includes(t.id)) ? <Check size={20} strokeWidth={4}/> : <span className="font-black text-xs">{idx + 1}</span>}
                      </div>
                      <div>
                        <p className={`text-sm font-black leading-none transition-colors ${t.id && selectedTeachers.includes(t.id) ? "text-red-700" : "text-slate-800"}`}>
                          {t.name}
                        </p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-[8px] font-black bg-white/50 border px-1.5 py-0.5 rounded text-slate-400 uppercase">P/W: {t.total}</span>
                          <span className="text-[8px] font-black bg-white/50 border px-1.5 py-0.5 rounded text-slate-400 uppercase">DAYS: {Object.keys(t.schedule).length}</span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setTeacherToDelete(t);
                      }} 
                      className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                        t.id && selectedTeachers.includes(t.id)
                        ? "text-red-400 hover:bg-red-100"
                        : "text-slate-300 hover:text-red-500 hover:bg-red-100"
                      }`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 p-6 rounded-[2rem]">
              <div className="flex items-center gap-3 text-amber-700 mb-2">
                <Info size={20}/>
                <h4 className="font-black text-xs uppercase tracking-widest">ध्यान दें (Warning)</h4>
              </div>
              <p className="text-[10px] font-bold text-amber-700 leading-relaxed uppercase tracking-tight italic">
                मैनेजमेंट पैनल से टीचर को डिलीट करने पर वह डेटाबेस से हमेशा के लिए हट जाएगा।
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Floating Bottom Bar */}
      {confirmedAbsent && (
        <div className="fixed bottom-0 left-0 right-0 p-4 pb-8 bg-white/90 backdrop-blur-xl border-t border-slate-200 z-[100] shadow-[0_-15px_40px_rgba(0,0,0,0.05)] animate-in slide-in-from-bottom-20">
          <div className="max-w-xl mx-auto flex gap-3">
            <button onClick={handleShare} className="flex-[2] bg-emerald-500 text-white p-5 rounded-[2rem] flex items-center justify-center gap-3 font-black text-xs active:scale-95 transition-all shadow-xl uppercase tracking-widest">
              <MessageCircle size={22}/> WhatsApp Share
            </button>
            <button onClick={handleCopy} className={`flex-1 p-5 rounded-[2rem] flex items-center justify-center gap-2 font-black text-xs active:scale-95 transition-all shadow-lg ${copyStatus ? "bg-emerald-100 text-emerald-700" : "bg-slate-900 text-white"} uppercase tracking-tighter`}>
              {copyStatus ? <Check size={20}/> : <Copy size={20}/>}
              {copyStatus ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Overlay Loaders */}
      {isProcessing && (
        <div className="fixed inset-0 bg-indigo-950/90 backdrop-blur-2xl z-[1000] flex flex-col items-center justify-center text-white p-6">
          <div className="w-20 h-20 border-8 border-white/10 border-t-white rounded-full animate-spin mb-8"></div>
          <h2 className="text-2xl font-black tracking-[0.4em] uppercase animate-pulse mb-8">Processing...</h2>
          {uploadProgress > 0 && (
            <div className="w-full max-w-md bg-white/10 h-3 rounded-full overflow-hidden border border-white/10">
              <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          )}
        </div>
      )}

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[2000] animate-in slide-in-from-top-10">
          <div className="bg-emerald-500 text-white px-8 py-4 rounded-[2rem] shadow-2xl flex items-center gap-4 border-2 border-emerald-400">
            <CheckCircle size={24} />
            <p className="font-black text-sm uppercase tracking-tight">सफलतापूर्वक अपलोड!</p>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
        @keyframes zoom-in-95 { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-in { animation: zoom-in-95 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
}
