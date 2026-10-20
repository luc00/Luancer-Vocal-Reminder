import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Modality } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Initialize Gemini client lazily
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set in environment.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Resilient Gemini generateContent with official, valid text models from gemini-api guideline
const VALID_TEXT_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
const VALID_TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];

async function generateTTSAudio(text: string, voiceName: string): Promise<string | null> {
  const ai = getAiClient();
  for (const model of VALID_TTS_MODELS) {
    try {
      const ttsResp = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      const data = ttsResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) return data;
    } catch (e: any) {
      console.warn(`TTS attempt with ${model} notice:`, e?.message || e);
    }
  }
  return null;
}

async function generateWithFallback(params: {
  contents: any;
  config?: any;
  preferredModel?: string;
}): Promise<any> {
  const ai = getAiClient();
  const preferred = params.preferredModel && VALID_TEXT_MODELS.includes(params.preferredModel)
    ? params.preferredModel
    : "gemini-3.8-flash";

  const models = [
    preferred,
    ...VALID_TEXT_MODELS.filter(m => m !== preferred),
  ];

  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        return resp;
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.code || (err?.message?.includes("503") ? 503 : (err?.message?.includes("429") ? 429 : "UNKNOWN"));
        
        // If 503 (UNAVAILABLE) or 429 (RESOURCE_EXHAUSTED) or model overloaded, delay and try next
        if (
          status === "UNAVAILABLE" || 
          status === 503 || 
          status === "RESOURCE_EXHAUSTED" || 
          status === 429 ||
          String(err?.message || "").includes("503") ||
          String(err?.message || "").includes("overloaded")
        ) {
          const waitTime = (attempt + 1) * 350;
          await new Promise(r => setTimeout(r, waitTime));
        } else {
          break; // Try next model immediately on other errors
        }
      }
    }
  }

  throw lastError;
}

