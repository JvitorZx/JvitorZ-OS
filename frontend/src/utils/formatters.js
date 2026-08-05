export const emptyValue = '--';

export const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') {
    return emptyValue;
  }

  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return String(value);
  }

  return new Intl.NumberFormat('pt-BR').format(numericValue);
};

export const formatDate = (value) => {
  if (!value) {
    return emptyValue;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};
