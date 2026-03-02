import { Router, type IRouter } from 'express';

const router: IRouter = Router();

interface Command {
  name: string;
  label: string;
}

const COMMANDS: Command[] = [
  { name: 'task-ai:target', label: 'target define' },
  { name: 'task-ai:research', label: 'research' },
  { name: 'task-ai:read', label: 'read' },
  { name: 'task-ai:library search', label: 'search' },
];

router.get('/', (_req, res) => {
  res.json({ commands: COMMANDS });
});

export default router;
