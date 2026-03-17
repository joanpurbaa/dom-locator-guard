// pages/api/baselines.ts
// GET  /api/baselines         → list all baselines
// DELETE /api/baselines?name=X → delete a baseline

import type { NextApiRequest, NextApiResponse } from 'next';
import { SnapshotStore } from '@dom-locator-guard/core';
import * as path from 'path';

const store = new SnapshotStore({
  baselineDir: process.env.BASELINES_DIR
    ?? path.join(process.cwd(), '..', 'locator-guard-baselines'),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const names = store.listBaselines();
    const baselines = names.map(name => {
      const snapshot = store.loadBaseline(name);
      return snapshot ? {
        featureName: snapshot.featureName,
        url: snapshot.url,
        timestamp: snapshot.timestamp,
        guardVersion: snapshot.guardVersion,
        elementCount: 0, // could traverse tree to count
      } : null;
    }).filter(Boolean);

    return res.status(200).json(baselines);
  }

  if (req.method === 'DELETE') {
    const { name } = req.query;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name query param required' });
    }
    const deleted = store.deleteBaseline(name);
    return res.status(200).json({ deleted });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
