import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, 
  MicOff, 
  Check, 
  Plus, 
  Volume2, 
  User, 
  RefreshCw, 
  Clock, 
  Trash2, 
  Bell, 
  BellRing, 
  Sparkles, 
  Settings, 
  RotateCcw, 
  VolumeX,
  Radio,
  CheckCircle2,
  Info,
  Calendar,
  Smartphone,
  ShieldCheck,
  Play,
  Vibrate,
  AlertTriangle,
  Globe,
  LogOut
} from 'lucide-react';
import { AssistantSettings, Task, Gender, CommandHistoryItem, AuthUser } from '../types';
import { 
  setupAssistant, 
  processVoiceCommand, 
  generateSpeechAudio, 
  generateReminderAlert 
} from '../services/geminiService';
import { 
  playAudioData, 
  playNotificationChime, 
  playWakeWordPromptChime,
  speakWithBrowserSynthesis,
  startBackgroundAudioKeepAlive,
  stopBackgroundAudioKeepAlive,
  vibrateDevice,
  requestScreenWakeLock,
  releaseScreenWakeLock,
  requestNotificationPermission,
  showSystemNotification,
  updateMediaSession
} from '../utils/audioUtils';
import { SUPPORTED_LANGUAGES, getLanguage, LanguageConfig } from '../utils/languages';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { CommandHistorySection } from './CommandHistorySection';

const STORAGE_KEY_SETTINGS = 'voiceminder_settings_v4';
const STORAGE_KEY_TASKS = 'voiceminder_tasks_v4';
const STORAGE_KEY_COMMAND_HISTORY = 'voiceminder_cmd_history_v1';

interface ReminderAppProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

