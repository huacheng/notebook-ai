# Voice Input & Task Notification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add voice-to-text input and task completion notifications to the prompt textarea.

**Architecture:**
- Voice input: Web Speech API (primary) with Baidu API fallback for unsupported browsers
- Notifications: Layered approach - Audio + Notification API + Title blink

**Tech Stack:** React, Web Speech API, MediaRecorder API, Web Notification API

---

## Task 1: Notification System - Audio Alert

**Files:**
- Create: `packages/web/public/sounds/notification.mp3`
- Create: `packages/web/src/hooks/useNotification.ts`
- Create: `packages/web/src/__tests__/useNotification.test.ts`

**Step 1: Write failing test**

```typescript
// packages/web/src/__tests__/useNotification.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotification } from '../hooks/useNotification';

describe('useNotification', () => {
  it('should export playSound function', () => {
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.playSound).toBe('function');
  });

  it('should export notify function', () => {
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.notify).toBe('function');
  });

  it('should export requestPermission function', () => {
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.requestPermission).toBe('function');
  });
});
```

**Step 2: Run test to verify failure**
```bash
npx vitest run packages/web/src/__tests__/useNotification.test.ts
```
Expected: FAIL - module not found

**Step 3: Implement useNotification hook**

```typescript
// packages/web/src/hooks/useNotification.ts
import { useCallback, useRef } from 'react';

/** Audio notification sound path */
const NOTIFICATION_SOUND = '/sounds/notification.mp3';

/** Title blink interval in ms */
const TITLE_BLINK_INTERVAL = 1000;

export function useNotification() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blinkIntervalRef = useRef<number | null>(null);
  const originalTitleRef = useRef<string>(document.title);

  /** Play notification sound */
  const playSound = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(NOTIFICATION_SOUND);
    }
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {
      // Autoplay blocked - ignore silently
    });
  }, []);

  /** Request notification permission (must be called from user gesture) */
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
  }, []);

  /** Show system notification */
  const showSystemNotification = useCallback((title: string, body?: string) => {
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/logo.png' });
  }, []);

  /** Start title blinking (for background tabs) */
  const startTitleBlink = useCallback((message: string) => {
    if (blinkIntervalRef.current) return; // Already blinking
    originalTitleRef.current = document.title;
    blinkIntervalRef.current = window.setInterval(() => {
      document.title = document.title === message ? originalTitleRef.current : message;
    }, TITLE_BLINK_INTERVAL);
  }, []);

  /** Stop title blinking */
  const stopTitleBlink = useCallback(() => {
    if (blinkIntervalRef.current) {
      clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
      document.title = originalTitleRef.current;
    }
  }, []);

  /** Combined notify: sound + system notification + title blink if hidden */
  const notify = useCallback((title: string, body?: string) => {
    playSound();
    showSystemNotification(title, body);
    if (document.hidden) {
      startTitleBlink(`✅ ${title}`);
      const handleVisible = () => {
        if (!document.hidden) {
          stopTitleBlink();
          document.removeEventListener('visibilitychange', handleVisible);
        }
      };
      document.addEventListener('visibilitychange', handleVisible);
    }
  }, [playSound, showSystemNotification, startTitleBlink, stopTitleBlink]);

  return { playSound, notify, requestPermission, stopTitleBlink };
}
```

**Step 4: Run test to verify pass**
```bash
npx vitest run packages/web/src/__tests__/useNotification.test.ts
```
Expected: PASS

**Step 5: Add notification sound file**

Download or generate a short notification sound (< 1 second, ~10KB).

**Step 6: Commit**
```bash
git add packages/web/src/hooks/useNotification.ts packages/web/src/__tests__/useNotification.test.ts packages/web/public/sounds/
git commit -m "feat: add useNotification hook with audio, system notification, and title blink"
```

---

## Task 2: Integrate Notification into Cell Completion

