type PlacedWord = { word: string; cells: number[] };
type Puzzle = { grid: string[][]; placed: PlacedWord[] };
const DIRECTIONS = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]] as const;

function parseWords(raw: string): string[] {
  const words = raw.split(/[\n,;]+/)
    .map((part) => part.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/gi, '').toUpperCase())
    .filter((word) => word.length >= 2);
  return [...new Set(words)];
}

function createPuzzle(words: string[], size: number, diagonal: boolean, backwards: boolean): Puzzle | null {
  const directions = DIRECTIONS.filter(([dr, dc]) => (diagonal || dr === 0 || dc === 0) && (backwards || dr >= 0 && dc >= 0 && !(dr === 0 && dc === 0)));
  for (let attempt = 0; attempt < 160; attempt++) {
    const grid = Array.from({ length: size }, () => Array<string>(size).fill(''));
    const placed: PlacedWord[] = [];
    let failed = false;
    for (const word of words) {
      let found: PlacedWord | null = null;
      for (let sample = 0; sample < 400 && !found; sample++) {
        const [dr, dc] = directions[Math.floor(Math.random() * directions.length)];
        const row = Math.floor(Math.random() * size);
        const col = Math.floor(Math.random() * size);
        const endRow = row + (word.length - 1) * dr;
        const endCol = col + (word.length - 1) * dc;
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;
        const cells: number[] = [];
        let fits = true;
        for (let i = 0; i < word.length; i++) {
          const r = row + i * dr;
          const c = col + i * dc;
          if (grid[r][c] && grid[r][c] !== word[i]) { fits = false; break; }
          cells.push(r * size + c);
        }
        if (fits) found = { word, cells };
      }
      if (!found) { failed = true; break; }
      found.cells.forEach((index, i) => { grid[Math.floor(index / size)][index % size] = word[i]; });
      placed.push(found);
    }
    if (!failed) {
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
        if (!grid[row][col]) grid[row][col] = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      }
      return { grid, placed };
    }
  }
  return null;
}

function renderGrid(target: HTMLElement, grid: string[][], size: number, answers: Set<number> = new Set()) {
  target.replaceChildren();
  target.style.setProperty('--grid-size', String(size));
  target.setAttribute('role', 'grid');
  grid.forEach((row, rowIndex) => row.forEach((letter, colIndex) => {
    const cell = document.createElement('div');
    const position = rowIndex * size + colIndex;
    cell.className = `puzzle-cell${answers.has(position) ? ' is-answer' : ''}`;
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `Row ${rowIndex + 1}, column ${colIndex + 1}: ${letter}${answers.has(position) ? ', answer' : ''}`);
    cell.textContent = letter;
    target.append(cell);
  }));
}

export function mountWordSearchMakers() {
  document.querySelectorAll<HTMLElement>('[data-wordsearch]').forEach((root) => {
    if (root.dataset.mounted) return;
    root.dataset.mounted = 'true';
    const input = root.querySelector<HTMLTextAreaElement>('[data-word-list]')!;
    const sizeInput = root.querySelector<HTMLSelectElement>('[data-grid-size]')!;
    const diagonal = root.querySelector<HTMLInputElement>('[data-diagonal]')!;
    const backwards = root.querySelector<HTMLInputElement>('[data-backwards]')!;
    const error = root.querySelector<HTMLElement>('[data-word-error]')!;
    const puzzleGrid = root.querySelector<HTMLElement>('[data-puzzle-grid]')!;
    const solutionGrid = root.querySelector<HTMLElement>('[data-solution-grid]')!;
    const wordList = root.querySelector<HTMLUListElement>('[data-puzzle-words]')!;
    const answerWords = root.querySelector<HTMLUListElement>('[data-answer-words]')!;
    const generate = root.querySelector<HTMLButtonElement>('[data-create-puzzle]')!;
    const print = root.querySelector<HTMLButtonElement>('[data-print-puzzle]')!;

    const build = () => {
      error.hidden = true;
      const words = parseWords(input.value);
      const size = Number(sizeInput.value);
      if (!words.length) { error.textContent = 'Enter at least two words, one per line.'; error.hidden = false; return; }
      if (words.length > 20) { error.textContent = 'Please use 20 words or fewer.'; error.hidden = false; return; }
      const tooLong = words.find((word) => word.length > size);
      if (tooLong) { error.textContent = `${tooLong} is longer than the ${size}-letter grid. Choose a larger grid or shorten that word.`; error.hidden = false; return; }
      const result = createPuzzle([...words].sort((a, b) => b.length - a.length), size, diagonal.checked, backwards.checked);
      if (!result) { error.textContent = 'Those words did not fit together. Try a larger grid or fewer words.'; error.hidden = false; return; }
      const answerCells = new Set(result.placed.flatMap((item) => item.cells));
      renderGrid(puzzleGrid, result.grid, size);
      renderGrid(solutionGrid, result.grid, size, answerCells);
      wordList.replaceChildren();
      answerWords.replaceChildren();
      words.forEach((word) => {
        const item = document.createElement('li');
        item.textContent = word;
        wordList.append(item);
      });
      result.placed.forEach((entry) => {
        const item = document.createElement('li');
        item.textContent = entry.word;
        answerWords.append(item);
      });
    };
    generate.addEventListener('click', build);
    print.addEventListener('click', () => window.print());
    build();
  });
}
