import { z } from 'zod';
import { registerTool } from '../registry';
import { mirrorTaskAdded } from '../../core/vault';
import { addTask, openTasks, completeTask, clearTasks } from '../../core/tasks';

// The task store now lives in core/tasks.ts (shared with the panel UI). This tool
// is just the LLM-facing front door onto it. core/tasks.save() handles the vault
// Tasks.md mirror; we still log adds into today's daily note here.

export function registerTaskTools(): void {
  registerTool({
    name: 'task.add',
    description: 'Add a to-do task',
    schema: z.object({ text: z.string() }),
    availableOffline: true,
    async execute(args) {
      addTask(args.text);
      mirrorTaskAdded(args.text); // also log it in today's daily note
      return { ok: true, summary: `Added task: "${args.text}" (${openTasks().length} open)` };
    },
  });

  registerTool({
    name: 'task.list',
    description: 'List open to-do tasks',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      const open = openTasks();
      if (!open.length) return { ok: true, summary: 'No open tasks. 🎉' };
      const lines = open.slice(0, 15).map((t, i) => `${i + 1}. ${t.text}`);
      return { ok: true, summary: `Tasks:\n${lines.join('\n')}` };
    },
  });

  registerTool({
    name: 'task.done',
    description: 'Mark a task complete by its list number (index) or by matching text',
    schema: z.object({ index: z.number().int().positive().optional(), text: z.string().optional() }),
    availableOffline: true,
    async execute(args) {
      const open = openTasks();
      let target = args.index
        ? open[args.index - 1]
        : args.text
          ? open.find((t) => t.text.toLowerCase().includes(args.text!.toLowerCase()))
          : undefined;
      if (!target) return { ok: false, error: 'not-found', userMessage: "Couldn't find that task." };
      completeTask(target.id);
      return { ok: true, summary: `Done: "${target.text}" (${openTasks().length} left)` };
    },
  });

  registerTool({
    name: 'task.clear',
    description: 'Clear completed tasks, or all tasks if allTasks is true',
    schema: z.object({ allTasks: z.boolean().default(false) }),
    availableOffline: true,
    async execute(args) {
      clearTasks(args.allTasks);
      return { ok: true, summary: args.allTasks ? 'Cleared all tasks.' : 'Cleared completed tasks.' };
    },
  });
}
