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
}

// Check for browser support
const SpeechRecognition: MySpeechRecognitionConstructor | undefined = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined;

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { lang = DEFAULT_LANG, continuous = true, onResult, onError } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<MySpeechRecognitionInstance | null>(null);

  const isSupported = !!SpeechRecognition;

  const start = useCallback(() => {
    if (!SpeechRecognition) {
      setError('Speech recognition not supported');
      onError?.('Speech recognition not supported');
      return;
    }

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
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
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
        try {
          recognition.stop();
          setTimeout(() => {
            if (recognitionRef.current === recognition) {
              recognition.start();
            }
          }, 100);
        } catch { /* ignore restart errors */ }
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
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [lang, continuous, onResult, onError]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

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
  };
}
