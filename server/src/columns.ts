/**
 * Явные списки колонок вместо `*`: в objects и mechanisms есть search_vector,
 * которому нечего делать ни в ответах API, ни в payload журнала changes.
 */
export const OBJECT_COLUMNS = `id, slug, type_code, name, full_name, parent_id, subsystem,
  tags, description, status, version, created_by, created_at, updated_by, updated_at, deleted_at`;

export const MECHANISM_COLUMNS = `id, title, category_code, summary, body, status, version,
  created_by, created_at, updated_by, updated_at, deleted_at`;

export const PARTICIPANT_COLUMNS = `id, mechanism_id, object_id, role_code, note, sort_order`;
