// Curated command set for the simulated shell. Each command returns an array of
// Tokens; the DOM controller renders token.text as a text node (XSS-safe) with
// the optional token.class applied for color.

import {
  createFs,
  displayPath,
  lookup,
  resolvePath,
  splitPath,
  type DirNode,
  type Node,
} from './vfs';

export interface Token {
  text: string;
  class?: string;
}

export interface ShellState {
  fs: DirNode;
  cwd: string; // absolute
  env: Record<string, string>;
  history: string[];
}

export interface CommandCtx {
  state: ShellState;
  args: string[];
  stdin: string; // text piped in from a previous command ('' if none)
}

export type Command = (ctx: CommandCtx) => Token[];

// --- helpers ------------------------------------------------------------------

const line = (text: string, cls?: string): Token => ({ text: text + '\n', class: cls });
const err = (text: string): Token => line(text, 'c-err');
const plain = (text: string): Token[] => text.split('\n').map((l, i, a) =>
  i === a.length - 1 && l === '' ? { text: '' } : line(l));

function dirOf(state: ShellState, path: string): DirNode | null {
  const node = lookup(state.fs, resolvePath(path, state.cwd));
  return node && node.type === 'dir' ? node : null;
}

function entriesText(node: DirNode, all: boolean): string[] {
  const names = Object.keys(node.children).filter((n) => all || !n.startsWith('.'));
  return names.sort();
}

// --- filesystem / navigation --------------------------------------------------

const ls: Command = ({ state, args }) => {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const all = flags.includes('a');
  const long = flags.includes('l');
  const targets = args.filter((a) => !a.startsWith('-'));
  const target = targets[0] ?? '.';
  const abs = resolvePath(target, state.cwd);
  const node = lookup(state.fs, abs);
  if (!node) return [err(`ls: cannot access '${target}': No such file or directory`)];
  if (node.type === 'file') return [line(target)];
  const names = entriesText(node, all);
  if (long) {
    return names.map((n) => {
      const child = node.children[n];
      const tag = child.type === 'dir' ? 'd' : '-';
      const size = child.type === 'file' ? child.content.length : 4096;
      return {
        text: `${tag}rwxr-xr-x  visitor  ${String(size).padStart(5)}  ${n}\n`,
        class: child.type === 'dir' ? 'c-prompt' : undefined,
      };
    });
  }
  if (names.length === 0) return [{ text: '' }];
  return names.map((n) => ({
    text: n + (node.children[n].type === 'dir' ? '/' : '') + '  ',
    class: node.children[n].type === 'dir' ? 'c-prompt' : undefined,
  })).concat([{ text: '\n' }]);
};

const cd: Command = ({ state, args }) => {
  const target = args[0] ?? '~';
  const abs = resolvePath(target, state.cwd);
  const node = lookup(state.fs, abs);
  if (!node) return [err(`cd: ${target}: No such file or directory`)];
  if (node.type !== 'dir') return [err(`cd: ${target}: Not a directory`)];
  state.cwd = abs;
  return [];
};

const pwd: Command = ({ state }) => [line(state.cwd)];

const catCmd: Command = ({ state, args }) => {
  if (args.length === 0) return [err('cat: missing file operand')];
  const out: Token[] = [];
  for (const target of args) {
    const node = lookup(state.fs, resolvePath(target, state.cwd));
    if (!node) {
      out.push(err(`cat: ${target}: No such file or directory`));
    } else if (node.type === 'dir') {
      out.push(err(`cat: ${target}: Is a directory`));
    } else {
      for (const l of node.content.replace(/\n$/, '').split('\n')) {
        out.push(highlightLine(l));
      }
    }
  }
  return out;
};

// Light syntax flourish: colorize comment lines (e.g. the smix:ignore comment).
function highlightLine(l: string): Token {
  const trimmed = l.trimStart();
  if (trimmed.startsWith('#')) return line(l, 'c-comment');
  return line(l);
}