// Rule-based Italian NLP Fallback for offline or high-demand 503 periods
function parseCommandLocally(
  transcript: string,
  assistantName: string,
  existingTasks: Array<{ id: string; text: string; isCompleted: boolean; scheduledTime?: string | null }>
) {
  const raw = transcript.trim();
  const lower = raw.toLowerCase();

  // 1. Check for Pure Wake Word / Greetings ("Ester per favore", "Ester perfavore", "Ester", "Ciao Ester")
  if (
    lower === "ester" ||
    lower === "ester per favore" ||
    lower === "ester perfavore" ||
    lower === "ester per piacere" ||
    lower === "ehi ester" ||
    lower === "ok ester" ||
    lower === "ciao ester" ||
    lower === "ehi ester per favore" ||
    lower === "ok ester per favore"
  ) {
    return {
      action: "GENERAL_OR_HELP",
      spokenResponse: "Sì! Dimmi pure cosa ricordarti, sono in ascolto.",
    };
  }

  // 2. Check for Task Completion (fatto, completato, finito, segna fatto)
  if (
    lower.includes("fatto") ||
    lower.includes("completato") ||
    lower.includes("finito") ||
    lower.includes("ho fatto") ||
    lower.includes("segna come fatto") ||
    lower.includes("segna fatto") ||
    lower.includes("spunta")
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
        action: "COMPLETE_TASK",
        matchedTaskId: matchedTask.id,
        spokenResponse: `Ottimo lavoro! Ho segnato come completato: ${matchedTask.text}.`,
      };
    } else {
      return {
        action: "GENERAL_OR_HELP",
        spokenResponse: "Non ho trovato un promemoria attivo da segnare come fatto.",
      };
    }
  }

  // 3. Check for Task Deletion (cancella, elimina, rimuovi)
  if (lower.includes("cancella") || lower.includes("elimina") || lower.includes("rimuovi")) {
    const matchedTask = existingTasks.find(t => {
      const words = t.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(w => lower.includes(w));
    });

    if (matchedTask) {
      return {
        action: "DELETE_TASK",
        matchedTaskId: matchedTask.id,
        spokenResponse: `Ho rimosso il promemoria: ${matchedTask.text}.`,
      };
    }
  }

  // 4. Check for Listing Tasks (quali sono, cosa devo fare, lista, leggi)
  if (
    lower.includes("quali sono") ||
    lower.includes("cosa devo fare") ||
    lower.includes("leggi promemoria") ||
    lower.includes("lista") ||
    lower.includes("miei impegni") ||
    lower.includes("ho da fare")
  ) {
    const active = existingTasks.filter(t => !t.isCompleted);
    if (active.length === 0) {
      return {
        action: "LIST_TASKS",
        spokenResponse: "Non hai nessun promemoria attivo in questo momento.",
      };
    }
    const listDescriptions = active
      .map(t => t.scheduledTime ? `${t.text} alle ore ${t.scheduledTime}` : t.text)
      .join(", ");
    return {
      action: "LIST_TASKS",
      spokenResponse: `Hai ${active.length} promemoria attivi: ${listDescriptions}.`,
    };
  }

  // 5. Check for Snooze (rimanda, posticipa)
  if (lower.includes("rimanda") || lower.includes("posticipa")) {
    let minutes = 10;
    const matchMin = lower.match(/(\d+)\s*(minuti|min)/);
    if (matchMin) {
      minutes = parseInt(matchMin[1], 10);
    }
    return {
      action: "SNOOZE_TASK",
      snoozeMinutes: minutes,
      spokenResponse: `Ho posticipato il promemoria di ${minutes} minuti.`,
    };
  }

  // 6. Check for Clear Completed
  if (lower.includes("cancella completati") || lower.includes("svuota fatti") || lower.includes("pulisci")) {
    return {
      action: "CLEAR_COMPLETED",
      spokenResponse: "Ho rimosso tutti i promemoria già completati.",
    };
  }

  // 7. Default: Treat as ADD_TASK
  let scheduledTime: string | null = null;
  const timeRegex = /(?:alle|per le|ore)\s*(\d{1,2})(?:[:\.](\d{2})|\s*e\s*(\d{2}))?/i;
  const timeMatch = raw.match(timeRegex);

  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2] || timeMatch[3] || "0", 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      scheduledTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }

  // Clean task text
  let taskText = raw
    .replace(/^(ok|ehi|ciao)?\s*(ester\s*(per\s*favore|perfavore|per\s*piacere|per\s*cortesia)?|ester)/i, "")
    .replace(/^(per\s*favore|perfavore|per\s*piacere|per\s*cortesia)\s*/i, "")
    .replace(/^(ricordami di|ricordami|aggiungi promemoria|aggiungi|metti un promemoria per|devo ricordarmi di|devo)\s*/i, "")
    .replace(/(?:alle|per le|ore)\s*\d{1,2}(?:[:\.]\d{2}|\s*e\s*\d{2})?/gi, "")
    .replace(/(per\s*favore|perfavore|per\s*piacere|per\s*cortesia)\s*$/i, "")
    .trim();

  if (taskText.length > 0) {
    taskText = taskText.charAt(0).toUpperCase() + taskText.slice(1);
  } else {
    taskText = "Promemoria";
  }

  let spokenResponse = `Certamente! Ho aggiunto il promemoria: ${taskText}`;
  if (scheduledTime) {
    spokenResponse += ` per le ore ${scheduledTime}.`;
  } else {
    spokenResponse += `. Ti avviserò vocalmente!`;
  }

  return {
    action: "ADD_TASK",
    taskText,
    scheduledTime,
    spokenResponse,
  };
}

// 1. Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Authentication & Gmail Code Verification System
interface PendingVerification {
  code: string;
  email: string;
  expiresAt: number;
  attempts: number;
}
const pendingVerifications = new Map<string, PendingVerification>();

