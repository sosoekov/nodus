import type { PoolClient } from 'pg';
import { recordChange } from '../repo/changes';
import { slugify } from '../slug';

interface SeedObject {
  type_code: string;
  name: string;
  full_name: string;
  subsystem: string;
  tags: string[];
  description: string;
  status: string;
}

const OBJECTS: SeedObject[] = [
  {
    type_code: 'Константа',
    name: 'Норма дней поиска',
    full_name: 'Константа.НормаДнейПоиска',
    subsystem: 'ПодборПерсонала',
    tags: ['подбор', 'нормативы'],
    description:
      'Базовая норма срока подбора в днях. Действует, пока для города заявки не задано переопределение.',
    status: 'active',
  },
  {
    type_code: 'РегистрСведений',
    name: 'Нормы дней поиска по городам',
    full_name: 'РегистрСведений.НормыДнейПоискаПоГородам',
    subsystem: 'ПодборПерсонала',
    tags: ['подбор', 'нормативы'],
    description:
      'Независимый регистр сведений. Измерение — город, ресурс — норма дней. Запись перебивает значение константы.',
    status: 'active',
  },
  {
    type_code: 'Документ',
    name: 'Заявка на подбор персонала',
    full_name: 'Документ.ЗаявкаНаПодборПерсонала',
    subsystem: 'ПодборПерсонала',
    tags: ['подбор'],
    description: 'Заявка от подразделения. Реквизит `СрокПодбора` заполняется при проведении.',
    status: 'active',
  },
];

const MECHANISM = {
  title: 'Определение нормы срока подбора',
  category_code: 'Расчет',
  summary: 'Норма берется из константы, запись регистра по городу заявки ее перебивает.',
  body: [
    'Значение по умолчанию берется из `Константа.НормаДнейПоиска`.',
    '',
    'Если для города, указанного в заявке, есть запись в',
    '`РегистрСведений.НормыДнейПоискаПоГородам`, она перебивает константу.',
    '',
    'Результат записывается в реквизит `СрокПодбора` документа',
    '`Документ.ЗаявкаНаПодборПерсонала` при проведении.',
  ].join('\n'),
  status: 'active',
};

const PARTICIPANTS: Array<[fullName: string, role: string, note: string]> = [
  [
    'Константа.НормаДнейПоиска',
    'ЗначениеПоУмолчанию',
    'Читается первой, используется если нет записи по городу.',
  ],
  [
    'РегистрСведений.НормыДнейПоискаПоГородам',
    'Переопределение',
    'Отбор по городу заявки; найденная запись перебивает константу.',
  ],
  [
    'Документ.ЗаявкаНаПодборПерсонала',
    'Приемник',
    'Результат попадает в реквизит СрокПодбора при проведении.',
  ],
];

export async function seedFixture(client: PoolClient, userId: string): Promise<void> {
  const existing = await client.query('SELECT 1 FROM mechanisms WHERE title = $1', [
    MECHANISM.title,
  ]);
  if (existing.rowCount) return;

  const objectIds = new Map<string, string>();

  for (const object of OBJECTS) {
    const { rows } = await client.query(
      `INSERT INTO objects
         (slug, type_code, name, full_name, subsystem, tags, description, status,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        slugify(object.full_name),
        object.type_code,
        object.name,
        object.full_name,
        object.subsystem,
        object.tags,
        object.description,
        object.status,
        userId,
      ],
    );
    const row = rows[0];
    objectIds.set(object.full_name, row.id);
    await recordChange(client, 'object', row.id, 'create', row, userId);
  }

  const { rows: mechanismRows } = await client.query(
    `INSERT INTO mechanisms (title, category_code, summary, body, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING *`,
    [
      MECHANISM.title,
      MECHANISM.category_code,
      MECHANISM.summary,
      MECHANISM.body,
      MECHANISM.status,
      userId,
    ],
  );
  const mechanism = mechanismRows[0];
  await recordChange(client, 'mechanism', mechanism.id, 'create', mechanism, userId);

  for (const [index, [fullName, roleCode, note]] of PARTICIPANTS.entries()) {
    const { rows } = await client.query(
      `INSERT INTO mechanism_participants (mechanism_id, object_id, role_code, note, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [mechanism.id, objectIds.get(fullName), roleCode, note, index * 10],
    );
    await recordChange(client, 'participant', rows[0].id, 'create', rows[0], userId);
  }
}
