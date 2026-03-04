import { useState, useCallback, useRef, useEffect } from 'react';

/** Default language for speech recognition */
export const DEFAULT_LANG = 'zh-CN';

// Web Speech API type declarations (not in standard lib.dom.d.ts)
interface MySpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface MySpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface MySpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((this: MySpeechRecognitionInstance, ev: Event) => void) | null;
  onresult: ((this: MySpeechRecognitionInstance, ev: MySpeechRecognitionEvent) => void) | null;
  onerror: ((this: MySpeechRecognitionInstance, ev: MySpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: MySpeechRecognitionInstance, ev: Event) => void) | null;
  start: () => void;
  stop: () => void;
}

interface MySpeechRecognitionConstructor {
  new (): MySpeechRecognitionInstance;
}

declare global {
  interface Window {
    SpeechRecognition?: MySpeechRecognitionConstructor;
    webkitSpeechRecognition?: MySpeechRecognitionConstructor;
  }
}

interface UseVoiceInputOptions {
  lang?: string;
  continuous?: boolean;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  start: () => void;
  stop: () => void;
  error: string | null;
  requestPermission: () => Promise<boolean>;
}

// Check for browser support
const SpeechRecognition: MySpeechRecognitionConstructor | undefined = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined;

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  // Default continuous=false for better browser compatibility
  const { lang = DEFAULT_LANG, continuous = false, onResult, onError } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<MySpeechRecognitionInstance | null>(null);
  const restartingRef = useRef(false); // D1-3 fix: track restart state to avoid isListening flicker

  const isSupported = !!SpeechRecognition;

  const start = useCallback(async () => {
    if (!SpeechRecognition) {
      setError('Speech recognition not supported');
      onError?.('Speech recognition not supported');
      return;
    }

    // Skip getUserMedia pre-check - let SpeechRecognition request microphone directly
    // This avoids conflicts where both APIs try to use the microphone

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    // D1-1 fix: Clear accumulated transcript on new session
    setTranscript('');
    setInterimTranscript('');

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: MySpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        setTranscript((prev) => prev + final);
        onResult?.(final);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: MySpeechRecognitionErrorEvent) => {
      // D3-2 fix: auto-restart on no-speech timeout in continuous mode
      if (event.error === 'no-speech' && continuous) {
        // Silent timeout - restart recognition automatically
        restartingRef.current = true; // D1-3 fix: mark as restarting
        try {
          recognition.stop();
          setTimeout(() => {
            restartingRef.current = false;
            if (recognitionRef.current === recognition) {
              recognition.start();
            }
          }, 100);
        } catch {
          restartingRef.current = false;
        }
        return;
      }

      const errMsg = event.error === 'not-allowed'
        ? 'Microphone access denied'
        : `Speech recognition error: ${event.error}`;
      setError(errMsg);
      onError?.(errMsg);
      setIsListening(false);
    };

    recognition.onend = () => {
      // D1-3 fix: don't set isListening=false if we're restarting due to no-speech
      if (!restartingRef.current) {
        setIsListening(false);
      }
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start speech recognition';
      console.error('[Voice] Start error:', err);
      setError(msg);
      onError?.(msg);
    }
  }, [lang, continuous, onResult, onError]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // Request microphone permission explicitly (for retry after denial)
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission granted - stop the stream immediately (we just needed permission)
      stream.getTracks().forEach(track => track.stop());
      setError(null);
      return true;
    } catch (err) {
      const isPermanentBlock = err instanceof Error && err.name === 'NotAllowedError';
      const msg = isPermanentBlock
        ? 'Microphone blocked permanently'
        : 'Failed to access microphone';
      setError(msg);
      onError?.(msg);

      // Show alert for permanently blocked - browser won't show permission dialog
      if (isPermanentBlock) {
        alert('Microphone is blocked.\n\nTo enable:\n1. Click the 🔒 icon in address bar\n2. Find "Microphone" setting\n3. Change to "Allow"\n4. Refresh the page');
      }
      return false;
    }
  }, [onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    start,
    stop,
    error,
    requestPermission,
  };
}
