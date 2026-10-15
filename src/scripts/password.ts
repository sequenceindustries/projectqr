const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/|~',
};

// Use rejection sampling so each character is selected without modulo bias.
function secureIndex(limit: number): number {
  if (limit < 1 || limit > 256) throw new Error('Invalid character set');
  const cutoff = Math.floor(256 / limit) * limit;
  const bytes = new Uint8Array(32);
  while (true) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) if (byte < cutoff) return byte % limit;
  }
}

function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function generate(length: number, sets: string[]): string {
  const all = sets.join('');
  if (!sets.length || !all.length) throw new Error('Choose at least one character type.');
  if (length < sets.length) throw new Error(`Choose at least ${sets.length} characters to include each selected type.`);
  const characters = sets.map((set) => set[secureIndex(set.length)]);
  while (characters.length < length) characters.push(all[secureIndex(all.length)]);
  return secureShuffle(characters).join('');
}

export function mountPasswordGenerators() {
  document.querySelectorAll<HTMLElement>('[data-password-generator]').forEach((root) => {
    if (root.dataset.mounted) return;
    root.dataset.mounted = 'true';

    const length = root.querySelector<HTMLInputElement>('[data-password-length]')!;
    const lengthOutput = root.querySelector<HTMLOutputElement>('[data-password-length-output]')!;
    const result = root.querySelector<HTMLOutputElement>('[data-password-result]')!;
    const error = root.querySelector<HTMLElement>('[data-password-error]')!;
    const copy = root.querySelector<HTMLButtonElement>('[data-password-copy]')!;
    const generateButton = root.querySelector<HTMLButtonElement>('[data-password-generate]')!;
    const checks = [...root.querySelectorAll<HTMLInputElement>('[data-password-set]')];
    const avoidLookalikes = root.querySelector<HTMLInputElement>('[data-password-avoid]')!;

    const generatePassword = () => {
      error.hidden = true;
      try {
        let sets = checks.filter((check) => check.checked).map((check) => CHARSETS[check.dataset.passwordSet as keyof typeof CHARSETS]);
        if (avoidLookalikes.checked) sets = sets.map((set) => set.replace(/[ilo01]/gi, ''));
        result.textContent = generate(Number(length.value), sets);
      } catch (cause) {
        result.textContent = '';
        error.textContent = cause instanceof Error ? cause.message : 'Could not generate a password.';
        error.hidden = false;
      }
    };

    length.addEventListener('input', () => {
      lengthOutput.value = `${length.value} characters`;
      generatePassword();
    });
    checks.forEach((check) => check.addEventListener('change', generatePassword));
    avoidLookalikes.addEventListener('change', generatePassword);
    generateButton.addEventListener('click', generatePassword);
    copy.addEventListener('click', async () => {
      if (!result.textContent) return;
      try {
        await navigator.clipboard.writeText(result.textContent);
        copy.textContent = 'Copied';
        window.setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      } catch {
        error.textContent = 'Clipboard access is unavailable. Select and copy the password instead.';
        error.hidden = false;
      }
    });

    generatePassword();
  });
}
