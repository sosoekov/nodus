// Единственное место в проекте, где ё оставлена намеренно: свои тексты мы пишем
// через е, но имена объектов набирают руками и ё в них попадет. Уберешь отсюда —
// «Отчёт» превратится в «otch-t».
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Разбивает СлитныеСлова1С на части, чтобы slug читался: normaDneyPoiska → norma-dney-poiska. */
function splitCamelCase(input: string): string {
  return input
    .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([А-ЯЁA-Z]{2,})([А-ЯЁA-Z][а-яёa-z])/g, '$1 $2');
}

export function slugify(source: string): string {
  const spaced = splitCamelCase(source).toLowerCase();
  let out = '';
  for (const char of spaced) {
    if (char in TRANSLIT) out += TRANSLIT[char];
    else if (/[a-z0-9]/.test(char)) out += char;
    else out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'object';
}
