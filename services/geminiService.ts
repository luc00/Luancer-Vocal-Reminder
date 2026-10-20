import { AssistantSettings, ProcessCommandResult, SetupAssistantResult, Task, Gender, ReminderAlertResult } from '../types';
import { getLanguage } from '../utils/languages';

/**
 * Local client-side NLP fallback with multi-language awareness
 */
function localClientParse(transcript: string, assistantName: string, existingTasks: Task[], languageCode: string = 'it-IT'): ProcessCommandResult {
  const raw = transcript.trim();
  const lower = raw.toLowerCase();
  const langConfig = getLanguage(languageCode);

  // Check language change commands (e.g. "cambia in inglese", "switch to English", "parla spagnolo")
  if (
    lower.includes("cambia lingua") ||
    lower.includes("switch language") ||
    lower.includes("cambiar idioma") ||
    lower.includes("changer de langue") ||
    lower.includes("sprache ändern")
  ) {
    return {
      action: 'GENERAL_OR_HELP',
      spokenResponse: `Puoi selezionare una qualsiasi delle 50 lingue dal menu in alto.`,
      audioData: null,
    };
  }

  // Wake word / Greetings
  if (
    lower === "ester" ||
    lower.includes("ester per favore") ||
    lower.includes("ester please") ||
    lower.includes("ester por favor") ||
    lower.includes("ester s'il vous plaît") ||
    lower.includes("ester bitte") ||
    lower === "ciao ester" ||
    lower === "hello ester"
  ) {
    return {
      action: 'GENERAL_OR_HELP',
      spokenResponse: langConfig.dict.listening,
      audioData: null,
    };
  }

  // Completion (fatto, done, completado, terminé, erledigt, feito, etc.)
  if (
    lower.includes("fatto") ||
    lower.includes("completato") ||
    lower.includes("finito") ||
    lower.includes("done") ||
    lower.includes("completed") ||
    lower.includes("finished") ||
    lower.includes("hecho") ||
    lower.includes("terminé") ||
    lower.includes("erledigt") ||
    lower.includes("concluído")
  ) {
    const uncompleted = existingTasks.filter(t => !t.isCompleted);
    let matchedTask = uncompleted.find(t => {
      const words = t.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(w => lower.includes(w));
    });
    if (!matchedTask && uncompleted.length > 0) {
      matchedTask = uncompleted[0];
    }
    if (matchedTask) {
      return {
        action: 'COMPLETE_TASK',
        matchedTaskId: matchedTask.id,
        spokenResponse: `OK! ${matchedTask.text} - ${langConfig.dict.completed}.`,
        audioData: null,
      };
    }
  }

  // Snooze (rimanda, snooze, posponer, reporter)
  if (lower.includes("rimanda") || lower.includes("posticipa") || lower.includes("snooze") || lower.includes("posponer") || lower.includes("reporter")) {
    let minutes = 10;
    const matchMin = lower.match(/(\d+)\s*(minuti|min|minutes|minutos)/);
    if (matchMin) {
      minutes = parseInt(matchMin[1], 10);
    }
    return {
      action: 'SNOOZE_TASK',
      snoozeMinutes: minutes,
      spokenResponse: `${langConfig.dict.snooze10Min} (${minutes}m)`,
      audioData: null,
    };
  }

  // Deletion (cancella, delete, eliminar, supprimer, löschen)
  if (lower.includes("cancella") || lower.includes("elimina") || lower.includes("rimuovi") || lower.includes("delete") || lower.includes("remove") || lower.includes("supprimer")) {
    const matchedTask = existingTasks.find(t => {
      const words = t.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(w => lower.includes(w));
    });
    if (matchedTask) {
      return {
        action: 'DELETE_TASK',
        matchedTaskId: matchedTask.id,
        spokenResponse: `OK, ${matchedTask.text}.`,
        audioData: null,
      };
    }
  }

  // Listing (quali sono, what are, cuáles son, quels sont, was sind)
  if (lower.includes("quali sono") || lower.includes("cosa devo fare") || lower.includes("what are") || lower.includes("cuáles son") || lower.includes("quels sont") || lower.includes("was sind")) {
    const active = existingTasks.filter(t => !t.isCompleted);
    if (active.length === 0) {
      return {
        action: 'LIST_TASKS',
        spokenResponse: langConfig.dict.noActiveReminders,
        audioData: null,
      };
    }
    const listDesc = active.map(t => t.scheduledTime ? `${t.text} (${t.scheduledTime})` : t.text).join(", ");
    return {
      action: 'LIST_TASKS',
      spokenResponse: `${langConfig.dict.yourReminders}: ${listDesc}.`,
      audioData: null,
    };
  }

  // Default: Add Task
  let scheduledTime: string | null = null;
  const timeMatch = raw.match(/(?:alle|per le|ore|at|a las|à|um)\s*(\d{1,2})(?:[:\.](\d{2})|\s*e\s*(\d{2}))?/i);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2] || timeMatch[3] || "0", 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      scheduledTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  let taskText = raw
    .replace(/^(ok|ehi|ciao|hey|hello|hola|bonjour|hallo)?\s*(ester\s*(per\s*favore|please|por\s*favor|s'il\s*vous\s*plaît|bitte)?|ester)/i, "")
    .replace(/^(per\s*favore|please|por\s*favor|s'il\s*vous\s*plaît|bitte)\s*/i, "")
    .replace(/^(ricordami di|ricordami|remind me to|recuérdame|rappelle-moi de|erinnere mich an|aggiungi|add)\s*/i, "")
    .replace(/(?:alle|per le|ore|at|a las|à|um)\s*\d{1,2}(?:[:\.]\d{2}|\s*e\s*\d{2})?/gi, "")
    .replace(/(per\s*favore|please|por\s*favor|s'il\s*vous\s*plaît|bitte)\s*$/i, "")
    .trim();

  if (taskText.length > 0) {
    taskText = taskText.charAt(0).toUpperCase() + taskText.slice(1);
  } else {
    taskText = "Reminder";
  }

  let spokenResponse = `OK! ${taskText}`;
  if (scheduledTime) {
    spokenResponse += ` (${scheduledTime}).`;
  } else {
    spokenResponse += `.`;
  }

  return {
    action: 'ADD_TASK',
    taskText,
    scheduledTime,
    spokenResponse,
    audioData: null,
  };
}

/**
 * Setup the assistant on the server:
 * Fixed to ESTER (Female voice Kore) with requested language.
 */
export async function setupAssistant(name: string = "ESTER", languageCode: string = "it-IT"): Promise<SetupAssistantResult> {
  try {
    const res = await fetch('/api/assistant/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: "ESTER", languageCode }),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn("Server setup request failed, using local setup:", e);
  }

  const langConfig = getLanguage(languageCode);
  return {
    name: 'ESTER',
    gender: 'FEMALE',
    voiceName: 'Kore',
    greetingText: langConfig.dict.wakeInstruction,
    audioData: null,
  };
}

/**
 * Process a spoken voice transcript using Gemini on the server with seamless local fallback.
 */
export async function processVoiceCommand(params: {
  transcript: string;
  assistantName: string;
  existingTasks: Task[];
  gender: Gender;
  languageCode?: string;
  currentLocalTime?: string;
}): Promise<ProcessCommandResult> {
  try {
    const res = await fetch('/api/assistant/process-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Server command processing error, executing client fallback:", err);
  }

  return localClientParse(params.transcript, params.assistantName, params.existingTasks, params.languageCode || 'it-IT');
}

/**
 * Generates spoken audio TTS from text via server.
 */
export async function generateSpeechAudio(text: string, gender: Gender, voiceName?: string): Promise<string | null> {
  try {
    const res = await fetch('/api/assistant/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender, voiceName }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.audioData || null;
  } catch (e) {
    console.warn('TTS request notice:', e);
    return null;
  }
}

/**
 * Generates a vocal alarm alert for a scheduled reminder.
 */
export async function generateReminderAlert(params: {
  taskText: string;
  assistantName: string;
  gender: Gender;
  languageCode?: string;
}): Promise<ReminderAlertResult> {
  try {
    const res = await fetch('/api/assistant/reminder-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Alert request notice:', e);
  }

  return {
    spokenText: `Reminder: ${params.taskText}!`,
    audioData: null,
  };
}