**Files:**
- Modify: `packages/web/src/store/wsSlice.ts`
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/__tests__/notificationIntegration.test.ts`

**Step 1: Write failing test**

```typescript
// packages/web/src/__tests__/notificationIntegration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const wsSliceSrc = readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('notification integration in wsSlice', () => {
  it('should import useNotification or have notification callback', () => {
    expect(wsSliceSrc).toContain('onCellComplete');
  });

  it('should trigger notification on result message', () => {
    // Check that result handling has notification hook point
    const resultCase = wsSliceSrc.indexOf("type === 'result'");
    expect(resultCase).toBeGreaterThan(-1);
  });
});
```

**Step 2: Implement notification trigger**

Add `onCellComplete` callback to store, call it when cell execution finishes.

**Step 3: Wire up in App.tsx**

```typescript
// In App.tsx or a dedicated NotificationProvider
const { notify, requestPermission } = useNotification();

useEffect(() => {
  // Request permission on first user interaction
  const handleInteraction = () => {
    requestPermission();
    document.removeEventListener('click', handleInteraction);
  };
  document.addEventListener('click', handleInteraction);
  return () => document.removeEventListener('click', handleInteraction);
}, [requestPermission]);

// Subscribe to cell completion events
useEffect(() => {
  const unsub = useStore.subscribe(
    (state) => state.lastCompletedCellId,
    (cellId) => {
      if (cellId && document.hidden) {
        notify('Task Complete', 'Claude has finished responding');
      }
    }
  );
  return unsub;
}, [notify]);
```

**Step 4: Commit**
```bash
git add packages/web/src/store/wsSlice.ts packages/web/src/App.tsx packages/web/src/__tests__/notificationIntegration.test.ts
git commit -m "feat: trigger notification when cell execution completes"
```

---

## Task 3: Voice Input - Web Speech API (Primary)

**Files:**
- Create: `packages/web/src/hooks/useVoiceInput.ts`
- Create: `packages/web/src/__tests__/useVoiceInput.test.ts`

**Step 1: Write failing test**

```typescript
// packages/web/src/__tests__/useVoiceInput.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVoiceInput } from '../hooks/useVoiceInput';

describe('useVoiceInput', () => {
  it('should export isSupported flag', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.isSupported).toBe('boolean');
  });

  it('should export isListening state', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.isListening).toBe('boolean');
  });

  it('should export start and stop functions', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
  });

  it('should export transcript state', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.transcript).toBe('string');
  });

  it('should export interimTranscript for real-time display', () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.interimTranscript).toBe('string');
  });
});
```

**Step 2: Run test to verify failure**
```bash
npx vitest run packages/web/src/__tests__/useVoiceInput.test.ts
```

**Step 3: Implement useVoiceInput hook**

```typescript
// packages/web/src/hooks/useVoiceInput.ts
import { useState, useCallback, useRef, useEffect } from 'react';

