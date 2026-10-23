export interface PageGroup {
  key: string; // '' = top-level pages
  label: string;
  urls: string[];
}

export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/+$/, '');
    return path + u.search;
  } catch {
    return url;
  }
}

// Group by first path segment; a section needs 2+ pages to earn its own group,
// everything else (/, /about, lone /careers/x) lands in "Main pages".
export function groupPages(urls: string[]): PageGroup[] {
  const firstSeg = (url: string): string => pagePath(url).split(/[/?]/).filter(Boolean)[0] ?? '';
  const counts = new Map<string, number>();
  for (const url of urls) counts.set(firstSeg(url), (counts.get(firstSeg(url)) ?? 0) + 1);

  const groups = new Map<string, PageGroup>();
  for (const url of urls) {
    const seg = firstSeg(url);
    const key = seg && (counts.get(seg) ?? 0) >= 2 ? seg : '';
    if (!groups.has(key)) groups.set(key, { key, label: key ? `/${key}` : 'Main pages', urls: [] });
    groups.get(key)!.urls.push(url);
  }
  for (const g of groups.values()) g.urls.sort((a, b) => pagePath(a).localeCompare(pagePath(b)));
  return [...groups.values()].sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : a.key.localeCompare(b.key)));
}
