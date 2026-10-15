import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';

const formats: Record<string, string> = {
  CODE128: 'Code 128',
  EAN13: 'EAN-13',
  UPC: 'UPC-A',
  EAN8: 'EAN-8',
  CODE39: 'Code 39',
  ITF14: 'ITF-14',
  DATAMATRIX: 'Data Matrix',
};

export function mountBarcodeGenerators() {
  document.querySelectorAll<HTMLElement>('[data-barcode-generator]').forEach((root) => {
    if (root.dataset.mounted) return;
    root.dataset.mounted = 'true';

    const form = root.querySelector<HTMLFormElement>('[data-barcode-form]')!;
    const valueField = root.querySelector<HTMLInputElement>('[data-barcode-value]')!;
    const formatField = root.querySelector<HTMLSelectElement>('[data-barcode-format]')!;
    const svg = root.querySelector<SVGSVGElement>('[data-barcode-svg]')!;
    const error = root.querySelector<HTMLElement>('[data-barcode-error]')!;
    const name = root.querySelector<HTMLElement>('[data-barcode-name]')!;
    const downloads = [...root.querySelectorAll<HTMLButtonElement>('[data-barcode-download]')];

    const render = () => {
      const value = valueField.value.trim();
      const format = formatField.value;
      svg.replaceChildren();
      svg.removeAttribute('viewBox');
      svg.removeAttribute('preserveAspectRatio');
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      error.hidden = true;
      downloads.forEach((button) => (button.disabled = true));
      if (!value) {
        error.textContent = 'Enter a value to create a barcode.';
        error.hidden = false;
        return false;
      }
      try {
        if (format === 'DATAMATRIX') {
          const output = bwipjs.toSVG({
            bcid: 'datamatrix',
            text: value,
            scale: 4,
            padding: 12,
            backgroundcolor: 'FFFFFF',
            barcolor: '13151F',
          });
          const parsed = new DOMParser().parseFromString(output, 'image/svg+xml').documentElement;
          svg.setAttribute('viewBox', parsed.getAttribute('viewBox') ?? '0 0 160 160');
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          svg.setAttribute('width', parsed.getAttribute('width') ?? '160');
          svg.setAttribute('height', parsed.getAttribute('height') ?? '160');
          svg.innerHTML = parsed.innerHTML;
          name.textContent = formats[format];
          svg.setAttribute('aria-label', `${formats[format]} preview for ${value}`);
          downloads.forEach((button) => (button.disabled = false));
          return true;
        }
        JsBarcode(svg, value, {
          format,
          width: 2,
          height: 96,
          displayValue: true,
          font: 'Figtree',
          fontSize: 16,
          fontOptions: 'bold',
          textMargin: 8,
          margin: 18,
          lineColor: '#13151f',
          background: '#ffffff',
        });
        name.textContent = formats[format] ?? 'Barcode';
        svg.setAttribute('aria-label', `${formats[format] ?? 'Barcode'} preview for ${value}`);
        downloads.forEach((button) => (button.disabled = false));
        return true;
      } catch {
        error.textContent = `That value is not valid for ${formats[format] ?? 'this barcode format'}. Check the required length and characters, then try again.`;
        error.hidden = false;
        return false;
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      render();
    });
    valueField.addEventListener('input', render);
    formatField.addEventListener('change', render);

    root.querySelector<HTMLButtonElement>('[data-barcode-copy]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(valueField.value);
        const button = root.querySelector<HTMLButtonElement>('[data-barcode-copy]')!;
        const original = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(() => (button.textContent = original), 1200);
      } catch {
        error.textContent = 'Clipboard access is unavailable in this browser.';
        error.hidden = false;
      }
    });

    downloads.forEach((button) => button.addEventListener('click', async () => {
      if (!render()) return;
      const kind = button.dataset.barcodeDownload;
      const source = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
      let blob = svgBlob;
      let fileName = 'barcode.svg';
      if (kind === 'png') {
        const imageUrl = URL.createObjectURL(svgBlob);
        try {
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          const canvas = document.createElement('canvas');
          const scale = 3;
          canvas.width = image.width * scale;
          canvas.height = image.height * scale;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas unavailable');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG export failed')), 'image/png'));
          fileName = 'barcode.png';
        } catch {
          error.textContent = 'Could not make the PNG file. Try downloading the SVG instead.';
          error.hidden = false;
          return;
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));

    render();
  });
}
