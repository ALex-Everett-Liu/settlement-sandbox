// 热键模式在页面那一头：把标签挂到这一页真正能按的元素上。
// 这一份要碰 DOM，所以自检不跑它；它能算的东西（字母、缓冲）都在 hotkeys.ts 里，那边有自检。
import { expandRow, headCode, rowCode } from './hotkeys.ts';

/**
 * 一行里哪些东西算「一个口」。一个格子里有输入件，整格算一个口（激活时把焦点给格子里第一个输入件，
 * 颜色格那种一格两个输入件的合成一个口）；格子里没有输入件、只有按钮的，每个按钮各算一个口。
 * 于是行内的字母按格子从左到右数，据点表那一行是 a…r 十七到十八个。
 */
function rowTargets(tr: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const cell of tr.querySelectorAll<HTMLElement>('td')) {
    const field = cell.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea');
    if (field !== null) {
      out.push(cell);
      continue;
    }
    for (const button of cell.querySelectorAll<HTMLElement>('button')) out.push(button);
  }
  return out;
}

/**
 * 挂标签，并把这一页现有的全部标签报回去——按下键时靠这一串判「正好是一个」「还算半截」「没有这个」。
 *
 * 画哪一层不靠删属性：标签一直留在元素上，由 `data-hintrow` 与 `hint-digit`／`hint-on` 决定画不画。
 * 于是隐藏着的时候按下去照样找得到那一处，也不会出现「画的是这一层、认的是那一层」。
 *
 * 只动表头与表体：页签、表上方那一行、顶上一排、表末那一行的标签由 React 写在元素上，这里只读不写。
 */
export function markHints(root: HTMLElement, buffer: string): string[] {
  // 上一轮挂上去的先清掉（行、页码、排序一变，能按的地方就整批换了）。
  for (const el of root.querySelectorAll<HTMLElement>('thead [data-hint], tbody [data-hint]')) {
    delete el.dataset.hint;
    delete el.dataset.hintrow;
    el.classList.remove('hint-digit', 'hint-on');
  }

  // 表头：这一页能点的列，按列序给 ha、hb……
  root.querySelectorAll<HTMLElement>('thead th button').forEach((el, k) => {
    const code = headCode(k);
    if (code !== '') el.dataset.hint = code;
  });

  // 行内：第几行 + 行内第几个口。展开的那一行画字母，其余行画行首的数字。
  const rows = root.querySelectorAll<HTMLElement>('tbody tr');
  const expanded = expandRow(buffer, rows.length);
  rows.forEach((tr, i) => {
    rowTargets(tr).forEach((el, k) => {
      const code = rowCode(i + 1, k);
      if (code === '') return;
      el.dataset.hint = code;
      el.dataset.hintrow = String(i + 1);
      el.classList.toggle('hint-digit', buffer === '' && k === 0);
      el.classList.toggle('hint-on', expanded === i + 1);
    });
  });

  // 收齐这一页的全部标签（含 React 写的那几层），顺便把不以缓冲开头的那几个淡下去。
  const codes: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-hint]')) {
    const code = el.dataset.hint;
    if (code === undefined) continue;
    // 地图那一块在别的页签下挂在 .hidden 里（display: none）：它的四个控件不该算进这一页的标签。
    if (el.closest('.hidden') !== null) continue;
    codes.push(code);
    el.classList.toggle('hint-dim', buffer !== '' && !code.startsWith(buffer));
    // 展开了一行之后，第一层（页签、表上方、顶上、表头）就不是这一步要按的东西了，先收起来。
    if (expanded > 0 && el.dataset.hintrow === undefined) el.dataset.hintshow = 'off';
    else delete el.dataset.hintshow;
  }
  return codes;
}
