export const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

/**
 * Converts raw 16-bit PCM (e.g. 24kHz mono from Gemini TTS) to a standard WAV Blob.
 */
export function pcm16ToWavBlob(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeStr(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');

  // "fmt " sub-chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  new Uint8Array(buffer, 44).set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

// Global persistent HTML5 Audio element for background-capable playback
let globalAudioElement: HTMLAudioElement | null = null;
let keepAliveAudio: HTMLAudioElement | null = null;
let wakeLockSentinel: any = null;

function getGlobalAudioElement(): HTMLAudioElement {
  if (!globalAudioElement) {
    globalAudioElement = new Audio();
    globalAudioElement.id = 'voiceminder-global-player';
    globalAudioElement.setAttribute('playsinline', 'true');
    globalAudioElement.setAttribute('webkit-playsinline', 'true');
    // Attach to DOM for iOS background preservation
    if (typeof document !== 'undefined') {
      globalAudioElement.style.display = 'none';
      document.body.appendChild(globalAudioElement);
    }
  }
  return globalAudioElement;
}

/**
 * Updates OS MediaSession (displayed on Lock Screen, Smartwatches & Bluetooth devices).
 */
export function updateMediaSession(metadata: {
  title: string;
  artist?: string;
  album?: string;
  onActionComplete?: () => void;
  onActionSnooze?: () => void;
}) {
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title,
        artist: metadata.artist || 'ESTER - Assistente Vocale',
        album: metadata.album || 'Promemoria Vocali',
        artwork: [
          {
            src: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=512&auto=format&fit=crop&q=60',
            sizes: '512x512',
            type: 'image/jpeg',
          },
        ],
      });

      if (metadata.onActionComplete) {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          metadata.onActionComplete?.();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          metadata.onActionComplete?.();
        });
        navigator.mediaSession.setActionHandler('stop', () => {
          metadata.onActionComplete?.();
        });
      }
    } catch (e) {
      console.warn('MediaSession notice:', e);
    }
  }
}

/**
 * Plays audio via HTML5 Audio with MediaSession (works with screen locked/off).
 */
export const playAudioData = async (
  base64Data: string,
  audioContext: AudioContext,
  sampleRate: number = 24000,
  mediaMetadata?: { title: string; artist?: string; onActionComplete?: () => void }
): Promise<void> => {
  try {
    const rawBytes = decodeBase64(base64Data);
    // Check if the payload is already an encapsulated RIFF WAVE container
    const isWav = rawBytes.length >= 12 &&
      rawBytes[0] === 0x52 && rawBytes[1] === 0x49 && rawBytes[2] === 0x46 && rawBytes[3] === 0x46 &&
      rawBytes[8] === 0x57 && rawBytes[9] === 0x41 && rawBytes[10] === 0x56 && rawBytes[11] === 0x45;

    const wavBlob = isWav ? new Blob([rawBytes], { type: 'audio/wav' }) : pcm16ToWavBlob(rawBytes, sampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);

    if (mediaMetadata) {
      updateMediaSession({
        title: mediaMetadata.title,
        artist: mediaMetadata.artist,
        onActionComplete: mediaMetadata.onActionComplete,
      });
    }

    const audio = getGlobalAudioElement();
    audio.src = audioUrl;

    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = async () => {
        URL.revokeObjectURL(audioUrl);
        // Fallback to Web Audio buffer if HTML5 audio fails
        try {
          if (audioContext.state === 'suspended') await audioContext.resume();
          if (isWav) {
            const buffer = await audioContext.decodeAudioData(rawBytes.buffer.slice(0));
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
            source.onended = () => resolve();
          } else {
            const buffer = audioContext.createBuffer(1, rawBytes.length / 2, sampleRate);
            const channelData = buffer.getChannelData(0);
            const dataInt16 = new Int16Array(rawBytes.buffer);
            for (let i = 0; i < dataInt16.length; i++) {
              channelData[i] = dataInt16[i] / 32768.0;
            }
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
            source.onended = () => resolve();
          }
        } catch {
          resolve();
        }
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('HTML5 audio play rejected (fallback to buffer):', err);
          resolve();
        });
      }
    });
  } catch (error) {
    console.error('Audio playback error:', error);
  }
};

/**
 * Synthesizes a fast, pleasant double-ding chime when wake word "Ester per favore" is detected.
 */
export const playWakeWordPromptChime = async (audioContext: AudioContext): Promise<void> => {
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;

    const notes = [
      { freq: 659.25, start: 0.0, dur: 0.15 }, // E5
      { freq: 880.00, start: 0.09, dur: 0.28 }, // A5
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.35, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    });

    return new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
  } catch (err) {
    console.warn('Wake word prompt chime error:', err);
  }
};

