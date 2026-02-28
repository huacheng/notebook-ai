/** Pure function: split tab items into left/right groups for split-view mode. */

export interface TabItem {
  id: string;
  title: string;
  closable: boolean;
}

export interface SplitTabGroupsInput {
  inSplitView: boolean;
  notebookTabs: { id: string; title: string }[];
  fileTabs: { id: string; title: string }[];
  gitTab: { id: string; title: string } | null;
}

export interface SplitTabGroupsResult {
  left: TabItem[];
  right: TabItem[];
}

export function splitTabGroups(input: SplitTabGroupsInput): SplitTabGroupsResult | null {
  if (!input.inSplitView) return null;

  const left: TabItem[] = input.fileTabs.map(t => ({
    id: t.id,
    title: t.title,
    closable: true,
  }));

  const right: TabItem[] = input.notebookTabs.map(t => ({
    id: t.id,
    title: t.title,
    closable: true,
  }));

  if (input.gitTab) {
    right.push({
      id: input.gitTab.id,
      title: input.gitTab.title,
      closable: false,
    });
  }

  return { left, right };
}