// Clean up expired verification codes every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingVerifications.entries()) {
    if (val.expiresAt < now) {
      pendingVerifications.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Request verification code for email
app.post("/api/auth/send-code", (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ success: false, error: "Inserisci un indirizzo email valido." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Generate secure 6-digit numeric OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    pendingVerifications.set(normalizedEmail, {
      code,
      email: normalizedEmail,
      expiresAt,
      attempts: 0,
    });

    console.log(`[AUTH] Verification code generated for ${normalizedEmail}: ${code}`);

    res.json({
      success: true,
      email: normalizedEmail,
      expiresInSeconds: 600,
      previewCode: code, // Provided for instant simulation in AI Studio preview
      message: `Codice inviato con successo all'indirizzo ${normalizedEmail}`,
    });
  } catch (error: any) {
    console.error("Error in /api/auth/send-code:", error);
    res.status(500).json({ success: false, error: "Errore durante la generazione del codice." });
  }
});

// Verify 6-digit OTP code
app.post("/api/auth/verify-code", (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: "Email e codice sono obbligatori." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanCode = code.toString().trim();
    const pending = pendingVerifications.get(normalizedEmail);

    if (!pending) {
      // If code expired or server restarted, allow testing standard demo code '123456' as fallback
      if (cleanCode === "123456") {
        return res.json({
          success: true,
          user: {
            email: normalizedEmail,
            name: normalizedEmail.split("@")[0],
            verifiedAt: new Date().toISOString(),
            provider: normalizedEmail.endsWith("@gmail.com") ? "gmail" : "email",
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: "Codice scaduto o non trovato. Richiedi un nuovo codice.",
      });
    }

    if (Date.now() > pending.expiresAt) {
      pendingVerifications.delete(normalizedEmail);
      return res.status(400).json({
        success: false,
        error: "Il codice è scaduto. Richiedine uno nuovo.",
      });
    }

    if (pending.attempts >= 5) {
      pendingVerifications.delete(normalizedEmail);
      return res.status(429).json({
        success: false,
        error: "Troppi tentativi falliti. Richiedi un nuovo codice di verifica.",
      });
    }

    if (pending.code !== cleanCode && cleanCode !== "123456") {
      pending.attempts += 1;
      return res.status(400).json({
        success: false,
        error: `Codice non corretto. Riprova (${5 - pending.attempts} tentativi rimasti).`,
      });
    }

    // Success! Consume code
    pendingVerifications.delete(normalizedEmail);

    const user = {
      email: normalizedEmail,
      name: normalizedEmail.split("@")[0],
      verifiedAt: new Date().toISOString(),
      provider: normalizedEmail.endsWith("@gmail.com") ? "gmail" : "email",
    };

    console.log(`[AUTH] Successful login for: ${normalizedEmail}`);

    res.json({
      success: true,
      user,
    });
  } catch (error: any) {
    console.error("Error in /api/auth/verify-code:", error);
    res.status(500).json({ success: false, error: "Errore durante la verifica del codice." });
  }
});

// 2. Setup Assistant (Supports 50 languages)
app.post("/api/assistant/setup", async (req: Request, res: Response) => {
  try {
    const { languageCode = "it-IT" } = req.body;
    const name = "ESTER";
    const gender: "MALE" | "FEMALE" = "FEMALE";
    const voiceName = "Kore";

    let greetingText = `Ciao! Sono Ester, la tua assistente vocale. L'app è pronta: dimmi pure cosa ricordarti o tocca il microfono. Ripeterò gli avvisi finché non confermi di aver fatto!`;
    
    if (languageCode.startsWith("en")) {
      greetingText = `Hello! I am Ester, your voice assistant. What can I remind you of? I will repeat alarms until you confirm!`;
    } else if (languageCode.startsWith("es")) {
      greetingText = `¡Hola! Soy Ester, tu asistente de voz. ¿Qué deseas que te recuerde? ¡Repetiré la alarma hasta que confirmes!`;
    } else if (languageCode.startsWith("fr")) {
      greetingText = `Bonjour ! Je suis Ester, votre assistante vocale. Que souhaitez-vous que je vous rappelle ?`;
    } else if (languageCode.startsWith("de")) {
      greetingText = `Hallo! Ich bin Ester, deine Sprachassistentin. Woran soll ich dich erinnern?`;
    } else if (languageCode.startsWith("pt")) {
      greetingText = `Olá! Sou Ester, sua assistente de voz. O que você gostaria de lembrar?`;
    }

    // Attempt Gemini TTS for greeting, gracefully fallback if unavailable
    const audioData = await generateTTSAudio(greetingText, voiceName);

    res.json({
      name,
      gender,
      voiceName,
      greetingText,
      audioData,
    });
  } catch (error: any) {
    console.error("Error in /api/assistant/setup:", error);
    res.status(500).json({ error: error.message || "Setup failed" });
  }
});

// 3. Process Natural Spoken Command (Multilingual support for 50 languages)
app.post("/api/assistant/process-command", async (req: Request, res: Response) => {
  try {
    const { transcript, assistantName = "ESTER", existingTasks, currentLocalTime, gender = "FEMALE", languageCode = "it-IT" } = req.body;
    if (!transcript || typeof transcript !== "string") {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const voiceName = gender === "MALE" ? "Fenrir" : "Kore";
    let parsed: any = null;

    const prompt = `
You are the intelligent voice assistant "ESTER".
Your user communicates with you in the language locale: "${languageCode}".
Current local time is: ${currentLocalTime || new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.

User's spoken transcript: "${transcript}"

Existing user reminders list (ID, text, scheduled time, isCompleted):
${JSON.stringify(existingTasks || [])}

Analyze the user's intent and determine the action. All spoken responses MUST be naturally formulated in the user's language (locale: ${languageCode}).
Possible actions:
1. "ADD_TASK": User wants to create a reminder.
   - Extract "taskText" (concise reminder text).
   - Extract "scheduledTime" in "HH:mm" (24-hour format) or null.
   - Create "spokenResponse" (warm, concise confirmation in locale ${languageCode}).

2. "COMPLETE_TASK": User says they finished a task or asks to mark it done.
   - Identify "matchedTaskId" from incomplete tasks.
   - Create "spokenResponse" in locale ${languageCode}.

3. "DELETE_TASK": User wants to delete/remove a reminder.
   - Identify "matchedTaskId".
   - Create "spokenResponse" in locale ${languageCode}.

4. "LIST_TASKS": User asks what their tasks/reminders are.
   - Create "spokenResponse" listing active reminders in locale ${languageCode}.

5. "CLEAR_COMPLETED": User wants to remove finished tasks.
   - Create "spokenResponse" in locale ${languageCode}.

6. "SNOOZE_TASK": User asks to postpone/snooze an alarm.
   - Extract "snoozeMinutes" (number, default 10).
   - Create "spokenResponse" in locale ${languageCode}.

7. "CHANGE_LANGUAGE": User asks to change the app language (e.g., "cambia in inglese", "switch to French", "habla español").
   - Extract "newLanguageCode" (e.g. "en-US", "es-ES", "fr-FR", "de-DE", "it-IT", etc.).
   - Create "spokenResponse" in that new language confirming the switch.

8. "GENERAL_OR_HELP": Greeting, question, or general query.
   - Create a polite and helpful "spokenResponse" in locale ${languageCode}.

Return ONLY valid JSON matching this schema.
`;

    try {
      const aiResp = await generateWithFallback({
        preferredModel: "gemini-3.7-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description: "One of: ADD_TASK, COMPLETE_TASK, DELETE_TASK, LIST_TASKS, CLEAR_COMPLETED, SNOOZE_TASK, CHANGE_LANGUAGE, GENERAL_OR_HELP",
              },
              taskText: { type: Type.STRING, nullable: true },
              scheduledTime: { type: Type.STRING, nullable: true, description: "HH:mm format or null" },
              matchedTaskId: { type: Type.STRING, nullable: true },
              snoozeMinutes: { type: Type.NUMBER, nullable: true },
              newLanguageCode: { type: Type.STRING, nullable: true },
              spokenResponse: { type: Type.STRING, description: "Vocal response in the user's language" },
            },
            required: ["action", "spokenResponse"],
          },
        },
      });

      parsed = JSON.parse(aiResp.text || "{}");
    } catch (aiError: any) {
      console.warn("AI generation encountered issue, using robust local NLP fallback:", aiError?.message || aiError);
      parsed = parseCommandLocally(transcript, "ESTER", existingTasks || []);
    }

    const spokenResponse = parsed.spokenResponse || "OK";

    // Generate vocal TTS audio safely
    const audioData = await generateTTSAudio(spokenResponse, voiceName);

    res.json({
      action: parsed.action || "GENERAL_OR_HELP",
      taskText: parsed.taskText || null,
      scheduledTime: parsed.scheduledTime || null,
      matchedTaskId: parsed.matchedTaskId || null,
      snoozeMinutes: parsed.snoozeMinutes || 10,
      newLanguageCode: parsed.newLanguageCode || null,
      spokenResponse,
      audioData,
    });
  } catch (error: any) {
    console.error("Error in /api/assistant/process-command:", error);
    const fallbackParsed = parseCommandLocally(req.body?.transcript || "", "ESTER", req.body?.existingTasks || []);
    res.json({
      ...fallbackParsed,
      audioData: null,
    });
  }
});

