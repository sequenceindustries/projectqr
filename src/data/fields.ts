import type { Fields, QrType } from '../../shared/qr/payload';

export interface FieldDef {
  f: keyof Fields;
  label: string;
  kind?: 'input' | 'textarea' | 'select' | 'check' | 'password';
  type?: 'text' | 'url' | 'email' | 'tel';
  placeholder?: string;
  inputmode?: 'url' | 'email' | 'tel' | 'decimal' | 'text';
  autocomplete?: string;
  hint?: string;
  optional?: boolean;
  /** Two short fields share a row on wide screens. */
  half?: boolean;
  options?: { value: string; label: string }[];
  value?: string;
}

export const FIELDS: Record<QrType, FieldDef[]> = {
  url: [{ f: 'url', label: 'Website or link', type: 'url', inputmode: 'url', placeholder: 'https://example.com', autocomplete: 'url' }],
  text: [{ f: 'text', label: 'Text', kind: 'textarea', placeholder: 'Type a message, a code, a note…' }],
  email: [
    { f: 'email', label: 'Email address', type: 'email', inputmode: 'email', placeholder: 'name@example.com', autocomplete: 'email' },
    { f: 'subject', label: 'Subject', optional: true, placeholder: 'Hello' },
    { f: 'body', label: 'Message', kind: 'textarea', optional: true, placeholder: 'Pre-filled email text' },
  ],
  phone: [{ f: 'phone', label: 'Phone number', type: 'tel', inputmode: 'tel', placeholder: '+27 82 123 4567', autocomplete: 'tel', hint: 'Include the country code if people outside your country will call.' }],
  sms: [
    { f: 'phone', label: 'Phone number', type: 'tel', inputmode: 'tel', placeholder: '+27 82 123 4567', autocomplete: 'tel' },
    { f: 'message', label: 'Message', kind: 'textarea', optional: true, placeholder: 'Pre-filled text message' },
  ],
  whatsapp: [
    { f: 'phone', label: 'WhatsApp number', type: 'tel', inputmode: 'tel', placeholder: '+27 82 123 4567', autocomplete: 'tel', hint: 'Include the country code, e.g. +27 for South Africa or +1 for the US.' },
    { f: 'message', label: 'Message', kind: 'textarea', optional: true, placeholder: 'Hi! I saw your QR code…' },
  ],
  wifi: [
    { f: 'ssid', label: 'Network name (SSID)', placeholder: 'MyHomeWiFi', autocomplete: 'off' },
    {
      f: 'security',
      label: 'Security',
      kind: 'select',
      value: 'WPA',
      options: [
        { value: 'WPA', label: 'WPA/WPA2/WPA3 (most networks)' },
        { value: 'WEP', label: 'WEP (older routers)' },
        { value: 'nopass', label: 'No password' },
      ],
    },
    { f: 'password', label: 'Password', kind: 'password', placeholder: 'Wi-Fi password', autocomplete: 'off' },
    { f: 'hidden', label: 'Hidden network', kind: 'check', hint: 'Tick this only if your network doesn’t broadcast its name.' },
  ],
  vcard: [
    { f: 'firstName', label: 'First name', autocomplete: 'given-name', half: true },
    { f: 'lastName', label: 'Last name', autocomplete: 'family-name', half: true },
    { f: 'company', label: 'Company', optional: true, autocomplete: 'organization', half: true },
    { f: 'title', label: 'Job title', optional: true, autocomplete: 'organization-title', half: true },
    { f: 'phone', label: 'Phone', type: 'tel', inputmode: 'tel', optional: true, autocomplete: 'tel', half: true },
    { f: 'email', label: 'Email', type: 'email', inputmode: 'email', optional: true, autocomplete: 'email', half: true },
    { f: 'website', label: 'Website', type: 'url', inputmode: 'url', optional: true, autocomplete: 'url', placeholder: 'example.com' },
    { f: 'address', label: 'Address', kind: 'textarea', optional: true, autocomplete: 'street-address' },
  ],
  location: [
    { f: 'lat', label: 'Latitude', inputmode: 'decimal', placeholder: '-33.9249', half: true },
    { f: 'lng', label: 'Longitude', inputmode: 'decimal', placeholder: '18.4241', half: true },
  ],
};

export const TYPE_HINT: Partial<Record<QrType, string>> = {
  location: 'Find coordinates by long-pressing (or right-clicking) a place in your maps app.',
  wifi: 'Guests point their camera at the code and join without typing the password.',
  vcard: 'Phones offer to save the contact straight to the address book.',
};
