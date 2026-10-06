import type { QrType } from '../../shared/qr/payload';

/**
 * Tool registry — the single source of truth for every tool page.
 * Routing, the sitemap, cards, related links, internal-link prompts and
 * structured data are all derived from this list.
 */

export interface Faq {
  q: string;
  a: string;
}

export type ToolUi =
  | { kind: 'generator'; types?: QrType[]; type?: QrType; design?: 'closed' | 'open' | 'inline'; caption?: string; action?: string }
  | { kind: 'scanner' }
  | { kind: 'reader' }
  | { kind: 'batch' };

export interface Tool {
  slug: string;
  /** Short name for cards and navigation. */
  name: string;
  blurb: string;
  h1: string;
  /** <title>, ≤ 60 chars. */
  title: string;
  /** Meta description, ≤ 160 chars. */
  description: string;
  intro: string;
  ui: ToolUi;
  howTo: { title: string; steps: string[] };
  explainer: { heading: string; body: string[] }[];
  faqs: Faq[];
  related: string[];
  /** Contextual prompts linking to other tools: "Need a Wi-Fi QR code?" → /wifi-qr-code */
  prompts: { q: string; slug: string }[];
}

export const tools: Tool[] = [
  {
    slug: 'qr-code-generator',
    name: 'QR Code Generator',
    blurb: 'Links, text, Wi-Fi, contacts and more.',
    h1: 'Free QR code generator',
    title: 'Free QR Code Generator — No Sign-up | QR Tools',
    description:
      'Create QR codes for links, text, Wi-Fi, contacts, email, phone, SMS, WhatsApp and locations. Customise and download PNG or SVG. Free, no account.',
    intro: 'Make a QR code for a link, Wi-Fi network, contact card, message and more. It appears as you type, and you can download it as PNG, SVG or JPG.',
    ui: { kind: 'generator' },
    howTo: {
      title: 'How to create a QR code',
      steps: [
        'Choose what the QR code should contain: a link, text, Wi-Fi details, a contact card, an email, a phone number, a text message, a WhatsApp chat or a location.',
        'Fill in the details. Your QR code appears and updates as you type.',
        'Open “Customise design” to change colours, the pattern, the corners or add your logo.',
        'Check the green “Scan check passed” message, then download PNG for screens or SVG for print.',
      ],
    },
    explainer: [
      {
        heading: 'Static QR codes that never expire',
        body: [
          'Every QR code made here is static: the link, text or details are stored inside the code itself. There is no redirect server in the middle, so the code keeps working for as long as the link it points to does. It can’t be switched off, it doesn’t count your scans, and nobody can change where it goes after you print it.',
          'Because the content is fixed, double-check it before printing. If you need to change a link later, update the page at that address rather than the QR code.',
        ],
      },
      {
        heading: 'Every code is scan-checked before you download it',
        body: [
          'Colours, rounded patterns and logos are fun, but they can make a code hard to read. After each change we decode the QR code again, the same way a phone camera would, and tell you if it no longer reads. If the colours are too similar, you’ll see a warning before you can download.',
          'For the most reliable results: keep the code dark on a light background, leave clear space around it, and print it at least 2 × 2 cm (about 0.8 inches) — larger if people will scan it from a distance.',
        ],
      },
      {
        heading: 'Private by design',
        body: [
          'Your QR code is generated in your browser. What you type — links, Wi-Fi passwords, contact details — is never sent to our server or stored. You can even disconnect from the internet after the page loads and keep making codes.',
        ],
      },
    ],
    faqs: [
      { q: 'Is this QR code generator really free?', a: 'Yes. There is no account, no trial, no watermark and no limit on how many QR codes you make. The codes are static, so they never expire.' },
      { q: 'Do the QR codes expire?', a: 'No. The content is stored inside the code itself, so it works forever. A link QR code only stops working if the web page it points to goes offline.' },
      { q: 'Should I download PNG or SVG?', a: 'PNG works everywhere: documents, slides, websites and social posts. SVG is a vector file that stays perfectly sharp at any size, so it is the best choice for printing and for designers.' },
      { q: 'How big should I print a QR code?', a: 'At least 2 × 2 cm (0.8 × 0.8 in) for something held in the hand, like a business card or menu. A good rule is that the code should be about one tenth of the scanning distance: 30 cm wide for a poster read from 3 metres.' },
      { q: 'Can I track how many people scan my QR code?', a: 'Not with a static QR code, and that’s deliberate: nothing sits between the code and its destination. If you link to your own website, your website analytics will show the visits.' },
      { q: 'Is my information sent to your server?', a: 'No. QR codes are generated in your browser, and what you type is never uploaded or stored. We only count anonymous events such as “a PNG was downloaded”, never what the code contains.' },
    ],
    related: ['custom-qr-code', 'wifi-qr-code', 'vcard-qr-code', 'qr-code-scanner'],
    prompts: [
      { q: 'Need a Wi-Fi QR code?', slug: 'wifi-qr-code' },
      { q: 'Want to scan an existing QR?', slug: 'qr-code-scanner' },
      { q: 'Want to add a logo?', slug: 'custom-qr-code' },
      { q: 'Making lots of codes?', slug: 'batch-qr-code' },
    ],
  },
  {
    slug: 'qr-code-scanner',
    name: 'QR Code Scanner',
    blurb: 'Scan with your camera or an image.',
    h1: 'QR code scanner',
    title: 'QR Code Scanner Online — Scan with Camera | QR Tools',
    description: 'Scan QR codes with your phone or laptop camera, or upload a screenshot. See the link, Wi-Fi password or contact before you open it. Free and private.',
    intro: 'Scan a QR code with your camera, or upload, drag or paste an image of one. You see exactly what’s inside — and can check a link — before you open anything.',
    ui: { kind: 'scanner' },
    howTo: {
      title: 'How to scan a QR code online',
      steps: [
        'Tap “Scan with camera” and allow camera access when your browser asks.',
        'Hold the QR code inside the frame. It scans automatically, usually in under a second.',
        'Read the result: a link, a Wi-Fi network, a contact card, text and so on.',
        'Copy it, or use the button to open the link, join the network, call or save the contact.',
      ],
    },
    explainer: [
      {
        heading: 'See where a QR code goes before you open it',
        body: [
          'Fake QR codes stuck over real ones on parking meters, posters and restaurant tables are a common scam. This scanner never opens anything by itself: it shows you the full link first, with the website name, so you can decide whether you trust it.',
        ],
      },
      {
        heading: 'Your camera stays on your device',
        body: [
          'The camera only starts after you tap the button and give permission, and it switches off as soon as a code is found or you leave the page. Video frames are analysed on your device and are never uploaded, recorded or stored.',
          'No camera, or would rather not use it? Upload a screenshot or photo, drag it onto the page, or paste it from your clipboard.',
        ],
      },
    ],
    faqs: [
      { q: 'Why doesn’t the camera start?', a: 'Your browser needs permission to use the camera. If you blocked it earlier, allow it in the site settings (the icon next to the address bar) and reload. Some laptops and in-app browsers have no camera access at all — upload an image instead.' },
      { q: 'Can I scan a QR code from a screenshot?', a: 'Yes. Upload the screenshot, drag it onto the scanner, or copy it and press Ctrl+V (⌘+V on Mac). The QR Code Reader page is built for exactly this.' },
      { q: 'Does it work with Wi-Fi QR codes?', a: 'Yes. The scanner shows the network name, password and security type, with buttons to copy them.' },
      { q: 'Is a QR code scanner safe to use?', a: 'This one never opens links automatically and never uploads your camera feed. Always look at the website name before opening a link from a QR code you found in public.' },
      { q: 'Why can’t it find my QR code?', a: 'Move closer so the code fills more of the frame, make sure it’s in focus and evenly lit, and avoid glare. Very damaged, tiny or low-contrast codes may not be readable.' },
    ],
    related: ['qr-code-reader', 'qr-code-generator', 'wifi-qr-code'],
    prompts: [
      { q: 'Have a screenshot instead?', slug: 'qr-code-reader' },
      { q: 'Want to make your own QR code?', slug: 'qr-code-generator' },
    ],
  },
  {
    slug: 'qr-code-reader',
    name: 'QR Code Reader',
    blurb: 'Read a QR code from an image.',
    h1: 'QR code reader',
    title: 'QR Code Reader — Read a QR Code from an Image | QR Tools',
    description: 'Upload a screenshot or photo to read the QR code inside it. See the link, text, Wi-Fi details or contact, then copy or open it. Free, private, no app.',
    intro: 'Got a QR code in a screenshot, PDF export or photo? Upload it, drop it here or paste it, and read what’s inside without picking up another phone.',
    ui: { kind: 'reader' },
    howTo: {
      title: 'How to read a QR code from an image',
      steps: [
        'Take a screenshot or save the image that contains the QR code.',
        'Upload it, drag it onto the box, or paste it with Ctrl+V (⌘+V on Mac).',
        'The code is read in your browser in a moment.',
        'Copy the result or open the link once you’ve checked it.',
      ],
    },
    explainer: [
      {
        heading: 'Read QR codes on the same screen',
        body: [
          'QR codes are made for phones, which is awkward when the code is already on your phone or laptop screen. The reader decodes the image directly: no second device, no app to install.',
          'It works with PNG, JPG, WebP, GIF and most other image formats, including photos where the code is small, rotated or off-centre.',
        ],
      },
      {
        heading: 'Images stay private',
        body: ['Images are read in your browser and never uploaded to a server. Nothing is stored after you leave the page.'],
      },
    ],
    faqs: [
      { q: 'Which image types can I upload?', a: 'Any image your browser can open: PNG, JPG, WebP, GIF, BMP and SVG, plus AVIF in modern browsers and HEIC in Safari. Images up to 15 MB.' },
      { q: 'Can it read a QR code inside a larger photo?', a: 'Yes, as long as the code is reasonably sharp. If it fails, crop the image closer to the code and try again.' },
      { q: 'Can I read more than one QR code at once?', a: 'The reader returns the clearest code in the image. To read another, crop to it or upload it separately.' },
      { q: 'Is the image uploaded anywhere?', a: 'No. It is decoded on your device and discarded when you leave the page.' },
    ],
    related: ['qr-code-scanner', 'qr-code-generator', 'custom-qr-code'],
    prompts: [
      { q: 'Want to scan with your camera?', slug: 'qr-code-scanner' },
      { q: 'Need to create a QR code?', slug: 'qr-code-generator' },
    ],
  },
  {
    slug: 'wifi-qr-code',
    name: 'Wi-Fi QR Code',
    blurb: 'Let guests join without typing.',
    h1: 'Wi-Fi QR code generator',
    title: 'WiFi QR Code Generator — Share Wi-Fi Instantly | QR Tools',
    description: 'Make a QR code that connects guests to your Wi-Fi without typing the password. Works with iPhone and Android cameras. Free, and your password stays private.',
    intro: 'Enter your network name and password, then print or share the code. Guests point their camera at it and join — no spelling out passwords.',
    ui: { kind: 'generator', types: ['wifi'], type: 'wifi', caption: 'Scan to connect to Wi-Fi', action: 'Generate Wi-Fi QR code' },
    howTo: {
      title: 'How to make a Wi-Fi QR code',
      steps: [
        'Type your Wi-Fi network name (SSID) exactly as it appears on your devices, including capital letters.',
        'Choose the security type — almost all home and office networks use WPA/WPA2 — and enter the password.',
        'Download the QR code and print it, or show it on a screen.',
        'Guests open their camera app, point it at the code and tap “Join”.',
      ],
    },
    explainer: [
      {
        heading: 'Where to find your network name and password',
        body: [
          'Both are usually printed on a sticker on your router. On a phone or laptop that’s already connected, the network name is shown in your Wi-Fi settings; many phones can also show or share the saved password from there.',
          'Network names and passwords are case-sensitive, and spaces count. If guests can’t connect, check those first.',
        ],
      },
      {
        heading: 'Your Wi-Fi password never leaves this page',
        body: [
          'The QR code is generated in your browser. Your network name and password are not uploaded, saved or logged. Anyone who can see the printed code can join your network, though — so for a business, print it for a guest network rather than your main one.',
        ],
      },
    ],
    faqs: [
      { q: 'Do Wi-Fi QR codes work on iPhone and Android?', a: 'Yes. The built-in camera apps on iPhone (iOS 11 and later) and Android (10 and later) recognise Wi-Fi QR codes and offer to join the network.' },
      { q: 'Which security type should I pick?', a: 'Choose WPA/WPA2/WPA3 unless you know your router uses WEP (very old) or has no password at all. WPA3 networks use the same option.' },
      { q: 'What if I change my Wi-Fi password?', a: 'The old QR code will stop working, because the password is stored inside the code. Make a new one with the new password.' },
      { q: 'What does “hidden network” mean?', a: 'Some routers are set not to broadcast their name. Tick it only if your network doesn’t appear in the list of nearby networks; otherwise leave it off.' },
      { q: 'Is it safe to put my Wi-Fi password in a QR code?', a: 'The code is just your password in a scannable form — as safe as writing it on a card. Only display it where you’d be happy for people to join. We never see or store it.' },
    ],
    related: ['qr-code-generator', 'custom-qr-code', 'vcard-qr-code'],
    prompts: [
      { q: 'Want your logo on it?', slug: 'custom-qr-code' },
      { q: 'Need a QR code for a link or menu?', slug: 'qr-code-generator' },
    ],
  },
  {
    slug: 'vcard-qr-code',
    name: 'vCard QR Code',
    blurb: 'Share your contact details.',
    h1: 'Create a digital contact QR code.',
    title: 'vCard QR Code Generator — Contact QR Code | QR Tools',
    description: 'Turn your name, phone, email, website and address into a QR code that saves straight to any phone’s contacts. Free vCard QR codes for business cards.',
    intro: 'Add your details once. Anyone who scans the code can save you to their contacts in one tap — perfect for business cards, name badges and email signatures.',
    ui: { kind: 'generator', types: ['vcard'], type: 'vcard', caption: 'Scan to save contact', action: 'Generate contact QR code' },
    howTo: {
      title: 'How to make a contact QR code',
      steps: [
        'Enter your name, then any details you want to share: company, job title, phone, email, website and address.',
        'Leave out anything you’d rather keep private. Every field except the name is optional.',
        'Download the QR code — SVG is best for business-card printing.',
        'When someone scans it, their phone shows your card with an “Add to contacts” button.',
      ],
    },
    explainer: [
      {
        heading: 'What a vCard QR code contains',
        body: [
          'A vCard is the standard format phones use for contact cards. The QR code stores your vCard directly, so it works offline, has no expiry date and doesn’t send anyone to a website first.',
          'The more you add, the denser the code becomes. For small printed cards, stick to the essentials — name, phone, email and website — so it stays easy to scan.',
        ],
      },
      {
        heading: 'Printing on business cards',
        body: [
          'Print the code at least 2 cm (0.8 in) wide, dark on a light background, with a clear margin around it. Download the SVG so it stays crisp at any size, and test the printed proof with a couple of phones before ordering a big batch.',
        ],
      },
    ],
    faqs: [
      { q: 'Does a vCard QR code work on all phones?', a: 'Yes. iPhone and Android camera apps both recognise contact QR codes and offer to add the contact. No app is needed.' },
      { q: 'Can I update my details later?', a: 'Static QR codes can’t be changed after you print them, because the details are stored in the code itself. Make a new code if your details change.' },
      { q: 'Can I add a photo?', a: 'Photos make the code far too large to scan, so we don’t include one. Your name and details are what people need to save you.' },
      { q: 'Are my contact details stored?', a: 'No. The QR code is created in your browser, and your details are never sent to us.' },
    ],
    related: ['qr-code-generator', 'custom-qr-code', 'batch-qr-code'],
    prompts: [
      { q: 'Want your logo in the middle?', slug: 'custom-qr-code' },
      { q: 'Need cards for a whole team?', slug: 'batch-qr-code' },
    ],
  },
  {
    slug: 'custom-qr-code',
    name: 'Custom QR Code',
    blurb: 'Colours, styles and your logo.',
    h1: 'Custom QR code with logo',
    title: 'Custom QR Code Generator with Logo — Free | QR Tools',
    description: 'Design a QR code with your colours, rounded or dot patterns, custom corners and your logo in the middle. Live preview and a scan check. Free, no account.',
    intro: 'Make a QR code that looks like your brand. Change colours, patterns and corners, add your logo, and watch the preview update — with a scan check after every change.',
    ui: { kind: 'generator', design: 'inline', action: 'Update QR code' },
    howTo: {
      title: 'How to design a custom QR code',
      steps: [
        'Enter your link (or pick another type, like Wi-Fi or a contact).',
        'Pick a colour preset or your own colours. Keep the code darker than the background.',
        'Choose a pattern and corner style, then add your logo and set its size.',
        'Make sure “Scan check passed” is showing, then download SVG for print or PNG for screens.',
      ],
    },
    explainer: [
      {
        heading: 'How a logo fits in a QR code',
        body: [
          'QR codes contain spare, error-correcting data, so part of the code can be covered and it still scans. When you add a logo we switch error correction to High, which lets up to 30% of the code be restored, and we clear the modules behind your logo so it sits cleanly in the middle.',
          'We cap the logo at a safe size and never cover the three corner squares phones use to find the code. Square or round logos with a simple shape work best.',
        ],
      },
      {
        heading: 'Colours that scan',
        body: [
          'Phones look for dark modules on a light background. Strong contrast matters more than the actual colours: deep blue on white scans perfectly; yellow on white does not. If your colours are too close, we’ll warn you before download.',
          'Light codes on dark backgrounds look striking, but some older scanner apps can’t read them. If you go that way, test with a few phones.',
        ],
      },
    ],
    faqs: [
      { q: 'Can I add my logo to a QR code for free?', a: 'Yes. Upload a PNG, JPG or WebP logo up to 2 MB. It is added in your browser and never uploaded.' },
      { q: 'Will a logo stop my QR code from scanning?', a: 'Not at the sizes we allow. Error correction is raised to High automatically and every design is scan-checked. If a combination of logo, colours and style fails, you’ll see it straight away.' },
      { q: 'Which file format is best for a custom QR code?', a: 'SVG for print and design tools — it stays sharp at any size and your logo is embedded. PNG for websites, slides and social media.' },
      { q: 'Can I use my brand colours?', a: 'Yes. Enter any hex code. Keep the code colour noticeably darker than the background so phones can read it.' },
      { q: 'What does error correction do?', a: 'It adds backup data so a code still scans when part of it is dirty, damaged or covered. Low (7%) makes the simplest code; High (30%) is the most robust and is required for logos.' },
    ],
    related: ['qr-code-generator', 'wifi-qr-code', 'vcard-qr-code'],
    prompts: [
      { q: 'Need many codes in the same style?', slug: 'batch-qr-code' },
      { q: 'Want to test a printed code?', slug: 'qr-code-scanner' },
    ],
  },
  {
    slug: 'batch-qr-code',
    name: 'Batch QR Code',
    blurb: 'Many codes from one CSV.',
    h1: 'Batch QR code generator',
    title: 'Batch QR Code Generator — CSV to ZIP, Free | QR Tools',
    description: 'Paste or upload a CSV and get one QR code per row in a single ZIP. Up to 500 codes at once, PNG or SVG, named from your list. Free, private, no sign-up.',
    intro: 'Make up to 500 QR codes at once from a spreadsheet. Each row becomes a named PNG or SVG, and you download them all in one ZIP.',
    ui: { kind: 'batch' },
    howTo: {
      title: 'How to make QR codes in bulk',
      steps: [
        'In your spreadsheet, put a name in the first column and the link (or text) in the second.',
        'Save or export it as CSV, then upload it — or copy the cells and paste them in.',
        'Choose PNG or SVG, the size and colours.',
        'Generate, check the preview and skipped rows, then download the ZIP.',
      ],
    },
    explainer: [
      {
        heading: 'Formatting your CSV',
        body: [
          'Two columns work best: a name and a link, like “Table 12, https://example.com/menu?table=12”. The name becomes the file name (table-12.png). A header row is optional; if you have one, we use the columns called Name and URL (or Link, Content, Text).',
          'Rows with an invalid link are skipped and listed so you can fix them. Duplicate names get a number added (google-2.png), so nothing is overwritten. The ZIP also includes qr-codes.csv, an index of every file and what it contains.',
        ],
      },
      {
        heading: 'Fast and private',
        body: ['Everything runs in your browser: your list is never uploaded, and the ZIP is built on your device. Every code is scan-checked as it is made.'],
      },
    ],
    faqs: [
      { q: 'How many QR codes can I make at once?', a: 'Up to 500 per batch. For more, split your list into several files.' },
      { q: 'Can I paste straight from Excel or Google Sheets?', a: 'Yes. Copy the two columns and paste them in — tab-separated data works as well as commas.' },
      { q: 'What happens to rows with mistakes?', a: 'They are skipped and listed with the row number and the reason, such as “Please enter a valid URL”. Everything else is still generated.' },
      { q: 'Can I add a logo to batch QR codes?', a: 'Not yet — batches use your chosen colours. For a single code with a logo, use the Custom QR Code tool.' },
      { q: 'Is my spreadsheet uploaded?', a: 'No. It’s read and processed entirely in your browser.' },
    ],
    related: ['qr-code-generator', 'custom-qr-code', 'vcard-qr-code'],
    prompts: [
      { q: 'Need a single code with a logo?', slug: 'custom-qr-code' },
      { q: 'Want to test your codes?', slug: 'qr-code-reader' },
    ],
  },
];

export const toolBySlug = new Map(tools.map((t) => [t.slug, t]));
