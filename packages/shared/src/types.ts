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
  data: z.string(),
});
export type PromptImage = z.infer<typeof PromptImageSchema>;

export const PromptCellSchema = BaseCellSchema.extend({
  type: z.literal('prompt'),
  source: z.string(),
  images: z.array(PromptImageSchema).optional(),
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

// ─── Slice (类 PPTX 总结演示) ───

export const SliceSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  cell_refs: z.array(z.string()).default([]),
  order: z.number().int().default(0),
});

export const SliceSchema = z.object({
  generated: z.boolean().default(false),
  sections: z.array(SliceSectionSchema).default([]),
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

// ─── Notebook (顶层文档) ───

export const NotebookSchema = z.object({
  version: z.number().int().default(1),
  metadata: NotebookMetadataSchema,
  cells: z.array(CellSchema).default([]),
  slice: SliceSchema.default({ generated: false, sections: [] }),
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
  images: z.array(PromptImageSchema).optional(),
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
    include_slice: z.boolean().default(true),
    include_replay: z.boolean().default(true),
    include_annotations: z.boolean().default(true),
  }).default({}),
});

export const SliceUpdateSchema = z.object({
  type: z.literal('slice_update'),
  session_id: z.string(),
  sections: z.array(SliceSectionSchema),
});

export const PingSchema = z.object({
  type: z.literal('ping'),
});

export const UpdateCellSourceSchema = z.object({
  type: z.literal('update_cell_source'),
  session_id: z.string(),
  cell_id: z.string(),
  source: z.string(),
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
  content: z.string(),
  format: z.enum(['text', 'html']),
  project_id: z.string().optional(),
});

export const AnnotationLoadSchema = z.object({
  type: z.literal('annotation-load'),
  session_id: z.string(),
  path: z.string(),
});

export const AnnotationSyncSchema = z.object({
  type: z.literal('annotation-sync'),
  session_id: z.string(),
  path: z.string(),
  content: z.string(),
  updated_at: z.number(),
});

// Client → Server: restart session
export const RestartSessionSchema = z.object({
  type: z.literal('restart_session'),
  session_id: z.string(),
});

// Client → Server: load older cells (pagination)
export const LoadCellsSchema = z.object({
  type: z.literal('load_cells'),
  session_id: z.string(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
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
  model: z.string(),
});

// Client → Server: notebook open via WebSocket (request-response)
export const NotebookOpenSchema = z.object({
  type: z.literal('notebook_open'),
  request_id: z.string(),
  path: z.string(),
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
  limit: z.number().int().positive(),
  all: z.boolean().optional(),
  stats: z.boolean().optional(),
});

// Client → Server: git commit files via WebSocket (request-response)
export const GitCommitFilesRequestSchema = z.object({
  type: z.literal('git_commit_files_request'),
  request_id: z.string(),
  project_id: z.string(),
  commit: z.string(),
});

// Client → Server: git diff via WebSocket (request-response)
export const GitDiffRequestSchema = z.object({
  type: z.literal('git_diff_request'),
  request_id: z.string(),
  project_id: z.string(),
  commit: z.string(),
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

// ─── SuggestNextStep ───

export const SuggestNextStepSchema = z.object({
  suggestions: z.array(z.string()).min(1).max(4),
  context: z.string().optional(),
});

export const WSClientMessageSchema = z.discriminatedUnion('type', [
  SubscribeSchema,
  UnsubscribeSchema,
  ExecuteRequestSchema,
  SaveNotebookSchema,
  LoadNotebookSchema,
  ExportHtmlSchema,
  SliceUpdateSchema,
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
  GitLogRequestSchema,
  GitCommitFilesRequestSchema,
  GitDiffRequestSchema,
  UrlCaptureRequestSchema,
  z.object({ type: z.literal('rerun_notebook'), session_id: z.string() }),
  z.object({ type: z.literal('interrupt_cell'), session_id: z.string() }),
  z.object({
    type: z.literal('tool_result_response'),
    session_id: z.string(),
    tool_use_id: z.string(),
    content: z.string(),
  }),
]);

// Server → Client: all session-scoped messages carry session_id
export const CellOutputMessageSchema = z.object({
  type: z.literal('cell_output'),
  session_id: z.string(),
  cell_id: z.string(),
  output: CellOutputSchema,
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

// Server → Client: cells loaded (pagination response)
export const CellsLoadedSchema = z.object({
  type: z.literal('cells_loaded'),
  session_id: z.string(),
  cells: z.array(CellSchema),
  offset: z.number().int().nonnegative(),
});

// Server → Client: cells removed responses
export const CellsRemovedSchema = z.object({
  type: z.literal('cells_removed'),
  session_id: z.string(),
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
export const NotebookOpenedSchema = z.object({
  type: z.literal('notebook_opened'),
  request_id: z.string(),
  notebook_id: z.string(),
  notebook: NotebookSchema,
  session_id: z.string(),
  workspace_dir: z.string(),
  total_cells: z.number().int().nonnegative(),
});

export const NotebookOpenErrorSchema = z.object({
  type: z.literal('notebook_open_error'),
  request_id: z.string(),
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

export const WSServerMessageSchema = z.discriminatedUnion('type', [
  CellOutputMessageSchema,
  CellStreamMessageSchema,
  ExecutionCompleteSchema,
  GitDiffMessageSchema,
  ExportCompleteSchema,
  ErrorMessageSchema,
  SliceUpdateSchema,
  ToolResultMessageSchema,
  SessionAlreadyOpenSchema,
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
  GitLogResponseSchema,
  GitLogErrorSchema,
  GitCommitFilesResponseSchema,
  GitCommitFilesErrorSchema,
  GitDiffResponseSchema,
  GitDiffErrorSchema,
  UrlCaptureResultSchema,
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
  include_slice: z.boolean().default(true),
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

export type SliceSection = z.infer<typeof SliceSectionSchema>;
export type Slice = z.infer<typeof SliceSchema>;

export type InsertAnnotation = z.infer<typeof InsertAnnotationSchema>;
export type DeleteAnnotation = z.infer<typeof DeleteAnnotationSchema>;
export type ReplaceAnnotation = z.infer<typeof ReplaceAnnotationSchema>;
export type CommentAnnotation = z.infer<typeof CommentAnnotationSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;

export type IntermediateFile = z.infer<typeof IntermediateFileSchema>;
export type Assets = z.infer<typeof AssetsSchema>;

export type NotebookMetadata = z.infer<typeof NotebookMetadataSchema>;
export type Notebook = z.infer<typeof NotebookSchema>;

export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;
export type CellOutputMessage = z.infer<typeof CellOutputMessageSchema>;
export type CellStreamMessage = z.infer<typeof CellStreamMessageSchema>;
export type ExecutionComplete = z.infer<typeof ExecutionCompleteSchema>;
export type GitDiffMessage = z.infer<typeof GitDiffMessageSchema>;
export type SliceUpdate = z.infer<typeof SliceUpdateSchema>;
export type SaveNotebook = z.infer<typeof SaveNotebookSchema>;
export type LoadNotebook = z.infer<typeof LoadNotebookSchema>;
export type ExportHtml = z.infer<typeof ExportHtmlSchema>;
export type ExportComplete = z.infer<typeof ExportCompleteSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;
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
