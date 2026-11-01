import { describe, expect, it } from 'vitest';
import { groupSceneReviewIssues } from './sceneReviewIssues';
import type { ScenePlacementIssue } from './spatial';

const overlap = (itemId: string, relatedItemId: string): ScenePlacementIssue => ({
  itemId,
  relatedItemId,
  code: 'collision',
  rootCause: 'collision',
  message: `${itemId} overlaps ${relatedItemId}.`,
});

describe('actionable photo review issues', () => {
  it('shows a collision pair once and preserves both selectable objects', () => {
    const issues = [overlap('a', 'b'), overlap('b', 'a'), overlap('b', 'c')];
    const groups = groupSceneReviewIssues(issues);
    expect(groups).toHaveLength(2);
    expect(groups[0].itemIds).toEqual(['a', 'b']);
    expect(groupSceneReviewIssues([...issues].reverse())).toEqual(groups);
  });

  it('puts support before related overlaps while retaining separate unrelated collisions', () => {
    const issues: ScenePlacementIssue[] = [
      overlap('laptop', 'stand'),
      overlap('stand', 'laptop'),
      overlap('mouse', 'keyboard'),
      {
        itemId: 'laptop',
        code: 'support',
        rootCause: 'overhang',
        message: 'Review laptop support.',
      },
    ];
    const groups = groupSceneReviewIssues(issues);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      kind: 'support',
      itemIds: ['laptop', 'stand'],
      primary: { message: 'Review laptop support.' },
    });
    expect(groups[0].overlaps).toHaveLength(1);
    expect(groups[1].kind).toBe('collision');
    expect(issues).toHaveLength(4);
  });

  it('keeps retained placement and legacy issues without parsing natural-language names', () => {
    expect(
      groupSceneReviewIssues([
        { itemId: 'saved', code: 'retained-placement', message: 'Saved object needs review.' },
        { itemId: 'new', code: 'collision', message: 'Legacy overlap.' },
      ]),
    ).toHaveLength(2);
  });

  it('retains every support detail when grouping does not change final validation', () => {
    const issues: ScenePlacementIssue[] = [
      {
        itemId: 'child',
        code: 'support',
        rootCause: 'height-budget',
        message: 'Large height change needs review.',
      },
      { itemId: 'child', code: 'support', rootCause: 'height', message: 'Position is locked.' },
      overlap('child', 'parent'),
      overlap('parent', 'child'),
    ];
    const groups = groupSceneReviewIssues(issues);
    expect(groups).toHaveLength(1);
    expect([groups[0].primary, ...groups[0].details].map((issue) => issue.message)).toEqual([
      'Large height change needs review.',
      'Position is locked.',
    ]);
    expect(groups[0].overlaps).toHaveLength(1);
    expect(issues).toHaveLength(4);
  });
});