const head: Command = ({ state, args }) => sliceLines(state, args, true);
const tail: Command = ({ state, args }) => sliceLines(state, args, false);

function sliceLines(state: ShellState, args: string[], fromTop: boolean): Token[] {
  let n = 10;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n') n = parseInt(args[++i] ?? '10', 10) || 10;
    else if (args[i].startsWith('-')) n = parseInt(args[i].slice(1), 10) || 10;
    else files.push(args[i]);
  }
  const target = files[0];
  if (!target) return [err('usage: head/tail [-n N] FILE')];
  const node = lookup(state.fs, resolvePath(target, state.cwd));
  if (!node || node.type !== 'file') return [err(`cannot open '${target}'`)];
  const lines = node.content.replace(/\n$/, '').split('\n');
  const chosen = fromTop ? lines.slice(0, n) : lines.slice(-n);
  return chosen.map((l) => line(l));
}

const tree: Command = ({ state, args }) => {
  const start = resolvePath(args[0] ?? '.', state.cwd);
  const root = lookup(state.fs, start);
  if (!root || root.type !== 'dir') return [err('tree: not a directory')];
  const out: Token[] = [line(displayPath(start), 'c-prompt')];
  const walk = (node: DirNode, prefix: string) => {
    const names = entriesText(node, false);
    names.forEach((n, i) => {
      const last = i === names.length - 1;
      const child = node.children[n];
      out.push({
        text: `${prefix}${last ? '└── ' : '├── '}${n}\n`,
        class: child.type === 'dir' ? 'c-prompt' : undefined,
      });
      if (child.type === 'dir') walk(child, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return out;
};

const mkdir: Command = ({ state, args }) => {
  if (!args[0]) return [err('mkdir: missing operand')];
  const abs = resolvePath(args[0], state.cwd);
  const [parent, base] = splitPath(abs);
  const p = lookup(state.fs, parent);
  if (!p || p.type !== 'dir') return [err(`mkdir: cannot create '${args[0]}': No such file or directory`)];
  if (p.children[base]) return [err(`mkdir: cannot create '${args[0]}': File exists`)];
  p.children[base] = { type: 'dir', children: {} };
  return [];
};

const touch: Command = ({ state, args }) => {
  if (!args[0]) return [err('touch: missing file operand')];
  const abs = resolvePath(args[0], state.cwd);
  const [parent, base] = splitPath(abs);
  const p = lookup(state.fs, parent);
  if (!p || p.type !== 'dir') return [err(`touch: cannot touch '${args[0]}': No such file or directory`)];
  if (!p.children[base]) p.children[base] = { type: 'file', content: '' };
  return [];
};

const rm: Command = ({ state, args }) => {
  const targets = args.filter((a) => !a.startsWith('-'));
  if (targets.length === 0) return [err('rm: missing operand')];
  const out: Token[] = [];
  for (const t of targets) {
    const abs = resolvePath(t, state.cwd);
    const [parent, base] = splitPath(abs);
    const p = lookup(state.fs, parent);
    if (!p || p.type !== 'dir' || !p.children[base]) {
      out.push(err(`rm: cannot remove '${t}': No such file or directory`));
      continue;
    }
    delete p.children[base];
  }
  return out;
};

const copyOrMove = (move: boolean): Command => ({ state, args }) => {
  const ps = args.filter((a) => !a.startsWith('-'));
  if (ps.length < 2) return [err(`${move ? 'mv' : 'cp'}: missing destination`)];
  const srcAbs = resolvePath(ps[0], state.cwd);
  const src = lookup(state.fs, srcAbs);
  if (!src) return [err(`${move ? 'mv' : 'cp'}: cannot stat '${ps[0]}': No such file or directory`)];
  const dstAbs = resolvePath(ps[1], state.cwd);
  let [parent, base] = splitPath(dstAbs);
  const dstNode = lookup(state.fs, dstAbs);
  if (dstNode && dstNode.type === 'dir') {
    parent = dstAbs;
    base = splitPath(srcAbs)[1];
  }
  const p = lookup(state.fs, parent);
  if (!p || p.type !== 'dir') return [err(`${move ? 'mv' : 'cp'}: target directory does not exist`)];
  p.children[base] = clone(src);
  if (move) {
    const [sp, sb] = splitPath(srcAbs);
    const sparent = lookup(state.fs, sp);
    if (sparent && sparent.type === 'dir') delete sparent.children[sb];
  }
  return [];
};

function clone(node: Node): Node {
  return node.type === 'file'
    ? { type: 'file', content: node.content }
    : { type: 'dir', children: Object.fromEntries(Object.entries(node.children).map(([k, v]) => [k, clone(v)])) };
}

const wc: Command = ({ state, args, stdin }) => {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const files = args.filter((a) => !a.startsWith('-'));
  const text = files.length
    ? (() => {
        const node = lookup(state.fs, resolvePath(files[0], state.cwd));
        return node && node.type === 'file' ? node.content : null;
      })()
    : stdin;
  if (text === null || text === undefined) return [err('wc: cannot read input')];
  const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  const chars = text.length;
  if (flags.includes('l')) return [line(String(lines))];
  if (flags.includes('w')) return [line(String(words))];
  if (flags.includes('c') || flags.includes('m')) return [line(String(chars))];
  return [line(`${String(lines).padStart(7)}${String(words).padStart(8)}${String(chars).padStart(8)}`)];
};

const grep: Command = ({ state, args, stdin }) => {
  const recursive = args.some((a) => a.startsWith('-') && a.includes('r'));
  const positional = args.filter((a) => !a.startsWith('-'));
  const pattern = positional[0];
  if (!pattern) return [err('usage: grep [-r] PATTERN [FILE]')];
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return [err(`grep: invalid pattern: ${pattern}`)];
  }
  const out: Token[] = [];
  const match = (text: string, label?: string) => {
    text.replace(/\n$/, '').split('\n').forEach((l) => {
      if (re.test(l)) out.push(line(label ? `${label}:${l}` : l));
    });
  };
  if (stdin && positional.length === 1) {
    match(stdin);
    return out.length ? out : [];
  }
  const collect = (abs: string, label: string) => {
    const node = lookup(state.fs, abs);
    if (!node) return;
    if (node.type === 'file') match(node.content, label);
    else if (recursive) {
      for (const [name, child] of Object.entries(node.children)) {
        const childLabel = label === '.' ? name : `${label}/${name}`;
        collect(abs + '/' + name, childLabel);
        void child;
      }
    }
  };
  const targets = positional.slice(1);
  if (targets.length === 0) targets.push('.');
  for (const t of targets) collect(resolvePath(t, state.cwd), t);
  return out;
};

// --- system / info ------------------------------------------------------------

const whoami: Command = () => [line('visitor')];
const hostname: Command = () => [line('smix')];
const uname: Command = ({ args }) =>
  args.includes('-a')
    ? [line('Linux smix 6.8.0-smix #1 SMP x86_64 GNU/Linux')]
    : [line('Linux')];
const dateCmd: Command = () => [line(new Date().toString())];
const echo: Command = ({ args, state }) =>
  [line(args.map((a) => a.replace(/^\$(\w+)$/, (_, k) => state.env[k] ?? '')).join(' '))];
const envCmd: Command = ({ state }) =>
  Object.entries(state.env).map(([k, v]) => line(`${k}=${v}`));
const historyCmd: Command = ({ state }) =>
  state.history.map((h, i) => line(`${String(i + 1).padStart(4)}  ${h}`));

const HELP_LINES: Array<[string, string]> = [
  ['ls / cd / pwd', 'list, change, print working directory'],
  ['cat / head / tail', 'print file contents'],
  ['tree', 'show a directory tree'],
  ['mkdir / touch / rm', 'create dirs/files, remove'],
  ['cp / mv', 'copy / move'],
  ['grep / wc', 'search / count (supports pipes: cat f | grep x)'],
  ['echo / env / whoami', 'misc'],
  ['uname / hostname / date', 'system info'],
  ['history / clear / man', 'shell utilities'],
  ['mix / smix', 'try: smix compile --branch'],
];

const help: Command = () => {
  const out: Token[] = [line('Available commands (a curated subset — not a full OS):', 'c-ok')];
  for (const [name, desc] of HELP_LINES) {
    out.push({ text: '  ' + name.padEnd(24), class: 'c-prompt' });
    out.push(line(desc));
  }
  out.push(line(''));
  out.push(line("Pipes (|) and redirects (>, >>) work. Try: cat ~/my_app/lib/my_app/legacy.ex"));
  return out;
};

const man: Command = ({ args }) => {
  if (!args[0]) return [err('What manual page do you want?')];
  return [
    line(`${args[0].toUpperCase()}(1)`, 'c-prompt'),
    line(`  This is a simulated shell. '${args[0]}' is summarized in 'help'.`),
  ];
};

// --- product demo (mix / smix) ------------------------------------------------

const WARN_CTX = (): Token[] => [
  { text: 'warning:', class: 'c-warn' },
  line(' variable "ctx" is unused'),
  line('  lib/my_app/orders.ex:42', 'c-muted'),
];

const mixCompile = (branch: boolean, ignore: boolean): Token[] => {
  if (ignore) {
    return [
      { text: '✓', class: 'c-ok' },
      line(' compiled · all warnings hidden', 'c-muted'),
    ];
  }
  if (branch) {
    return [
      { text: '✓', class: 'c-ok' },
      line(' compiled, showing warnings for your branch only'),
      ...WARN_CTX(),
      line('1 warning · 137 hidden', 'c-ok'),
    ];
  }
  return [
    ...WARN_CTX(),
    { text: 'warning:', class: 'c-warn' },
    line(' function legacy/0 is unused'),
    line('  lib/my_app/legacy.ex:7', 'c-muted'),
    line('… 137 more warnings', 'c-muted'),
  ];
};

const smix: Command = ({ args }) => {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === 'compile') {
    return mixCompile(rest.includes('--branch'), rest.includes('--ignore-warnings'));
  }
  if (sub === 'test') {
    return [line('....', 'c-muted'), line('4 tests, 0 failures', 'c-ok')];
  }
  if (sub === 'format') return [{ text: '✓', class: 'c-ok' }, line(' formatted 5 files')];
  if (!sub) return [line('smix — a wrapper for Elixir’s Mix. Try: smix compile --branch')];
  return [line(`smix: unknown task "${sub}". Try: compile, test, format`, 'c-muted')];
};

const mix: Command = (ctx) => {
  const { args } = ctx;
  if (args[0] === 'archive.install') {
    return [{ text: '✓', class: 'c-ok' }, line(' installed smix')];
  }
  if (args[0] === 'compile') return mixCompile(false, false);
  if (args[0] === 'test') return smix({ ...ctx, args: ['test'] });
  if (!args[0]) return [line('mix — Elixir build tool. (smix wraps it.)')];
  return [line(`mix: task "${args[0]}" not simulated here. Try: compile, test`, 'c-muted')];
};

// --- registry -----------------------------------------------------------------

export const commands: Record<string, Command> = {
  ls,
  cd,
  pwd,
  cat: catCmd,
  head,
  tail,
  tree,
  mkdir,
  touch,
  rm,
  cp: copyOrMove(false),
  mv: copyOrMove(true),
  wc,
  grep,
  whoami,
  hostname,
  uname,
  date: dateCmd,
  echo,
  env: envCmd,
  history: historyCmd,
  help,
  man,
  smix,
  mix,
};

export function initialState(cwdAbsolute: string): ShellState {
  return {
    fs: createFs(),
    cwd: cwdAbsolute,
    env: { USER: 'visitor', HOME: '/home/visitor', SHELL: '/bin/smixsh', PWD: cwdAbsolute, TERM: 'xterm-256color' },
    history: [],
  };
}

export { plain };
