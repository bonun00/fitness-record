'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, deleteDoc, doc } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { analyzeWorkout } from '@/lib/gemini';
import { motion, AnimatePresence } from 'motion/react';
import { Dumbbell, Plus, Trash2, LogIn, LogOut, Loader2, Calendar, ChevronRight, Sparkles, ListFilter, History, Search, X } from 'lucide-react';
import { format, eachMonthOfInterval, subMonths, isSameMonth, eachDayOfInterval, startOfToday, subDays, isSameDay, getDay, startOfMonth, endOfMonth } from 'date-fns';
import ReactMarkdown from 'react-markdown';

type TabType = 'timeline' | 'exercises';

const COMMON_EXERCISES = [
  '벤치프레스', '데드리프트', '스쿼트', '오버헤드프레스', '바벨로우',
  '풀업', '푸쉬업', '런지', '레그프레스', '덤벨 컬', '트라이셉스 익스텐션',
  '사이드 레터럴 레이즈', '랫풀다운', '체스트 프레스', '플랭크',
  '머신 벤치프레스', '머신 체스트 프레스', '머신 숄더 프레스', '머신 로우',
  '레그 익스텐션', '레그 컬', '암 컬', '케이블 푸쉬다운', '딥스'
];

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('timeline');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [ghostText, setGhostText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Sync scroll between textarea and ghost overlay
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (ghostRef.current) {
      ghostRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  useEffect(() => {
    if (!user) {
      setWorkouts([]);
      return;
    }

    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc')
    );

    const path = 'workouts';
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: (doc.data().date as Timestamp).toDate()
      }));
      setWorkouts(docs);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, path);
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    });

    return () => unsubscribe();
  }, [user]);

  // Handle suggestions and ghost text
  useEffect(() => {
    const lines = inputText.split('\n');
    const lastLine = lines[lines.length - 1];
    const words = lastLine.trim().split(/\s+/);
    const lastWord = words[words.length - 1] || '';

    if (lastWord.length >= 1) {
      const filtered = COMMON_EXERCISES.filter(ex => 
        ex.toLowerCase().includes(lastWord.toLowerCase()) && 
        !lastLine.toLowerCase().includes(ex.toLowerCase() + ' ')
      ).slice(0, 5);
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }

    // Clear ghost text if user types something different from the exercise name
    if (ghostText && !lastLine.includes(ghostText.trim())) {
      // We only keep ghost text if the line ends with an exercise name we just suggested
    }
  }, [inputText, ghostText]);

  const applySuggestion = (suggestion: string) => {
    const lines = inputText.split('\n');
    const lastLine = lines[lines.length - 1];
    const words = lastLine.trim().split(/\s+/);
    words.pop(); // Remove the partial word
    
    const updatedLastLine = [...words, suggestion].join(' ') + ' ';
    lines[lines.length - 1] = updatedLastLine;
    
    const newText = lines.join('\n');
    setInputText(newText);
    setSuggestions([]);
    setGhostText('80kg 5세트 10회'); // Set the ghost hint
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const acceptGhost = () => {
    if (!ghostText) return;
    setInputText(prev => prev.trimEnd() + ' ' + ghostText + '\n');
    setGhostText('');
    inputRef.current?.focus();
  };

  // Contribution Graph calculation (Current Month)
  const contributionData = useMemo(() => {
    const today = new Date();
    const startDate = startOfMonth(today);
    const endDate = endOfMonth(today);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return days.map(day => {
      const count = workouts.filter(w => isSameDay(w.date, day)).length;
      return {
        date: day,
        count,
        level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3
      };
    });
  }, [workouts]);

  // Exercise list and history
  const exerciseHistory = useMemo(() => {
    const history: Record<string, any[]> = {};
    workouts.forEach(w => {
      w.exercises?.forEach((ex: any) => {
        const name = ex.name.trim();
        if (!history[name]) history[name] = [];
        history[name].push({
          ...ex,
          date: w.date,
          workoutId: w.id
        });
      });
    });
    return history;
  }, [workouts]);

  const exerciseNames = useMemo(() => Object.keys(exerciseHistory).sort(), [exerciseHistory]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
      setError("로그인에 실패했습니다.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    setIsAnalyzing(true);
    setError(null);

    const path = 'workouts';
    try {
      const result = await analyzeWorkout(inputText);
      
      await addDoc(collection(db, path), {
        userId: user.uid,
        rawText: inputText,
        date: Timestamp.now(),
        exercises: result.exercises,
        analysis: result.analysis
      });

      setInputText('');
      setActiveTab('timeline');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      setError("기록 저장 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelete = async (id: string) => {
    const path = `workouts/${id}`;
    try {
      await deleteDoc(doc(db, 'workouts', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
      setError("삭제 중 오류가 발생했습니다.");
    }
  };

  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#1a1a1a] font-sans pb-24">
      {/* Mobile Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg border-b border-gray-100 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Dumbbell className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">FitTrack</span>
        </div>
        {user && (
          <button onClick={handleLogout} className="p-2 text-gray-400">
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </header>

      <div className="max-w-md mx-auto px-4 py-6">
        {!user ? (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-blue-600" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">운동 기록의 시작</h2>
              <p className="text-gray-500 text-sm">AI와 함께 더 스마트하게<br/>당신의 성장을 기록하세요.</p>
            </div>
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Google 계정으로 시작
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <AnimatePresence mode="wait">
              {activeTab === 'timeline' && (
                <motion.div
                  key="timeline"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-6"
                >
                  {/* Contribution Graph (Monthly) */}
                  <section className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-col">
                        <h3 className="font-bold text-base">활동 잔디</h3>
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                          {format(new Date(), 'yyyy년 M월')}
                        </span>
                      </div>
                      <Calendar className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 justify-center">
                      {/* Day labels */}
                      {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                        <div key={d} className="text-[10px] text-gray-300 font-bold text-center mb-1">{d}</div>
                      ))}
                      
                      {/* Empty cells for padding before start of month */}
                      {Array.from({ length: getDay(startOfMonth(new Date())) }).map((_, i) => (
                        <div key={`empty-${i}`} className="aspect-square" />
                      ))}
                      
                      {contributionData.map((day, i) => (
                        <div
                          key={i}
                          title={`${format(day.date, 'yyyy-MM-dd')}: ${day.count} workouts`}
                          className={`aspect-square rounded-lg transition-colors flex items-center justify-center relative group ${
                            day.level === 0 ? 'bg-gray-50' :
                            day.level === 1 ? 'bg-blue-100' :
                            day.level === 2 ? 'bg-blue-400' :
                            'bg-blue-600'
                          }`}
                        >
                          <span className={`text-[8px] font-bold ${day.level >= 2 ? 'text-white' : 'text-gray-300'}`}>
                            {format(day.date, 'd')}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-400 font-bold uppercase">이번 달</span>
                          <span className="text-sm font-black text-blue-600">{contributionData.reduce((acc, curr) => acc + curr.count, 0)}회</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[8px] text-gray-300 font-bold uppercase">
                        <span>Less</span>
                        <div className="w-2 h-2 bg-gray-50 rounded-[1px]" />
                        <div className="w-2 h-2 bg-blue-100 rounded-[1px]" />
                        <div className="w-2 h-2 bg-blue-400 rounded-[1px]" />
                        <div className="w-2 h-2 bg-blue-600 rounded-[1px]" />
                        <span>More</span>
                      </div>
                    </div>
                  </section>

                  {/* Input Section */}
                  <section className="bg-white p-4 rounded-3xl shadow-sm border border-gray-50 relative">
                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div className="relative min-h-[120px]">
                        {/* Ghost Overlay */}
                        <div 
                          ref={ghostRef}
                          className="absolute inset-0 p-4 text-base whitespace-pre-wrap break-words pointer-events-none font-sans leading-normal overflow-hidden"
                          style={{ color: 'transparent' }}
                        >
                          {inputText}
                          <span className="text-gray-300">{ghostText}</span>
                        </div>
                        
                        <textarea
                          ref={inputRef}
                          value={inputText}
                          onChange={(e) => {
                            setInputText(e.target.value);
                            if (ghostText) setGhostText(''); // Clear ghost on manual type
                          }}
                          onScroll={handleScroll}
                          placeholder="스쿼트 100kg 3세트 10회..."
                          className="w-full min-h-[120px] p-4 bg-transparent rounded-2xl border-none focus:ring-2 focus:ring-blue-500 transition-all resize-none text-base relative z-10 font-sans leading-normal"
                          disabled={isAnalyzing}
                        />
                        {isAnalyzing && (
                          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 z-20">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                            <span className="text-xs font-bold text-blue-600">AI 분석 중</span>
                          </div>
                        )}
                      </div>

                      {/* Suggestions & Ghost Accept */}
                      <AnimatePresence>
                        {(suggestions.length > 0 || ghostText) && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex flex-wrap gap-2 py-1 items-center"
                          >
                            {suggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => applySuggestion(s)}
                                className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-xs font-bold border border-blue-100"
                              >
                                {s}
                              </button>
                            ))}
                            {ghostText && (
                              <button
                                type="button"
                                onClick={acceptGhost}
                                className="px-3 py-1.5 bg-gray-900 text-white rounded-full text-xs font-bold flex items-center gap-1 shadow-sm"
                              >
                                <Sparkles className="w-3 h-3" />
                                가이드 적용
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        type="submit"
                        disabled={!inputText.trim() || isAnalyzing}
                        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-bold shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" />
                        기록하기
                      </button>
                    </form>
                  </section>

                  {/* List Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 px-1">최근 활동</h3>
                    <AnimatePresence mode="popLayout">
                      {workouts.map((workout) => (
                        <motion.div
                          key={workout.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-blue-500" />
                              <span className="text-xs font-bold text-gray-400">
                                {format(workout.date, 'M월 d일 · HH:mm')}
                              </span>
                            </div>
                            <button onClick={() => handleDelete(workout.id)} className="text-gray-300">
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="space-y-3">
                            <p className="text-sm font-medium text-gray-800 leading-relaxed">
                              {workout.rawText}
                            </p>

                            {workout.exercises && workout.exercises.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {workout.exercises.map((ex: any, idx: number) => (
                                  <div key={idx} className="px-3 py-2 bg-gray-50 rounded-xl text-xs">
                                    <span className="font-bold text-gray-700 mr-2">{ex.name}</span>
                                    <span className="text-gray-400">
                                      {ex.weight}{ex.unit || 'kg'} · {ex.sets}s · {ex.reps}r
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {workout.analysis && (
                              <div className="p-3 bg-blue-50/30 rounded-2xl border border-blue-50">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Sparkles className="w-3 h-3 text-blue-500" />
                                  <span className="text-[10px] font-bold text-blue-500 uppercase">AI Feedback</span>
                                </div>
                                <div className="text-xs text-blue-900/70 leading-relaxed">
                                  <ReactMarkdown>{workout.analysis}</ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {activeTab === 'exercises' && (
                <motion.div
                  key="exercises"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="flex flex-wrap gap-2">
                    {exerciseNames.map(name => (
                      <button
                        key={name}
                        onClick={() => setSelectedExercise(selectedExercise === name ? null : name)}
                        className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all ${
                          selectedExercise === name 
                            ? 'bg-blue-600 text-white shadow-md' 
                            : 'bg-white text-gray-500 border border-gray-100'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>

                  {selectedExercise && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-gray-400 px-1">{selectedExercise} 히스토리</h4>
                      {exerciseHistory[selectedExercise].map((item, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-50 flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-bold text-gray-300 mb-1">
                              {format(item.date, 'yyyy. MM. dd')}
                            </p>
                            <div className="flex items-center gap-3 text-sm font-bold text-gray-700">
                              <span>{item.weight}{item.unit || 'kg'}</span>
                              <span className="text-gray-300">·</span>
                              <span>{item.sets}s</span>
                              <span className="text-gray-300">·</span>
                              <span>{item.reps}r</span>
                            </div>
                          </div>
                          <div className="w-8 h-8 bg-gray-50 rounded-full flex items-center justify-center">
                            <ChevronRight className="w-4 h-4 text-gray-300" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Mobile Bottom Nav */}
      {user && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 px-6 pb-8 pt-3 z-30">
          <div className="max-w-md mx-auto flex justify-between items-center">
            {[
              { id: 'timeline', label: '기록', icon: History },
              { id: 'exercises', label: '종목', icon: ListFilter },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex flex-col items-center gap-1 transition-all ${
                  activeTab === tab.id ? 'text-blue-600' : 'text-gray-300'
                }`}
              >
                <tab.icon className={`w-6 h-6 ${activeTab === tab.id ? 'fill-blue-600/10' : ''}`} />
                <span className="text-[10px] font-bold">{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
