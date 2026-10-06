/**
 * Analytics contract shared by the browser and the server.
 * Events carry the tool id and coarse, enum-like properties only.
 * QR contents, file names, phone numbers, passwords etc. are never sent.
 */
export const EVENT_NAMES = new Set([
  'tool_view',
  'qr_generation_started',
  'qr_generation_completed',
  'qr_generation_failed',
  'qr_downloaded',
  'qr_scanned',
  'qr_decoded',
  'customization_used',
  'logo_added',
  'batch_generation_started',
  'batch_generation_completed',
]);

/** Allowed property keys. Values are numbers or short tokens (letters, digits, _ . -). */
export const EVENT_PROPS = new Set([
  'tool', // tool id, e.g. qr-code-generator
  'type', // QR content type, e.g. url, wifi
  'format', // png | svg | jpg | zip
  'size', // output pixels
  'ec', // L | M | Q | H
  'option', // which customisation, e.g. module_style
  'value', // the enum value of that option, e.g. dots
  'source', // camera | upload | paste
  'code', // failure code, e.g. invalid_url
  'count', // batch rows
  'ms', // elapsed time
  'referrer', // search | social | internal | other | direct
]);