/**
 * Synthesizes a loud, pleasant alerting chime for reminder alarms.
 */
export const playNotificationChime = async (audioContext: AudioContext): Promise<void> => {
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;

    // Triple alert chime chord (D5 -> F#5 -> A5 -> D6)
    const notes = [
      { freq: 587.33, start: 0.0, dur: 0.25 },
      { freq: 739.99, start: 0.12, dur: 0.25 },
      { freq: 880.00, start: 0.24, dur: 0.35 },
      { freq: 1174.66, start: 0.36, dur: 0.55 },
    ];

    notes.forEach(({ freq, start, dur }) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.4, now + start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    });

    return new Promise((resolve) => {
      setTimeout(resolve, 800);
    });
  } catch (err) {
    console.warn('Chime playback error:', err);
  }
};

/**
 * Web Speech Synthesis with multi-language and screen-locked support.
 */
export const speakWithBrowserSynthesis = (
  text: string,
  gender: 'MALE' | 'FEMALE' = 'MALE',
  mediaMetadata?: { title: string; artist?: string; onActionComplete?: () => void },
  langCode: string = 'it-IT'
): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }

    if (mediaMetadata) {
      updateMediaSession({
        title: mediaMetadata.title,
        artist: mediaMetadata.artist,
        onActionComplete: mediaMetadata.onActionComplete,
      });
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode || 'it-IT';
    utterance.rate = 1.0;
    utterance.pitch = gender === 'FEMALE' ? 1.15 : 0.95;

    const voices = window.speechSynthesis.getVoices();
    const prefix = langCode.split('-')[0].toLowerCase();
    const matchingVoices = voices.filter(v => 
      v.lang.toLowerCase() === langCode.toLowerCase() ||
      v.lang.toLowerCase().replace('_', '-').startsWith(prefix)
    );

    if (matchingVoices.length > 0) {
      utterance.voice = matchingVoices[0];
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
};

/**
 * Starts background silent audio keep-alive.
 * Mobile browsers (iOS Safari & Android Chrome) keep audio threads and background timers
 * active as long as an audio stream / loop is registered with MediaSession.
 */
export function startBackgroundAudioKeepAlive(): void {
  if (typeof window === 'undefined') return;

  if (!keepAliveAudio) {
    // 1-second silent WAV base64
    const silentWavBase64 =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP//AAD//w==';
    keepAliveAudio = new Audio(silentWavBase64);
    keepAliveAudio.id = 'voiceminder-keepalive-loop';
    keepAliveAudio.loop = true;
    keepAliveAudio.volume = 0.01; // Ultra-low inaudible volume to keep audio session alive
    keepAliveAudio.setAttribute('playsinline', 'true');
    keepAliveAudio.setAttribute('webkit-playsinline', 'true');
  }

  keepAliveAudio.play().catch((err) => {
    console.warn('Background audio keep-alive play notice:', err);
  });

  updateMediaSession({
    title: 'VoiceMinder Pronto ad Avvisare',
    artist: 'Audio a schermo spento attivo',
  });
}

export function stopBackgroundAudioKeepAlive(): void {
  if (keepAliveAudio) {
    try {
      keepAliveAudio.pause();
    } catch {}
  }
}

/**
 * Vibrates the device if supported by hardware (Android / mobile browsers).
 */
export function vibrateDevice(pattern: number[] = [400, 200, 400, 200, 600]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibration notice:', e);
    }
  }
}

/**
 * Requests Screen Wake Lock to prevent screen sleep during alarm or active session.
 */
export async function requestScreenWakeLock(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      return true;
    } catch (err) {
      console.warn('Wake Lock request notice:', err);
    }
  }
  return false;
}

export function releaseScreenWakeLock(): void {
  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release();
      wakeLockSentinel = null;
    } catch {}
  }
}

/**
 * Requests Notification permission and sends system notification.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  }
  return false;
}

export function showSystemNotification(
  title: string,
  body: string,
  onActionClick?: () => void
): void {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notifOptions: NotificationOptions = {
        body,
        icon: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=192&auto=format&fit=crop&q=60',
        badge: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=96&auto=format&fit=crop&q=60',
        tag: 'voiceminder-alarm',
        requireInteraction: true,
      };
      const notif = new Notification(title, notifOptions);

      notif.onclick = () => {
        window.focus();
        onActionClick?.();
        notif.close();
      };
    } catch (e) {
      console.warn('Notification display notice:', e);
    }
  }
}
