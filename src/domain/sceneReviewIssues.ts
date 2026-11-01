import type { ScenePlacementIssue } from './spatial';

export type SceneReviewIssueGroup = {
  id: string;
  kind: 'support' | 'collision' | 'retained-placement';
  itemIds: string[];
  primary: ScenePlacementIssue;
  details: ScenePlacementIssue[];
  overlaps: ScenePlacementIssue[];
};

/** One object pair is one review problem, even when both objects have an issue.
 * A support problem is shown first with its overlaps, without claiming that
 * fixing support must resolve every collision. Validation still uses all issues. */
export function groupSceneReviewIssues(issues: ScenePlacementIssue[]): SceneReviewIssueGroup[] {
  const groups = new Map<string, SceneReviewIssueGroup>();
  const supportByItem = new Map<string, SceneReviewIssueGroup>();
  const ordered = [...issues].sort(
    (a, b) =>
      a.itemId.localeCompare(b.itemId) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
  for (const issue of ordered) {
    if (issue.code === 'collision' || issue.rootCause === 'collision') continue;
    const id = `support:${issue.itemId}`;
    const existing = groups.get(id);
    if (existing) {
      existing.details.push(issue);
      continue;
    }
    const group: SceneReviewIssueGroup = {
      id,
      kind: issue.code === 'retained-placement' ? 'retained-placement' : 'support',
      itemIds: [issue.itemId],
      primary: issue,
      details: [],
      overlaps: [],
    };
    groups.set(id, group);
    supportByItem.set(issue.itemId, group);
  }
  const seenPairs = new Set<string>();
  for (const issue of ordered) {
    if (issue.code !== 'collision' && issue.rootCause !== 'collision') continue;
    const itemIds = [
      ...new Set([issue.itemId, ...(issue.relatedItemId ? [issue.relatedItemId] : [])]),
    ].sort();
    const pair = issue.relatedItemId ? itemIds.join(':') : `${issue.itemId}:${issue.message}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    const support = itemIds.map((id) => supportByItem.get(id)).find(Boolean);
    if (support) {
      support.itemIds = [...new Set([...support.itemIds, ...itemIds])].sort();
      support.overlaps.push(issue);
    } else
      groups.set(`collision:${pair}`, {
        id: `collision:${pair}`,
        kind: 'collision',
        itemIds,
        primary: issue,
        details: [],
        overlaps: [],
      });
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.kind === 'collision') - Number(b.kind === 'collision') || a.id.localeCompare(b.id),
  );
}
