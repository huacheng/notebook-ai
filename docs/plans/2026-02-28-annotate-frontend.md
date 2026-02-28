# Annotate Frontend Integration — Implementation Plan

> **⚠️ 历史文档** — `textOffset` + `before`/`after` 定位机制已被 `cursor`（源文件字符偏移）+ `selected` 双锚点取代。当前实现见 `task-ai/commands/references/annotation-format.md`。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ad-hoc annotation-to-prompt pipeline with JSONL serialization, textOffset-based positioning, and system-file hard routing, so annotations from FileViewer flow directly into task-ai:annotate (system files) or Claude conversation (general files).

**Architecture:** Pure frontend changes across 3 files. `types/fileAnnotations.ts` gains JSONL serialization + `isTaskSystemFile()` + `resolveAbsolutePath()`. `FileViewer.tsx` computes absolute paths and disables edit for system files. `FileViewerRender.tsx` captures `textOffset` via Range API and wires up the new serializers in send handlers. No backend changes.

**Tech Stack:** React, TypeScript, Vitest

**Design spec:** `AiTasks/notebook/task-ai-annotate-设计.md` §2

**TDD 约束:** 严格 Red → Green → Refactor。每个行为变更先有失败测试，再写最少实现。

---

## Task 1: `isTaskSystemFile()` — 系统文件判定

**行为定义:** 路径含 `/.working/` 且文件名以 `.` 开头 → 系统文件

**Files:**
- Test: `packages/web/src/__tests__/annotationPrompt.test.ts` (新建)
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: RED — 写失败测试

新建 `packages/web/src/__tests__/annotationPrompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isTaskSystemFile } from '../types/fileAnnotations';

describe('isTaskSystemFile', () => {
  it('detects dotfile inside .working/', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/task-1/.working/.target.md')).toBe(true);
    expect(isTaskSystemFile('/home/u/ws/proj/task-1/.working/.plan.md')).toBe(true);
  });

  it('rejects non-dotfile inside .working/', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/task-1/.working/notes.md')).toBe(false);
  });

  it('rejects dotfile outside .working/', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/.hidden-file.md')).toBe(false);
  });

  it('rejects normal files', () => {
    expect(isTaskSystemFile('/home/u/ws/proj/src/index.ts')).toBe(false);
  });

  it('handles .working/ subdirs — only leaf filename matters', () => {
    // .analysis is a dir name, not the leaf filename
    expect(isTaskSystemFile('/home/u/ws/proj/.working/.analysis/review.md')).toBe(false);
    // leaf filename starts with dot
    expect(isTaskSystemFile('/home/u/ws/proj/.working/.test/.criteria.md')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isTaskSystemFile('')).toBe(false);
  });
});
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: FAIL — `isTaskSystemFile` is not exported.

### Step 2: GREEN — 最小实现

在 `packages/web/src/types/fileAnnotations.ts` 末尾追加:

```typescript
/** Path contains /.working/ and leaf filename starts with '.' → task system file */
export function isTaskSystemFile(absolutePath: string): boolean {
  const segments = absolutePath.split('/');
  const workingIdx = segments.indexOf('.working');
  if (workingIdx < 0) return false;
  const filename = segments[segments.length - 1];
  return filename.startsWith('.');
}
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts packages/web/src/__tests__/annotationPrompt.test.ts
git commit -m "feat(annotate): add isTaskSystemFile() with tests"
```

---

## Task 2: `resolveAbsolutePath()` — 绝对路径解析

**行为定义:** 根据 source 类型 + 已知目录信息推导绝对路径

**Files:**
- Test: `packages/web/src/__tests__/annotationPrompt.test.ts` (追加)
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: RED — 写失败测试

追加到测试文件:

```typescript
import { resolveAbsolutePath } from '../types/fileAnnotations';

