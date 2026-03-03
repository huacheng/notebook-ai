/**
 * D6: Centralized constants for the notebook-ai server.
 * Extracted from scattered magic numbers across the codebase.
 */

/** Number of cells to return on initial notebook load (rest are lazy-loaded) */
export const CELL_PAGE_SIZE = 2;

/** Maximum upload file size in bytes (20MB) */
export const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;

/** Timeout for cell load requests in milliseconds (30s) */
export const CELL_LOAD_TIMEOUT = 30_000;

/** Number of events to retain in buffer for WS resume */
export const EVENT_BUFFER_SIZE = 1000;

/** Allowed file extensions for upload */
export const ALLOWED_UPLOAD_EXTENSIONS = ['.zip', '.notebook.json', '.json'];

/** Maximum number of files per upload request */
export const MAX_UPLOAD_FILES = 5;

/** Ping interval for WebSocket keepalive (ms) */
export const WS_PING_INTERVAL = 10_000;

/** Pong timeout before considering connection dead (ms) */
export const WS_PONG_TIMEOUT = 4_000;
