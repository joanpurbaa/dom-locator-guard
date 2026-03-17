// pages/index.tsx
// Serves the dashboard HTML. In production, this would be a full
// React app that fetches from /api/reports and /api/baselines.
// For now it reads reports via the API and injects them into the page.

import type { GetServerSideProps } from 'next';
import * as fs from 'fs';
import * as path from 'path';

// Read the dashboard HTML and inject live data from the API
export default function Dashboard({ dashboardHTML }: { dashboardHTML: string }) {
  return (
    <div dangerouslySetInnerHTML={{ __html: dashboardHTML }} />
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  const htmlPath = path.join(process.cwd(), 'index.html');
  const dashboardHTML = fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, 'utf-8')
    : '<p>Dashboard not found. Run build first.</p>';

  return { props: { dashboardHTML } };
};
