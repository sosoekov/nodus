import type { FastifyInstance } from 'fastify';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { pool, withTransaction } from '../db';

interface Position {
  object_id: string;
  x: number;
  y: number;
  pinned?: boolean;
}

/**
 * Раскладка живет в базе и не пересчитывается при каждой загрузке: на 1000+
 * узлов это долго, а картинка каждый раз получалась бы разной — человек теряет
 * пространственную память о графе.
 */
export async function layoutRoutes(app: FastifyInstance): Promise<void> {
  const editor = app.requireRole('editor');
  const admin = app.requireRole('admin');

  app.put<{ Body: { positions: Position[] } }>(
    '/api/layout',
    {
      onRequest: [editor],
      schema: {
        body: {
          type: 'object',
          required: ['positions'],
          properties: {
            positions: {
              type: 'array',
              maxItems: 5000,
              items: {
                type: 'object',
                required: ['object_id', 'x', 'y'],
                properties: {
                  object_id: { type: 'string', format: 'uuid' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  pinned: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { positions } = request.body;
      if (!positions.length) return { saved: 0 };

      await withTransaction(async (client) => {
        for (const position of positions) {
          await client.query(
            `INSERT INTO layout (object_id, x, y, pinned) VALUES ($1, $2, $3, $4)
             ON CONFLICT (object_id) DO UPDATE
               SET x = EXCLUDED.x, y = EXCLUDED.y, pinned = EXCLUDED.pinned`,
            [position.object_id, position.x, position.y, position.pinned ?? true],
          );
        }
      });

      return { saved: positions.length };
    },
  );

  app.post('/api/layout/recompute', { onRequest: [admin] }, async () => {
    const objects = await pool.query<{ id: string }>(
      'SELECT id FROM objects WHERE deleted_at IS NULL',
    );

    // Ребра объект-объект выводим из ролей так же, как объектный режим графа:
    // раскладка должна отражать ту картину, которую человек видит.
    const participants = await pool.query<{
      mechanism_id: string;
      object_id: string;
      direction: string;
    }>(
      `SELECT p.mechanism_id, p.object_id, r.direction
         FROM mechanism_participants p
         JOIN mechanisms m ON m.id = p.mechanism_id AND m.deleted_at IS NULL
         JOIN objects o ON o.id = p.object_id AND o.deleted_at IS NULL
         JOIN participant_roles r ON r.code = p.role_code`,
    );

    const pinned = await pool.query<{ object_id: string; x: number; y: number }>(
      'SELECT object_id, x, y FROM layout WHERE pinned = true',
    );
    const pinnedById = new Map(pinned.rows.map((row) => [row.object_id, row]));

    const graph = new Graph({ type: 'undirected', multi: false });

    for (const [index, object] of objects.rows.entries()) {
      // Стартовая раскладка по кругу: детерминированная и без наложений,
      // которые force-layout потом долго расталкивает.
      const angle = (index / Math.max(objects.rows.length, 1)) * Math.PI * 2;
      graph.addNode(object.id, { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
    }

    const byMechanism = new Map<string, Array<{ id: string; direction: string }>>();
    for (const row of participants.rows) {
      const list = byMechanism.get(row.mechanism_id) ?? [];
      list.push({ id: row.object_id, direction: row.direction });
      byMechanism.set(row.mechanism_id, list);
    }

    for (const list of byMechanism.values()) {
      const targets = list.filter((item) => item.direction === 'target').map((i) => i.id);
      const others = list.filter((item) => item.direction !== 'target').map((i) => i.id);

      const pairs: Array<[string, string]> = [];
      if (targets.length) {
        for (const from of others) for (const to of targets) pairs.push([from, to]);
        for (let i = 0; i < targets.length; i += 1) {
          for (let j = i + 1; j < targets.length; j += 1) pairs.push([targets[i], targets[j]]);
        }
      } else {
        const all = list.map((item) => item.id);
        for (let i = 0; i < all.length; i += 1) {
          for (let j = i + 1; j < all.length; j += 1) pairs.push([all[i], all[j]]);
        }
      }

      for (const [from, to] of pairs) {
        if (from === to || !graph.hasNode(from) || !graph.hasNode(to)) continue;
        if (!graph.hasEdge(from, to)) graph.addEdge(from, to);
      }
    }

    forceAtlas2.assign(graph, {
      iterations: graph.order > 500 ? 300 : 600,
      settings: { ...forceAtlas2.inferSettings(graph), gravity: 1, scalingRatio: 20 },
    });

    // Закрепленные узлы возвращаем на место. ForceAtlas2 в graphology не умеет
    // фиксировать узлы во время счета, поэтому они не влияют на раскладку —
    // но с места их не сдвигает, а это и есть смысл закрепления.
    const saved = await withTransaction(async (client) => {
      let count = 0;
      for (const node of graph.nodes()) {
        const anchor = pinnedById.get(node);
        const x = anchor ? anchor.x : (graph.getNodeAttribute(node, 'x') as number);
        const y = anchor ? anchor.y : (graph.getNodeAttribute(node, 'y') as number);

        await client.query(
          `INSERT INTO layout (object_id, x, y, pinned) VALUES ($1, $2, $3, $4)
           ON CONFLICT (object_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y`,
          [node, x, y, Boolean(anchor)],
        );
        count += 1;
      }
      return count;
    });

    return { nodes: saved, pinned: pinnedById.size, edges: graph.size };
  });
}
