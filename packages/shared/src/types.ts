import { z } from 'zod';

// ─── Cell Output Types ───

export const TextOutputSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const ToolUseOutputSchema = z.object({
  type: z.literal('tool_use'),
  tool_use_id: z.string().optional(),
  name: z.string(),
  input: z.record(z.unknown()),
  result: z.string().optional(),
  is_error: z.boolean().optional(),
  isActive: z.boolean().optional(), // For AskUserQuestion: true = waiting for answer, false = answered
  timestamp: z.string().optional(),
});

export const ErrorOutputSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  timestamp: z.string().optional(),
});

export const ChartOutputSchema = z.object({
  type: z.literal('chart'),
  chart_type: z.string(),
  data: z.unknown(),
  svg: z.string().optional(),
  timestamp: z.string().optional(),
});

export const ThinkingOutputSchema = z.object({
  type: z.literal('thinking'),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const CellOutputSchema = z.discriminatedUnion('type', [
  TextOutputSchema,
  ToolUseOutputSchema,
  ErrorOutputSchema,
  ChartOutputSchema,
  ThinkingOutputSchema,
]);

// ─── Cell Types ───

export const CellStatusSchema = z.enum([
  'idle',
  'pending',
  'running',
  'completed',
  'error',
  'interrupted',
]);

const BaseCellSchema = z.object({
  id: z.string(),
  execution_count: z.number().int().nonnegative().default(0),
  status: CellStatusSchema.default('idle'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const PromptImageSchema = z.object({
  media_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  data: z.string().max(20_000_000),  // D2: cap base64 image at ~20 MB
});
export type PromptImage = z.infer<typeof PromptImageSchema>;

// Image reference (path only, no embedded data - images stored in .images/ directory)
export const ImageRefSchema = z.object({
  path: z.string().max(1024),  // relative path in workspace, e.g. ".images/xxx.png"
});
export type ImageRef = z.infer<typeof ImageRefSchema>;

// ── Prompt Segment (append-to-running-cell model) ───────────────────────────
export const PromptSegmentSchema = z.object({
  text: z.string(),
  images: z.array(PromptImageSchema).optional(),
  image_refs: z.array(ImageRefSchema).optional(),
  addedAt: z.string(),
});
export type PromptSegment = z.infer<typeof PromptSegmentSchema>;

export const PromptCellSchema = BaseCellSchema.extend({
  type: z.literal('prompt'),
  source: z.string(),
  images: z.array(PromptImageSchema).optional(),        // deprecated: inline base64 images
  image_refs: z.array(ImageRefSchema).optional(),       // preferred: file paths in .images/
  segments: z.array(PromptSegmentSchema).optional(),
  outputs: z.array(CellOutputSchema).default([]),
  git_diff: z.string().optional(),
  duration_ms: z.number().optional(),
});

export const MarkdownCellSchema = BaseCellSchema.extend({
  type: z.literal('markdown'),
  source: z.string(),
});

export const VisualizationCellSchema = BaseCellSchema.extend({
  type: z.literal('visualization'),
  source: z.string(),
  data: z.unknown(),
  config: z.record(z.unknown()).optional(),
});

export const CellSchema = z.discriminatedUnion('type', [
  PromptCellSchema,
  MarkdownCellSchema,
  VisualizationCellSchema,
]);

// ─── Slide (类 PPTX 总结演示) ───

export const SlideSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  cell_refs: z.array(z.string()).default([]),
  order: z.number().int().default(0),
});

export const SlideSchema = z.object({
  generated: z.boolean().default(false),
  sections: z.array(SlideSectionSchema).default([]),
  updated_at: z.string().optional(),
});

// ─── Annotations (批注) ───

export const InsertAnnotationSchema = z.object({
  id: z.string(),
  type: z.literal('insert'),
  target_cell: z.string(),
  after_output_index: z.number().int(),
  content: z.string(),
  author: z.string().default('user'),
  timestamp: z.string(),
});

export const DeleteAnnotationSchema = z.object({
  id: z.string(),
  type: z.literal('delete'),
  target_cell: z.string(),
  output_indices: z.array(z.number().int()),
  selected_text: z.string(),
  author: z.string().default('user'),
  timestamp: z.string(),
});

export const ReplaceAnnotationSchema = z.object({
  id: z.string(),
  type: z.literal('replace'),
  target_cell: z.string(),
  output_indices: z.array(z.number().int()),
  selected_text: z.string(),
  replacement: z.string(),
  author: z.string().default('user'),
  timestamp: z.string(),
});

export const CommentAnnotationSchema = z.object({
  id: z.string(),
  type: z.literal('comment'),
  target_cell: z.string(),
  output_indices: z.array(z.number().int()),
  selected_text: z.string(),
  comment: z.string(),
  audio_base64: z.string().optional(),
  transcript: z.string().optional(),
  author: z.string().default('user'),
  timestamp: z.string(),
});

export const AnnotationSchema = z.discriminatedUnion('type', [
  InsertAnnotationSchema,
  DeleteAnnotationSchema,
  ReplaceAnnotationSchema,
  CommentAnnotationSchema,
]);

// ─── Assets ───

export const IntermediateFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  cell_ref: z.string().optional(),
});

export const AssetsSchema = z.object({
  intermediate_files: z.array(IntermediateFileSchema).default([]),
});

// ─── Notebook Metadata ───

export const NotebookMetadataSchema = z.object({
  title: z.string(),
  created: z.string(),
  updated: z.string().optional(),
  cwd: z.string().optional(),
  git_repo: z.boolean().default(false),
  tmux_session: z.string().optional(),
  project_id: z.string().optional(),
  worktree_path: z.string().optional(),
  branch: z.string().optional(),
  agent: z.enum(['claude', 'gemini']).default('claude'),
  model: z.string().optional(),
});

// ─── Notebook Index (v2 磁盘格式) ───

export const NotebookIndexSchema = z.object({
  version: z.literal(2),
  metadata: NotebookMetadataSchema,
  cell_ids: z.array(z.string()).default([]),
  slide: SlideSchema.default({ generated: false, sections: [] }),
  annotations: z.array(AnnotationSchema).default([]),
  assets: AssetsSchema.default({ intermediate_files: [] }),
});

// ─── Notebook (顶层文档) ───

export const NotebookSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).default(1),
  metadata: NotebookMetadataSchema,
  cells: z.array(CellSchema).default([]),
  slide: SlideSchema.default({ generated: false, sections: [] }),
  annotations: z.array(AnnotationSchema).default([]),
  assets: AssetsSchema.default({ intermediate_files: [] }),
});

