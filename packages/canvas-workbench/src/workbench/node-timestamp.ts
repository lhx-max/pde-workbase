/** Mixed ISO and status-text timestamps on historical and generic cards. */
export function formatNodeTimestamp(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