describe('resolveAbsolutePath', () => {
  it('workspace: workspaceDir + "/" + path', () => {
    expect(resolveAbsolutePath('workspace', 'src/index.ts', '/home/u/ws/proj/.worktrees/t', null))
      .toBe('/home/u/ws/proj/.worktrees/t/src/index.ts');
  });

  it('workspace: system file inside .working/', () => {
    expect(resolveAbsolutePath('workspace', '.working/.target.md', '/home/u/ws/proj/.worktrees/t', null))
      .toBe('/home/u/ws/proj/.worktrees/t/.working/.target.md');
  });

  it('library: uses activeProjectPath parent as root', () => {
    expect(resolveAbsolutePath('library', 'docs/ref.pdf', null, '/home/u/ws/proj'))
      .toBe('/home/u/ws/.library/docs/ref.pdf');
  });

  it('library: also works when workspaceDir is provided but activeProjectPath preferred', () => {
    expect(resolveAbsolutePath('library', 'paper.pdf', '/home/u/ws/proj/.worktrees/t', '/home/u/ws/proj'))
      .toBe('/home/u/ws/.library/paper.pdf');
  });

  it('deliverables: workspaceDir + "/.deliverables/" + path', () => {
    expect(resolveAbsolutePath('deliverables', 'output.pdf', '/home/u/ws/proj/.worktrees/t', null))
      .toBe('/home/u/ws/proj/.worktrees/t/.deliverables/output.pdf');
  });

  it('returns empty string when no dir info available', () => {
    expect(resolveAbsolutePath('workspace', 'file.ts', null, null)).toBe('');
    expect(resolveAbsolutePath('library', 'ref.pdf', null, null)).toBe('');
    expect(resolveAbsolutePath('deliverables', 'out.pdf', null, null)).toBe('');
  });
});
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: FAIL — `resolveAbsolutePath` is not exported.

### Step 2: GREEN — 最小实现

在 `fileAnnotations.ts` 追加:

```typescript
export function resolveAbsolutePath(
  source: 'workspace' | 'library' | 'deliverables',
  filePath: string,
  workspaceDir: string | null,
  activeProjectPath: string | null,
): string {
  if (source === 'workspace') {
    return workspaceDir ? `${workspaceDir}/${filePath}` : '';
  }
  if (source === 'deliverables') {
    return workspaceDir ? `${workspaceDir}/.deliverables/${filePath}` : '';
  }
  // library: root = parent of activeProjectPath
  const root = activeProjectPath
    ? activeProjectPath.substring(0, activeProjectPath.lastIndexOf('/'))
    : null;
  return root ? `${root}/.library/${filePath}` : '';
}
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts packages/web/src/__tests__/annotationPrompt.test.ts
git commit -m "feat(annotate): add resolveAbsolutePath() with tests"
```

---

## Task 3: `FileAnnotation` 接口硬升级 + JSONL 序列化

**行为定义:**
- `FileAnnotation` 新增 required 字段: `absolute_path: string`, `textOffset: number`
- `buildSingleAnnotationPrompt()` 将单条批注序列化为 JSON 行；`before`/`after` 从 `renderedText` + `textOffset` 提取，最长 40 字符
- `buildAnnotationPrompt()` 将多条拼为 JSONL
- 硬升级：不做旧数据兼容，新字段 required

**Files:**
- Test: `packages/web/src/__tests__/annotationPrompt.test.ts` (追加)
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: RED — 写失败测试

追加到测试文件:

```typescript
import { buildSingleAnnotationPrompt, buildAnnotationPrompt } from '../types/fileAnnotations';
import type { FileAnnotation } from '../types/fileAnnotations';

// Helper to create a complete annotation (all required fields)
function makeAnn(overrides: Partial<FileAnnotation> & { type: FileAnnotation['type'] }): FileAnnotation {
  return {
    id: 'ann_test',
    type: 'comment',
    file_path: 'f.md',
    selected_text: 'selected',
    absolute_path: '/home/u/ws/proj/.working/.target.md',
    textOffset: 10,
    author: 'user',
    timestamp: '',
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildSingleAnnotationPrompt', () => {
  it('produces valid JSON with correct fields', () => {
    const ann = makeAnn({ type: 'replace', selected_text: 'old text', content: 'new text', textOffset: 5 });
    const rendered = 'AAAA old text BBBB';
    //                 01234 = "AAAA " before (5 chars)
    const line = buildSingleAnnotationPrompt(ann, rendered);
    const p = JSON.parse(line);
    expect(p.file).toBe(ann.absolute_path);
    expect(p.type).toBe('replace');
    expect(p.selected).toBe('old text');
    expect(p.replacement).toBe('new text');
    expect(p.before).toBe('AAAA ');
    expect(p.after).toBe(' BBBB');
  });

  it('caps before/after at 40 chars', () => {
    const ann = makeAnn({ type: 'comment', selected_text: 'SEL', content: 'Why?', textOffset: 100 });
    const rendered = 'A'.repeat(100) + 'SEL' + 'B'.repeat(100);
    const p = JSON.parse(buildSingleAnnotationPrompt(ann, rendered));
    expect(p.before.length).toBe(40);
    expect(p.after.length).toBe(40);
    expect(p.comment).toBe('Why?');
  });

  it('insert type → content field, no replacement/comment', () => {
    const ann = makeAnn({ type: 'insert', content: 'added' });
    const p = JSON.parse(buildSingleAnnotationPrompt(ann, 'x'.repeat(50)));
    expect(p.content).toBe('added');
    expect(p.replacement).toBeUndefined();
    expect(p.comment).toBeUndefined();
  });

  it('delete type → no content/replacement/comment', () => {
    const ann = makeAnn({ type: 'delete' });
    const p = JSON.parse(buildSingleAnnotationPrompt(ann, 'x'.repeat(50)));
    expect(p.content).toBeUndefined();
    expect(p.replacement).toBeUndefined();
    expect(p.comment).toBeUndefined();
  });

  it('textOffset=0 → before is empty', () => {
    const ann = makeAnn({ type: 'comment', selected_text: 'hello', content: 'q', textOffset: 0 });
    const p = JSON.parse(buildSingleAnnotationPrompt(ann, 'hello world'));
    expect(p.before).toBe('');
  });

  it('selection at end → after is empty', () => {
    const text = 'prefix-SEL';
    const ann = makeAnn({ type: 'comment', selected_text: 'SEL', content: 'q', textOffset: 7 });
    const p = JSON.parse(buildSingleAnnotationPrompt(ann, text));
    expect(p.after).toBe('');
  });

  it('escapes quotes, newlines, special chars in JSON', () => {
    const ann = makeAnn({
      type: 'replace',
      selected_text: 'Use "strict" for → val',
      content: 'line1\nline2',
      textOffset: 0,
    });
    const rendered = 'Use "strict" for → val and more';
    const line = buildSingleAnnotationPrompt(ann, rendered);
    expect(() => JSON.parse(line)).not.toThrow();
    const p = JSON.parse(line);
    expect(p.selected).toBe('Use "strict" for → val');
    expect(p.replacement).toBe('line1\nline2');
  });
});

describe('buildAnnotationPrompt', () => {
  it('one line per annotation, each valid JSON', () => {
    const anns = [
      makeAnn({ id: 'a1', type: 'replace', content: 'new', textOffset: 0 }),
      makeAnn({ id: 'a2', type: 'comment', content: 'why?', textOffset: 20 }),
    ];
    const result = buildAnnotationPrompt(anns, 'x'.repeat(100));
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach(l => expect(() => JSON.parse(l)).not.toThrow());
  });

  it('single annotation → single line, no trailing newline', () => {
    const result = buildAnnotationPrompt([makeAnn({ type: 'delete' })], 'x'.repeat(50));
    expect(result.includes('\n')).toBe(false);
  });

  it('empty array → empty string', () => {
    expect(buildAnnotationPrompt([], '')).toBe('');
  });
});
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: FAIL — `buildSingleAnnotationPrompt`, `buildAnnotationPrompt` not exported; `absolute_path`/`textOffset` not on interface.

### Step 2: GREEN — 接口升级 + 序列化实现

**2a. 修改 `FileAnnotation` 接口（硬升级，required 字段）:**

```typescript
export interface FileAnnotation {
  id: string;
  type: 'insert' | 'delete' | 'replace' | 'comment';
  file_path: string;            // relative path within workspace/library
  absolute_path: string;        // absolute path for prompt construction
  selected_text: string;        // anchor snapshot (max 80 chars)
  content?: string;             // insert/replace/comment text
  textOffset: number;           // selection start offset in rendered text
  author: string;
  timestamp: string;            // ISO
  updatedAt: number;            // ms epoch
  highlightRects?: { x: number; y: number; width: number; height: number }[];
  capturedScale?: number;
}
```

**2b. 追加序列化函数:**

```typescript
interface AnnotationPayload {
  file: string;
  type: 'insert' | 'delete' | 'replace' | 'comment';
  selected: string;
  before: string;
  after: string;
  content?: string;
  replacement?: string;
  comment?: string;
}

