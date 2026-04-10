'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, Timestamp, deleteDoc, doc, setDoc, getDoc, getDocs, limit } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';
import { analyzeWorkout } from '@/lib/gemini';
import { motion, AnimatePresence } from 'motion/react';
import { Dumbbell, Plus, Trash2, LogIn, LogOut, Loader2, Calendar, ChevronRight, Sparkles, ListFilter, History, Search, X, Users, UserPlus, User as UserIcon, TrendingUp, Flame, Edit2, Save, ChevronLeft, Image as ImageIcon, Camera, ChevronUp, ChevronDown, Copy, Heart, UserMinus, Share2 } from 'lucide-react';
import { format, eachMonthOfInterval, subMonths, isSameMonth, eachDayOfInterval, startOfToday, subDays, isSameDay, getDay, startOfMonth, endOfMonth, startOfDay, addMonths } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';

type TabType = 'exercises' | 'timeline' | 'friends';

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
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [friends, setFriends] = useState<any[]>([]);
  const [friendsWorkouts, setFriendsWorkouts] = useState<any[]>([]);
  const [friendEmail, setFriendEmail] = useState('');
  const [isAddingFriend, setIsAddingFriend] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState<any | null>(null);
  const [quickEdit, setQuickEdit] = useState<{ workoutId: string, exerciseIdx: number } | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [cheers, setCheers] = useState<Record<string, any[]>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync user profile to Firestore
  useEffect(() => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        updatedAt: Timestamp.now()
      }, { merge: true });
    }
  }, [user]);

  // Fetch friends
  useEffect(() => {
    if (!user) return;
    
    const q1 = query(collection(db, 'friendships'), where('userUids', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q1, async (snapshot) => {
      const friendUids = snapshot.docs.map(doc => {
        const data = doc.data();
        return data.userUids.find((uid: string) => uid !== user.uid);
      });
      
      if (friendUids.length === 0) {
        setFriends([]);
        return;
      }

      // Fetch friend profiles
      const profiles = await Promise.all(friendUids.map(async (uid) => {
        const d = await getDoc(doc(db, 'users', uid));
        return { id: d.id, ...d.data() };
      }));
      setFriends(profiles);
    });
    
    return () => unsubscribe();
  }, [user]);

  // Fetch friends' workouts
  useEffect(() => {
    if (!user || friends.length === 0) {
      setFriendsWorkouts([]);
      return;
    }
    
    const friendUids = friends.map(f => f.uid);
    // Firestore 'in' query is limited to 10 items
    const q = query(
      collection(db, 'workouts'),
      where('userId', 'in', friendUids.slice(0, 10)),
      orderBy('date', 'desc'),
      limit(20)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: (doc.data().date as Timestamp).toDate()
      }));
      setFriendsWorkouts(docs);
    });
    
    return () => unsubscribe();
  }, [user, friends]);

  // Fetch cheers
  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, 'cheers'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const grouped: Record<string, any[]> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (!grouped[data.workoutId]) grouped[data.workoutId] = [];
        grouped[data.workoutId].push({ id: doc.id, ...data });
      });
      setCheers(grouped);
    });
    
    return () => unsubscribe();
  }, [user]);

  // Sync scroll between textarea and ghost overlay - Removed
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    // Removed
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


  // Contribution Graph calculation (Selected Month)
  const contributionData = useMemo(() => {
    const startDate = startOfMonth(viewMonth);
    const endDate = endOfMonth(viewMonth);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return days.map((day) => {
      const dayWorkouts = workouts.filter(w => isSameDay(w.date, day));
      const count = dayWorkouts.length;
      
      return {
        date: day,
        count,
        level: count === 0 ? 0 : 1, // Solid color if any workout exists
        workouts: dayWorkouts
      };
    });
  }, [workouts, viewMonth]);

  const selectedDayWorkouts = useMemo(() => {
    return workouts.filter(w => isSameDay(w.date, selectedDate))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [workouts, selectedDate]);

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
    
    // Group by date for each exercise and find the best performance
    const groupedHistory: Record<string, { date: Date, entries: any[], isBestDay: boolean }[]> = {};
    Object.keys(history).forEach(name => {
      const sorted = history[name].sort((a, b) => b.date.getTime() - a.date.getTime());
      const groups: { date: Date, entries: any[], isBestDay: boolean }[] = [];
      
      // Find the absolute best performance for this exercise
      let maxWeight = 0;
      let maxReps = 0;
      history[name].forEach(item => {
        const w = parseFloat(item.weight) || 0;
        const r = parseInt(item.reps) || 0;
        if (w > maxWeight) {
          maxWeight = w;
          maxReps = r;
        } else if (w === maxWeight && r > maxReps) {
          maxReps = r;
        }
      });

      sorted.forEach(item => {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && isSameDay(lastGroup.date, item.date)) {
          lastGroup.entries.push(item);
        } else {
          groups.push({ date: item.date, entries: [item], isBestDay: false });
        }
      });

      // Mark the group(s) that contain the best performance
      groups.forEach(group => {
        group.isBestDay = group.entries.some(item => {
          const w = parseFloat(item.weight) || 0;
          const r = parseInt(item.reps) || 0;
          return w === maxWeight && r === maxReps;
        });
      });

      groupedHistory[name] = groups;
    });

    return groupedHistory;
  }, [workouts]);

  const exerciseNames = useMemo(() => Object.keys(exerciseHistory).sort(), [exerciseHistory]);

  // Handle suggestions and ghost text
  useEffect(() => {
    const lines = inputText.split('\n');
    const lastLine = lines[lines.length - 1];
    const words = lastLine.trim().split(/\s+/);
    const lastWord = words[words.length - 1] || '';

    if (lastWord.length >= 1) {
      const source = exerciseNames.length > 0 ? exerciseNames : COMMON_EXERCISES;
      const filtered = source.filter(ex => 
        ex.toLowerCase().includes(lastWord.toLowerCase()) && 
        !lastLine.toLowerCase().includes(ex.toLowerCase() + ' ')
      ).slice(0, 5);
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [inputText, exerciseNames]);

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
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const acceptGhost = () => {
    // Removed
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
      setError("로그인에 실패했습니다.");
    }
  };

  const groupExercises = (exercises: any[]) => {
    if (!exercises) return [];
    const groups: { [key: string]: any[] } = {};
    exercises.forEach((ex, idx) => {
      if (!groups[ex.name]) {
        groups[ex.name] = [];
      }
      groups[ex.name].push({ ...ex, originalIdx: idx });
    });
    return Object.entries(groups).map(([name, items]) => ({
      name,
      items
    }));
  };

  const handleQuickUpdate = async (workoutId: string, exerciseIdx: number, field: string, delta: number) => {
    const workout = workouts.find(w => w.id === workoutId) || friendsWorkouts.find(w => w.id === workoutId);
    if (!workout) return;

    const newExercises = [...workout.exercises];
    const val = Number(newExercises[exerciseIdx][field]) || 0;
    newExercises[exerciseIdx][field] = Math.max(0, val + delta);

    const path = `workouts/${workoutId}`;
    try {
      await setDoc(doc(db, 'workouts', workoutId), {
        exercises: newExercises,
        updatedAt: Timestamp.now()
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsUploading(true);
    // In a real app, we would upload to Firebase Storage.
    // For this demo, we'll use FileReader to create local preview URLs (base64)
    // and store them in Firestore. Note: Base64 in Firestore is not ideal for large images,
    // but works for a few small ones in a demo.
    
    const uploadPromises = Array.from(files).map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(uploadPromises).then(urls => {
      setImageUrls(prev => [...prev, ...urls]);
      setIsUploading(false);
    });
  };

  const removeImage = (index: number) => {
    setImageUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    setIsAnalyzing(true);
    setError(null);

    const path = 'workouts';
    try {
      const historySummary = workouts.slice(0, 5).map(w => {
        const dateStr = format(w.date, 'yyyy-MM-dd');
        const exercisesStr = w.exercises.map((ex: any) => `${ex.name} ${ex.weight}${ex.unit || 'kg'} ${ex.reps}회 ${ex.sets}세트`).join(', ');
        return `[${dateStr}] ${exercisesStr}`;
      }).join('; ');

      const result = await analyzeWorkout(inputText, historySummary);
      
      // Use the selected date but keep current time if it's today, 
      // or set to noon if it's a past/future date to avoid timezone edge cases
      const workoutDate = isSameDay(selectedDate, new Date()) 
        ? new Date() 
        : new Date(selectedDate.setHours(12, 0, 0, 0));

      await addDoc(collection(db, path), {
        userId: user.uid,
        rawText: inputText,
        date: Timestamp.fromDate(workoutDate),
        exercises: result.exercises,
        analysis: result.analysis,
        images: imageUrls
      });

      setInputText('');
      setImageUrls([]);
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

  const handleUpdateWorkout = async (workoutId: string, updatedExercises: any[]) => {
    const path = `workouts/${workoutId}`;
    try {
      const workoutRef = doc(db, 'workouts', workoutId);
      await setDoc(workoutRef, {
        exercises: updatedExercises,
        updatedAt: Timestamp.now()
      }, { merge: true });
      setEditingWorkout(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
      setError("수정 중 오류가 발생했습니다.");
    }
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendEmail.trim() || !user) return;
    
    setIsAddingFriend(true);
    setError(null);
    try {
      const q = query(collection(db, 'users'), where('email', '==', friendEmail.trim()), limit(1));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        setError("사용자를 찾을 수 없습니다.");
        return;
      }
      
      const friendData = snapshot.docs[0].data();
      if (friendData.uid === user.uid) {
        setError("자기 자신은 친구로 추가할 수 없습니다.");
        return;
      }
      
      const ids = [user.uid, friendData.uid].sort();
      const friendshipId = ids.join('_');
      
      await setDoc(doc(db, 'friendships', friendshipId), {
        userUids: ids,
        status: 'accepted',
        createdAt: Timestamp.now()
      });
      
      setFriendEmail('');
    } catch (err) {
      console.error("Error adding friend:", err);
      setError("친구 추가 중 오류가 발생했습니다.");
    } finally {
      setIsAddingFriend(false);
    }
  };

  const handleRemoveFriend = async (friendUid: string) => {
    if (!user) return;
    const ids = [user.uid, friendUid].sort();
    const friendshipId = ids.join('_');
    try {
      await deleteDoc(doc(db, 'friendships', friendshipId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'friendships');
      setError("친구 삭제 중 오류가 발생했습니다.");
    }
  };

  const handleCheer = async (workoutId: string) => {
    if (!user) return;
    const cheerId = `${user.uid}_${workoutId}`;
    const cheerRef = doc(db, 'cheers', cheerId);
    
    try {
      const d = await getDoc(cheerRef);
      if (d.exists()) {
        await deleteDoc(cheerRef);
      } else {
        await setDoc(cheerRef, {
          userId: user.uid,
          workoutId,
          createdAt: Timestamp.now()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'cheers');
    }
  };

  const handleShareEmail = async () => {
    if (!user?.email) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'FitTrack AI 친구 초대',
          text: `FitTrack AI에서 함께 운동해요! 제 이메일은 ${user.email} 입니다.`,
          url: window.location.href
        });
      } catch (err) {
        console.error("Share error:", err);
      }
    } else {
      navigator.clipboard.writeText(user.email);
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
                  {/* Input Section - Moved up */}
                  <section className="bg-white p-4 rounded-3xl shadow-sm border border-gray-50 relative">
                    <div className="flex items-center justify-between mb-4 px-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
                          <Plus className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm">운동 기록하기</h3>
                          <p className="text-[10px] font-bold text-blue-500">
                            {format(selectedDate, 'yyyy년 M월 d일')} 기록
                          </p>
                        </div>
                      </div>
                      {!isSameDay(selectedDate, new Date()) && (
                        <button 
                          onClick={() => setSelectedDate(startOfToday())}
                          className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg"
                        >
                          오늘로 이동
                        </button>
                      )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div className="relative min-h-[120px]">
                        {/* Ghost Overlay - Removed */}
                        
                        <textarea
                          ref={inputRef}
                          value={inputText}
                          onChange={(e) => {
                            setInputText(e.target.value);
                          }}
                          placeholder="오늘의 운동을 자유롭게 입력하세요. AI가 당신의 성장을 분석해 드립니다"
                          className="w-full min-h-[120px] p-4 bg-gray-50/50 rounded-2xl border-none focus:ring-2 focus:ring-blue-500 transition-all resize-none text-base relative z-10 font-sans leading-normal"
                          disabled={isAnalyzing}
                        />
                        {isAnalyzing && (
                          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 z-20">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                            <span className="text-xs font-bold text-blue-600">AI 분석 중</span>
                          </div>
                        )}
                      </div>

                      {/* Image Upload Preview */}
                      <div className="flex flex-wrap gap-2">
                        {imageUrls.map((url, idx) => (
                          <div key={idx} className="relative w-20 h-20 rounded-2xl overflow-hidden group">
                            <Image src={url} alt="Workout" fill className="object-cover" unoptimized />
                            <button 
                              type="button"
                              onClick={() => removeImage(idx)}
                              className="absolute top-1 right-1 p-1 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ))}
                        <label className="w-20 h-20 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-100 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-all">
                          <Camera className="w-6 h-6 text-gray-300" />
                          <span className="text-[10px] font-bold text-gray-300 mt-1">사진 추가</span>
                          <input 
                            type="file" 
                            multiple 
                            accept="image/*" 
                            onChange={handleImageUpload} 
                            className="hidden" 
                          />
                        </label>
                      </div>

                      {/* Suggestions */}
                      <AnimatePresence>
                        {suggestions.length > 0 && (
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
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        type="submit"
                        disabled={!inputText.trim() || isAnalyzing}
                        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-bold shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" />
                        {format(selectedDate, 'M/d')} 기록하기
                      </button>
                    </form>
                  </section>

                  {/* Contribution Graph (Monthly) */}
                  <section className="bg-white p-5 rounded-3xl shadow-sm border border-gray-50">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-col">
                        <h3 className="font-bold text-base">활동 잔디</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <button 
                            onClick={() => setViewMonth(prev => addMonths(prev, -1))}
                            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <ChevronLeft className="w-3 h-3 text-gray-400" />
                          </button>
                          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                            {format(viewMonth, 'yyyy년 M월')}
                          </span>
                          <button 
                            onClick={() => setViewMonth(prev => addMonths(prev, 1))}
                            className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <ChevronRight className="w-3 h-3 text-gray-400" />
                          </button>
                        </div>
                      </div>
                      <Calendar className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 justify-center">
                      {/* Day labels */}
                      {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                        <div key={d} className="text-[10px] text-gray-300 font-bold text-center mb-1">{d}</div>
                      ))}
                      
                      {/* Empty cells for padding before start of month */}
                      {Array.from({ length: getDay(startOfMonth(viewMonth)) }).map((_, i) => (
                        <div key={`empty-${i}`} className="aspect-square" />
                      ))}
                      
                      {contributionData.map((day, i) => {
                        const hasWorkout = day.count > 0;
                        const isSaturday = getDay(day.date) === 6;
                        const isSunday = getDay(day.date) === 0;
                        const prevDay = i > 0 ? contributionData[i - 1] : null;
                        const nextDay = i < contributionData.length - 1 ? contributionData[i + 1] : null;
                        
                        const hasPrevWorkout = prevDay && prevDay.count > 0 && !isSunday;
                        const hasNextWorkout = nextDay && nextDay.count > 0 && !isSaturday;

                        return (
                          <div key={i} className="relative aspect-square">
                            {/* Streak Connector */}
                            {hasWorkout && hasNextWorkout && (
                              <div className="absolute top-0 bottom-0 -right-[6px] w-[10px] z-0 bg-blue-600" />
                            )}
                            
                            <button
                              onClick={() => setSelectedDate(day.date)}
                              title={`${format(day.date, 'yyyy-MM-dd')}: ${day.count} workouts`}
                              className={`w-full h-full transition-all flex items-center justify-center relative z-10 group ${
                                isSameDay(day.date, selectedDate) ? 'ring-2 ring-blue-600 ring-offset-2 z-20' : ''
                              } ${
                                !hasWorkout ? 'bg-gray-50 rounded-lg' :
                                'bg-blue-600'
                              } ${
                                hasWorkout ? (
                                  (hasPrevWorkout && hasNextWorkout) ? 'rounded-none' :
                                  hasPrevWorkout ? 'rounded-r-lg rounded-l-none' :
                                  hasNextWorkout ? 'rounded-l-lg rounded-r-none' :
                                  'rounded-lg'
                                ) : 'rounded-lg'
                              }`}
                            >
                              <span className={`text-[8px] font-bold ${
                                hasWorkout ? 'text-white' : 
                                isSameDay(day.date, selectedDate) ? 'text-blue-600 font-black' : 'text-gray-300'
                              }`}>
                                {format(day.date, 'd')}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-400 font-bold uppercase">이번 달</span>
                          <span className="text-sm font-black text-blue-600">{contributionData.reduce((acc, curr) => acc + curr.count, 0)}회</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[8px] text-gray-400 font-bold uppercase">
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 bg-gray-50 rounded-[2px]" />
                          <span>휴식</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 bg-blue-600 rounded-[2px]" />
                          <span>운동</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* List Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-sm font-bold text-gray-400">
                        {isSameDay(selectedDate, new Date()) ? '오늘' : format(selectedDate, 'M월 d일')} 활동
                      </h3>
                      <span className="text-[10px] font-bold text-gray-300">
                        {selectedDayWorkouts.length}개의 기록
                      </span>
                    </div>
                    
                    <AnimatePresence mode="popLayout">
                      {selectedDayWorkouts.length === 0 ? (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="bg-white p-10 rounded-3xl text-center border border-gray-50"
                        >
                          <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                            <History className="w-6 h-6 text-gray-200" />
                          </div>
                          <p className="text-sm text-gray-400">이 날의 기록이 없습니다.</p>
                        </motion.div>
                      ) : (
                        selectedDayWorkouts.map((workout) => (
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
                                  {format(workout.date, 'HH:mm')}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button onClick={() => setEditingWorkout(workout)} className="text-gray-300 hover:text-blue-500 transition-colors">
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(workout.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <p className="text-sm font-medium text-gray-800 leading-relaxed">
                                {workout.rawText}
                              </p>

                              {workout.images && workout.images.length > 0 && (
                                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                                  {workout.images.map((url: string, idx: number) => (
                                    <div key={idx} className="relative w-32 h-32 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-100">
                                      <Image src={url} alt="Workout" fill className="object-cover" unoptimized />
                                    </div>
                                  ))}
                                </div>
                              )}

                              {workout.exercises && workout.exercises.length > 0 && (
                                <div className="space-y-3">
                                  {groupExercises(workout.exercises).map((group, gIdx) => (
                                    <div key={gIdx} className="bg-gray-50/50 rounded-2xl p-3 border border-gray-100/50">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-gray-700">{group.name}</span>
                                        <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                                          총 {group.items.length}세트
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {group.items.map((ex, iIdx) => (
                                          <div key={iIdx} className="relative">
                                            <button 
                                              onClick={() => setQuickEdit(quickEdit?.workoutId === workout.id && quickEdit?.exerciseIdx === ex.originalIdx ? null : { workoutId: workout.id, exerciseIdx: ex.originalIdx })}
                                              className={`px-3 py-2 rounded-xl text-xs transition-all flex items-center gap-2 ${
                                                quickEdit?.workoutId === workout.id && quickEdit?.exerciseIdx === ex.originalIdx 
                                                ? 'bg-blue-600 text-white shadow-md' 
                                                : 'bg-white border border-gray-100 text-gray-500 hover:border-blue-200'
                                              }`}
                                            >
                                              <span className="font-bold">{ex.weight}{ex.unit || 'kg'}</span>
                                              <span className="opacity-40">·</span>
                                              <span>{ex.reps}회</span>
                                            </button>

                                            <AnimatePresence>
                                              {quickEdit?.workoutId === workout.id && quickEdit?.exerciseIdx === ex.originalIdx && (
                                                <motion.div 
                                                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                                  className="absolute bottom-full left-0 mb-2 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 flex flex-col gap-3 min-w-[140px]"
                                                >
                                                  <div className="flex items-center justify-between gap-4">
                                                    <div className="flex flex-col">
                                                      <span className="text-[10px] font-bold text-gray-400 uppercase">무게</span>
                                                      <span className="text-sm font-black text-gray-800">{ex.weight}</span>
                                                    </div>
                                                    <div className="flex gap-1">
                                                      <button onClick={() => handleQuickUpdate(workout.id, ex.originalIdx, 'weight', -1)} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-100"><ChevronDown className="w-3 h-3" /></button>
                                                      <button onClick={() => handleQuickUpdate(workout.id, ex.originalIdx, 'weight', 1)} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-100"><ChevronUp className="w-3 h-3" /></button>
                                                    </div>
                                                  </div>
                                                  <div className="h-[1px] bg-gray-50" />
                                                  <div className="flex items-center justify-between gap-4">
                                                    <div className="flex flex-col">
                                                      <span className="text-[10px] font-bold text-gray-400 uppercase">횟수</span>
                                                      <span className="text-sm font-black text-gray-800">{ex.reps}</span>
                                                    </div>
                                                    <div className="flex gap-1">
                                                      <button onClick={() => handleQuickUpdate(workout.id, ex.originalIdx, 'reps', -1)} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-100"><ChevronDown className="w-3 h-3" /></button>
                                                      <button onClick={() => handleQuickUpdate(workout.id, ex.originalIdx, 'reps', 1)} className="p-1.5 bg-gray-50 rounded-lg hover:bg-gray-100"><ChevronUp className="w-3 h-3" /></button>
                                                    </div>
                                                  </div>
                                                  <button onClick={() => setQuickEdit(null)} className="w-full py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold">닫기</button>
                                                </motion.div>
                                              )}
                                            </AnimatePresence>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {workout.analysis && (
                                <div className="p-3 bg-blue-50/30 rounded-2xl border border-blue-50">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Sparkles className="w-3 h-3 text-blue-500" />
                                    <span className="text-[10px] font-bold text-blue-500 uppercase">AI 데이터 인사이트</span>
                                  </div>
                                  <div className="text-xs text-blue-900/70 leading-relaxed font-medium">
                                    <ReactMarkdown>{workout.analysis}</ReactMarkdown>
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))
                      )}
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
                  {exerciseNames.length === 0 ? (
                    <div className="bg-white p-10 rounded-3xl text-center space-y-4 border border-gray-50">
                      <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
                        <Dumbbell className="w-8 h-8 text-blue-500" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-gray-800">기록된 운동이 없습니다</h3>
                        <p className="text-sm text-gray-400">운동을 기록하면 종목별 통계를 볼 수 있어요.</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('timeline')}
                        className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-md"
                      >
                        운동 기록하러 가기
                      </button>
                    </div>
                  ) : (
                    <>
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
                        <div className="space-y-4">
                          <div className="flex items-center justify-between px-1">
                            <h4 className="text-sm font-bold text-gray-400">{selectedExercise} 히스토리</h4>
                            <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-lg">
                              총 {exerciseHistory[selectedExercise].reduce((acc, group) => acc + group.entries.length, 0)}회
                            </span>
                          </div>
                          <div className="space-y-3">
                            {exerciseHistory[selectedExercise].map((group, idx) => (
                              <div key={idx} className={`p-5 rounded-3xl shadow-sm border transition-all ${
                                group.isBestDay 
                                  ? 'bg-orange-50 border-orange-200 ring-2 ring-orange-500/20' 
                                  : 'bg-white border-gray-50'
                              }`}>
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2">
                                    <Calendar className={`w-3 h-3 ${group.isBestDay ? 'text-orange-400' : 'text-gray-300'}`} />
                                    <span className={`text-[11px] font-bold ${group.isBestDay ? 'text-orange-600' : 'text-gray-400'}`}>
                                      {format(group.date, 'yyyy년 M월 d일')}
                                    </span>
                                    {group.isBestDay && (
                                      <div className="flex items-center gap-1 bg-orange-500 text-white px-2 py-0.5 rounded-full animate-bounce">
                                        <Flame className="w-2.5 h-2.5" />
                                        <span className="text-[8px] font-black uppercase">Best</span>
                                      </div>
                                    )}
                                  </div>
                                  <button 
                                    onClick={() => {
                                      const workout = workouts.find(w => w.id === group.entries[0].workoutId);
                                      if (workout) setEditingWorkout(workout);
                                    }}
                                    className={`${group.isBestDay ? 'text-orange-300 hover:text-orange-500' : 'text-gray-300 hover:text-blue-500'} transition-colors`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <div className="space-y-4">
                                  {group.entries.map((item, entryIdx) => (
                                    <div key={entryIdx} className="flex items-center justify-between">
                                      <div className="flex items-center gap-4">
                                        <div className="flex flex-col">
                                          <span className={`text-[10px] font-bold uppercase mb-0.5 ${group.isBestDay ? 'text-orange-300' : 'text-gray-300'}`}>Weight</span>
                                          <span className={`text-base font-black ${group.isBestDay ? 'text-orange-900' : 'text-gray-800'}`}>{item.weight}<span className="text-xs ml-0.5">{item.unit || 'kg'}</span></span>
                                        </div>
                                        <div className={`w-px h-8 ${group.isBestDay ? 'bg-orange-200' : 'bg-gray-100'}`} />
                                        <div className="flex flex-col">
                                          <span className={`text-[10px] font-bold uppercase mb-0.5 ${group.isBestDay ? 'text-orange-300' : 'text-gray-300'}`}>Reps</span>
                                          <span className={`text-base font-black ${group.isBestDay ? 'text-orange-900' : 'text-gray-800'}`}>{item.reps}<span className="text-xs ml-0.5">r</span></span>
                                        </div>
                                        <div className={`w-px h-8 ${group.isBestDay ? 'bg-orange-200' : 'bg-gray-100'}`} />
                                        <div className="flex flex-col">
                                          <span className={`text-[10px] font-bold uppercase mb-0.5 ${group.isBestDay ? 'text-orange-300' : 'text-gray-300'}`}>Sets</span>
                                          <span className={`text-base font-black ${group.isBestDay ? 'text-orange-900' : 'text-gray-800'}`}>{item.sets}<span className="text-xs ml-0.5">s</span></span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {activeTab === 'friends' && (
                <motion.div
                  key="friends"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  {/* Compact Friend Management Section */}
                  <section className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-gray-50 space-y-5">
                    {/* My ID Row */}
                    <div className="flex items-center justify-between bg-blue-50/50 p-3 pl-4 rounded-2xl border border-blue-100/50">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-1.5 bg-blue-600 rounded-lg shrink-0">
                          <Users className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] font-black text-blue-600/50 uppercase tracking-wider leading-none mb-1">My Friend ID</span>
                          <span className="text-xs font-bold text-blue-900 truncate">{user?.email}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button 
                          onClick={() => user?.email && navigator.clipboard.writeText(user.email)}
                          className="p-2 bg-white text-blue-600 rounded-xl shadow-sm border border-blue-100 active:scale-90 transition-all"
                          title="복사"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={handleShareEmail}
                          className="p-2 bg-blue-600 text-white rounded-xl shadow-sm active:scale-90 transition-all"
                          title="공유"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Add Friend Row */}
                    <div className="space-y-3">
                      <form onSubmit={handleAddFriend} className="flex gap-2">
                        <div className="relative flex-1">
                          <div className="absolute left-4 top-1/2 -translate-y-1/2">
                            <UserPlus className="w-4 h-4 text-gray-400" />
                          </div>
                          <input
                            type="email"
                            value={friendEmail}
                            onChange={(e) => setFriendEmail(e.target.value)}
                            placeholder="친구 이메일로 추가하기"
                            className="w-full pl-10 pr-4 py-3 bg-gray-50 rounded-2xl text-xs border-none focus:ring-2 focus:ring-blue-500 transition-all"
                            required
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={isAddingFriend}
                          className="px-5 py-3 bg-gray-900 text-white rounded-2xl font-bold text-xs shadow-lg shadow-gray-100 disabled:opacity-50 active:scale-95 transition-all"
                        >
                          {isAddingFriend ? <Loader2 className="w-4 h-4 animate-spin" /> : '추가'}
                        </button>
                      </form>
                      {error && (
                        <p className="text-[10px] text-red-500 font-bold px-2 flex items-center gap-1.5 animate-pulse">
                          <X className="w-3 h-3" /> {error}
                        </p>
                      )}
                    </div>
                  </section>

                  {/* Friends List */}
                  {friends.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-sm font-bold text-gray-400">내 친구 ({friends.length})</h3>
                      </div>
                      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-1">
                        {friends.map(friend => (
                          <div key={friend.uid} className="flex flex-col items-center gap-2 min-w-[70px] group relative">
                            <div className="w-16 h-16 rounded-3xl bg-blue-50 flex items-center justify-center overflow-hidden border-4 border-white shadow-md relative group-hover:scale-105 transition-transform">
                              {friend.photoURL ? (
                                <Image 
                                  src={friend.photoURL} 
                                  alt={friend.displayName} 
                                  fill 
                                  className="object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <UserIcon className="w-7 h-7 text-blue-600" />
                              )}
                              <button 
                                onClick={() => handleRemoveFriend(friend.uid)}
                                className="absolute inset-0 bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <UserMinus className="w-6 h-6 text-white" />
                              </button>
                            </div>
                            <span className="text-[11px] font-bold text-gray-600 truncate w-full text-center">
                              {friend.displayName || friend.email.split('@')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Friends' Workouts Feed */}
                  <div className="space-y-5">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-sm font-bold text-gray-400">친구들의 활동</h3>
                      <div className="h-[1px] flex-1 bg-gray-100 mx-4" />
                    </div>
                    
                    {friendsWorkouts.length === 0 ? (
                      <div className="bg-white p-12 rounded-[2.5rem] text-center space-y-4 border border-gray-50">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto">
                          <Users className="w-10 h-10 text-gray-200" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-gray-800">아직 활동이 없어요</p>
                          <p className="text-xs text-gray-400">친구를 추가하고 운동 기록을 공유해보세요!</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {friendsWorkouts.map((workout) => {
                          const friend = friends.find(f => f.uid === workout.userId);
                          const workoutCheers = cheers[workout.id] || [];
                          const hasCheered = workoutCheers.some(c => c.userId === user?.uid);
                          
                          return (
                            <motion.div 
                              layout
                              key={workout.id} 
                              className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-50 hover:shadow-md transition-shadow"
                            >
                              <div className="flex items-center justify-between mb-5">
                                <div className="flex items-center gap-3">
                                  <div className="w-12 h-12 rounded-2xl bg-gray-100 overflow-hidden relative border-2 border-white shadow-sm">
                                    {friend?.photoURL ? (
                                      <Image 
                                        src={friend.photoURL} 
                                        alt={friend.displayName} 
                                        fill 
                                        className="object-cover"
                                        referrerPolicy="no-referrer"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center bg-blue-50">
                                        <UserIcon className="w-6 h-6 text-blue-600" />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-sm font-black text-gray-800">
                                      {friend?.displayName || friend?.email?.split('@')[0] || '친구'}
                                    </p>
                                    <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                                      <Calendar className="w-2.5 h-2.5" />
                                      {format(workout.date, 'M월 d일 · HH:mm')}
                                    </p>
                                  </div>
                                </div>
                                <button 
                                  onClick={() => handleCheer(workout.id)}
                                  className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-black transition-all ${
                                    hasCheered 
                                      ? 'bg-pink-50 text-pink-500 ring-1 ring-pink-100' 
                                      : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                                  }`}
                                >
                                  <Heart className={`w-3.5 h-3.5 ${hasCheered ? 'fill-pink-500' : ''}`} />
                                  {workoutCheers.length > 0 && <span>{workoutCheers.length}</span>}
                                </button>
                              </div>
                              
                              <div className="bg-gray-50/50 p-4 rounded-3xl mb-4 border border-gray-100/50">
                                <p className="text-sm text-gray-700 leading-relaxed font-medium">{workout.rawText}</p>
                              </div>
                              
                              {workout.images && workout.images.length > 0 && (
                                <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
                                  {workout.images.map((url: string, idx: number) => (
                                    <div key={idx} className="relative w-48 h-48 flex-shrink-0 rounded-3xl overflow-hidden border-2 border-white shadow-sm">
                                      <Image src={url} alt="Workout" fill className="object-cover" unoptimized />
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="grid grid-cols-1 gap-3">
                                {groupExercises(workout.exercises).map((group, gIdx) => (
                                  <div key={gIdx} className="bg-white rounded-2xl p-4 border border-gray-100">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        <span className="text-xs font-black text-gray-800">{group.name}</span>
                                      </div>
                                      <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2.5 py-1 rounded-xl">
                                        {group.items.length}세트
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {group.items.map((ex, iIdx) => (
                                        <div key={iIdx} className="px-3 py-2 bg-gray-50 rounded-xl text-[10px] font-bold text-gray-600 border border-gray-100/50">
                                          {ex.weight}{ex.unit || 'kg'} <span className="text-gray-300 mx-1">|</span> {ex.reps}회
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Edit Workout Modal */}
      <AnimatePresence>
        {editingWorkout && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[40px] p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-gray-800">기록 수정하기</h3>
                <button onClick={() => setEditingWorkout(null)} className="p-2 bg-gray-50 rounded-full">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              
              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 scrollbar-hide">
                {editingWorkout.exercises.map((ex: any, idx: number) => (
                  <div key={idx} className="p-5 bg-gray-50 rounded-3xl space-y-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Exercise Name</label>
                      <input 
                        type="text"
                        value={ex.name}
                        onChange={(e) => {
                          const newExercises = [...editingWorkout.exercises];
                          newExercises[idx].name = e.target.value;
                          setEditingWorkout({...editingWorkout, exercises: newExercises});
                        }}
                        className="w-full bg-white px-4 py-3 rounded-2xl text-sm font-bold border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Weight</label>
                        <input 
                          type="number"
                          value={ex.weight}
                          onChange={(e) => {
                            const newExercises = [...editingWorkout.exercises];
                            newExercises[idx].weight = e.target.value;
                            setEditingWorkout({...editingWorkout, exercises: newExercises});
                          }}
                          className="w-full bg-white px-4 py-3 rounded-2xl text-sm font-bold border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Reps</label>
                        <input 
                          type="number"
                          value={ex.reps}
                          onChange={(e) => {
                            const newExercises = [...editingWorkout.exercises];
                            newExercises[idx].reps = e.target.value;
                            setEditingWorkout({...editingWorkout, exercises: newExercises});
                          }}
                          className="w-full bg-white px-4 py-3 rounded-2xl text-sm font-bold border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Sets</label>
                        <input 
                          type="number"
                          value={ex.sets}
                          onChange={(e) => {
                            const newExercises = [...editingWorkout.exercises];
                            newExercises[idx].sets = e.target.value;
                            setEditingWorkout({...editingWorkout, exercises: newExercises});
                          }}
                          className="w-full bg-white px-4 py-3 rounded-2xl text-sm font-bold border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => handleUpdateWorkout(editingWorkout.id, editingWorkout.exercises)}
                className="w-full mt-8 bg-blue-600 text-white py-4 rounded-3xl font-bold shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-5 h-5" />
                저장하기
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav */}
      {user && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 px-6 pb-8 pt-3 z-30">
          <div className="max-w-md mx-auto flex justify-between items-center">
            {[
              { id: 'exercises', label: '종목', icon: ListFilter },
              { id: 'timeline', label: '기록', icon: History },
              { id: 'friends', label: '친구', icon: Users },
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