export default function ReminderApp({ currentUser, onLogout }: ReminderAppProps = {}) {
  // Settings & Assistant State
  const [settings, setSettings] = useState<AssistantSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          name: 'ESTER', // Fixed name
          gender: parsed.gender || 'FEMALE',
          voiceName: parsed.voiceName || 'Kore',
          languageCode: parsed.languageCode || 'it-IT',
          isSetup: true,
        };
      }
    } catch (e) {
      console.warn("Error loading settings:", e);
    }
    return {
      name: 'ESTER',
      gender: 'FEMALE',
      voiceName: 'Kore',
      languageCode: 'it-IT',
      isSetup: true,
      continuousListening: true,
      wakeWordRequired: false,
      soundChime: true,
      repeatUntilCompleted: true,
      alarmRepeatSeconds: 10,
      backgroundAudioKeepAlive: true,
      vibrationEnabled: true,
    };
  });

  // Current active language dictionary
  const currentLang = getLanguage(settings.languageCode || 'it-IT');
  const t = currentLang.dict;

  const [tempName, setTempName] = useState('ESTER');
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TASKS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Error loading tasks:", e);
    }
    return [
      {
        id: 'sample-1',
        text: 'Bere un bicchiere d\'acqua',
        isCompleted: false,
        scheduledTime: null,
        nextReminderAt: Date.now() + 1000 * 60 * 30, // 30 mins
        createdAt: Date.now(),
        repeatIntervalMins: 30,
      }
    ];
  });

  const [newTaskInput, setNewTaskInput] = useState('');
  const [scheduledTimeInput, setScheduledTimeInput] = useState('');
  
  // Voice & Interaction State
  const [isListening, setIsListening] = useState(false);
  const [isWakeActive, setIsWakeActive] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [processing, setProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastSpokenResponse, setLastSpokenResponse] = useState<string>('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'completed'>('active');
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');
  const [backgroundAudioActive, setBackgroundAudioActive] = useState<boolean>(false);

  // Expandable Command History State (persisted, showing last 3)
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_COMMAND_HISTORY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Error loading command history:", e);
    }
    return [];
  });
  const [isCommandHistoryOpen, setIsCommandHistoryOpen] = useState<boolean>(false);

  // Active Repeating Alarm Ringing State
  const [activeRingingTask, setActiveRingingTask] = useState<Task | null>(null);
  const [alarmRepeatCount, setAlarmRepeatCount] = useState<number>(0);

  // Refs for callbacks & continuous loop
  const recognitionRef = useRef<any>(null);
  const wakeTimeoutRef = useRef<any>(null);
  const tasksRef = useRef<Task[]>(tasks);
  const settingsRef = useRef<AssistantSettings>(settings);
  const isListeningRef = useRef<boolean>(isListening);
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  const processingRef = useRef<boolean>(processing);
  const activeRingingTaskRef = useRef<Task | null>(activeRingingTask);
  const audioContextRef = useRef<AudioContext | null>(null);
  const repeatingAlarmTimerRef = useRef<any>(null);

  useEffect(() => { 
    tasksRef.current = tasks; 
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks)); 
  }, [tasks]);

  useEffect(() => { 
    settingsRef.current = settings; 
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings)); 
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COMMAND_HISTORY, JSON.stringify(commandHistory));
  }, [commandHistory]);

  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { processingRef.current = processing; }, [processing]);
  useEffect(() => { activeRingingTaskRef.current = activeRingingTask; }, [activeRingingTask]);

  // Live Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString(settings.languageCode || 'it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [settings.languageCode]);

  // Initialize Web Audio Context
  const getOrCreateAudioContext = useCallback((): AudioContext => {
    let ctx = audioContextRef.current;
    if (!ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioCtx({ sampleRate: 24000 });
      audioContextRef.current = ctx;
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }, []);

  // Background Audio & WakeLock Setup on Mount / Visibility Change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (settingsRef.current.backgroundAudioKeepAlive) {
          requestScreenWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Enable Background Audio Mode
  const enableBackgroundAudioSession = useCallback(async () => {
    try {
      getOrCreateAudioContext();
      startBackgroundAudioKeepAlive();
      await requestScreenWakeLock();
      await requestNotificationPermission();
      setBackgroundAudioActive(true);
    } catch (e) {
      console.warn("Background audio activation notice:", e);
    }
  }, [getOrCreateAudioContext]);

  // Vocal Output with Gemini TTS + Browser SpeechSynthesis fallback + Lock Screen metadata
  const speak = useCallback(async (
    text: string, 
    customAudioData?: string | null, 
    mediaMetadata?: { title: string; artist?: string; onActionComplete?: () => void }
  ) => {
    if (!text) return;
    setIsSpeaking(true);
    setLastSpokenResponse(text);

    const langCode = settingsRef.current.languageCode || 'it-IT';

    // Pause recognition while speaking to prevent echoing into itself
    const wasListening = isListeningRef.current;
    if (wasListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    try {
      const ctx = getOrCreateAudioContext();
      let audioToPlay = customAudioData;

      if (!audioToPlay) {
        audioToPlay = await generateSpeechAudio(text, settingsRef.current.gender, settingsRef.current.voiceName);
      }

      const meta = mediaMetadata || {
        title: text.length > 40 ? text.slice(0, 37) + '...' : text,
        artist: `${settingsRef.current.name} - VoiceReminder`,
      };

      if (audioToPlay) {
        await playAudioData(audioToPlay, ctx, 24000, meta);
      } else {
        await speakWithBrowserSynthesis(text, settingsRef.current.gender, meta, langCode);
      }
    } catch (e) {
      console.warn("Speech error, using browser synthesis:", e);
      await speakWithBrowserSynthesis(text, settingsRef.current.gender, mediaMetadata, langCode);
    } finally {
      setIsSpeaking(false);
      // Resume listening if continuous mode was enabled and not currently alarming
      if (wasListening && settingsRef.current.continuousListening) {
        setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {}
          }
        }, 500);
      }
    }
  }, [getOrCreateAudioContext]);

  // Change Language Handler
  const handleSelectLanguage = useCallback((lang: LanguageConfig) => {
    const updated: AssistantSettings = {
      ...settingsRef.current,
      languageCode: lang.code,
    };
    setSettings(updated);
    settingsRef.current = updated;

    // Update speech recognition if active
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = lang.code;
      } catch (e) {}
    }

    // Speak vocal confirmation in the selected language
    const confirmMessage = `${lang.dict.wakeInstruction}`;
    speak(confirmMessage);
  }, [speak]);

  // Voice Preview Handler
  const handlePreviewVoice = useCallback((lang: LanguageConfig) => {
    speak(lang.dict.wakeInstruction, null, undefined);
  }, [speak]);

  // Dismiss / Mark Completed Action (Stops active repeating alarm)
  const handleCompleteAlarm = useCallback(async (taskId?: string) => {
    const target = activeRingingTaskRef.current;
    const targetId = taskId || target?.id;

    if (repeatingAlarmTimerRef.current) {
      clearTimeout(repeatingAlarmTimerRef.current);
      repeatingAlarmTimerRef.current = null;
    }

    setActiveRingingTask(null);
    setAlarmRepeatCount(0);

    if (targetId) {
      setTasks(prev => prev.map(t => t.id === targetId ? { ...t, isCompleted: true } : t));
      const taskText = target?.text || "reminder";
      const doneNotice = `${taskText} - ${currentLang.dict.completed}!`;
      await speak(doneNotice);
    }

    // Refresh background keepalive
    if (settingsRef.current.backgroundAudioKeepAlive) {
      startBackgroundAudioKeepAlive();
    }
  }, [currentLang.dict.completed, speak]);

  // Snooze Action for Repeating Alarm
  const handleSnoozeAlarm = useCallback(async (minutes: number = 5) => {
    const target = activeRingingTaskRef.current;
    if (repeatingAlarmTimerRef.current) {
      clearTimeout(repeatingAlarmTimerRef.current);
      repeatingAlarmTimerRef.current = null;
    }

    setActiveRingingTask(null);
    setAlarmRepeatCount(0);

    if (target) {
      const snoozeUntil = Date.now() + minutes * 60 * 1000;
      setTasks(prev => prev.map(t => t.id === target.id ? { ...t, nextReminderAt: snoozeUntil } : t));
      await speak(`OK, ${target.text} (+${minutes}m).`);
    }
  }, [speak]);

  // Repeating Alarm Loop: Rings continuously until user taps completed!
  const runAlarmLoopIteration = useCallback(async (task: Task) => {
    if (!activeRingingTaskRef.current || activeRingingTaskRef.current.id !== task.id) {
      return;
    }

    setAlarmRepeatCount(prev => prev + 1);

    // 1. Vibrate device
    if (settingsRef.current.vibrationEnabled) {
      vibrateDevice([500, 200, 500, 200, 800]);
    }

    // 2. Play audible alarm chime
    if (settingsRef.current.soundChime) {
      try {
        const ctx = getOrCreateAudioContext();
        await playNotificationChime(ctx);
      } catch (e) {}
    }

    // 3. Show Lock Screen notification
    showSystemNotification(
      `🔔 ${task.text}`,
      `${currentLang.dict.alarmText}`,
      () => handleCompleteAlarm(task.id)
    );

    // 4. Update MediaSession
    updateMediaSession({
      title: `🔔 ${task.text}`,
      artist: `${settingsRef.current.name} - VoiceReminder`,
      album: 'Alarm',
      onActionComplete: () => handleCompleteAlarm(task.id),
      onActionSnooze: () => handleSnoozeAlarm(5),
    });

    // 5. Vocal announcement in selected language
    const alertResult = await generateReminderAlert({
      taskText: task.text,
      assistantName: settingsRef.current.name,
      gender: settingsRef.current.gender,
      languageCode: settingsRef.current.languageCode || 'it-IT',
    });

    const announcement = alertResult.spokenText || `${task.text}!`;
    await speak(announcement, alertResult.audioData, {
      title: `Alarm: ${task.text}`,
      artist: settingsRef.current.name,
      onActionComplete: () => handleCompleteAlarm(task.id),
    });

    // 6. Schedule next repetition if still uncompleted!
    if (activeRingingTaskRef.current && activeRingingTaskRef.current.id === task.id) {
      const repeatDelayMs = (settingsRef.current.alarmRepeatSeconds || 10) * 1000;
      repeatingAlarmTimerRef.current = setTimeout(() => {
        runAlarmLoopIteration(task);
      }, repeatDelayMs);
    }
  }, [currentLang.dict.alarmText, getOrCreateAudioContext, handleCompleteAlarm, handleSnoozeAlarm, speak]);

  // Trigger Repeating Alarm for a Task
  const triggerRepeatingAlarm = useCallback((task: Task) => {
    if (activeRingingTaskRef.current?.id === task.id) return;

    setActiveRingingTask(task);
    setAlarmRepeatCount(0);

    requestScreenWakeLock();
    runAlarmLoopIteration(task);
  }, [runAlarmLoopIteration]);

  // Master Reminder Checker Loop
  useEffect(() => {
    const checkReminders = () => {
      if (activeRingingTaskRef.current) return;

      const now = Date.now();
      const uncompleted = tasksRef.current.filter(t => !t.isCompleted);

      for (const task of uncompleted) {
        if (now >= task.nextReminderAt) {
          triggerRepeatingAlarm(task);
          break;
        }
      }
    };

    const intervalId = setInterval(checkReminders, 2500);
    return () => clearInterval(intervalId);
  }, [triggerRepeatingAlarm]);

  // Handle Spoken Command
  const handleVoiceCommand = useCallback(async (spokenText: string) => {
    if (!spokenText.trim() || processingRef.current) return;

    setProcessing(true);
    setLastTranscript(spokenText);

    try {
      const now = new Date();
      const currentLocalTime = now.toLocaleTimeString(settingsRef.current.languageCode || 'it-IT', { hour: '2-digit', minute: '2-digit' });

      const result = await processVoiceCommand({
        transcript: spokenText,
        assistantName: settingsRef.current.name,
        existingTasks: tasksRef.current,
        gender: settingsRef.current.gender,
        languageCode: settingsRef.current.languageCode || 'it-IT',
        currentLocalTime,
      });

      // Record to Command History (storing latest 10, displaying top 3)
      const historyItem: CommandHistoryItem = {
        id: crypto.randomUUID(),
        transcript: spokenText,
        action: result.action,
        spokenResponse: result.spokenResponse || '',
        timestamp: Date.now(),
        timeStr: now.toLocaleTimeString(settingsRef.current.languageCode || 'it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        taskText: result.taskText,
        scheduledTime: result.scheduledTime,
      };
      setCommandHistory(prev => [historyItem, ...prev.filter(item => item.id !== historyItem.id)].slice(0, 10));

      // If user asked to change language dynamically
      if (result.action === 'CHANGE_LANGUAGE' && result.newLanguageCode) {
        const found = SUPPORTED_LANGUAGES.find(l => l.code.toLowerCase() === result.newLanguageCode?.toLowerCase() || l.code.startsWith(result.newLanguageCode || ''));
        if (found) {
          const updated = { ...settingsRef.current, languageCode: found.code };
          setSettings(updated);
          settingsRef.current = updated;
          if (recognitionRef.current) {
            try { recognitionRef.current.lang = found.code; } catch (e) {}
          }
        }
      }

      // Execute Action
      if (result.action === 'ADD_TASK' && result.taskText) {
        let nextReminder = Date.now() + 1000 * 60 * 30; // default 30 mins
        
        if (result.scheduledTime) {
          const [h, m] = result.scheduledTime.split(':').map(Number);
          const target = new Date();
          target.setHours(h, m, 0, 0);
          if (target.getTime() < Date.now()) {
            target.setDate(target.getDate() + 1);
          }
          nextReminder = target.getTime();
        }

        const newTask: Task = {
          id: crypto.randomUUID(),
          text: result.taskText,
          isCompleted: false,
          scheduledTime: result.scheduledTime || null,
          nextReminderAt: nextReminder,
          createdAt: Date.now(),
          repeatIntervalMins: 30,
        };

        setTasks(prev => [newTask, ...prev]);
      } else if (result.action === 'COMPLETE_TASK') {
        const targetId = result.matchedTaskId || activeRingingTaskRef.current?.id;
        if (targetId) {
          handleCompleteAlarm(targetId);
          return;
        }
      } else if (result.action === 'DELETE_TASK' && result.matchedTaskId) {
        setTasks(prev => prev.filter(t => t.id !== result.matchedTaskId));
        if (activeRingingTaskRef.current?.id === result.matchedTaskId) {
          setActiveRingingTask(null);
        }
      } else if (result.action === 'CLEAR_COMPLETED') {
        setTasks(prev => prev.filter(t => !t.isCompleted));
      } else if (result.action === 'SNOOZE_TASK') {
        const snoozeMins = result.snoozeMinutes || 5;
        if (activeRingingTaskRef.current) {
          handleSnoozeAlarm(snoozeMins);
          return;
        } else if (result.matchedTaskId) {
          setTasks(prev => prev.map(t => t.id === result.matchedTaskId ? {
            ...t,
            nextReminderAt: Date.now() + snoozeMins * 60 * 1000,
          } : t));
        }
      }

      // Assistant speaks the response aloud
      await speak(result.spokenResponse, result.audioData);

    } catch (err: any) {
      console.error("Voice processing error:", err);
      await speak("OK.");
    } finally {
      setProcessing(false);
      setInterimTranscript('');
    }
  }, [handleCompleteAlarm, handleSnoozeAlarm, speak]);

  // Start Voice Recognition in selected language
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicSupported(false);
      return;
    }

    try {
      enableBackgroundAudioSession();
    } catch (e) {}

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = settingsRef.current.languageCode || 'it-IT';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let currentInterim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text;
        } else {
          currentInterim += text;
        }
      }

      if (currentInterim) {
        setInterimTranscript(currentInterim);
      }

      if (finalTranscript.trim()) {
        const cleaned = finalTranscript.trim();
        setInterimTranscript('');
        console.log("Final spoken input:", cleaned);

        const lower = cleaned.toLowerCase();

        // If currently ringing and user says done / fatto / stop / fini
        if (activeRingingTaskRef.current && (
          lower.includes("fatto") || 
          lower.includes("completato") || 
          lower.includes("done") || 
          lower.includes("stop") || 
          lower.includes("hecho") || 
          lower.includes("fini") ||
          lower.includes("ho fatto") ||
          lower.includes("silenzio")
        )) {
          handleCompleteAlarm();
          return;
        }

        // Check if user calls wake phrase
        const isPureWakeCall = 
          lower === "ester" ||
          lower.includes("ester per favore") ||
          lower.includes("ester please") ||
          lower.includes("ester por favor") ||
          lower.includes("ester s'il vous plaît") ||
          lower.includes("ester bitte") ||
          lower.includes("ehi ester") ||
          lower.includes("hey ester") ||
          lower.includes("ciao ester") ||
          lower.includes("hello ester");

        if (isPureWakeCall) {
          try {
            const ctx = getOrCreateAudioContext();
            playWakeWordPromptChime(ctx);
          } catch (e) {}

          setIsWakeActive(true);
          if (wakeTimeoutRef.current) clearTimeout(wakeTimeoutRef.current);
          wakeTimeoutRef.current = setTimeout(() => {
            setIsWakeActive(false);
          }, 15000);

          speak(currentLang.dict.listening);
          return;
        }

        // Process command
        setIsWakeActive(false);
        if (wakeTimeoutRef.current) clearTimeout(wakeTimeoutRef.current);
        handleVoiceCommand(cleaned);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return;
      console.warn("Speech recognition notice:", event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (isListeningRef.current && settingsRef.current.continuousListening && !isSpeakingRef.current) {
        try {
          recognition.start();
        } catch (e) {
          setTimeout(() => {
            if (isListeningRef.current && !isSpeakingRef.current) {
              try { recognition.start(); } catch (err) {}
            }
          }, 1000);
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.warn("Failed to start speech recognition:", e);
    }
  }, [currentLang.dict.listening, enableBackgroundAudioSession, getOrCreateAudioContext, handleCompleteAlarm, handleVoiceCommand, speak]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsWakeActive(false);
    if (wakeTimeoutRef.current) clearTimeout(wakeTimeoutRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Auto-start continuous hands-free listening on initial load and unlock audio session on first gesture
  useEffect(() => {
    const timer = setTimeout(() => {
      startListening();
      enableBackgroundAudioSession();
    }, 400);

    const handleFirstGesture = () => {
      enableBackgroundAudioSession();
    };

    window.addEventListener('click', handleFirstGesture, { once: true, passive: true });
    window.addEventListener('touchstart', handleFirstGesture, { once: true, passive: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleFirstGesture);
      window.removeEventListener('touchstart', handleFirstGesture);
    };
  }, [startListening, enableBackgroundAudioSession]);

  // Manual Add Task Handler
  const handleManualAdd = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTaskInput.trim()) return;

    let nextReminder = Date.now() + 1000 * 60 * 30;
    if (scheduledTimeInput) {
      const [h, m] = scheduledTimeInput.split(':').map(Number);
      const target = new Date();
      target.setHours(h, m, 0, 0);
      if (target.getTime() < Date.now()) {
        target.setDate(target.getDate() + 1);
      }
      nextReminder = target.getTime();
    }

    const newTask: Task = {
      id: crypto.randomUUID(),
      text: newTaskInput.trim(),
      isCompleted: false,
      scheduledTime: scheduledTimeInput || null,
      nextReminderAt: nextReminder,
      createdAt: Date.now(),
      repeatIntervalMins: 30,
    };

    setTasks(prev => [newTask, ...prev]);
    setNewTaskInput('');
    setScheduledTimeInput('');

    const confirmMsg = scheduledTimeInput 
      ? `OK: ${newTask.text} (${scheduledTimeInput})`
      : `OK: ${newTask.text}`;

    const historyItem: CommandHistoryItem = {
      id: crypto.randomUUID(),
      transcript: newTask.text,
      action: 'ADD_TASK',
      spokenResponse: confirmMsg,
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString(settingsRef.current.languageCode || 'it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      taskText: newTask.text,
      scheduledTime: newTask.scheduledTime,
    };
    setCommandHistory(prev => [historyItem, ...prev.filter(item => item.id !== historyItem.id)].slice(0, 10));

    speak(confirmMsg);
  };

  // Read task aloud
  const handleReadTask = async (task: Task) => {
    let msg = `${task.text}.`;
    if (task.scheduledTime) msg += ` ${task.scheduledTime}.`;
    if (task.isCompleted) msg += ` ${t.completed}.`;
    else msg += ` ${t.active}.`;
    await speak(msg);
  };

  // Test Repeating Voice Alarm
  const testAlarmNow = () => {
    const testTask: Task = {
      id: 'test-alarm-' + Date.now(),
      text: 'Test: ' + (currentLang.quickPhrases[0] || 'Take medicine'),
      isCompleted: false,
      scheduledTime: null,
      nextReminderAt: Date.now(),
      createdAt: Date.now(),
    };
    setTasks(prev => [testTask, ...prev]);
    triggerRepeatingAlarm(testTask);
  };

  // Counts
  const pendingTasksCount = tasks.filter(t => !t.isCompleted).length;
  const completedTasksCount = tasks.filter(t => t.isCompleted).length;

  const displayedTasks = tasks.filter(t => {
    if (filterTab === 'active') return !t.isCompleted;
    if (filterTab === 'completed') return t.isCompleted;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#e3eee7] text-[#141b16] flex flex-col font-sans selection:bg-[#2e5941] selection:text-white pb-12">
      {/* Ambient Sage Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-[650px] h-[340px] bg-[#9abfaa]/25 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-[#89b09a]/20 rounded-full blur-[130px]" />
      </div>

      {/* 🔴 FULL-SCREEN RINGING ALARM MODAL */}
      {activeRingingTask && (
        <div className="fixed inset-0 z-50 bg-[#122018]/90 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-gradient-to-b from-[#1a3024] via-[#13231a] to-[#0f1b14] border-2 border-[#428860] rounded-3xl p-6 sm:p-8 shadow-2xl shadow-[#1f4e34]/30 space-y-6 relative overflow-hidden text-white">
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-60 h-60 bg-[#428860]/30 rounded-full blur-3xl animate-pulse pointer-events-none" />

            <div className="relative mx-auto w-24 h-24 rounded-3xl bg-gradient-to-tr from-[#2d6143] to-[#4ba071] text-white flex items-center justify-center shadow-xl shadow-[#2d6143]/40 animate-bounce">
              <BellRing className="w-12 h-12 stroke-[2.5]" />
              <span className="absolute -top-2 -right-2 px-2.5 py-1 bg-rose-600 text-white font-mono text-xs font-black rounded-full border-2 border-[#13231a] animate-ping">
                ALARM
              </span>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3d7a58]/30 border border-[#4ea073]/50 text-[#a9e4c1] text-xs font-bold uppercase tracking-wider">
                <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                <span>#{alarmRepeatCount || 1} • {t.alarmRepeating}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                {activeRingingTask.text}
              </h2>
              <p className="text-sm text-[#b2ddc5] font-medium">
                {settings.name} {t.alarmText}
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button
                id="alarm-complete-btn"
                type="button"
                onClick={() => handleCompleteAlarm()}
                className="w-full bg-gradient-to-r from-[#2a7a50] via-[#359463] to-[#2a7a50] hover:from-[#236843] hover:to-[#2d8156] text-white font-black py-4 px-6 rounded-2xl shadow-xl shadow-[#2a7a50]/30 text-base flex items-center justify-center gap-3 transition-all active:scale-[0.97] ring-4 ring-[#4fae7c]/30"
              >
                <Check className="w-6 h-6 stroke-[3]" />
                <span>{t.doneButton}</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleSnoozeAlarm(5)}
                  className="flex-1 bg-[#1c3326] hover:bg-[#254232] text-[#c0e0ce] font-semibold py-3 px-4 rounded-xl border border-[#315640] text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <Clock className="w-4 h-4 text-[#75c697]" />
                  <span>{t.snooze5Min}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSnoozeAlarm(10)}
                  className="flex-1 bg-[#1c3326] hover:bg-[#254232] text-[#c0e0ce] font-semibold py-3 px-4 rounded-xl border border-[#315640] text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <Clock className="w-4 h-4 text-[#75c697]" />
                  <span>{t.snooze10Min}</span>
                </button>
              </div>
            </div>

            <p className="text-xs text-[#9ebfae] flex items-center justify-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-[#75c697]" />
              <span>Voice: <strong className="text-white">"Done"</strong> / <strong className="text-white">"Fatto"</strong></span>
            </p>
          </div>
        </div>
      )}

      {/* Top Utility Bar with Language Selector */}
      <header className="relative z-20 w-full max-w-2xl mx-auto px-4 sm:px-6 pt-4 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Clock */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 backdrop-blur-md border border-[#c4d7cc] text-xs font-mono text-[#1c3927] shadow-xs">
            <Clock className="w-3.5 h-3.5 text-[#2e5941]" />
            <span>{currentTimeStr || '00:00:00'}</span>
          </div>

          {/* 50 Languages Selector Button */}
          <button
            id="open-language-btn"
            type="button"
            onClick={() => setShowLanguageModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 hover:bg-white border border-[#9ac2ab] hover:border-[#28553d] text-xs font-semibold text-[#1a3826] shadow-xs transition-all cursor-pointer group"
            title="Cambia Lingua e Voce (50 lingue disponibili)"
          >
            <span className="text-sm group-hover:scale-110 transition-transform">{currentLang.flag}</span>
            <span className="truncate max-w-[85px] sm:max-w-none">{currentLang.name}</span>
            <Globe className="w-3 h-3 text-[#28553d] opacity-70 group-hover:opacity-100" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Background Audio Screen-off Toggle */}
          <button
            type="button"
            onClick={enableBackgroundAudioSession}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              backgroundAudioActive 
                ? 'bg-[#d2e7db] border-[#8cb59d] text-[#143521] font-semibold shadow-xs'
                : 'bg-white/80 border-[#c4d7cc] text-[#4d6957] hover:text-[#183424] hover:bg-white'
            }`}
            title="Audio abilitato a schermo spento e telefono bloccato"
          >
            <Smartphone className="w-3.5 h-3.5 text-[#2e5941]" />
            <span className="hidden xs:inline">{backgroundAudioActive ? 'Schermo Spento: ON' : 'Audio Spento'}</span>
          </button>

          {/* Test Alarm */}
          <button
            id="test-alarm-btn"
            type="button"
            onClick={testAlarmNow}
            className="p-2 rounded-full bg-white/80 hover:bg-white border border-[#c4d7cc] hover:border-[#8cb59d] text-[#2e5941] shadow-xs transition-colors"
            title="Prova la sveglia a ripetizione vocale"
          >
            <BellRing className="w-4 h-4" />
          </button>

          {/* Settings */}
          <button
            id="open-settings-btn"
            type="button"
            onClick={() => setShowSettingsModal(!showSettingsModal)}
            className="p-2 rounded-full bg-white/80 hover:bg-white border border-[#c4d7cc] hover:border-[#8cb59d] text-[#2c4033] shadow-xs transition-colors"
            title="Impostazioni Assistente"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* User Account / Logout */}
          {currentUser && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/90 border border-[#9ac2ab] text-xs text-[#143521] shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Account Verificato" />
              <span className="font-semibold truncate max-w-[85px] sm:max-w-[130px]" title={currentUser.email}>
                {currentUser.email}
              </span>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="ml-0.5 text-[#466a54] hover:text-rose-700 hover:bg-rose-50 p-1 rounded-full transition-colors cursor-pointer"
                  title="Disconnetti account"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 space-y-5 pt-1">

        {/* 1. TOP LOGO & "VoiceReminder" BRANDING */}
        <section className="text-center flex flex-col items-center pt-2 select-none">
          {/* LUANCER AND CO. Emblem Capsule */}
          <div className="relative group cursor-pointer" onClick={toggleListening}>
            {/* Subtle brand glow behind logo */}
            <div className="absolute -inset-2 rounded-full bg-[#8faea0]/30 blur-md group-hover:bg-[#8faea0]/50 transition duration-500" />
            
            {/* Exact SVG Capsule and Calligraphy Monogram L */}
            <div className="relative flex flex-col items-center justify-center">
              <svg 
                viewBox="0 0 100 110" 
                className="w-16 h-18 sm:w-18 sm:h-20 drop-shadow-xs" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Capsule / Oval Outline matching the exact shape */}
                <rect 
                  x="20" 
                  y="8" 
                  width="60" 
                  height="94" 
                  rx="30" 
                  stroke="#7c9888" 
                  strokeWidth="2.2" 
                  fill="#eaf2ec" 
                />
                
                {/* Flowing handwritten cursive "L" Monogram */}
                <path 
                  d="M 45 32 C 51 22, 57 26, 54 44 C 51 57, 46 72, 41 76 C 35 80, 31 75, 34 68 C 37 63, 46 68, 64 71" 
                  stroke="#16201a" 
                  strokeWidth="2.8" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
              </svg>
            </div>
          </div>

          {/* LUANCER AND CO. Logotype */}
          <div className="text-center mt-2">
            <span className="text-base sm:text-lg font-semibold tracking-[0.24em] text-[#141b16] block uppercase font-sans">
              LUANCER AND CO.
            </span>
            <span className="text-[9px] sm:text-[10px] tracking-[0.28em] text-[#5e7769] font-medium block uppercase mt-0.5">
              QUALITY YOU CAN TRUST.
            </span>
          </div>

          {/* VoiceReminder Wordmark Under Logo */}
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#141b16] flex items-center justify-center gap-1.5 mt-3.5">
            <span>Voice</span>
            <span className="text-[#28553d]">Reminder</span>
          </h1>

          {/* Minimal Assistant Subtitle Tag with Language Pill */}
          <div className="mt-1.5 inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#d6e7dc] border border-[#a2c2b0] text-[#183623] text-xs font-medium shadow-xs">
            <Radio className="w-3.5 h-3.5 text-[#28553d] animate-pulse" />
            <span>{t.assistantTag} • {t.wakeInstruction}</span>
          </div>
        </section>

        {/* 2. Interactive Voice Center */}
        <section className={`relative overflow-hidden bg-white/75 backdrop-blur-xl border rounded-3xl p-5 sm:p-6 text-center flex flex-col items-center transition-all duration-300 shadow-sm ${
          isWakeActive 
            ? 'border-[#2d5c42] ring-4 ring-[#2d5c42]/20 shadow-md bg-[#edf5f0]' 
            : 'border-[#c4d7cc] hover:border-[#9fbfae]'
        }`}>
          {/* Central Voice Orb Button */}
          <div className="relative my-2">
            {isWakeActive && (
              <>
                <div className="absolute inset-0 rounded-full bg-[#2d5c42]/30 animate-ping" />
                <div className="absolute -inset-6 rounded-full border-2 border-[#2d5c42] animate-pulse" />
              </>
            )}

            {isListening && !isWakeActive && (
              <>
                <div className="absolute inset-0 rounded-full bg-[#487a5d]/20 animate-ping" />
                <div className="absolute -inset-4 rounded-full border border-[#487a5d]/40 animate-pulse" />
              </>
            )}

            {isSpeaking && (
              <>
                <div className="absolute inset-0 rounded-full bg-[#3d7054]/30 animate-ping" />
                <div className="absolute -inset-4 rounded-full border-2 border-[#3d7054] animate-pulse" />
              </>
            )}

            <button
              id="main-voice-toggle-btn"
              type="button"
              onClick={toggleListening}
              className={`relative z-10 w-22 h-22 sm:w-24 sm:h-24 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 active:scale-95 ${
                isWakeActive
                  ? 'bg-gradient-to-tr from-[#1e442f] via-[#28553d] to-[#3a7354] text-white shadow-[#28553d]/40 ring-4 ring-[#6fa887] scale-105'
                  : isSpeaking
                  ? 'bg-gradient-to-tr from-[#2d5841] to-[#407659] text-white shadow-[#2d5841]/30 ring-4 ring-[#88b99e]'
                  : isListening
                  ? 'bg-gradient-to-tr from-[#234c36] via-[#2f6045] to-[#3f7c5a] text-white shadow-[#234c36]/30 ring-4 ring-[#94c0a8]'
                  : 'bg-[#2e5440] hover:bg-[#244433] text-[#e0efe6] ring-2 ring-[#a3c5b3]'
              }`}
              title={isListening ? `Microfono attivo (${currentLang.name})` : "Tocca per attivare l'ascolto vocale"}
            >
              {processing ? (
                <RefreshCw className="w-9 h-9 animate-spin text-white" />
              ) : isSpeaking ? (
                <Volume2 className="w-9 h-9 animate-pulse" />
              ) : isWakeActive ? (
                <Sparkles className="w-10 h-10 text-white animate-bounce" />
              ) : isListening ? (
                <Mic className="w-10 h-10 animate-pulse text-white" />
              ) : (
                <MicOff className="w-9 h-9" />
              )}
            </button>
          </div>

          {/* Realtime Live Status Text */}
          <div className="mt-2.5 space-y-2 max-w-md w-full">
            <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full border text-xs font-semibold transition-all ${
              isWakeActive
                ? 'bg-[#d2e8dc] border-[#5d9475] text-[#13331f]'
                : 'bg-[#e5f0ea] border-[#c0d6c9] text-[#223d2d]'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                processing 
                  ? 'bg-amber-500 animate-ping' 
                  : isWakeActive
                  ? 'bg-[#28553d] animate-ping'
                  : isSpeaking 
                  ? 'bg-[#3b7556] animate-pulse' 
                  : isListening 
                  ? 'bg-[#2e6245] animate-pulse' 
                  : 'bg-slate-400'
              }`} />
              <span>
                {processing 
                  ? t.processing
                  : isWakeActive
                  ? `${settings.name}: ${t.listening}`
                  : isSpeaking 
                  ? `${settings.name}: ${t.speaking}` 
                  : isListening 
                  ? `${t.listening} (${currentLang.flag} ${currentLang.name})` 
                  : t.tapToSpeak}
              </span>
            </div>

            {/* Speech transcript feedback */}
            {(interimTranscript || lastTranscript) && (
              <div className="p-3 rounded-2xl bg-white border border-[#c4d7cc] text-sm text-[#141b16] shadow-xs animate-fade-in">
                <span className="text-[11px] font-semibold text-[#446d56] uppercase tracking-wider block mb-0.5">
                  {interimTranscript ? '...' : 'Speech:'}
                </span>
                <p className="italic text-[#141b16] font-medium">
                  "{interimTranscript || lastTranscript}"
                </p>
              </div>
            )}

            {/* Last Assistant Vocal Reply */}
            {lastSpokenResponse && !interimTranscript && (
              <div className="text-xs text-[#1a3825] bg-[#d9ebe0] border border-[#a8ccb7] rounded-xl px-3.5 py-1.5 flex items-center justify-center gap-2">
                <Volume2 className="w-3.5 h-3.5 text-[#28553d] shrink-0" />
                <span className="truncate"><strong>{settings.name}:</strong> "{lastSpokenResponse}"</span>
              </div>
            )}
          </div>

          {/* Quick Voice Chips in Current Language */}
          <div className="mt-4 pt-3.5 border-t border-[#d3e3da] w-full">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#547361] block mb-2">
              {t.quickExamples}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {currentLang.quickPhrases.map((phrase, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleVoiceCommand(phrase)}
                  className="text-xs bg-white hover:bg-[#d6e7dc] hover:border-[#86aa95] border border-[#c4d7cc] text-[#203629] px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Radio className="w-3 h-3 text-[#2e5941]" />
                  <span>"{phrase}"</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Expandable Command History Section (Shows Last 3 Voice Commands) */}
        <CommandHistorySection
          history={commandHistory}
          isOpen={isCommandHistoryOpen}
          onToggle={() => setIsCommandHistoryOpen(prev => !prev)}
          onClear={() => setCommandHistory([])}
          onReplayCommand={(transcript) => handleVoiceCommand(transcript)}
          assistantName={settings.name}
          languageCode={settings.languageCode || 'it-IT'}
        />

        {/* 3. Streamlined Minimal Task Input */}
        <section className="bg-white/75 border border-[#c4d7cc] rounded-2xl p-3 shadow-xs">
          <form onSubmit={handleManualAdd} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 relative">
              <input
                id="manual-task-input"
                type="text"
                value={newTaskInput}
                onChange={(e) => setNewTaskInput(e.target.value)}
                placeholder={t.addPlaceholder}
                className="w-full bg-white border border-[#c4d7cc] focus:border-[#2e5941] rounded-xl px-4 py-2.5 text-sm text-[#141b16] placeholder:text-[#769383] focus:ring-1 focus:ring-[#2e5941] outline-none transition-all shadow-xs"
              />
            </div>
            <div className="flex gap-2">
              <input
                id="manual-time-input"
                type="time"
                value={scheduledTimeInput}
                onChange={(e) => setScheduledTimeInput(e.target.value)}
                className="bg-white border border-[#c4d7cc] focus:border-[#2e5941] rounded-xl px-3 py-2 text-sm text-[#1c3827] focus:ring-1 focus:ring-[#2e5941] outline-none transition-all shadow-xs"
                title="Orario opzionale"
              />
              <button
                id="manual-add-task-btn"
                type="submit"
                disabled={!newTaskInput.trim()}
                className="bg-[#28553d] hover:bg-[#1f4530] disabled:opacity-40 text-white font-medium px-4 py-2 rounded-xl text-sm flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t.addButton}</span>
              </button>
            </div>
          </form>
        </section>

        {/* 4. Minimalist Reminder List */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[#141b16] uppercase tracking-wider">
                {t.yourReminders}
              </h2>
              <span className="text-xs bg-[#d3e7db] text-[#1a3a26] border border-[#a2c2b0] px-2 py-0.2 rounded-full font-mono font-bold">
                {displayedTasks.length}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-[#d6e7dc] border border-[#b4cfc0] rounded-xl p-1 text-xs">
              <button
                type="button"
                onClick={() => setFilterTab('active')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  filterTab === 'active' 
                    ? 'bg-[#28553d] text-white shadow-xs' 
                    : 'text-[#425d4e] hover:text-[#141b16]'
                }`}
              >
                {t.active} ({pendingTasksCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('completed')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  filterTab === 'completed' 
                    ? 'bg-[#28553d] text-white shadow-xs' 
                    : 'text-[#425d4e] hover:text-[#141b16]'
                }`}
              >
                {t.completed} ({completedTasksCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  filterTab === 'all' 
                    ? 'bg-[#28553d] text-white shadow-xs' 
                    : 'text-[#425d4e] hover:text-[#141b16]'
                }`}
              >
                {t.all}
              </button>
            </div>
          </div>

          {/* Tasks Container */}
          {displayedTasks.length === 0 ? (
            <div className="text-center py-12 px-4 bg-white/60 border border-dashed border-[#c0d6c8] rounded-2xl space-y-2">
              <div className="w-12 h-12 bg-[#d7e9de] border border-[#a5c6b3] rounded-2xl flex items-center justify-center mx-auto text-[#28553d]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#1a2d21]">
                {filterTab === 'active' 
                  ? t.noActiveReminders 
                  : filterTab === 'completed'
                  ? t.noCompletedReminders
                  : t.noReminders}
              </p>
              <p className="text-xs text-[#5e7d6c] max-w-sm mx-auto">
                {t.wakeInstruction}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedTasks.map((task) => {
                const isOverdue = !task.isCompleted && Date.now() >= task.nextReminderAt;

                return (
                  <div
                    key={task.id}
                    className={`group p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 shadow-xs ${
                      task.isCompleted
                        ? 'bg-white/40 border-[#d1e0d7] opacity-65'
                        : isOverdue
                        ? 'bg-[#fcf7f3] border-[#e2a87d] shadow-sm'
                        : 'bg-white/85 border-[#c4d7cc] hover:border-[#98bcab]'
                    }`}
                  >
                    {/* Left: Checkbox & Text */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          const newCompleted = !task.isCompleted;
                          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, isCompleted: newCompleted } : t));
                          if (newCompleted) {
                            speak(`OK! ${task.text} (${t.completed})`);
                          }
                        }}
                        className={`w-6 h-6 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                          task.isCompleted
                            ? 'bg-[#28553d] text-white'
                            : 'border-2 border-[#8dafa0] hover:border-[#28553d] text-transparent hover:text-[#28553d]'
                        }`}
                        title={task.isCompleted ? 'Pending' : 'Completed'}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </button>

                      <div className="min-w-0 flex-1">
                        <span className={`text-sm font-medium block truncate ${
                          task.isCompleted ? 'line-through text-[#6a8777]' : 'text-[#141b16]'
                        }`}>
                          {task.text}
                        </span>

                        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs">
                          {task.scheduledTime ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[#1a3d28] bg-[#d7eadf] px-2 py-0.5 rounded-md border border-[#a6c7b4]">
                              <Clock className="w-3 h-3 text-[#28553d]" />
                              <span>{task.scheduledTime}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[#4b6757] bg-[#e6f0ea] px-2 py-0.5 rounded-md border border-[#c4d7cc]">
                              <Calendar className="w-3 h-3 text-[#28553d]/80" />
                              <span>{t.today}</span>
                            </span>
                          )}

                          {isOverdue && (
                            <span className="inline-flex items-center gap-1 text-[#8c3c1b] bg-[#faebe1] px-2 py-0.5 rounded-md border border-[#e8b594] font-medium">
                              <Bell className="w-3 h-3 text-[#b94a1d] animate-bounce" />
                              <span>{t.alarmRepeating}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {!task.isCompleted && (
                        <button
                          type="button"
                          onClick={() => triggerRepeatingAlarm(task)}
                          className="p-2 rounded-xl hover:bg-[#d9ebe0] text-[#28553d] transition-colors"
                          title="Fai suonare la sveglia vocale ora"
                        >
                          <BellRing className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleReadTask(task)}
                        className="p-2 rounded-xl hover:bg-[#d9ebe0] text-[#4d6b5b] hover:text-[#183624] transition-colors"
                        title="Ascolta promemoria"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setTasks(prev => prev.filter(t => t.id !== task.id));
                          speak(`OK, ${task.text}.`);
                        }}
                        className="p-2 rounded-xl hover:bg-rose-100 text-[#859f91] hover:text-rose-600 transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* 50 Languages Selection Modal */}
      <LanguageSelectorModal
        isOpen={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        currentLanguageCode={settings.languageCode || 'it-IT'}
        onSelectLanguage={handleSelectLanguage}
        onPreviewVoice={handlePreviewVoice}
      />

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-[#122018]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#f6faf7] border border-[#c4d7cc] rounded-3xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-[#141b16]">
            <div className="flex items-center justify-between pb-3 border-b border-[#c4d7cc]">
              <h3 className="text-lg font-bold text-[#141b16] flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#28553d]" />
                <span>{t.settingsTitle}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-[#597866] hover:text-[#141b16] text-sm p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {/* Account Utente & Accesso */}
              {currentUser && (
                <div>
                  <label className="block text-xs font-semibold text-[#547361] uppercase tracking-wider mb-1.5">
                    Account Collegato
                  </label>
                  <div className="p-3.5 bg-white border border-[#c4d7cc] rounded-2xl shadow-xs flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#e3efe7] border border-[#a6c7b3] flex items-center justify-center text-[#28553d] font-bold text-sm">
                        {currentUser.email ? currentUser.email.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div>
                        <span className="font-bold text-[#141b16] text-xs sm:text-sm block truncate max-w-[170px] sm:max-w-[210px]">
                          {currentUser.email}
                        </span>
                        <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>Confermato con codice OTP</span>
                        </span>
                      </div>
                    </div>
                    {onLogout && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettingsModal(false);
                          onLogout();
                        }}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                        title="Esci dall'applicazione"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Esci</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Language Selector Row in Settings */}
              <div>
                <label className="block text-xs font-semibold text-[#547361] uppercase tracking-wider mb-1.5">
                  {t.languagePicker} (50 Lingue)
                </label>
                <div 
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowLanguageModal(true);
                  }}
                  className="flex items-center justify-between p-3.5 bg-white border border-[#c4d7cc] hover:border-[#28553d] rounded-2xl shadow-xs cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{currentLang.flag}</span>
                    <div>
                      <span className="font-bold text-[#141b16] text-sm block">{currentLang.name} ({currentLang.englishName})</span>
                      <span className="text-xs text-[#527561]">Voce e riconoscimento in {currentLang.name}</span>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#28553d] bg-[#d6e7dc] border border-[#a2c2b0] px-3 py-1.5 rounded-xl group-hover:bg-[#28553d] group-hover:text-white transition-all">
                    Cambia Lingua
                  </span>
                </div>
              </div>

              {/* Assistant Name & Fixed Info */}
              <div>
                <label className="block text-xs font-semibold text-[#547361] uppercase tracking-wider mb-1.5">
                  {t.assistantName}
                </label>
                <div className="flex items-center justify-between p-3.5 bg-white border border-[#c4d7cc] rounded-2xl shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#244f37] to-[#3c7755] flex items-center justify-center text-white font-bold text-sm shadow-xs">
                      E
                    </div>
                    <div>
                      <span className="text-[#141b16] font-bold text-base block">ESTER</span>
                      <span className="text-xs text-[#4b6d5a]">{t.assistantTag}</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold bg-[#d6e7dc] text-[#193a26] border border-[#a2c2b0] px-2.5 py-1 rounded-full">
                    Predefinito
                  </span>
                </div>
              </div>

              {/* Voice Gender */}
              <div>
                <label className="block text-xs font-semibold text-[#547361] uppercase tracking-wider mb-1.5">
                  {t.voiceGender}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const updated: AssistantSettings = { ...settings, gender: 'MALE', voiceName: 'Fenrir' };
                      setSettings(updated);
                      speak("Voice: Male");
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      settings.gender === 'MALE'
                        ? 'bg-[#28553d] text-white border-[#28553d] shadow-xs'
                        : 'bg-white text-[#425e4f] border-[#c4d7cc] hover:text-[#141b16]'
                    }`}
                  >
                    {t.male} (Fenrir)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated: AssistantSettings = { ...settings, gender: 'FEMALE', voiceName: 'Kore' };
                      setSettings(updated);
                      speak("Voice: Female");
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      settings.gender === 'FEMALE'
                        ? 'bg-[#28553d] text-white border-[#28553d] shadow-xs'
                        : 'bg-white text-[#425e4f] border-[#c4d7cc] hover:text-[#141b16]'
                    }`}
                  >
                    {t.female} (Kore)
                  </button>
                </div>
              </div>

              {/* Repeating Alarm Settings */}
              <div>
                <label className="block text-xs font-semibold text-[#547361] uppercase tracking-wider mb-1.5">
                  {t.alarmInterval}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[10, 15, 30].map(secs => (
                    <button
                      key={secs}
                      type="button"
                      onClick={() => setSettings({ ...settings, alarmRepeatSeconds: secs })}
                      className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all ${
                        settings.alarmRepeatSeconds === secs
                          ? 'bg-[#28553d] text-white border-[#28553d] shadow-xs'
                          : 'bg-white text-[#425e4f] border-[#c4d7cc]'
                      }`}
                    >
                      {t.everySecs.replace('{n}', String(secs))}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#5e7c6b] mt-1">
                  {t.alarmText}
                </p>
              </div>

              {/* Toggles */}
              <div className="space-y-2.5 pt-1">
                <label className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#c4d7cc] cursor-pointer shadow-xs">
                  <div>
                    <span className="font-medium text-[#141b16] block">{t.backgroundAudio}</span>
                    <span className="text-xs text-[#597866]">{t.backgroundAudioDesc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.backgroundAudioKeepAlive}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSettings({ ...settings, backgroundAudioKeepAlive: val });
                      if (val) enableBackgroundAudioSession();
                      else stopBackgroundAudioKeepAlive();
                    }}
                    className="w-5 h-5 rounded text-[#28553d] focus:ring-[#28553d]"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#c4d7cc] cursor-pointer shadow-xs">
                  <div>
                    <span className="font-medium text-[#141b16] block">{t.vibration}</span>
                    <span className="text-xs text-[#597866]">Alert vibration</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.vibrationEnabled}
                    onChange={(e) => setSettings({ ...settings, vibrationEnabled: e.target.checked })}
                    className="w-5 h-5 rounded text-[#28553d] focus:ring-[#28553d]"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#c4d7cc] cursor-pointer shadow-xs">
                  <div>
                    <span className="font-medium text-[#141b16] block">{t.continuousListen}</span>
                    <span className="text-xs text-[#597866]">Hands-free mic</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.continuousListening}
                    onChange={(e) => setSettings({ ...settings, continuousListening: e.target.checked })}
                    className="w-5 h-5 rounded text-[#28553d] focus:ring-[#28553d]"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-2xl bg-white border border-[#c4d7cc] cursor-pointer shadow-xs">
                  <div>
                    <span className="font-medium text-[#141b16] block">{t.soundChime}</span>
                    <span className="text-xs text-[#597866]">Chime alert</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.soundChime}
                    onChange={(e) => setSettings({ ...settings, soundChime: e.target.checked })}
                    className="w-5 h-5 rounded text-[#28553d] focus:ring-[#28553d]"
                  />
                </label>
              </div>

              {/* Clear Data */}
              <div className="pt-3 border-t border-[#c4d7cc] flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t.clearCompleted + "?")) {
                      setTasks([]);
                      speak("Cleared.");
                    }
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 hover:underline font-medium"
                >
                  {t.clearCompleted}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#28553d] hover:bg-[#1e432f] text-white text-xs font-semibold shadow-xs"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
