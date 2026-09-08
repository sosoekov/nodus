export type Role = 'viewer' | 'editor' | 'admin';
export type ObjectStatus = 'stub' | 'active' | 'deprecated';
export type MechanismStatus = 'draft' | 'active' | 'deprecated';
export type Direction = 'source' | 'target' | 'neutral';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface ObjectType {
  code: string;
  title: string;
  color: string;
  sort_order: number;
}

export interface MechanismCategory {
  code: string;
  title: string;
  sort_order: number;
}

export interface ParticipantRole {
  code: string;
  title: string;
  direction: Direction;
  sort_order: number;
}

export interface Dictionaries {
  object_types: ObjectType[];
  mechanism_categories: MechanismCategory[];
  participant_roles: ParticipantRole[];
}

export interface ConfigObject {
  id: string;
  slug: string;
  type_code: string;
  name: string;
  full_name: string | null;
  parent_id: string | null;
  subsystem: string | null;
  tags: string[];
  description: string | null;
  status: ObjectStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Mechanism {
  id: string;
  title: string;
  category_code: string;
  summary: string | null;
  body: string | null;
  status: MechanismStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MechanismsByRole {
  role_code: string;
  role_title: string;
  direction: Direction;
  mechanisms: Array<{
    id: string;
    title: string;
    category_code: string;
    summary: string | null;
    status: MechanismStatus;
    note: string | null;
    sort_order: number;
  }>;
}

export interface ObjectCard {
  object: ConfigObject;
  parent: ConfigObject | null;
  children: ConfigObject[];
  mechanisms_by_role: MechanismsByRole[];
}

export interface MechanismParticipant {
  id: string;
  object_id: string;
  role_code: string;
  note: string | null;
  sort_order: number;
  role_title: string;
  direction: Direction;
  slug: string;
  name: string;
  full_name: string | null;
  type_code: string;
  object_status: ObjectStatus;
}

export interface MechanismCard {
  mechanism: Mechanism;
  participants: MechanismParticipant[];
}

export interface ParticipantInput {
  object_id: string;
  role_code: string;
  note?: string | null;
  sort_order?: number;
}

export interface SimilarObject {
  id: string;
  slug: string;
  type_code: string;
  name: string;
  full_name: string | null;
  status: ObjectStatus;
  score: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface EditLock {
  entity_type: 'object' | 'mechanism';
  entity_id: string;
  user_id: string;
  user_name: string;
  acquired_at: string;
  heartbeat_at: string;
  age_seconds: number;
}

export interface ChangeEvent {
  seq: number;
  entity_type: 'object' | 'mechanism' | 'participant';
  entity_id: string;
  op: 'create' | 'update' | 'delete';
  payload: unknown;
  user_id: string | null;
  created_at: string;
}
