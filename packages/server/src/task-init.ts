import { writeFile, mkdir, readFile, appendFile, stat } from 'fs/promises';
import path from 'path';

export interface TaskStatusJson {
  title: string;
  type: string;
  status: 'draft' | 'planning' | 'review' | 'executing' | 're-planning' | 'evolving' | 'satisfied' | 'blocked' | 'cancelled';
  phase: string;
  completed_steps: number;
  created: string;
  updated: string;
  depends_on: string[];
  tags: string[];
  branch: string;
  worktree: string;
  stage: {
    current: number;
    history: { stage: number; commit: string; convergence: number }[];
  };
}

export async function initTaskWorkingDir(opts: {
  worktreePath: string;
  nbSlug: string;
  title: string;
  branchName: string;
}): Promise<TaskStatusJson> {
  const workingDir = path.join(opts.worktreePath, '.working');
  const now = new Date().toISOString();

  const index: TaskStatusJson = {
    title: opts.title,
    type: '',
    status: 'draft',
    phase: '',
    completed_steps: 0,
    created: now,
    updated: now,
    depends_on: [],
    tags: [],
    branch: opts.branchName,
    worktree: opts.worktreePath,
    stage: {
      current: 1,
      history: [],
    },
  };

  await writeFile(
    path.join(workingDir, '.status.json'),
    JSON.stringify(index, null, 2),
    'utf-8',
  );

  const targetMd = `# Task Target: ${opts.title}

## Objective
<!-- Describe the goal of this task -->

## Requirements
<!-- List specific requirements -->

## Constraints
<!-- Any constraints or limitations -->
`;

  await writeFile(path.join(workingDir, '.target.md'), targetMd, 'utf-8');

  return index;
}

const GITIGNORE_MARKER = '# task-ai temp files';

// Resolve template path relative to this file's compiled location (dist/)
// so it works in both dev (src/) and prod (dist/) contexts.
const GITIGNORE_TEMPLATE_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..', 'gitignore.template',
);

/** Read gitignore entries from template file at runtime (hot-updatable). */
async function getGitignoreBlock(): Promise<string> {
  try {
    const content = await readFile(GITIGNORE_TEMPLATE_PATH, 'utf-8');
    return `\n${GITIGNORE_MARKER}\n${content.endsWith('\n') ? content : content + '\n'}`;
  } catch {
    // Fallback if template file is missing
    return `\n${GITIGNORE_MARKER}\n.claude/\n.env\n`;
  }
}

export async function ensureLibrarySkeleton(
  workspacesRoot: string,
  projectPath: string,
): Promise<void> {
  const libDir = path.join(workspacesRoot, '.library');

  // Create skeleton directories
  await mkdir(path.join(libDir, '.changelog-archive'), { recursive: true });
  await mkdir(path.join(libDir, '.memory'), { recursive: true });

  // Create skeleton files (only if they don't exist)
  const filesToCreate: Array<[string, string]> = [
    [path.join(libDir, '.changelog'), ''],
    [
      path.join(libDir, '.master-index.md'),
      '# Master Index\n\n| File | Type | Summary |\n|------|------|---------|\n',
    ],
    [
      path.join(libDir, '.type-registry.md'),
      '# Type Registry\n\n| Type | Description |\n|------|-------------|\n',
    ],
  ];

  for (const [filePath, content] of filesToCreate) {
    try {
      await stat(filePath);
    } catch {
      await writeFile(filePath, content, 'utf-8');
    }
  }

  // Append gitignore entries to project .gitignore (idempotent)
  const gitignorePath = path.join(projectPath, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf-8');
  } catch {
    // file doesn't exist yet
  }

  if (!existing.includes(GITIGNORE_MARKER)) {
    const block =
      (existing && !existing.endsWith('\n') ? '\n' : '') +
      await getGitignoreBlock();
    await appendFile(gitignorePath, block, 'utf-8');
  }
}
