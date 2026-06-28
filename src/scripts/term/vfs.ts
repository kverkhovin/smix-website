// A tiny in-memory virtual filesystem for the simulated shell.
// Everything lives in the visitor's browser — there is no real disk access.

export interface FileNode {
  type: 'file';
  content: string;
}

export interface DirNode {
  type: 'dir';
  children: Record<string, Node>;
}

export type Node = FileNode | DirNode;

const file = (content = ''): FileNode => ({ type: 'file', content });
const dir = (children: Record<string, Node> = {}): DirNode => ({
  type: 'dir',
  children,
});

export const HOME = '/home/visitor';

// Seed content reused across the page so cat/ls/grep act on real files and the
// smix demo has something to operate on.
const ORDERS_EX = `defmodule MyApp.Orders do
  def total(ctx, items) do
    Enum.reduce(items, 0, fn item, acc -> acc + item.price end)
  end
end
`;

const LEGACY_EX = `defmodule MyApp.Legacy do
  # smix:ignore unused — kept for backwards compat
  def legacy() do
    :ok
  end
end
`;

const MYAPP_EX = `defmodule MyApp do
  @moduledoc "Example application used by the smix demo."
end
`;

const MIX_EXS = `defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app, version: "0.1.0", elixir: "~> 1.16"]
  end
end
`;

const README_MD = `# my_app

An example Elixir project. Try:

    smix compile --branch
`;

// Build a fresh filesystem tree. Each shell instance gets its own copy so state
// (files created/removed) never leaks between terminals on the page.
export function createFs(): DirNode {
  return dir({
    home: dir({
      visitor: dir({
        '.bashrc': file('# visitor shell\nexport PS1="\\u@\\h:\\w$ "\n'),
        'README.md': file('Welcome! Type `help` to see what this shell can do.\n'),
        my_app: dir({
          'mix.exs': file(MIX_EXS),
          'README.md': file(README_MD),
          lib: dir({
            'my_app.ex': file(MYAPP_EX),
            my_app: dir({
              'orders.ex': file(ORDERS_EX),
              'legacy.ex': file(LEGACY_EX),
            }),
          }),
          test: dir({
            'my_app_test.exs': file(
              "defmodule MyAppTest do\n  use ExUnit.Case\n  test \"greets\" do\n    assert true\n  end\nend\n",
            ),
          }),
        }),
      }),
    }),
  });
}

// --- path helpers -------------------------------------------------------------

/** Normalize an absolute path: resolve `.` and `..`, collapse slashes. */
export function normalize(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

/** Resolve a (possibly relative, possibly ~) path against the current dir. */
export function resolvePath(input: string, cwd: string): string {
  let p = input.trim();
  if (p === '' || p === '~') return HOME;
  if (p === '~/' || p.startsWith('~/')) p = HOME + p.slice(1);
  if (!p.startsWith('/')) p = cwd + '/' + p;
  return normalize(p);
}

/** Display form of an absolute path, abbreviating the home dir to `~`. */
export function displayPath(absolute: string): string {
  if (absolute === HOME) return '~';
  if (absolute.startsWith(HOME + '/')) return '~' + absolute.slice(HOME.length);
  return absolute;
}

/** Look up a node by absolute path. Returns null if any segment is missing. */
export function lookup(fs: DirNode, absolute: string): Node | null {
  if (absolute === '/') return fs;
  const parts = normalize(absolute).split('/').filter(Boolean);
  let node: Node = fs;
  for (const part of parts) {
    if (node.type !== 'dir') return null;
    const next: Node | undefined = node.children[part];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Split an absolute path into [parentDir, baseName]. */
export function splitPath(absolute: string): [string, string] {
  const norm = normalize(absolute);
  const idx = norm.lastIndexOf('/');
  const parent = idx <= 0 ? '/' : norm.slice(0, idx);
  const base = norm.slice(idx + 1);
  return [parent, base];
}
