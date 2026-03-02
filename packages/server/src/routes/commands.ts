import { Router, type IRouter } from 'express';

const router: IRouter = Router();

interface Command {
  name: string;
  label: string;
}

const COMMANDS: Command[] = [
  // task-ai lifecycle (init 已与 notebook 创建绑定，不单独暴露)
  { name: 'task-ai:target', label: 'define objectives' },
  { name: 'task-ai:research', label: 'deep research' },
  { name: 'task-ai:read', label: 'read & synthesize' },
  { name: 'task-ai:plan', label: 'generate plan' },
  { name: 'task-ai:check', label: 'check feasibility' },
  { name: 'task-ai:verify', label: 'run verification' },
  { name: 'task-ai:exec', label: 'execute plan' },
  { name: 'task-ai:auto', label: 'autonomous loop' },
  { name: 'task-ai:merge', label: 'merge branch' },
  { name: 'task-ai:list', label: 'list tasks' },
  { name: 'task-ai:library search', label: 'search library' },
  // git & commit
  { name: 'commit', label: 'git commit' },
  { name: 'commit-push-pr', label: 'commit + push + PR' },
  // code quality
  { name: 'simplify', label: 'simplify code' },
  { name: 'code-review:code-review', label: 'code review' },
];

router.get('/', (_req, res) => {
  res.json({ commands: COMMANDS });
});

export default router;