export function buildSingleAnnotationPrompt(
  ann: FileAnnotation,
  renderedText: string,
  maxCtx: number = 40,
): string {
  const off = ann.textOffset;
  const end = off + ann.selected_text.length;
  const payload: AnnotationPayload = {
    file: ann.absolute_path,
    type: ann.type,
    selected: ann.selected_text,
    before: renderedText.slice(Math.max(0, off - maxCtx), off),
    after:  renderedText.slice(end, end + maxCtx),
  };
  if (ann.type === 'insert')  payload.content = ann.content ?? '';
  if (ann.type === 'replace') payload.replacement = ann.content ?? '';
  if (ann.type === 'comment') payload.comment = ann.content ?? '';
  return JSON.stringify(payload);
}

export function buildAnnotationPrompt(
  annotations: FileAnnotation[],
  renderedText: string,
): string {
  return annotations
    .map(ann => buildSingleAnnotationPrompt(ann, renderedText))
    .join('\n');
}
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts packages/web/src/__tests__/annotationPrompt.test.ts
git commit -m "feat(annotate): hard-upgrade FileAnnotation interface + add JSONL serialization"
```

---

## Task 4: `buildSendPayload()` — prefix 路由

**行为定义:**
- 系统文件批注 → `"/task-ai:annotate\n" + JSONL`
- 一般文件批注 → `JSONL`（无前缀）
- 路由依据：第一条批注的 `absolute_path`

**Files:**
- Test: `packages/web/src/__tests__/annotationPrompt.test.ts` (追加)
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: RED — 写失败测试

```typescript
import { buildSendPayload } from '../types/fileAnnotations';

