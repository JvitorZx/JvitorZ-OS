export const OPERATIONAL_STATUS = {
  CONNECTED: { label: 'Conectado', variant: 'connected' },
  DEGRADED: { label: 'Degradado', variant: 'warning' },
  AUTH_REQUIRED: { label: 'Reconexão necessária', variant: 'pending' },
  NOT_CONFIGURED: { label: 'Não configurado', variant: 'pending' },
  ERROR: { label: 'Com erro', variant: 'error' },
};

export const operationalStatus = (value) => OPERATIONAL_STATUS[value]
  ?? { label: 'Indisponível', variant: 'pending' };

export const integrationFrom = (data, id) => data?.integrations?.[id] ?? null;
