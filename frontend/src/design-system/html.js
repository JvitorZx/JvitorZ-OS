export const html = (strings, ...values) =>
  strings.reduce((result, string, index) => `${result}${string}${values[index] ?? ''}`, '');

export const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
