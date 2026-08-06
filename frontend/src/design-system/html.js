export const html = (strings, ...values) =>
  strings.reduce((result, string, index) => `${result}${string}${values[index] ?? ''}`, '');