describe('buildSendPayload — send pipeline with routing', () => {
  const SYSTEM_ANN = makeAnn({
    type: 'replace', content: 'new text',
    absolute_path: '/home/u/ws/proj/.working/.target.md',
    textOffset: 5,
  });
  const GENERAL_ANN = makeAnn({
    type: 'comment', content: 'Why?',
    absolute_path: '/home/u/ws/proj/src/readme.md',
    textOffset: 5,
  });
  const RENDERED = 'AAAA selected BBBB more text padding here for context';

  describe('single annotation', () => {
    it('system file → "/task-ai:annotate\\n" + JSONL', () => {
      const result = buildSendPayload([SYSTEM_ANN], RENDERED);
      expect(result.startsWith('/task-ai:annotate\n')).toBe(true);
      const jsonPart = result.slice('/task-ai:annotate\n'.length);
      expect(() => JSON.parse(jsonPart)).not.toThrow();
      expect(JSON.parse(jsonPart).file).toContain('.working/.target.md');
    });

    it('general file → no prefix, just JSONL', () => {
      const result = buildSendPayload([GENERAL_ANN], RENDERED);
      expect(result.startsWith('/task-ai:annotate')).toBe(false);
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('batch annotations', () => {
    it('system file batch → prefix + multi-line JSONL', () => {
      const ann2 = makeAnn({
        id: 'ann_2', type: 'comment', content: 'question',
        absolute_path: '/home/u/ws/proj/.working/.target.md',
        textOffset: 20,
      });
      const result = buildSendPayload([SYSTEM_ANN, ann2], RENDERED);
      expect(result.startsWith('/task-ai:annotate\n')).toBe(true);
      const body = result.slice('/task-ai:annotate\n'.length);
      const lines = body.split('\n');
      expect(lines).toHaveLength(2);
      lines.forEach(l => expect(() => JSON.parse(l)).not.toThrow());
    });

    it('general file batch → no prefix, multi-line JSONL', () => {
      const ann2 = makeAnn({
        id: 'ann_2', type: 'delete',
        absolute_path: '/home/u/ws/proj/src/readme.md',
        textOffset: 20,
      });
      const result = buildSendPayload([GENERAL_ANN, ann2], RENDERED);
      expect(result.startsWith('/task-ai:annotate')).toBe(false);
      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  it('empty annotations → empty string', () => {
    expect(buildSendPayload([], '')).toBe('');
  });
});
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: FAIL — `buildSendPayload` not exported.

### Step 2: GREEN — 实现

在 `fileAnnotations.ts` 追加:

```typescript
/**
 * Build the complete send payload with routing prefix.
 * System files → "/task-ai:annotate\n" + JSONL
 * General files → JSONL (no prefix)
 */
export function buildSendPayload(
  annotations: FileAnnotation[],
  renderedText: string,
): string {
  if (annotations.length === 0) return '';
  const jsonl = buildAnnotationPrompt(annotations, renderedText);
  const firstPath = annotations[0].absolute_path;
  const prefix = isTaskSystemFile(firstPath) ? '/task-ai:annotate\n' : '';
  return prefix + jsonl;
}
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts packages/web/src/__tests__/annotationPrompt.test.ts
git commit -m "feat(annotate): add buildSendPayload with system-file routing prefix"
```

---

## Task 5: `canEditFile()` — 编辑守卫

**行为定义:**
- 系统文件 → `false`（即使格式可编辑）
- 二进制格式 → `false`
- unsupported / null 格式 → `false`
- 一般文件 + 可编辑格式 → `true`

**Files:**
- Test: `packages/web/src/__tests__/annotationPrompt.test.ts` (追加)
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: RED — 写失败测试

```typescript
import { canEditFile } from '../types/fileAnnotations';

describe('canEditFile — edit guard with system file check', () => {
  it('system file + text format → false (read-only)', () => {
    expect(canEditFile('text', '/home/u/ws/proj/.working/.target.md')).toBe(false);
  });

  it('system file + html format → false', () => {
    expect(canEditFile('html', '/home/u/ws/proj/.working/.plan.md')).toBe(false);
  });

  it('general file + text format → true', () => {
    expect(canEditFile('text', '/home/u/ws/proj/src/index.ts')).toBe(true);
  });

  it('general file + html format → true', () => {
    expect(canEditFile('html', '/home/u/ws/proj/readme.html')).toBe(true);
  });

  it('binary format → always false', () => {
    expect(canEditFile('pdf-binary', '/home/u/ws/proj/doc.pdf')).toBe(false);
    expect(canEditFile('docx-binary', '/home/u/ws/proj/.working/.target.md')).toBe(false);
  });

  it('unsupported format → always false', () => {
    expect(canEditFile('unsupported', '/home/u/ws/proj/file.xyz')).toBe(false);
  });

  it('null format → false', () => {
    expect(canEditFile(null, '/home/u/ws/proj/file.ts')).toBe(false);
  });

  it('empty absolutePath → treated as non-system file', () => {
    expect(canEditFile('text', '')).toBe(true);
  });
});
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: FAIL — `canEditFile` not exported.

### Step 2: GREEN — 实现

在 `fileAnnotations.ts` 追加:

```typescript
/** Determine if a file can be edited based on format and system-file status. */
export function canEditFile(format: string | null, absolutePath: string): boolean {
  if (format === null) return false;
  if (format.endsWith('-binary')) return false;
  if (format === 'unsupported') return false;
  if (isTaskSystemFile(absolutePath)) return false;
  return true;
}
```

Run: `cd packages/web && npx vitest run src/__tests__/annotationPrompt.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts packages/web/src/__tests__/annotationPrompt.test.ts
git commit -m "feat(annotate): add canEditFile with system-file read-only guard"
```

---

## Task 6: 接线 `FileViewer.tsx` — 使用新纯函数

**行为已测试:** `resolveAbsolutePath`（Task 2）、`canEditFile`（Task 5）。此 task 只是接线。

**Files:**
- Modify: `packages/web/src/components/FileViewer.tsx`

### Step 1: RED — 运行全量测试确认当前绿色基线

Run: `cd packages/web && npx vitest run`
Expected: PASS

### Step 2: GREEN — 修改 FileViewer.tsx

**2a. Import 变更（第 5-6 行区域）:**

```diff
-import { EMPTY_FILE_ANNOTATIONS } from '../types/fileAnnotations';
+import { EMPTY_FILE_ANNOTATIONS, resolveAbsolutePath, canEditFile } from '../types/fileAnnotations';
```

**2b. 读 store（第 19-20 行后追加）:**

```diff
  const submitPrompt = useStore((s) => s.submitPrompt);
+ const workspaceDir = useStore((s) => s.workspaceDir);
+ const activeProjectPath = useStore((s) => s.activeProjectPath);
```

**2c. 计算 absolutePath + canEdit（第 75-76 行）:**

```diff
  const filename = activeFile.path.split('/').pop() ?? activeFile.path;
- const canEdit = fileState.format !== null && !fileState.format.endsWith('-binary') && fileState.format !== 'unsupported';
+ const absolutePath = resolveAbsolutePath(
+   activeFile.source, activeFile.path, workspaceDir, activeProjectPath,
+ );
+ const canEdit = canEditFile(fileState.format, absolutePath);
```

**2d. 传 absolutePath 给 FileViewerRender（第 110-122 行）:**

```diff
  <FileViewerRender
    format={fileState.format!}
    content={fileState.content}
    binaryBuffer={fileState.binaryBuffer}
    filename={filename}
    annotations={annotations}
    filePath={activeFile.path}
    onAnnotationsChange={setAnnotations}
    onSendToPrompt={submitPrompt}
+   absolutePath={absolutePath}
    pdfScale={contentScale}
    onPdfPagesLoaded={setPdfPages}
    onPdfVisiblePage={setPdfPage}
  />
```

### Step 3: 运行全量测试

Run: `cd packages/web && npx vitest run`
Expected: PASS（类型编译可能暂时报 FileViewerRender 不接受 absolutePath——Task 7 修复）

### Step 4: Commit

```bash
git add packages/web/src/components/FileViewer.tsx
git commit -m "feat(annotate): wire resolveAbsolutePath + canEditFile in FileViewer"
```

---

## Task 7: 接线 `FileViewerRender.tsx` — textOffset + JSONL send

**行为已测试:** `buildSendPayload`（Task 4）。此 task 接线 + Range API textOffset 捕获。

**Files:**
- Modify: `packages/web/src/components/FileViewerRender.tsx`

### Step 1: RED — 运行全量测试确认当前绿色基线

Run: `cd packages/web && npx vitest run`
Expected: PASS（或 Task 6 传了 absolutePath 但 FileViewerRender 未接受——此 task 修复）

### Step 2: GREEN — 修改 FileViewerRender.tsx

**2a. Import 变更（第 16 行）:**

```diff
-import { uid, buildAnnotationText } from '../types/fileAnnotations';
+import { uid, buildSendPayload } from '../types/fileAnnotations';
```

**2b. Props interface 增加 absolutePath（第 179-191 行）:**

```diff
 interface FileViewerRenderProps {
   format: FileFormat;
   content: string;
   binaryBuffer: Uint8Array | null;
   filename: string;
   annotations: FileAnnotations;
   filePath: string;
   onAnnotationsChange: (a: FileAnnotations) => void;
   onSendToPrompt: (text: string) => void;
+  absolutePath: string;
   pdfScale?: number;
   onPdfPagesLoaded?: (n: number) => void;
   onPdfVisiblePage?: (n: number) => void;
 }
```

**2c. Destructure（第 193-196 行）:**

```diff
 export function FileViewerRender({
-  format, content, binaryBuffer, filename, annotations, filePath, onAnnotationsChange, onSendToPrompt,
+  format, content, binaryBuffer, filename, annotations, filePath, onAnnotationsChange, onSendToPrompt, absolutePath,
   pdfScale = 1.0, onPdfPagesLoaded, onPdfVisiblePage,
 }: FileViewerRenderProps) {
```

**2d. float state 增加 textOffset（第 197 行）:**

```diff
-  const [float, setFloat] = useState<{ x: number; y: number; selectionBottom: number; text: string; rects: { x: number; y: number; width: number; height: number }[] } | null>(null);
+  const [float, setFloat] = useState<{ x: number; y: number; selectionBottom: number; text: string; rects: { x: number; y: number; width: number; height: number }[]; textOffset: number } | null>(null);
```

**2e. addAnnotation — 记录 absolute_path + textOffset（第 290-314 行）:**

```diff
 const addAnnotation = useCallback((type: FileAnnotation['type'], selectedText: string, defaultContent?: string) => {
   const id = uid();
   const ann: FileAnnotation = {
     id,
     type,
     file_path: filePath,
+    absolute_path: absolutePath,
     selected_text: selectedText.slice(0, 80),
     content: defaultContent,
+    textOffset: float?.textOffset ?? 0,
     author: 'user',
     timestamp: new Date().toISOString(),
     updatedAt: Date.now(),
     highlightRects: float?.rects,
     capturedScale: pdfScale,
   };
```

**2f. handleMouseUp — Range API 捕获 textOffset（第 329-354 行）:**

在 `const range = sel.getRangeAt(0);` 之后、`const rangeRect` 之前追加:

```typescript
    // Compute textOffset: character offset of selection start in rendered text
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const textOffset = preRange.toString().length;
```

在 `setFloat({` 中追加 `textOffset`:

```diff
     setFloat({
       x: e.clientX - containerRect.left + scrollLeft,
       y: e.clientY - containerRect.top + scrollTop - 40,
       selectionBottom: rangeRect.bottom - containerRect.top + scrollTop + 8,
       text,
       rects,
+      textOffset,
     });
```

**2g. handleSendSingle + handleSendAll — 用新函数（第 356-365 行）:**

```diff
+  const getRenderedText = useCallback(() => containerRef.current?.innerText ?? '', []);

   const handleSendSingle = useCallback((id: string) => {
     const ann = annotations.items.find((a) => a.id === id);
     if (ann) {
-      onSendToPrompt(`[File annotation: ${ann.type}] "${ann.selected_text}"${ann.content ? ` → ${ann.content}` : ''}`);
+      onSendToPrompt(buildSendPayload([ann], getRenderedText()));
     }
-  }, [annotations, onSendToPrompt]);
+  }, [annotations, onSendToPrompt, getRenderedText]);

   const handleSendAll = useCallback(() => {
-    onSendToPrompt(buildAnnotationText(annotations));
+    onSendToPrompt(buildSendPayload(annotations.items, getRenderedText()));
-  }, [annotations, onSendToPrompt]);
+  }, [annotations, onSendToPrompt, getRenderedText]);
```

### Step 3: 运行全量测试

Run: `cd packages/web && npx vitest run`
Expected: PASS

### Step 4: Commit

```bash
git add packages/web/src/components/FileViewerRender.tsx
git commit -m "feat(annotate): wire textOffset capture + JSONL send in FileViewerRender"
```

---

## Task 8: 清理 — 删除 `buildAnnotationText()`

**Files:**
- Modify: `packages/web/src/types/fileAnnotations.ts`

### Step 1: 确认无残留引用

Run: `grep -r 'buildAnnotationText' packages/web/src/ --include='*.ts' --include='*.tsx'`
Expected: 只剩 `fileAnnotations.ts` 中的定义。

### Step 2: 删除函数

删除 `fileAnnotations.ts` 中 `buildAnnotationText` 函数（原第 35-65 行）。

### Step 3: 运行全量测试

Run: `cd packages/web && npx vitest run`
Expected: PASS

### Step 4: Commit

```bash
git add packages/web/src/types/fileAnnotations.ts
git commit -m "refactor(annotate): remove deprecated buildAnnotationText"
```

---

## Task 9: 最终验证

### Step 1: 全量测试

Run: `cd packages/web && npx vitest run`
Expected: PASS

### Step 2: 类型检查

Run: `cd packages/web && npx tsc --noEmit`
Expected: 无类型错误

### Step 3: Final commit (fixups if needed)

---

## 变更总览

| Task | TDD | 文件 | 行为 |
|------|-----|------|------|
| 1 | R→G | `fileAnnotations.ts` | `isTaskSystemFile()` |
| 2 | R→G | `fileAnnotations.ts` | `resolveAbsolutePath()` |
| 3 | R→G | `fileAnnotations.ts` | `FileAnnotation` 硬升级 + `buildSingleAnnotationPrompt()` + `buildAnnotationPrompt()` |
| 4 | R→G | `fileAnnotations.ts` | `buildSendPayload()` — prefix 路由 |
| 5 | R→G | `fileAnnotations.ts` | `canEditFile()` — 编辑守卫 |
| 6 | 接线 | `FileViewer.tsx` | 使用 Task 2 + 5 的纯函数 |
| 7 | 接线 | `FileViewerRender.tsx` | textOffset 捕获 + 使用 Task 4 的 send 函数 |
| 8 | 清理 | `fileAnnotations.ts` | 删除 `buildAnnotationText()` |
| 9 | 验证 | — | 全量测试 + tsc |

**不变文件:** `FileAnnotationCard.tsx`, `FileSelectionFloat.tsx`, `FileAnnotationDropdown.tsx`, `annotationHighlight.ts`, `useAnnotationPersistence.ts`

**测试覆盖（36 cases）:**
- `isTaskSystemFile`: 6 cases
- `resolveAbsolutePath`: 6 cases
- `buildSingleAnnotationPrompt`: 7 cases（4 类型 + 边界 + 转义）
- `buildAnnotationPrompt`: 3 cases
- `buildSendPayload`: 5 cases（系统/一般 × 单条/批量 + 空）
- `canEditFile`: 8 cases（系统/一般 × 格式组合）
- ~~旧数据兼容: 删除~~
