import { describe, expect, it } from 'vitest';
import paperDraftCsv from '../../seeds/2026-paper-draft.csv?raw';
import {
  generatePaperDraftSql,
  parseAndValidatePaperDraft,
  parseTeamExport,
  resolvePaperDraftTeams,
  TEAM_NAME_ALIASES,
} from './paper-draft';

function canonicalSchool(name: string): string {
  return TEAM_NAME_ALIASES[name] ?? name;
}

const validated = parseAndValidatePaperDraft(paperDraftCsv);
const teamExport = validated.map((pick, index) => ({
  id: 10_000 + index,
  school: canonicalSchool(pick.selectedTeam),
}));

describe('completed 2026 paper draft import', () => {
  it('accepts the authoritative 10-manager, 10-round snake and regenerates picks 1..100', () => {
    expect(validated).toHaveLength(100);
    expect(validated.map((pick) => pick.pickNumber)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect(validated.slice(0, 10).map((pick) => pick.ownerUsername)).toEqual([
      'dustin',
      'dylan',
      'allan',
      'josh.bozym',
      'eric',
      'adam',
      'broc',
      'zac',
      'tom',
      'justin',
    ]);
    expect(validated.slice(10, 20).map((pick) => pick.ownerUsername)).toEqual([
      'justin',
      'tom',
      'zac',
      'broc',
      'adam',
      'eric',
      'josh.bozym',
      'allan',
      'dylan',
      'dustin',
    ]);
    expect(validated.some((pick) => pick.ownerUsername === 'josh.yagel')).toBe(false);
  });

  it('rejects incomplete, duplicate-team, unknown-owner, and broken-snake drafts', () => {
    expect(() => parseAndValidatePaperDraft(paperDraftCsv.split('\n').slice(0, -2).join('\n'))).toThrow(
      /exactly 100/i,
    );
    expect(() =>
      parseAndValidatePaperDraft(paperDraftCsv.replace('Ohio State', 'Georgia')),
    ).toThrow(/duplicate selected team/i);
    expect(() => parseAndValidatePaperDraft(paperDraftCsv.replace('Dustin,Georgia', 'Mystery,Georgia'))).toThrow(
      /unknown owner/i,
    );
    expect(() => parseAndValidatePaperDraft(paperDraftCsv.replace('2,Mann,Virginia', '2,Talty,Virginia'))).toThrow(
      /snake owner order/i,
    );
  });

  it('resolves aliases only to exact canonical school names and fails on missing or ambiguous exports', () => {
    const resolved = resolvePaperDraftTeams(validated, teamExport);
    expect(resolved.find((pick) => pick.selectedTeam === 'Mississippi')?.school).toBe('Ole Miss');
    expect(resolved.find((pick) => pick.selectedTeam === 'Central Florida')?.school).toBe('UCF');

    expect(() => resolvePaperDraftTeams(validated, teamExport.filter((team) => team.school !== 'Georgia'))).toThrow(
      /missing.*Georgia/i,
    );
    expect(() => resolvePaperDraftTeams(validated, [...teamExport, { id: 999_999, school: 'Georgia' }])).toThrow(
      /ambiguous.*Georgia/i,
    );

    const aliasCollision = validated.map((pick) =>
      pick.selectedTeam === 'Penn State' ? { ...pick, selectedTeam: 'Ole Miss' } : pick,
    );
    expect(() => resolvePaperDraftTeams(aliasCollision, teamExport)).toThrow(/duplicate.*Ole Miss/i);
  });

  it('parses CFBD team exports from JSON or CSV without inventing ids', () => {
    expect(parseTeamExport('[{"id":61,"school":"Georgia"}]')).toEqual([
      { id: 61, school: 'Georgia' },
    ]);
    expect(
      parseTeamExport('[{"results":[{"id":61,"school":"Georgia"}],"success":true}]'),
    ).toEqual([{ id: 61, school: 'Georgia' }]);
    expect(parseTeamExport('id,school\n61,Georgia\n')).toEqual([{ id: 61, school: 'Georgia' }]);
    expect(() => parseTeamExport('[{"id":"made-up","school":"Georgia"}]')).toThrow(/team export/i);
  });

  it('emits migration-safe SQL with exported team ids, round-one draft order, commissioner attribution, and no passwords', () => {
    const sql = generatePaperDraftSql({ season: 2026, csv: paperDraftCsv, teams: teamExport });

    expect(sql).not.toMatch(/BEGIN TRANSACTION|COMMIT;/);
    expect(sql).toContain('DELETE FROM picks WHERE season_year = 2026;');
    expect(sql).toContain('DELETE FROM draft_order WHERE season_year = 2026;');
    expect(sql).toContain("UPDATE seasons SET draft_status = 'complete', rounds = 10");
    expect(sql).toContain("SELECT id FROM users WHERE username = 'tom'");
    expect(sql).toContain('10000');
    expect(sql.match(/INSERT INTO picks/g)).toHaveLength(100);
    expect(sql.match(/INSERT INTO draft_order/g)).toHaveLength(10);
    expect(sql).not.toMatch(/password/i);
    expect(sql).not.toContain('unixepoch()');
    expect(generatePaperDraftSql({ season: 2026, csv: paperDraftCsv, teams: teamExport })).toBe(sql);
  });
});
