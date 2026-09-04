const timestamp = (milliseconds: number): string => {
  const total = Math.floor(milliseconds / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const formatChapters = (entries: readonly { startMs: number; title: string }[]): string =>
  [...entries].sort((a, b) => a.startMs - b.startMs).map(({ startMs, title }) => `${timestamp(startMs)} ${title.trim()}`).join('\n');
