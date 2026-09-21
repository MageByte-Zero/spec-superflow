/**
 * spec-superflow plugin for OpenCode.ai
 *
 * Registers skills and adds a bounded pointer only inside an active change.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '../../skills');

export const SpecSuperflowPlugin = async (_opts) => {
  return {
    // Register skills directory so OpenCode discovers spec-superflow skills
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    // Inject bootstrap context into the first user message per session
    'experimental.chat.messages.transform': async (_input, output) => {
      // Skill discovery handles explicit requests. Ordinary sessions need no reminder.
      const directory = _opts?.directory;
      if (!directory) return;
      let state;
      try { state = fs.readFileSync(path.join(directory, '.spec-superflow.yaml'), 'utf8'); } catch { return; }
      if (!/^state:\s*(exploring|specifying|bridging|approved-for-build|executing|debugging)\s*$/m.test(state)) return;
      const bootstrap = 'Active spec-superflow change detected. Use workflow-start only when the user asks to continue this change.';
      if (!bootstrap || !output.messages.length) return;
      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;
      if (firstUser.parts.some(p => p.type === 'text' && p.text === bootstrap)) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },
  };
};
