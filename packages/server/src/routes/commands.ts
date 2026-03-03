import { Router, type IRouter } from 'express';

const router: IRouter = Router();

interface Command {
  name: string;
  label: string;
}

const COMMANDS: Command[] = [
  // task-ai lifecycle (init 已与 notebook 创建绑定，不单独暴露)
  { name: 'task-ai:target', label: 'Define task objectives and requirements in .target.md' },
  { name: 'task-ai:research', label: 'Deep research for objective refinement and feasibility' },
  { name: 'task-ai:read', label: 'Read documents and synthesize into .references/ files' },
  { name: 'task-ai:plan', label: 'Generate implementation plan from requirements' },
  { name: 'task-ai:check', label: 'Check plan feasibility at key checkpoints' },
  { name: 'task-ai:verify', label: 'Run domain-adapted tests and verification' },
  { name: 'task-ai:exec', label: 'Execute the implementation plan step by step' },
  { name: 'task-ai:auto', label: 'Autonomous loop: plan → check → exec cycle' },
  { name: 'task-ai:merge', label: 'Merge completed task branch to main' },
  { name: 'task-ai:list', label: 'Query task status, progress, and dependencies' },
  { name: 'task-ai:highlight', label: 'Distill experiences and insights into knowledge library' },
  { name: 'task-ai:library search', label: 'Search cross-task knowledge library' },
  // git & commit
  { name: 'commit', label: 'Create a git commit with staged changes' },
  { name: 'commit-push-pr', label: 'Commit, push to remote, and open a pull request' },
  // code quality
  { name: 'simplify', label: 'Review and simplify code for clarity and efficiency' },
  { name: 'code-review:code-review', label: 'Code review a pull request against standards' },
];

router.get('/', (_req, res) => {
  res.json({ commands: COMMANDS });
});

export default router;