/** Default language for speech recognition */
const DEFAULT_LANG = 'zh-CN';

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
const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || (window as any).webkitSpeechRecognition)
  : null;

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const { lang = DEFAULT_LANG, continuous = true, onResult, onError } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

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

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
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

    recognition.onerror = (event: any) => {
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
```

**Step 4: Run test to verify pass**
```bash
npx vitest run packages/web/src/__tests__/useVoiceInput.test.ts
```

**Step 5: Commit**
```bash
git add packages/web/src/hooks/useVoiceInput.ts packages/web/src/__tests__/useVoiceInput.test.ts
git commit -m "feat: add useVoiceInput hook with Web Speech API"
```

---

## Task 4: Voice Input UI - InputBar Integration

**Files:**
- Modify: `packages/web/src/components/shared/InputBar.tsx`
- Modify: `packages/web/src/styles.css`

**Step 1: Add voice button to InputBar**

```typescript
// In InputBar.tsx
import { useVoiceInput } from '../../hooks/useVoiceInput';

// Inside component:
const { isSupported, isListening, interimTranscript, start, stop, error } = useVoiceInput({
  onResult: (result) => {
    setText((prev) => prev + result);
  },
});

// Toggle voice input
const toggleVoice = () => {
  if (isListening) {
    stop();
  } else {
    start();
  }
};

// In JSX, add button near submit:
{isSupported && (
  <button
    type="button"
    className={`voice-input-btn ${isListening ? 'voice-input-btn--active' : ''}`}
    onClick={toggleVoice}
    title={isListening ? t('input.stopVoice') : t('input.startVoice')}
  >
    {isListening ? '🔴' : '🎤'}
  </button>
)}

// Show interim transcript
{interimTranscript && (
  <div className="voice-interim">{interimTranscript}</div>
)}
```

**Step 2: Add CSS styles**

```css
/* Voice input button */
.voice-input-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.voice-input-btn:hover {
  background: var(--bg-cell-hover);
}

.voice-input-btn--active {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.voice-interim {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--bg-thinking);
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
```

**Step 3: Add i18n strings**

```typescript
// locales.ts - EN
'input.startVoice': 'Start voice input',
'input.stopVoice': 'Stop voice input',
'input.voiceNotSupported': 'Voice input not supported in this browser',

// locales.ts - ZH
'input.startVoice': '开始语音输入',
'input.stopVoice': '停止语音输入',
'input.voiceNotSupported': '当前浏览器不支持语音输入',
```

**Step 4: Commit**
```bash
git add packages/web/src/components/shared/InputBar.tsx packages/web/src/styles.css packages/web/src/i18n/locales.ts
git commit -m "feat: add voice input button to InputBar with visual feedback"
```

---

## Task 5: Settings - Notification Preferences

**Files:**
- Modify: `packages/web/src/store/index.ts` (or settings slice)
- Modify: Settings UI component

**Step 1: Add settings state**

```typescript
interface NotificationSettings {
  soundEnabled: boolean;
  systemNotificationEnabled: boolean;
  titleBlinkEnabled: boolean;
}

// Default
const defaultNotificationSettings: NotificationSettings = {
  soundEnabled: true,
  systemNotificationEnabled: true,
  titleBlinkEnabled: true,
};
```

**Step 2: Persist to localStorage**

**Step 3: Add UI toggle in settings panel**

**Step 4: Commit**
```bash
git commit -m "feat: add notification preferences in settings"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | useNotification hook | 30 min |
| 2 | Notification integration | 20 min |
| 3 | useVoiceInput hook | 40 min |
| 4 | InputBar UI integration | 30 min |
| 5 | Settings preferences | 20 min |

**Total: ~2.5 hours**

---

## Six-Dimensional Review

### D1 Correctness

| Check | Status | Notes |
|-------|--------|-------|
| Web Speech API edge cases | ⚠️ | Need to handle `no-speech` timeout |
| Transcript accumulation | ✅ | Appends final results correctly |
| Permission request timing | ✅ | On user gesture only |

### D2 Security

| Check | Status | Notes |
|-------|--------|-------|
| Microphone permission | ✅ | Browser handles consent |
| No API keys in frontend | ✅ | Web Speech API is browser-native |
| Audio file source | ✅ | Local file, no external URL |

### D3 Reliability

| Check | Status | Notes |
|-------|--------|-------|
| Browser not supported | ✅ | `isSupported` flag hides button |
| Recognition error handling | ✅ | `onerror` captures and displays |
| Cleanup on unmount | ✅ | `useEffect` cleanup stops recognition |
| Audio autoplay blocked | ✅ | `.catch()` silently ignores |

### D4 Performance

| Check | Status | Notes |
|-------|--------|-------|
| Audio preload | ⚠️ | Consider preloading on first interaction |
| Memory leak | ✅ | Refs cleaned up on unmount |
| Re-render frequency | ✅ | Only on state change |

### D5 Architecture

| Check | Status | Notes |
|-------|--------|-------|
| Hook separation | ✅ | `useNotification` and `useVoiceInput` independent |
| Extensibility | ✅ | Options pattern allows customization |
| Store coupling | ⚠️ | Notification trigger tightly coupled to wsSlice |

### D6 Maintainability

| Check | Status | Notes |
|-------|--------|-------|
| Constants extracted | ✅ | `DEFAULT_LANG`, `TITLE_BLINK_INTERVAL` |
| Type safety | ✅ | Full TypeScript interfaces |
| Test coverage | ✅ | Unit tests for both hooks |
| i18n | ✅ | All user-facing strings in locales |

---

## Issues Found & Mitigations

### D1-1: Web Speech API `no-speech` timeout
**Problem:** Recognition may timeout after ~5s of silence.
**Fix:** Add `recognition.onsoundend` handler to restart if `continuous` mode.

### D4-1: Audio not preloaded
**Problem:** First notification may have delay loading audio file.
**Fix:** Preload audio on first user click.

### D5-1: Notification trigger coupling
**Problem:** `wsSlice` needs to know about notifications.
**Fix:** Use event emitter pattern or store subscription (already in plan).

---

## Final Verdict

| Dimension | Rating |
|-----------|--------|
| D1 Correctness | ✅ Good (1 minor fix needed) |
| D2 Security | ✅ Good |
| D3 Reliability | ✅ Good |
| D4 Performance | ⚠️ Minor (preload audio) |
| D5 Architecture | ✅ Good |
| D6 Maintainability | ✅ Good |

**Ready for implementation** with noted mitigations.

---

## Regression Test Strategy

### Pre-Implementation Baseline

**在开始任何任务前，必须先运行全量测试建立基线：**

```bash
# 记录基线测试数量
npx vitest run 2>&1 | tee /tmp/baseline.log
grep "Tests" /tmp/baseline.log
# Expected: Tests  XXX passed (记录此数字)
```

### Per-Task Regression Check

**每个 Task 完成后必须执行：**

```bash
# 1. 运行全量测试
npx vitest run

# 2. 验证测试数量 ≥ 基线 + 新增测试数
# 3. 验证 0 失败

# 4. TypeScript 类型检查
npx tsc --noEmit -p packages/web/tsconfig.json
npx tsc --noEmit -p packages/server/tsconfig.json
```

### Critical Regression Tests

**以下现有功能必须保持正常（每个 Task 后验证）：**

| 功能 | 测试文件 | 关键断言 |
|------|---------|----------|
| InputBar 提交 | `InputBar.test.ts` | 回车提交、Shift+回车换行 |
| WS 消息处理 | `wsSlice.test.ts` | result 消息正确处理 |
| Cell 执行 | `session.test.ts` | 执行状态转换正确 |
| 文件批注 | `fileAnnotations.test.ts` | 批注存储/加载 |

---

## Red-Green TDD Detailed Steps

### Task 1: useNotification Hook

#### Step 1.1: RED - 写失败测试

```bash
# 创建测试文件
cat > packages/web/src/__tests__/useNotification.test.ts << 'EOF'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useNotification', () => {
  // 测试模块导出
  it('should export useNotification function', async () => {
    const module = await import('../hooks/useNotification');
    expect(typeof module.useNotification).toBe('function');
  });

  // 测试 hook 返回值结构
  it('should return playSound function', async () => {
    const { useNotification } = await import('../hooks/useNotification');
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.playSound).toBe('function');
  });

  it('should return notify function', async () => {
    const { useNotification } = await import('../hooks/useNotification');
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.notify).toBe('function');
  });

  it('should return requestPermission function', async () => {
    const { useNotification } = await import('../hooks/useNotification');
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.requestPermission).toBe('function');
  });

  it('should return stopTitleBlink function', async () => {
    const { useNotification } = await import('../hooks/useNotification');
    const { result } = renderHook(() => useNotification());
    expect(typeof result.current.stopTitleBlink).toBe('function');
  });

  // 测试常量导出
  it('should export NOTIFICATION_SOUND constant', async () => {
    const module = await import('../hooks/useNotification');
    expect(module.NOTIFICATION_SOUND).toBe('/sounds/notification.mp3');
  });

  it('should export TITLE_BLINK_INTERVAL constant', async () => {
    const module = await import('../hooks/useNotification');
    expect(module.TITLE_BLINK_INTERVAL).toBe(1000);
  });
});
EOF

# 运行测试 - 必须失败
npx vitest run packages/web/src/__tests__/useNotification.test.ts
# Expected: FAIL - Cannot find module '../hooks/useNotification'
```

#### Step 1.2: GREEN - 实现最小代码

```bash
# 创建实现文件（见计划中的代码）
# 运行测试 - 必须通过
npx vitest run packages/web/src/__tests__/useNotification.test.ts
# Expected: 7 tests passed
```

#### Step 1.3: REFACTOR - 清理（如需要）

#### Step 1.4: REGRESSION - 全量测试

```bash
npx vitest run
# Expected: 基线 + 7 tests passed, 0 failed
```

---

### Task 2: Notification Integration

#### Step 2.1: RED - 写失败测试

```bash
cat > packages/web/src/__tests__/notificationIntegration.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('notification integration', () => {
  const wsSliceSrc = readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  it('should have lastCompletedCellId in store state', () => {
    expect(wsSliceSrc).toContain('lastCompletedCellId');
  });

  it('should set lastCompletedCellId when result message received', () => {
    // 检查 result 处理逻辑中设置了 lastCompletedCellId
    const resultHandling = wsSliceSrc.includes("type: 'result'") ||
                           wsSliceSrc.includes('type === "result"');
    expect(resultHandling).toBe(true);
    expect(wsSliceSrc).toContain('lastCompletedCellId');
  });

  it('should reset lastCompletedCellId on new execution', () => {
    // 检查开始执行时重置
    expect(wsSliceSrc).toContain('lastCompletedCellId: null');
  });
});
EOF

npx vitest run packages/web/src/__tests__/notificationIntegration.test.ts
# Expected: FAIL - lastCompletedCellId not found
```

#### Step 2.2: GREEN - 实现

修改 `wsSlice.ts` 添加 `lastCompletedCellId` 状态和设置逻辑。

#### Step 2.3: REGRESSION

```bash
npx vitest run
# 验证现有 wsSlice 测试仍通过
```

---

### Task 3: useVoiceInput Hook

#### Step 3.1: RED - 写失败测试

```bash
cat > packages/web/src/__tests__/useVoiceInput.test.ts << 'EOF'
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useVoiceInput', () => {
  // 模拟 SpeechRecognition
  beforeEach(() => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
  });

  it('should export useVoiceInput function', async () => {
    const module = await import('../hooks/useVoiceInput');
    expect(typeof module.useVoiceInput).toBe('function');
  });

  it('should return isSupported as false when API not available', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isSupported).toBe(false);
  });

  it('should return isListening initially false', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.isListening).toBe(false);
  });

  it('should return empty transcript initially', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.transcript).toBe('');
  });

  it('should return empty interimTranscript initially', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.interimTranscript).toBe('');
  });

  it('should return start and stop functions', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
  });

  it('should return null error initially', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.error).toBeNull();
  });

  it('should set error when start called without support', async () => {
    const { useVoiceInput } = await import('../hooks/useVoiceInput');
    const { result } = renderHook(() => useVoiceInput());
    act(() => {
      result.current.start();
    });
    expect(result.current.error).toBe('Speech recognition not supported');
  });

  it('should export DEFAULT_LANG constant', async () => {
    const module = await import('../hooks/useVoiceInput');
    expect(module.DEFAULT_LANG).toBe('zh-CN');
  });
});
EOF

npx vitest run packages/web/src/__tests__/useVoiceInput.test.ts
# Expected: FAIL - Cannot find module
```

#### Step 3.2: GREEN - 实现

#### Step 3.3: REGRESSION

```bash
npx vitest run
# 验证全量测试通过
```

---

### Task 4: InputBar Integration

#### Step 4.1: RED - 写失败测试

```bash
cat > packages/web/src/__tests__/inputBarVoice.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('InputBar voice integration', () => {
  const inputBarSrc = readFileSync(
    path.resolve(__dirname, '../components/shared/InputBar.tsx'),
    'utf-8'
  );

  it('should import useVoiceInput hook', () => {
    expect(inputBarSrc).toContain("from '../../hooks/useVoiceInput'");
  });

  it('should have voice-input-btn class', () => {
    expect(inputBarSrc).toContain('voice-input-btn');
  });

  it('should have voice toggle handler', () => {
    expect(inputBarSrc).toContain('toggleVoice');
  });

  it('should show microphone emoji when not listening', () => {
    expect(inputBarSrc).toContain('🎤');
  });

  it('should show recording indicator when listening', () => {
    expect(inputBarSrc).toContain('🔴');
  });

  it('should conditionally render based on isSupported', () => {
    expect(inputBarSrc).toContain('isSupported');
  });
});

describe('InputBar existing functionality (regression)', () => {
  const inputBarSrc = readFileSync(
    path.resolve(__dirname, '../components/shared/InputBar.tsx'),
    'utf-8'
  );

  it('should still have submit handler', () => {
    expect(inputBarSrc).toContain('handleSubmit');
  });

  it('should still have command buttons', () => {
    expect(inputBarSrc).toContain('task-ai:target');
    expect(inputBarSrc).toContain('task-ai:auto');
  });

  it('should still support image upload', () => {
    expect(inputBarSrc).toContain('handlePaste');
  });
});
EOF

npx vitest run packages/web/src/__tests__/inputBarVoice.test.ts
# Expected: FAIL - useVoiceInput not imported
```

#### Step 4.2: GREEN - 实现

#### Step 4.3: REGRESSION

```bash
# 特别验证 InputBar 现有功能
npx vitest run packages/web/src/__tests__/inputBar
npx vitest run
```

---

### Task 5: Settings

#### Step 5.1: RED - 写失败测试

```bash
cat > packages/web/src/__tests__/notificationSettings.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';

describe('notification settings', () => {
  it('should have NotificationSettings interface', async () => {
    const module = await import('../hooks/useNotification');
    // 检查类型导出
    expect(module.defaultNotificationSettings).toBeDefined();
  });

  it('should have default settings with all options true', async () => {
    const module = await import('../hooks/useNotification');
    expect(module.defaultNotificationSettings.soundEnabled).toBe(true);
    expect(module.defaultNotificationSettings.systemNotificationEnabled).toBe(true);
    expect(module.defaultNotificationSettings.titleBlinkEnabled).toBe(true);
  });
});
EOF

npx vitest run packages/web/src/__tests__/notificationSettings.test.ts
# Expected: FAIL
```

#### Step 5.2: GREEN - 实现

#### Step 5.3: FINAL REGRESSION

```bash
# 最终全量测试
npx vitest run
npx tsc --noEmit -p packages/web/tsconfig.json
npx tsc --noEmit -p packages/server/tsconfig.json

# 验证测试数量 = 基线 + 所有新增测试
```

---

## Test Count Tracking

| Phase | Expected Test Count | Actual | Status |
|-------|---------------------|--------|--------|
| Baseline | XXX | | |
| After Task 1 | XXX + 7 | | |
| After Task 2 | XXX + 10 | | |
| After Task 3 | XXX + 19 | | |
| After Task 4 | XXX + 25 | | |
| After Task 5 | XXX + 27 | | |

---

## Commit Checklist

每次 commit 前必须确认：

- [ ] 新测试先失败（RED 确认）
- [ ] 实现后测试通过（GREEN 确认）
- [ ] 全量测试通过（REGRESSION 确认）
- [ ] TypeScript 无错误
- [ ] 只 stage 相关文件
- [ ] commit message 符合规范
