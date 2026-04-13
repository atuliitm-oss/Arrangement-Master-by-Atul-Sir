/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  UserX, Search, UserCheck, Clock, Calendar as CalendarIcon, 
  AlertCircle, CheckCircle2, Users, Wand2, Share2, Upload, 
  Trash2, Plus, FileSpreadsheet, X, Save, UserPlus, Info, Check, MessageCircle, Copy, CheckCircle, ShieldAlert, BarChart3, Filter
} from 'lucide-react';

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
  name: string;
  total: number;
  schedule: {
    [day: string]: string[];
  };
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [absentTeachers, setAbsentTeachers] = useState<string[]>([]);
  const [confirmedAbsent, setConfirmedAbsent] = useState(false); 
  const [arrangements, setArrangements] = useState<{[period: number]: {[absentName: string]: string}}>({}); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [copyStatus, setCopyStatus] = useState(false);
  const [searchTerm, setSearchTerm] = useState(""); // शिक्षकों को खोजने के लिए

  // बिज़नेस रूल्स
  const RESTRICTED_NAMES = ["anju", "vatsa", "neetu"];
  const LOW_PRIORITY_NAMES = ["atul", "madhuri", "rekha", "prabha", "nisha"];
  const MAX_LIMIT = 2; 

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const periods = ["1st P", "2nd P", "3rd P", "4th P", "5th P", "6th P", "7th P", "8th P"];

  useEffect(() => { loadXlsxScript(); }, []);

  const selectedDay = useMemo(() => {
    const date = new Date(selectedDate);
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

  const getFreeTeachers = (periodIndex: number, currentPeriodSubs: {[name: string]: string} = {}) => {
    const inThisPeriod = Object.values(currentPeriodSubs);
    return teachers.filter(t => {
      const sched = t.schedule[selectedDay];
      const isFree = sched && (sched[periodIndex] === "—" || !sched[periodIndex] || sched[periodIndex].trim() === "");
      const isBlocked = RESTRICTED_NAMES.some(r => t.name.toLowerCase().includes(r));
      const myCount = subCounts[t.name] || 0;
      return isFree && !absentTeachers.includes(t.name) && !isBlocked && !inThisPeriod.includes(t.name) && myCount < MAX_LIMIT;
    }).sort((a, b) => {
      const isLowA = LOW_PRIORITY_NAMES.some(lp => a.name.toLowerCase().includes(lp));
      const isLowB = LOW_PRIORITY_NAMES.some(lp => b.name.toLowerCase().includes(lp));
      if (isLowA && !isLowB) return 1;
      if (!isLowA && isLowB) return -1;
      return (a.total || 0) - (b.total || 0);
    });
  };

  const toggleAbsentTeacher = (name: string) => {
    if (confirmedAbsent) return;
    setAbsentTeachers(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]);
  };

  const autoArrangeAll = () => {
    const newArr = { ...arrangements };
    const tempCounts = { ...subCounts };
    periods.forEach((_, pIdx) => {
      if (!newArr[pIdx]) newArr[pIdx] = {};
      absentTeachers.forEach(absName => {
        const absT = teachers.find(t => t.name === absName);
        const classInfo = absT?.schedule[selectedDay]?.[pIdx];
        if (classInfo && classInfo !== "—" && !newArr[pIdx][absName]) {
          const available = getFreeTeachers(pIdx, newArr[pIdx]);
          const bestFit = available.find(t => (tempCounts[t.name] || 0) < MAX_LIMIT);
          if (bestFit) {
            newArr[pIdx][absName] = bestFit.name;
            tempCounts[bestFit.name] = (tempCounts[bestFit.name] || 0) + 1;
          }
        }
      });
    });
    setArrangements(newArr);
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

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result as string;
        const XLSX = (window as any).XLSX;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        const newList: Teacher[] = [];
        let curName = "";
        data.forEach((row, idx) => {
          if (idx < 2) return;
          const name = row[0] ? row[0].toString().trim() : curName;
          const day = row[1] ? row[1].toString().trim() : "";
          if (name && days.includes(day)) {
            curName = name;
            const sched = row.slice(2, 10).map(c => c ? c.toString().trim() : "—");
            let tObj = newList.find(t => t.name === name);
            if (!tObj) {
              tObj = { name, total: parseInt(row[10]) || 0, schedule: {} };
              newList.push(tObj);
            }
            tObj.schedule[day] = sched;
          }
        });
        const sorted = newList.sort((a, b) => a.name.localeCompare(b.name));
        setTeachers(sorted);
        setAbsentTeachers([]);
        setConfirmedAbsent(false);
      } catch (err) { alert("Excel Parsing Error"); }
      finally { setIsProcessing(false); }
    };
    reader.readAsBinaryString(file);
  };

  // सर्च फिल्टर शिक्षक सूची
  const filteredTeachers = teachers.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans pb-32">
      {/* Navbar */}
      <nav className="bg-indigo-900 text-white p-4 sticky top-0 z-[60] shadow-lg border-b border-indigo-700">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-xl"><Users size={20}/></div>
            <div>
              <h1 className="text-sm font-black tracking-widest leading-none uppercase">ARRANGEMASTER BY ATUL SHARMA SIR</h1>
              <p className="text-[8px] font-bold text-indigo-400 mt-1 uppercase">Unified Workload & Absentee List</p>
            </div>
          </div>
          <div className="bg-black/20 rounded-lg p-1.5 flex items-center gap-2 border border-white/5">
            <CalendarIcon size={14} className="text-indigo-400"/>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} 
              className="bg-transparent border-none text-[10px] font-black text-white outline-none cursor-pointer uppercase"/>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Unified Selection Sidebar */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
             <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
               <Upload size={14} className="text-indigo-500"/> एक्सेल डाटा सोर्स
             </h3>
             <div className="relative group border-2 border-dashed border-indigo-50 rounded-2xl p-6 text-center hover:bg-indigo-50 transition-all cursor-pointer">
               <input type="file" onChange={handleExcelUpload} accept=".xlsx, .xls" className="absolute inset-0 opacity-0 cursor-pointer" />
               <FileSpreadsheet className="mx-auto text-indigo-200 mb-2" size={40}/>
               <p className="text-[10px] font-black text-slate-500 uppercase">फ़ाइल अपलोड करें</p>
             </div>
          </div>

          <div className="bg-white p-6 rounded-[2rem] border shadow-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 size={14} className="text-indigo-500"/> टीचर डायरेक्टरी
              </h3>
              <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">Total: {teachers.length}</span>
            </div>

            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14}/>
              <input 
                type="text" 
                placeholder="शिक्षक का नाम खोजें..." 
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold focus:ring-2 ring-indigo-500 outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="space-y-1.5 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
              {filteredTeachers.map(t => (
                <button 
                  key={t.name}
                  disabled={confirmedAbsent}
                  onClick={() => toggleAbsentTeacher(t.name)}
                  className={`group w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
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
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">P/W: {t.total}</p>
                    </div>
                  </div>
                  {absentTeachers.includes(t.name) ? (
                    <div className="bg-red-500 text-white p-1 rounded-lg"><Check size={12} strokeWidth={4}/></div>
                  ) : (
                    <div className="bg-slate-200 w-5 h-5 rounded-lg group-hover:bg-slate-300 transition-colors"></div>
                  )}
                </button>
              ))}
              {teachers.length === 0 && <p className="text-[10px] font-bold text-slate-300 text-center py-10 italic uppercase">डेटा लोड करें</p>}
              {teachers.length > 0 && filteredTeachers.length === 0 && <p className="text-[10px] font-bold text-slate-400 text-center py-6 italic uppercase">कोई मेल नहीं मिला</p>}
            </div>

            {absentTeachers.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-100">
                {!confirmedAbsent ? (
                  <button 
                    onClick={() => setConfirmedAbsent(true)}
                    className="w-full bg-red-600 text-white p-5 rounded-[1.5rem] font-black text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
                  >
                    <UserX size={18}/> अनुपस्थित फाइनल करें ({absentTeachers.length})
                  </button>
                ) : (
                  <button onClick={() => {setConfirmedAbsent(false); setArrangements({});}} className="w-full text-indigo-600 font-black text-[10px] p-2 text-center uppercase tracking-widest hover:underline">
                    ← लिस्ट बदलें
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Board Panel Area */}
        <div className="lg:col-span-7">
          {!confirmedAbsent ? (
            <div className="bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 h-full min-h-[500px] flex flex-col items-center justify-center text-slate-300 text-center p-12 shadow-inner">
              <div className="bg-slate-50 p-10 rounded-full mb-6 shadow-inner"><Users size={80} className="opacity-10"/></div>
              <h2 className="text-xl font-black text-slate-400 uppercase tracking-widest">अरेंजमेंट बोर्ड</h2>
              <p className="max-w-[250px] text-[10px] font-bold text-slate-400 mt-4 uppercase tracking-tighter leading-relaxed">
                Step 1: फ़ाइल अपलोड करें<br/>Step 2: टीचर डायरेक्टरी से एब्सेंट मार्क करें<br/>Step 3: फाइनल बटन दबाएं
              </p>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
              <div className="bg-white p-6 rounded-[2.5rem] border shadow-sm flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-800 leading-none">{selectedDay}</h2>
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mt-2 italic">Substitute Matrix - Atul Sharma Sir</p>
                </div>
                <button onClick={autoArrangeAll} className="bg-indigo-600 text-white px-5 py-3 rounded-2xl font-black text-[10px] flex items-center gap-2 shadow-xl active:scale-95 transition-all uppercase tracking-widest">
                  <Wand2 size={16}/> ऑटो-असाइन
                </button>
              </div>

              <div className="grid gap-4 pb-20">
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
                          const assigned = arrangements[pIdx]?.[absName];
                          const available = getFreeTeachers(pIdx, arrangements[pIdx] || {});

                          return (
                            <div key={absName} className="p-5 rounded-[2.25rem] bg-slate-50 border border-slate-100 group transition-all hover:bg-white hover:shadow-lg">
                              <div className="mb-4">
                                <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-1 leading-none">{absName} की जगह</p>
                                <p className="text-sm font-black text-slate-800 italic tracking-tight">कक्षा: {classInfo}</p>
                              </div>

                              {assigned ? (
                                <div className="bg-emerald-50 text-emerald-800 p-4 rounded-2xl border border-emerald-100 flex items-center justify-between font-black text-[11px] shadow-sm animate-in zoom-in-95">
                                  <span className="flex items-center gap-2 truncate"><CheckCircle2 size={14}/> {assigned}</span>
                                  <button onClick={() => {
                                    const next = { ...arrangements };
                                    delete next[pIdx][absName];
                                    setArrangements(next);
                                  }} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={18}/></button>
                                </div>
                              ) : (
                                <select 
                                  className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-[10px] font-black outline-none focus:ring-2 ring-indigo-500 cursor-pointer shadow-sm transition-all"
                                  onChange={(e) => {
                                    const next = { ...arrangements };
                                    if(!next[pIdx]) next[pIdx] = {};
                                    next[pIdx][absName] = e.target.value;
                                    setArrangements(next);
                                  }}
                                  value=""
                                >
                                  <option value="">+ असाइन करें</option>
                                  {available.map(t => (
                                    <option key={t.name} value={t.name}>
                                      {t.name} ({t.total}) | {subCounts[t.name] || 0}/{MAX_LIMIT}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {available.length === 0 && !assigned && (
                                <p className="text-[9px] font-bold text-amber-600 mt-2 bg-amber-50 p-2 rounded-xl border border-amber-100 flex items-center gap-2">
                                  <ShieldAlert size={12}/> कोई फ़्री टीचर नहीं (Limit 2/2)
                                </p>
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

      {/* Loader */}
      {isProcessing && (
        <div className="fixed inset-0 bg-indigo-950/90 backdrop-blur-2xl z-[1000] flex flex-col items-center justify-center text-white">
          <div className="w-16 h-16 border-8 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <h2 className="text-2xl font-black tracking-[0.4em] uppercase animate-pulse">Processing...</h2>
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