// --- Project ---

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  status: z.enum(['active', 'archived']).default('active'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const ProjectListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'archived']),
  notebookCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── WebSocket Messages ───
//
// All session-scoped messages carry `session_id` so a single shared WebSocket
// connection can multiplex multiple notebook sessions.

// Client → Server: session management
export const SubscribeSchema = z.object({
  type: z.literal('subscribe'),
  session_id: z.string(),
  resume_after: z.number().int().optional(),
  skip_full_state: z.boolean().optional(),  // Skip sending full session_state on reconnect
});

export const UnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
  session_id: z.string(),
});

// Client → Server: session actions (all include session_id)
export const ExecuteRequestSchema = z.object({
  type: z.literal('execute_request'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string(),
  images: z.array(PromptImageSchema).optional(),        // deprecated: inline base64
  image_refs: z.array(ImageRefSchema).optional(),       // preferred: file paths
});

export const SaveNotebookSchema = z.object({
  type: z.literal('save_notebook'),
  session_id: z.string(),
  path: z.string(),
});

export const LoadNotebookSchema = z.object({
  type: z.literal('load_notebook'),
  session_id: z.string(),
  path: z.string(),
});

export const ExportHtmlSchema = z.object({
  type: z.literal('export_html'),
  session_id: z.string(),
  options: z.object({
    include_slide: z.boolean().default(true),
    include_replay: z.boolean().default(true),
    include_annotations: z.boolean().default(true),
  }).default({}),
});

export const SlideUpdateSchema = z.object({
  type: z.literal('slide_update'),
  session_id: z.string(),
  sections: z.array(SlideSectionSchema),
});

export const PingSchema = z.object({
  type: z.literal('ping'),
});

export const UpdateCellSourceSchema = z.object({
  type: z.literal('update_cell_source'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string().max(1_000_000),  // D2: cap cell source at 1 MB
});

// ── File Viewer messages ────────────────────────────────────────────────────

export const FileOpenSchema = z.object({
  type: z.literal('file-open'),
  session_id: z.string(),
  path: z.string(),
  source: z.enum(['workspace', 'library', 'deliverables']),
  project_id: z.string().optional(),
});

export const FileSaveSchema = z.object({
  type: z.literal('file-save'),
  session_id: z.string(),
  path: z.string(),
  source: z.enum(['workspace', 'library', 'deliverables']),
  content: z.string().max(10_000_000),  // D2: cap file save at 10 MB
  format: z.enum(['text', 'html']),
  project_id: z.string().optional(),
});

export const AnnotationLoadSchema = z.object({
  type: z.literal('annotation-load'),
  session_id: z.string(),
  path: z.string().max(2048),
});

export const AnnotationSyncSchema = z.object({
  type: z.literal('annotation-sync'),
  session_id: z.string(),
  path: z.string().max(2048),
  content: z.string().max(1_000_000),  // D2: cap annotation HTML at 1 MB
  updated_at: z.number(),
});

// Client → Server: restart session
export const RestartSessionSchema = z.object({
  type: z.literal('restart_session'),
  session_id: z.string(),
  clear: z.boolean().optional(), // clear: true → skipResume, truly clears Claude context
});

// Client → Server: load older cells (pagination)
export const LoadCellsSchema = z.object({
  type: z.literal('load_cells'),
  session_id: z.string(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200),
});

// Client → Server: remove cells (batch delete)
export const RemoveCellsSchema = z.object({
  type: z.literal('remove_cells'),
  session_id: z.string(),
  cell_ids: z.array(z.string()),
});

export const ChangeModelSchema = z.object({
  type: z.literal('change_model'),
  session_id: z.string(),
  model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),  // D2: alphanumeric model ID whitelist
});

// Client → Server: notebook open via WebSocket (request-response)
export const NotebookOpenSchema = z.object({
  type: z.literal('notebook_open'),
  request_id: z.string(),
  path: z.string(),
  lazy: z.boolean().optional(), // If true, return cell stubs instead of full cells
});

// Client → Server: load single cell (for lazy loading)
export const CellLoadSchema = z.object({
  type: z.literal('cell_load'),
  request_id: z.string(),
  session_id: z.string(),
  cell_id: z.string(),
});

// Client → Server: watch subscribe/unsubscribe (file & git change notifications)
export const WatchSubscribeSchema = z.object({
  type: z.literal('watch_subscribe'),
  watch_id: z.string(),
  kind: z.enum(['git', 'files']),
  project_id: z.string().optional(),
  dir_path: z.string().optional(),
});

export const WatchUnsubscribeSchema = z.object({
  type: z.literal('watch_unsubscribe'),
  watch_id: z.string(),
});

// Client → Server: git log via WebSocket (request-response)
export const GitLogRequestSchema = z.object({
  type: z.literal('git_log_request'),
  request_id: z.string(),
  project_id: z.string(),
  page: z.number().int().positive(),
  limit: z.number().int().positive().max(100),
  all: z.boolean().optional(),
  stats: z.boolean().optional(),
});

// Client → Server: git commit files via WebSocket (request-response)
export const GitCommitFilesRequestSchema = z.object({
  type: z.literal('git_commit_files_request'),
  request_id: z.string(),
  project_id: z.string(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/),  // D2: valid git commit hash
});

// Client → Server: git diff via WebSocket (request-response)
export const GitDiffRequestSchema = z.object({
  type: z.literal('git_diff_request'),
  request_id: z.string(),
  project_id: z.string(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/),  // D2: valid git commit hash
  file: z.string().optional(),
});

// Client → Server: library git commit files via WebSocket (request-response)
export const LibraryGitCommitFilesRequestSchema = z.object({
  type: z.literal('library_git_commit_files_request'),
  request_id: z.string(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/),
});

// Client → Server: library git diff via WebSocket (request-response)
export const LibraryGitDiffRequestSchema = z.object({
  type: z.literal('library_git_diff_request'),
  request_id: z.string(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/),
  file: z.string().optional(),
});

// ─── URL Capture ───

export const UrlCaptureRequestSchema = z.object({
  type: z.literal('url_capture'),
  session_id: z.string(),
  url: z.string().url(),
});

export const UrlCaptureResultSchema = z.object({
  type: z.literal('url_capture_result'),
  url: z.string(),
  file_path: z.string(),
  format: z.literal('image'),
  error: z.string().optional(),
});

// D3: autosave error notification
export const AutosaveErrorSchema = z.object({
  type: z.literal('autosave_error'),
  session_id: z.string().optional(),
  error: z.string(),
});

// ─── SuggestNextStep ───

export const SuggestNextStepSchema = z.object({
  suggestions: z.array(z.string()).min(1).max(4),
  context: z.string().optional(),
});

// ─── Prompt Append Message ───

export const AppendPromptSchema = z.object({
  type: z.literal('append_prompt'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string(),
  images: z.array(PromptImageSchema).optional(),
  image_refs: z.array(ImageRefSchema).optional(),
});

export const TimerStartSchema = z.object({
  type: z.literal('timer_start'),
  session_id: z.string(),
  interval_ms: z.number().min(10000).max(1800000).optional(),
});

export const TimerStopSchema = z.object({
  type: z.literal('timer_stop'),
  session_id: z.string(),
});

export const TaskStatusSubscribeSchema = z.object({
  type: z.literal('task_status_subscribe'),
  session_id: z.string(),
});

export const WSClientMessageSchema = z.discriminatedUnion('type', [
  SubscribeSchema,
  UnsubscribeSchema,
  ExecuteRequestSchema,
  SaveNotebookSchema,
  LoadNotebookSchema,
  ExportHtmlSchema,
  SlideUpdateSchema,
  PingSchema,
  UpdateCellSourceSchema,
  FileOpenSchema,
  FileSaveSchema,
  AnnotationLoadSchema,
  AnnotationSyncSchema,
  RestartSessionSchema,
  LoadCellsSchema,
  RemoveCellsSchema,
  ChangeModelSchema,
  WatchSubscribeSchema,
  WatchUnsubscribeSchema,
  NotebookOpenSchema,
  CellLoadSchema,
  GitLogRequestSchema,
  GitCommitFilesRequestSchema,
  GitDiffRequestSchema,
  LibraryGitCommitFilesRequestSchema,
  LibraryGitDiffRequestSchema,
  UrlCaptureRequestSchema,
  AppendPromptSchema,
  TimerStartSchema,
  TimerStopSchema,
  TaskStatusSubscribeSchema,
  z.object({ type: z.literal('rerun_notebook'), session_id: z.string() }),
  z.object({ type: z.literal('interrupt_cell'), session_id: z.string() }),
  z.object({
    type: z.literal('tool_result_response'),
    session_id: z.string(),
    tool_use_id: z.string(),
    content: z.string().max(1_000_000),
  }),
  z.object({
    type: z.literal('update_tool_result'),
    session_id: z.string(),
    cell_id: z.string(),
    tool_use_id: z.string(),
    content: z.string().max(1_000_000),
  }),
  z.object({ type: z.literal('notebook_sync_request'), session_id: z.string() }),
]);

// Server → Client: all session-scoped messages carry session_id
export const CellOutputMessageSchema = z.object({
  type: z.literal('cell_output'),
  session_id: z.string(),
  cell_id: z.string(),
  output: CellOutputSchema,
});

// Multi-device sync: broadcast when a new cell is created via execute_request
export const CellCreatedMessageSchema = z.object({
  type: z.literal('cell_created'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string(),
  images: z.array(PromptImageSchema).optional(),
  image_refs: z.array(ImageRefSchema).optional(),
});

// Multi-device sync: broadcast when cell status changes (e.g., running)
export const CellStatusMessageSchema = z.object({
  type: z.literal('cell_status'),
  session_id: z.string(),
  cell_id: z.string(),
  status: CellStatusSchema,
});

export const CellStreamMessageSchema = z.object({
  type: z.literal('cell_stream'),
  session_id: z.string(),
  cell_id: z.string(),
  delta: z.string(),
  block_type: z.enum(['text', 'thinking']),
});

export const ExecutionCompleteSchema = z.object({
  type: z.literal('execution_complete'),
  session_id: z.string(),
  cell_id: z.string(),
  duration_ms: z.number().optional(),
  status: z.enum(['completed', 'error', 'interrupted']).optional(),
});

export const PromptAcceptedSchema = z.object({
  type: z.literal('prompt_accepted'),
  session_id: z.string().optional(),
  cell_id: z.string(),
});

export const GitDiffMessageSchema = z.object({
  type: z.literal('git_diff'),
  session_id: z.string(),
  cell_id: z.string(),
  diff: z.string(),
  files_changed: z.array(z.string()).default([]),
});

export const ExportCompleteSchema = z.object({
  type: z.literal('export_complete'),
  session_id: z.string(),
  html: z.string(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  session_id: z.string().optional(), // optional: connection-level errors have no session
  message: z.string(),
  cell_id: z.string().optional(),
});

export const ToolResultMessageSchema = z.object({
  type: z.literal('tool_result'),
  session_id: z.string(),
  cell_id: z.string(),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});

export const PongSchema = z.object({
  type: z.literal('pong'),
});

export const SessionAlreadyOpenSchema = z.object({
  type: z.literal('session_already_open'),
  session_id: z.string(),
});

// ── Multi-device collaboration messages ───────────────────────────────────────

export const DeviceConnectedSchema = z.object({
  type: z.literal('device_connected'),
  session_id: z.string(),
  device_count: z.number().int().positive(),
});

export const DeviceDisconnectedSchema = z.object({
  type: z.literal('device_disconnected'),
  session_id: z.string(),
  device_count: z.number().int().nonnegative(),
});

export const DeviceLimitExceededSchema = z.object({
  type: z.literal('device_limit_exceeded'),
  max_devices: z.number().int().positive(),
  message: z.string(),
});

export const FileOpenMetaSchema = z.object({
  type: z.literal('file-open-meta'),
  session_id: z.string(),
  size: z.number(),
  mtime: z.number(),
  format: z.enum(['text', 'html', 'pdf-binary', 'docx-binary', 'xlsx-binary', 'pptx-binary', 'image', 'unsupported']),
});

export const FileChunkSchema = z.object({
  type: z.literal('file-chunk'),
  session_id: z.string(),
  data: z.string(),
  encoding: z.enum(['utf8', 'base64']),
});

export const FileOpenEndSchema = z.object({
  type: z.literal('file-open-end'),
  session_id: z.string(),
  mtime: z.number(),
});

export const FileOpenErrorSchema = z.object({
  type: z.literal('file-open-error'),
  session_id: z.string(),
  error: z.string(),
});

export const FileSaveOkSchema = z.object({
  type: z.literal('file-save-ok'),
  session_id: z.string(),
  mtime: z.number(),
});

export const FileSaveErrorSchema = z.object({
  type: z.literal('file-save-error'),
  session_id: z.string(),
  error: z.string(),
});

export const AnnotationDataSchema = z.object({
  type: z.literal('annotation-data'),
  session_id: z.string(),
  path: z.string(),
  content: z.string(),
  updated_at: z.number(),
});

export const AnnotationSyncOkSchema = z.object({
  type: z.literal('annotation-sync-ok'),
  session_id: z.string(),
  path: z.string(),
  updated_at: z.number(),
});

// Server → Client: session restart responses
export const SessionRestartedSchema = z.object({
  type: z.literal('session_restarted'),
  session_id: z.string(),
});

export const SessionRestartFailedSchema = z.object({
  type: z.literal('session_restart_failed'),
  session_id: z.string(),
  error: z.string(),
});

// Server → Client: cells loaded (pagination response, LZ4 compressed)
export const CellsLoadedSchema = z.object({
  type: z.literal('cells_loaded'),
  session_id: z.string(),
  // Either raw cells or compressed
  cells: z.array(CellSchema).optional(),
  cells_compressed: z.string().optional(), // Base64-encoded LZ4 compressed JSON
  compression: z.enum(['lz4']).optional(),
  offset: z.number().int().nonnegative(),
  count: z.number().int().nonnegative().optional(), // Number of cells in compressed payload
});

// Server → Client: cells removed responses
export const CellsRemovedSchema = z.object({
  type: z.literal('cells_removed'),
  session_id: z.string(),
  cell_ids: z.array(z.string()), // Multi-device sync: which cells were removed
});

export const CellsRemoveFailedSchema = z.object({
  type: z.literal('cells_remove_failed'),
  session_id: z.string(),
  error: z.string(),
});

// Server → Client: rerun responses
export const RerunStartedSchema = z.object({
  type: z.literal('rerun_started'),
  session_id: z.string(),
});

export const RerunFailedSchema = z.object({
  type: z.literal('rerun_failed'),
  session_id: z.string(),
  error: z.string(),
});

// Server → Client: cell interrupt response
export const CellInterruptedSchema = z.object({
  type: z.literal('cell_interrupted'),
  session_id: z.string(),
});

export const ModelChangedSchema = z.object({
  type: z.literal('model_changed'),
  session_id: z.string(),
  model: z.string(),
});

// Server → Client: forwarded system message (e.g. context compaction)
export const SystemMessageSchema = z.object({
  type: z.literal('system_message'),
  subtype: z.string(),
  message: z.string(),
  cell_id: z.string().optional(),
});

// Server → Client: notebook open responses
// Supports both compressed notebook (gzip) and lazy mode (cell_stubs)
export const CellStubSchema = z.object({
  id: z.string(),
  type: z.string(),
  source_preview: z.string(),
  output_count: z.number().int().nonnegative(),
  status: z.string(),
});

export const NotebookOpenedSchema = z.object({
  type: z.literal('notebook_opened'),
  request_id: z.string(),
  notebook_id: z.string(),
  session_id: z.string(),
  workspace_dir: z.string(),
  total_cells: z.number().int().nonnegative(),
  // Non-lazy mode: compressed notebook
  notebook: NotebookSchema.optional(),
  notebook_compressed: z.string().optional(), // gzip + base64
  // Lazy mode: metadata + stubs
  metadata: z.record(z.unknown()).optional(),
  cell_stubs: z.array(CellStubSchema).optional(),
  lazy: z.boolean().optional(),
});

export const NotebookOpenErrorSchema = z.object({
  type: z.literal('notebook_open_error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: cell load responses (for lazy loading)
export const CellLoadedSchema = z.object({
  type: z.literal('cell_loaded'),
  request_id: z.string(),
  cell_id: z.string(),
  cell_compressed: z.string(), // LZ4 + base64
  compression: z.literal('lz4'),
});

export const CellLoadErrorSchema = z.object({
  type: z.literal('cell_load_error'),
  request_id: z.string(),
  cell_id: z.string(),
  error: z.string(),
});

// Server → Client: git log responses
export const GitLogResponseSchema = z.object({
  type: z.literal('git_log_response'),
  request_id: z.string(),
  commits: z.array(z.unknown()),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

export const GitLogErrorSchema = z.object({
  type: z.literal('git_log_error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: git commit files responses
export const GitCommitFilesResponseSchema = z.object({
  type: z.literal('git_commit_files_response'),
  request_id: z.string(),
  files: z.array(z.object({
    path: z.string(),
    additions: z.number(),
    deletions: z.number(),
  })),
});

export const GitCommitFilesErrorSchema = z.object({
  type: z.literal('git_commit_files_error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: git diff responses
export const GitDiffResponseSchema = z.object({
  type: z.literal('git_diff_response'),
  request_id: z.string(),
  diff: z.string(),
});

export const GitDiffErrorSchema = z.object({
  type: z.literal('git_diff_error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: library git commit files responses
export const LibraryGitCommitFilesResponseSchema = z.object({
  type: z.literal('library-git-commit-files-response'),
  request_id: z.string(),
  files: z.array(z.object({
    path: z.string(),
    additions: z.number(),
    deletions: z.number(),
  })),
});

export const LibraryGitCommitFilesErrorSchema = z.object({
  type: z.literal('library-git-commit-files-error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: library git diff responses
export const LibraryGitDiffResponseSchema = z.object({
  type: z.literal('library-git-diff-response'),
  request_id: z.string(),
  diff: z.string(),
});

export const LibraryGitDiffErrorSchema = z.object({
  type: z.literal('library-git-diff-error'),
  request_id: z.string(),
  error: z.string(),
});

// Server → Client: watch change notifications
export const GitChangedSchema = z.object({
  type: z.literal('git_changed'),
  watch_id: z.string(),
  project_id: z.string(),
  latest_hash: z.string(),
  commits: z.array(z.unknown()).optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

export const FilesChangedSchema = z.object({
  type: z.literal('files_changed'),
  watch_id: z.string(),
  dir_path: z.string(),
  cache_key: z.string().optional(),
  files: z.object({
    dirPath: z.string(),
    files: z.array(z.object({
      name: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number(),
      modifiedAt: z.string(),
    }).passthrough()),
    truncated: z.boolean(),
  }).optional(),
});

// ─── Prompt Append Server Message ───

export const CellAppendedSchema = z.object({
  type: z.literal('cell_appended'),
  session_id: z.string(),
  cell_id: z.string(),
  segment: PromptSegmentSchema,
});

export const AppendPromptRedirectSchema = z.object({
  type: z.literal('append_prompt_redirect'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string(),
  images: z.array(z.unknown()).optional(),
  image_refs: z.array(z.unknown()).optional(),
});

// ─── Heartbeat Events ───

export const ProcessDeadSchema = z.object({
  type: z.literal('process_dead'),
  session_id: z.string(),
  cell_id: z.string(),
});

export const StuckExhaustedSchema = z.object({
  type: z.literal('stuck_exhausted'),
  session_id: z.string(),
  cell_id: z.string(),
  retries: z.number().int(),
});

export const ToolLongRunningSchema = z.object({
  type: z.literal('tool_long_running'),
  session_id: z.string(),
  cell_id: z.string(),
  elapsed_ms: z.number(),
  pending_tools: z.number().int(),
});

// ── Auto signal schema (Conversational Auto) ────────────────────────────────

export const CheckScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  d1_correctness: z.number().min(0).max(1),
  d2_security: z.number().min(0).max(1),
  d3_reliability: z.number().min(0).max(1),
  d4_performance: z.number().min(0).max(1),
  d5_architecture: z.number().min(0).max(1),
  d6_maintainability: z.number().min(0).max(1),
});

export const AutoSignalSchema = z.object({
  step: z.string(),
  result: z.string(),
  next: z.string(),
  checkpoint: z.string().optional(),
  iteration: z.number().int().nonnegative(),
  compaction_count: z.number().int().nonnegative().optional(),
  vfp_cycles_completed: z.number().int().nonnegative().optional(),
  phase: z.enum(['target', 'planning', 'execution', 'finalization']),
  phase_progress: z.number().min(0).max(1),
  stage: z.object({
    current: z.number().int().positive(),
    total: z.number().int().positive(),
  }).optional(),
  check_score: CheckScoreSchema.nullable(),
  retry_count: z.number().int().nonnegative(),
  delegation_failures: z.array(z.string()),
  timestamp: z.string(),
});

export const AutoStatusMessageSchema = z.object({
  type: z.literal('auto_status'),
  session_id: z.string(),
  phase: z.enum(['target', 'planning', 'execution', 'finalization']).nullable(),
  phase_progress: z.number().min(0).max(1).nullable(),
  step: z.string().nullable(),
  next: z.string().nullable(),
  stage: z.object({
    current: z.number().int().positive(),
    total: z.number().int().positive(),
  }).nullable(),
  check_score: CheckScoreSchema.nullable(),
  retry_count: z.number().int().nonnegative(),
  iteration: z.number().int().nonnegative(),
});

export const WSServerMessageSchema = z.discriminatedUnion('type', [
  CellOutputMessageSchema,
  CellCreatedMessageSchema,
  CellStatusMessageSchema,
  CellStreamMessageSchema,
  ExecutionCompleteSchema,
  PromptAcceptedSchema,
  GitDiffMessageSchema,
  ExportCompleteSchema,
  ErrorMessageSchema,
  SlideUpdateSchema,
  ToolResultMessageSchema,
  SessionAlreadyOpenSchema,
  DeviceConnectedSchema,
  DeviceDisconnectedSchema,
  DeviceLimitExceededSchema,
  PongSchema,
  FileOpenMetaSchema,
  FileChunkSchema,
  FileOpenEndSchema,
  FileOpenErrorSchema,
  FileSaveOkSchema,
  FileSaveErrorSchema,
  AnnotationDataSchema,
  AnnotationSyncOkSchema,
  SessionRestartedSchema,
  SessionRestartFailedSchema,
  CellsLoadedSchema,
  CellsRemovedSchema,
  CellsRemoveFailedSchema,
  RerunStartedSchema,
  RerunFailedSchema,
  CellInterruptedSchema,
  ModelChangedSchema,
  SystemMessageSchema,
  GitChangedSchema,
  FilesChangedSchema,
  NotebookOpenedSchema,
  NotebookOpenErrorSchema,
  CellLoadedSchema,
  CellLoadErrorSchema,
  GitLogResponseSchema,
  GitLogErrorSchema,
  GitCommitFilesResponseSchema,
  GitCommitFilesErrorSchema,
  GitDiffResponseSchema,
  GitDiffErrorSchema,
  LibraryGitCommitFilesResponseSchema,
  LibraryGitCommitFilesErrorSchema,
  LibraryGitDiffResponseSchema,
  LibraryGitDiffErrorSchema,
  UrlCaptureResultSchema,
  AutosaveErrorSchema,
  CellAppendedSchema,
  AppendPromptRedirectSchema,
  ProcessDeadSchema,
  StuckExhaustedSchema,
  ToolLongRunningSchema,
  AutoStatusMessageSchema,
  z.object({
    type: z.literal('task_status'),
    session_id: z.string(),
    status: z.unknown(),
  }),
  z.object({
    type: z.literal('timer_heartbeat'),
    session_id: z.string(),
    iteration: z.number(),
    interval_ms: z.number(),
  }),
  z.object({
    type: z.literal('timer_stopped'),
    session_id: z.string(),
    iteration_count: z.number().optional(),
  }),
  z.object({
    type: z.literal('timer_started'),
    session_id: z.string(),
    interval_ms: z.number().nullable().optional(),
  }),
  z.object({
    type: z.literal('timer_stopped_ack'),
    session_id: z.string(),
  }),
  z.object({
    type: z.literal('timer_paused'),
    session_id: z.string().optional(),
    reason: z.string(),
    resume_at: z.number(),
    cooldown_ms: z.number(),
  }),
  z.object({
    type: z.literal('timer_resumed'),
    session_id: z.string().optional(),
  }),
  z.object({
    type: z.literal('notebook_digest'),
    session_id: z.string(),
    cell_count: z.number(),
    last_cell_id: z.string().nullable(),
  }),
  z.object({
    type: z.literal('notebook_sync'),
    session_id: z.string(),
    notebook: NotebookSchema.optional(),
    notebook_compressed: z.string().optional(),
    compression: z.string().optional(),
  }),
  z.object({
    type: z.literal('session_state'),
    session_id: z.string(),
    notebook: NotebookSchema.optional(),
    notebook_compressed: z.string().optional(),
    compression: z.string().optional(),
  }),
  z.object({
    type: z.literal('session_state_chunk'),
    session_id: z.string(),
    chunk_index: z.number(),
    total_chunks: z.number(),
    data: z.string(),
    compression: z.string(),
  }),
  z.object({
    type: z.literal('session_ready'),
    session_id: z.string(),
  }),
  z.object({
    type: z.literal('cell_removed'),
    session_id: z.string().optional(),
    cell_id: z.string(),
  }),
]);

// ─── Notebook List / Workspace Types ───

export const NotebookListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
  cellCount: z.number().int().default(0),
  hasActiveSession: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkspaceInfoSchema = z.object({
  workspaceRoot: z.string(),
  notebookDir: z.string(),
  notebookPath: z.string(),
});

export const CreateNotebookRequestSchema = z.object({
  title: z.string().min(1),
  userId: z.string().optional(),
});

// ─── Export Options ───

export const ExportOptionsSchema = z.object({
  include_slide: z.boolean().default(true),
  include_replay: z.boolean().default(true),
  include_annotations: z.boolean().default(true),
  minify: z.boolean().default(false),
});

// ─── Inferred Types ───

export type TextOutput = z.infer<typeof TextOutputSchema>;
export type ToolUseOutput = z.infer<typeof ToolUseOutputSchema>;
export type ErrorOutput = z.infer<typeof ErrorOutputSchema>;
export type ChartOutput = z.infer<typeof ChartOutputSchema>;
export type ThinkingOutput = z.infer<typeof ThinkingOutputSchema>;
export type CellOutput = z.infer<typeof CellOutputSchema>;

export type CellStatus = z.infer<typeof CellStatusSchema>;
export type PromptCell = z.infer<typeof PromptCellSchema>;
export type MarkdownCell = z.infer<typeof MarkdownCellSchema>;
export type VisualizationCell = z.infer<typeof VisualizationCellSchema>;
export type Cell = z.infer<typeof CellSchema>;
export type CellType = Cell['type'];

export type SlideSection = z.infer<typeof SlideSectionSchema>;
export type Slide = z.infer<typeof SlideSchema>;

export type InsertAnnotation = z.infer<typeof InsertAnnotationSchema>;
export type DeleteAnnotation = z.infer<typeof DeleteAnnotationSchema>;
export type ReplaceAnnotation = z.infer<typeof ReplaceAnnotationSchema>;
export type CommentAnnotation = z.infer<typeof CommentAnnotationSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;

export type IntermediateFile = z.infer<typeof IntermediateFileSchema>;
export type Assets = z.infer<typeof AssetsSchema>;

export type NotebookMetadata = z.infer<typeof NotebookMetadataSchema>;
export type Notebook = z.infer<typeof NotebookSchema>;
export type NotebookIndex = z.infer<typeof NotebookIndexSchema>;

export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;
export type CellOutputMessage = z.infer<typeof CellOutputMessageSchema>;
export type CellCreatedMessage = z.infer<typeof CellCreatedMessageSchema>;
export type CellStatusMessage = z.infer<typeof CellStatusMessageSchema>;
export type CellStreamMessage = z.infer<typeof CellStreamMessageSchema>;
export type ExecutionComplete = z.infer<typeof ExecutionCompleteSchema>;
export type GitDiffMessage = z.infer<typeof GitDiffMessageSchema>;
export type SlideUpdate = z.infer<typeof SlideUpdateSchema>;
export type SaveNotebook = z.infer<typeof SaveNotebookSchema>;
export type LoadNotebook = z.infer<typeof LoadNotebookSchema>;
export type ExportHtml = z.infer<typeof ExportHtmlSchema>;
export type ExportComplete = z.infer<typeof ExportCompleteSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;
export type DeviceConnected = z.infer<typeof DeviceConnectedSchema>;
export type DeviceDisconnected = z.infer<typeof DeviceDisconnectedSchema>;
export type DeviceLimitExceeded = z.infer<typeof DeviceLimitExceededSchema>;
export type WSClientMessage = z.infer<typeof WSClientMessageSchema>;
export type WSServerMessage = z.infer<typeof WSServerMessageSchema>;
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export type FileOpen = z.infer<typeof FileOpenSchema>;
export type FileSave = z.infer<typeof FileSaveSchema>;
export type AnnotationLoad = z.infer<typeof AnnotationLoadSchema>;
export type AnnotationSync = z.infer<typeof AnnotationSyncSchema>;
export type FileOpenMeta = z.infer<typeof FileOpenMetaSchema>;
export type FileChunk = z.infer<typeof FileChunkSchema>;
export type FileOpenEnd = z.infer<typeof FileOpenEndSchema>;
export type FileOpenError = z.infer<typeof FileOpenErrorSchema>;
export type FileSaveOk = z.infer<typeof FileSaveOkSchema>;
export type FileSaveError = z.infer<typeof FileSaveErrorSchema>;
export type AnnotationData = z.infer<typeof AnnotationDataSchema>;
export type AnnotationSyncOk = z.infer<typeof AnnotationSyncOkSchema>;
export type RestartSession = z.infer<typeof RestartSessionSchema>;
export type SessionRestarted = z.infer<typeof SessionRestartedSchema>;
export type SessionRestartFailed = z.infer<typeof SessionRestartFailedSchema>;
export type LoadCells = z.infer<typeof LoadCellsSchema>;
export type CellsLoaded = z.infer<typeof CellsLoadedSchema>;

export type NotebookListItem = z.infer<typeof NotebookListItemSchema>;
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;
export type CreateNotebookRequest = z.infer<typeof CreateNotebookRequestSchema>;

export type WatchSubscribe = z.infer<typeof WatchSubscribeSchema>;
export type WatchUnsubscribe = z.infer<typeof WatchUnsubscribeSchema>;
export type GitChanged = z.infer<typeof GitChangedSchema>;
export type FilesChanged = z.infer<typeof FilesChangedSchema>;

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export type NotebookOpen = z.infer<typeof NotebookOpenSchema>;
export type NotebookOpened = z.infer<typeof NotebookOpenedSchema>;
export type NotebookOpenError = z.infer<typeof NotebookOpenErrorSchema>;
export type GitLogRequest = z.infer<typeof GitLogRequestSchema>;
export type GitLogResponse = z.infer<typeof GitLogResponseSchema>;
export type GitLogError = z.infer<typeof GitLogErrorSchema>;
export type GitCommitFilesRequest = z.infer<typeof GitCommitFilesRequestSchema>;
export type GitCommitFilesResponse = z.infer<typeof GitCommitFilesResponseSchema>;
export type GitCommitFilesError = z.infer<typeof GitCommitFilesErrorSchema>;
export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>;
export type GitDiffResponse = z.infer<typeof GitDiffResponseSchema>;
export type GitDiffError = z.infer<typeof GitDiffErrorSchema>;

export type UrlCaptureRequest = z.infer<typeof UrlCaptureRequestSchema>;
export type UrlCaptureResult = z.infer<typeof UrlCaptureResultSchema>;
export type SuggestNextStep = z.infer<typeof SuggestNextStepSchema>;

export type AutoSignal = z.infer<typeof AutoSignalSchema>;
export type CheckScore = z.infer<typeof CheckScoreSchema>;
export type AutoStatusMessage = z.infer<typeof AutoStatusMessageSchema>;
