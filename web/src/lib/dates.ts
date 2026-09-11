const DAY = 86_400_000;

/** Порог из требований: относительное время только для свежего. */
const RELATIVE_LIMIT_DAYS = 7;

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = value % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Полные дата и время — для тултипа, где важна точность. */
export function formatExact(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * «3 дня назад» для свежего, точная дата для старого. Относительное время
 * старше недели не помогает: «47 дней назад» человек все равно пересчитывает
 * в дату.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const stamp = new Date(iso).getTime();
  const diff = now - stamp;

  if (diff >= RELATIVE_LIMIT_DAYS * DAY || diff < 0) return formatDate(iso);

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;

  const days = Math.floor(diff / DAY);
  if (days === 1) return 'вчера';
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}
