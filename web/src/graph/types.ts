import type { Direction, MechanismStatus, ObjectStatus } from '../api/types';

export interface GraphObject {
  id: string;
  slug: string;
  name: string;
  type_code: string;
  status: ObjectStatus;
  tags: string[];
  parent_id: string | null;
  x: number | null;
  y: number | null;
  pinned: boolean | null;
}

export interface GraphMechanism {
  id: string;
  title: string;
  category_code: string;
  status: MechanismStatus;
  summary: string | null;
}

export interface GraphParticipant {
  id: string;
  mechanism_id: string;
  object_id: string;
  role_code: string;
}

export interface Snapshot {
  seq: number;
  objects: GraphObject[];
  mechanisms: GraphMechanism[];
  participants: GraphParticipant[];
}

export interface GraphState {
  seq: number;
  objects: Map<string, GraphObject>;
  mechanisms: Map<string, GraphMechanism>;
  participants: Map<string, GraphParticipant>;
  /** Направления ролей — из справочника, нужны для вывода ребер объект→объект. */
  roleDirection: Map<string, Direction>;
}

export type RenderMode = 'objects' | 'full';

/** Что выделено сейчас: узел графа или ребро. */
export type Selection =
  | { kind: 'object'; id: string }
  | { kind: 'mechanism'; id: string }
  | { kind: 'edge'; mechanismIds: string[] }
  | null;
