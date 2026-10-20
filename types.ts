export type Gender = 'MALE' | 'FEMALE';

export interface Task {
  id: string;
  text: string;
  isCompleted: boolean;
  scheduledTime: string | null; // Format "HH:mm"
  nextReminderAt: number; // Timestamp for the next vocal alert
  createdAt: number;
  repeatIntervalMins?: number; // default 15-30 mins if not completed
  lastAlertedAt?: number;
}

export interface AssistantSettings {
  name: string;
  gender: Gender;
  voiceName?: string;
  languageCode: string; // e.g. 'it-IT', 'en-US', 'es-ES' (50 languages)
  isSetup: boolean;
  continuousListening: boolean;
  wakeWordRequired: boolean;
  soundChime: boolean;
  repeatUntilCompleted: boolean; // Continuous loop repeating voice alarm until tapped completed
  alarmRepeatSeconds: number; // Seconds between vocal repetitions (default 10s)
  backgroundAudioKeepAlive: boolean; // Keep audio session active when screen is off/locked
  vibrationEnabled: boolean;
}

export interface ProcessCommandResult {
  action: 'ADD_TASK' | 'COMPLETE_TASK' | 'DELETE_TASK' | 'LIST_TASKS' | 'CLEAR_COMPLETED' | 'SNOOZE_TASK' | 'GENERAL_OR_HELP' | 'CHANGE_LANGUAGE';
  taskText?: string | null;
  scheduledTime?: string | null;
  matchedTaskId?: string | null;
  snoozeMinutes?: number;
  newLanguageCode?: string | null;
  spokenResponse: string;
  audioData?: string | null;
}

export interface SetupAssistantResult {
  name: string;
  gender: Gender;
  voiceName: string;
  greetingText: string;
  audioData?: string | null;
}

export interface ReminderAlertResult {
  spokenText: string;
  audioData?: string | null;
}

export interface CommandHistoryItem {
  id: string;
  transcript: string;
  action: ProcessCommandResult['action'] | 'MANUAL_ADD';
  spokenResponse: string;
  timestamp: number;
  timeStr: string;
  taskText?: string | null;
  scheduledTime?: string | null;
}

export interface AuthUser {
  email: string;
  name?: string;
  verifiedAt: string;
  provider: 'gmail' | 'email';
}