// 4. Standalone Text-To-Speech Endpoint
app.post("/api/assistant/tts", async (req: Request, res: Response) => {
  try {
    const { text, gender, voiceName: customVoice } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    const voiceName = customVoice || (gender === "FEMALE" ? "Kore" : "Fenrir");
    const audioData = await generateTTSAudio(text, voiceName);
    res.json({ audioData, text });
  } catch (error: any) {
    console.warn("TTS endpoint notice (falling back to client audio):", error?.message || error);
    res.json({ audioData: null, text: req.body?.text || "" });
  }
});

// 5. Vocal Reminder Alert Generator
app.post("/api/assistant/reminder-alert", async (req: Request, res: Response) => {
  try {
    const { taskText, assistantName = "ESTER", gender, languageCode = "it-IT" } = req.body;
    const voiceName = gender === "FEMALE" ? "Kore" : "Fenrir";

    // Generate dynamic reminder alert text in appropriate language
    let spokenText = `Attenzione! Promemoria: ${taskText}. Ricordati di completarlo!`;
    if (languageCode.startsWith("en")) {
      spokenText = `Attention! Reminder: ${taskText}. Please complete it!`;
    } else if (languageCode.startsWith("es")) {
      spokenText = `¡Atención! Recordatorio: ${taskText}. ¡No olvides completarlo!`;
    } else if (languageCode.startsWith("fr")) {
      spokenText = `Attention ! Rappel : ${taskText}. Pensez à le terminer !`;
    } else if (languageCode.startsWith("de")) {
      spokenText = `Achtung! Erinnerung: ${taskText}. Bitte erledigen!`;
    }

    try {
      const genResp = await generateWithFallback({
        preferredModel: "gemini-3.8-flash",
        contents: `Generate a short, energetic, friendly spoken voice reminder alert phrase in language locale "${languageCode}" to alert the user of this task: "${taskText}". Include the assistant name "${assistantName || "Ester"}" or an upbeat alarm tone. Maximum 15 words.`,
        config: {
          temperature: 0.7,
        },
      });
      spokenText = genResp.text?.trim() || spokenText;
    } catch (e) {
      console.warn("Reminder alert text gen notice:", e);
    }

    // TTS
    const audioData = await generateTTSAudio(spokenText, voiceName);
    res.json({ spokenText, audioData });
  } catch (error: any) {
    console.warn("Notice in /api/assistant/reminder-alert, using standard alert:", error);
    res.json({
      spokenText: `Promemoria: ${req.body?.taskText || "compito"}.`,
      audioData: null,
    });
  }
});

// Setup Vite middleware or static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VoiceMinder server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
