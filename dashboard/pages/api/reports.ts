// pages/api/reports.ts
// Reads all JSON report files from the output directory
// and returns them as an array.
//
// In production, replace with a proper database query.

import type { NextApiRequest, NextApiResponse } from 'next';
import * as fs from 'fs';
import * as path from 'path';
import type { LocatorReport } from '@dom-locator-guard/core';

const REPORTS_DIR = process.env.REPORTS_DIR
  ?? path.join(process.cwd(), '..', 'locator-guard-reports');

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      return res.status(200).json([]);
    }

    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.junit.xml'));

    const reports: LocatorReport[] = files
      .map(f => {
        try {
          const raw = fs.readFileSync(path.join(REPORTS_DIR, f), 'utf-8');
          return JSON.parse(raw) as LocatorReport;
        } catch {
          return null;
        }
      })
      .filter((r): r is LocatorReport => r !== null)
      .sort((a, b) => b.generatedAt - a.generatedAt);

    res.status(200).json(reports);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
