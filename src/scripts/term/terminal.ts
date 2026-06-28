// Turns every .term element on the page into an interactive simulated shell.
// Output is rendered with textContent (never innerHTML of user input) so echoed
// input can't inject markup.

import { commands, type Token } from './commands';
import { createShell, type Shell } from './shell';
import { displayPath, HOME, lookup, resolvePath } from './vfs';

const USER = 'visitor';
const HOSTPART = 'smix';

function span(text: string, cls?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function renderTokens(target: HTMLElement, tokens: Token[]): void {
  for (const t of tokens) {
    if (t.text === '') continue;
    target.appendChild(span(t.text, t.class));
  }
}

/** Build the colored prompt nodes into `target` (cleared first). */
function renderPrompt(target: HTMLElement, cwdAbs: string): void {
  target.textContent = '';
  target.appendChild(span(`${USER}@${HOSTPART}`, 'c-ok'));
  target.appendChild(span(':'));
  target.appendChild(span(displayPath(cwdAbs), 'c-prompt'));
  target.appendChild(span('$ '));
}

function completions(shell: Shell, input: string): string[] {
  const parts = input.split(/\s+/);
  const last = parts[parts.length - 1] ?? '';
  // First word → complete command names.
  if (parts.length <= 1) {
    return Object.keys(commands).filter((c) => c.startsWith(last)).sort();
  }
  // Otherwise complete a path in the relevant directory.
  const slash = last.lastIndexOf('/');
  const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
  const basePart = slash >= 0 ? last.slice(slash + 1) : last;
  const dirNode = lookup(shell.state.fs, resolvePath(dirPart || '.', shell.state.cwd));
  if (!dirNode || dirNode.type !== 'dir') return [];
  return Object.keys(dirNode.children)
    .filter((n) => n.startsWith(basePart) && !n.startsWith('.'))
    .map((n) => dirPart + n + (dirNode.children[n].type === 'dir' ? '/' : ''))
    .sort();
}

function initTerminal(root: HTMLElement): void {
  const output = root.querySelector<HTMLElement>('.term-output');
  const promptEl = root.querySelector<HTMLElement>('.term-prompt');
  const input = root.querySelector<HTMLInputElement>('.term-input');
  const screen = root.querySelector<HTMLElement>('.term-screen');
  if (!output || !promptEl || !input || !screen) return;

  const cwdAttr = root.dataset.cwd || '~';
  const cwdAbs = resolvePath(cwdAttr, HOME);
  const shell = createShell({ cwd: cwdAbs });

  // Hint line so visitors know the terminal is live.
  renderTokens(output, [{ text: "# type 'help' to try it\n", class: 'c-muted' }]);

  renderPrompt(promptEl, shell.state.cwd);

  let histIdx = shell.state.history.length;
  let draft = '';

  const scrollDown = () => {
    screen.scrollTop = screen.scrollHeight;
  };

  // Show the live prompt on load even when the initial scrollback overflows.
  scrollDown();

  const submit = () => {
    const cmd = input.value;
    // Echo the entered line into the scrollback.
    const echo = document.createElement('div');
    echo.className = 'tline';
    renderPromptInto(echo, shell.state.cwd);
    echo.appendChild(span(cmd));
    output.appendChild(echo);

    const result = shell.run(cmd);
    if (result.clear) {
      output.textContent = '';
    } else {
      renderTokens(output, result.tokens);
    }
    input.value = '';
    histIdx = shell.state.history.length;
    draft = '';
    renderPrompt(promptEl, shell.state.cwd);
    scrollDown();
  };

  // Same as renderPrompt but appends to an arbitrary node (for echoed lines).
  function renderPromptInto(node: HTMLElement, cwd: string) {
    node.appendChild(span(`${USER}@${HOSTPART}`, 'c-ok'));
    node.appendChild(span(':'));
    node.appendChild(span(displayPath(cwd), 'c-prompt'));
    node.appendChild(span('$ '));
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx === shell.state.history.length) draft = input.value;
      if (histIdx > 0) {
        histIdx--;
        input.value = shell.state.history[histIdx];
        moveCaretToEnd(input);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < shell.state.history.length) {
        histIdx++;
        input.value = histIdx === shell.state.history.length ? draft : shell.state.history[histIdx];
        moveCaretToEnd(input);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const matches = completions(shell, input.value);
      if (matches.length === 1) {
        const parts = input.value.split(/\s+/);
        parts[parts.length - 1] = matches[0];
        input.value = parts.join(' ');
      } else if (matches.length > 1) {
        const echo = document.createElement('div');
        echo.className = 'tline';
        renderPromptInto(echo, shell.state.cwd);
        echo.appendChild(span(input.value));
        output.appendChild(echo);
        renderTokens(output, [{ text: matches.join('   ') + '\n', class: 'c-muted' }]);
        scrollDown();
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      output.textContent = '';
    }
  });

  // Clicking anywhere in the terminal focuses the input (unless selecting text).
  root.addEventListener('mousedown', (e) => {
    if (window.getSelection()?.toString()) return;
    if (e.target !== input) {
      // Defer so a click that starts a selection still works.
      setTimeout(() => input.focus(), 0);
    }
  });
}

function moveCaretToEnd(input: HTMLInputElement): void {
  const len = input.value.length;
  requestAnimationFrame(() => input.setSelectionRange(len, len));
}

function initAll(): void {
  document.querySelectorAll<HTMLElement>('.term').forEach(initTerminal);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}
