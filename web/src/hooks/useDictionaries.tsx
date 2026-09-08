import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Dictionaries, MechanismCategory, ObjectType, ParticipantRole } from '../api/types';

interface DictionaryState extends Dictionaries {
  typeByCode: Map<string, ObjectType>;
  categoryByCode: Map<string, MechanismCategory>;
  roleByCode: Map<string, ParticipantRole>;
}

const EMPTY: DictionaryState = {
  object_types: [],
  mechanism_categories: [],
  participant_roles: [],
  typeByCode: new Map(),
  categoryByCode: new Map(),
  roleByCode: new Map(),
};

const DictionaryContext = createContext<DictionaryState>(EMPTY);

/**
 * Справочники загружаются один раз на сессию: они меняются только сидом, а
 * нужны почти каждому экрану — цвета типов, порядок ролей, названия категорий.
 */
export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [raw, setRaw] = useState<Dictionaries | null>(null);

  useEffect(() => {
    api.get<Dictionaries>('/api/dictionaries').then(setRaw).catch(console.error);
  }, []);

  const value = useMemo<DictionaryState>(() => {
    if (!raw) return EMPTY;
    return {
      ...raw,
      typeByCode: new Map(raw.object_types.map((item) => [item.code, item])),
      categoryByCode: new Map(raw.mechanism_categories.map((item) => [item.code, item])),
      roleByCode: new Map(raw.participant_roles.map((item) => [item.code, item])),
    };
  }, [raw]);

  return <DictionaryContext value={value}>{children}</DictionaryContext>;
}

export function useDictionaries(): DictionaryState {
  return use(DictionaryContext);
}
