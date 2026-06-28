// Parses and runs a command line against a ShellState. Supports simple quoting,
// pipes (|) and output redirects (>, >>). Everything is synchronous and local.

import {
  commands,
  initialState,
  type ShellState,
  type Token,
} from './commands';
import { lookup, resolvePath, splitPath } from './vfs';

export interface RunResult {
  tokens: Token[];
  clear?: boolean;
}

export interface Shell {
  state: ShellState;
  run(commandLine: string): RunResult;
}

/** Split a string into argv, honoring single and double quotes. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      has = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) {
        out.push(cur);
        cur = '';
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

function tokensToText(tokens: Token[]): string {
  return tokens.map((t) => t.text).join('');
}

/** Extract a trailing `> file` / `>> file` redirect from a stage's argv. */
function extractRedirect(argv: string[]): { argv: string[]; redirect?: { file: string; append: boolean } } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '>' || argv[i] === '>>') {
      const append = argv[i] === '>>';
      const file = argv[i + 1];
      return { argv: argv.slice(0, i), redirect: file ? { file, append } : undefined };
    }
  }
  return { argv };
}

export function createShell(opts: { cwd: string }): Shell {
  const state = initialState(opts.cwd);

  function run(commandLine: string): RunResult {
    const trimmed = commandLine.trim();
    if (trimmed === '') return { tokens: [] };
    state.history.push(trimmed);
    state.env.PWD = state.cwd;

    if (trimmed === 'clear') return { tokens: [], clear: true };

    const stages = trimmed.split('|').map((s) => s.trim());
    let stdin = '';
    let lastTokens: Token[] = [];

    for (let s = 0; s < stages.length; s++) {
      const rawArgv = tokenize(stages[s]);
      const { argv, redirect } = extractRedirect(rawArgv);
      const name = argv[0];
      if (!name) {
        return { tokens: [{ text: 'smixsh: syntax error near `|`\n', class: 'c-err' }] };
      }
      const cmd = commands[name];
      if (!cmd) {
        return {
          tokens: [
            { text: `${name}: command not found`, class: 'c-err' },
            { text: " — this is a simulated shell; type 'help' for what's available.\n", class: 'c-muted' },
          ],
        };
      }
      const tokens = cmd({ state, args: argv.slice(1), stdin });
      lastTokens = tokens;
      stdin = tokensToText(tokens);

      // Redirect this stage's output to a file instead of the screen/next stage.
      if (redirect) {
        const abs = resolvePath(redirect.file, state.cwd);
        const [parent, base] = splitPath(abs);
        const p = lookup(state.fs, parent);
        if (!p || p.type !== 'dir') {
          return { tokens: [{ text: `smixsh: ${redirect.file}: No such file or directory\n`, class: 'c-err' }] };
        }
        const existing = p.children[base];
        const prev = redirect.append && existing && existing.type === 'file' ? existing.content : '';
        p.children[base] = { type: 'file', content: prev + stdin };
        lastTokens = [];
        stdin = '';
      }
    }

    return { tokens: lastTokens };
  }

  return { state, run };
}
