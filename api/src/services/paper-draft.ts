/** Pure validation and SQL generation for a completed paper draft import. */

export const OWNER_ALIASES: Readonly<Record<string, string>> = {
  Dustin: 'dustin',
  Nuzzo: 'dylan',
  Allan: 'allan',
  JB: 'josh.bozym',
  Gillis: 'eric',
  Hoffman: 'adam',
  Broc: 'broc',
  Meso: 'zac',
  Talty: 'tom',
  Mann: 'justin',
};

/** Paper names that differ from CFBD's canonical `school` values. */
export const TEAM_NAME_ALIASES: Readonly<Record<string, string>> = {
  'Appalachian State': 'App State',
  'Brigham Young': 'BYU',
  'Central Florida': 'UCF',
  Connecticut: 'UConn',
  Hawaii: "Hawai'i",
  'Louisiana State': 'LSU',
  'Miami (FL)': 'Miami',
  Mississippi: 'Ole Miss',
  'Nevada-Las Vegas': 'UNLV',
  'North Carolina State': 'NC State',
  'Southern California': 'USC',
  'Southern Methodist': 'SMU',
  'Southern Mississippi': 'Southern Miss',
  'Texas Christian': 'TCU',
  'Texas-San Antonio': 'UTSA',
};

export interface PaperDraftPick {
  pickNumber: number;
  round: number;
  ownerAlias: string;
  ownerUsername: string;
  selectedTeam: string;
}

export interface TeamExportRow {
  id: number;
  school: string;
}

export interface ResolvedPaperDraftPick extends PaperDraftPick {
  teamId: number;
  school: string;
}

function validateTeamExportRows(rows: unknown[]): TeamExportRow[] {
  return rows.map((row, index) => {
    if (
      typeof row !== 'object' ||
      row === null ||
      !Number.isInteger((row as { id?: unknown }).id) ||
      ((row as { id: number }).id <= 0) ||
      typeof (row as { school?: unknown }).school !== 'string' ||
      !(row as { school: string }).school.trim()
    ) {
      throw new Error(`Team export row ${index + 1} requires a positive integer id and non-empty school`);
    }
    return { id: (row as { id: number }).id, school: (row as { school: string }).school.trim() };
  });
}

/** Parse a raw team array, Wrangler D1 JSON results, or an `id,school` CSV export. */
export function parseTeamExport(text: string): TeamExportRow[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Team export is empty');
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('Team export JSON is invalid');
    }
    if (!Array.isArray(parsed)) throw new Error('Team export JSON must be an array');
    if (
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      parsed[0] !== null &&
      'results' in parsed[0]
    ) {
      const rows: unknown[] = [];
      for (const [index, result] of parsed.entries()) {
        if (
          typeof result !== 'object' ||
          result === null ||
          !('results' in result) ||
          !Array.isArray(result.results)
        ) {
          throw new Error(`Team export D1 result ${index + 1} has no results array`);
        }
        rows.push(...result.results);
      }
      return validateTeamExportRows(rows);
    }
    return validateTeamExportRows(parsed);
  }

  const lines = trimmed.split(/\r?\n/);
  const columns = parseCsvLine(lines.shift()!);
  const idIndex = columns.indexOf('id');
  const schoolIndex = columns.indexOf('school');
  if (idIndex === -1 || schoolIndex === -1) {
    throw new Error('Team export CSV requires id and school columns');
  }
  return validateTeamExportRows(
    lines.filter((line) => line.trim()).map((line) => {
      const cells = parseCsvLine(line);
      return { id: Number(cells[idIndex]), school: cells[schoolIndex] };
    }),
  );
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('Paper draft CSV contains an unterminated quoted field');
  cells.push(cell.trim());
  return cells;
}

export function parseAndValidatePaperDraft(csv: string): PaperDraftPick[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines.shift();
  if (!header) throw new Error('Paper draft CSV is empty');
  const columns = parseCsvLine(header);
  const column = (name: string): number => {
    const index = columns.indexOf(name);
    if (index === -1) throw new Error(`Paper draft CSV is missing the "${name}" column`);
    return index;
  };
  const roundIndex = column('round');
  const ownerIndex = column('owner');
  const teamIndex = column('selected_team');

  if (lines.length !== 100) {
    throw new Error(`Paper draft must contain exactly 100 rows; found ${lines.length}`);
  }

  const picks = lines.map((line, index): PaperDraftPick => {
    const cells = parseCsvLine(line);
    const round = Number(cells[roundIndex]);
    const ownerAlias = cells[ownerIndex] ?? '';
    const selectedTeam = cells[teamIndex] ?? '';
    const ownerUsername = OWNER_ALIASES[ownerAlias];
    if (!Number.isInteger(round)) throw new Error(`Row ${index + 2} has an invalid round`);
    if (!ownerUsername) throw new Error(`Row ${index + 2} has unknown owner alias "${ownerAlias}"`);
    if (!selectedTeam) throw new Error(`Row ${index + 2} has no selected team`);
    return { pickNumber: index + 1, round, ownerAlias, ownerUsername, selectedTeam };
  });

  const teams = new Set<string>();
  for (const pick of picks) {
    if (teams.has(pick.selectedTeam)) {
      throw new Error(`Duplicate selected team "${pick.selectedTeam}"`);
    }
    teams.add(pick.selectedTeam);
  }

  const firstRound = picks.slice(0, 10).map((pick) => pick.ownerUsername);
  if (new Set(firstRound).size !== 10) {
    throw new Error('Round 1 must contain 10 unique owners');
  }
  for (let round = 1; round <= 10; round += 1) {
    const roundPicks = picks.slice((round - 1) * 10, round * 10);
    if (roundPicks.some((pick) => pick.round !== round)) {
      throw new Error(`Round ${round} must contain exactly 10 consecutive rows`);
    }
    const expected = round % 2 === 1 ? firstRound : [...firstRound].reverse();
    if (roundPicks.some((pick, index) => pick.ownerUsername !== expected[index])) {
      throw new Error(`Round ${round} does not follow snake owner order`);
    }
  }

  return picks;
}

export function resolvePaperDraftTeams(
  picks: PaperDraftPick[],
  teams: TeamExportRow[],
): ResolvedPaperDraftPick[] {
  const bySchool = new Map<string, TeamExportRow[]>();
  for (const team of teams) {
    if (!Number.isInteger(team.id) || team.id <= 0 || !team.school.trim()) {
      throw new Error('Team export rows require a positive integer id and non-empty school');
    }
    const matches = bySchool.get(team.school) ?? [];
    matches.push(team);
    bySchool.set(team.school, matches);
  }

  const resolved = picks.map((pick) => {
    const school = TEAM_NAME_ALIASES[pick.selectedTeam] ?? pick.selectedTeam;
    const matches = bySchool.get(school) ?? [];
    if (matches.length === 0) {
      throw new Error(`Missing team "${pick.selectedTeam}" (expected exact school "${school}")`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous team "${pick.selectedTeam}" (school "${school}" occurs ${matches.length} times)`);
    }
    return { ...pick, teamId: matches[0]!.id, school };
  });

  const selectedSchools = new Set<string>();
  const selectedIds = new Set<number>();
  for (const pick of resolved) {
    if (selectedSchools.has(pick.school)) {
      throw new Error(`Duplicate resolved team "${pick.school}"`);
    }
    if (selectedIds.has(pick.teamId)) {
      throw new Error(`Duplicate resolved team id ${pick.teamId}`);
    }
    selectedSchools.add(pick.school);
    selectedIds.add(pick.teamId);
  }
  return resolved;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function userId(username: string): string {
  return `(SELECT id FROM users WHERE username = ${sqlString(username)})`;
}

export function generatePaperDraftSql(options: {
  season: number;
  csv: string;
  teams: TeamExportRow[];
  commissionerUsername?: string;
}): string {
  if (!Number.isInteger(options.season) || options.season < 2000 || options.season > 2100) {
    throw new Error('Season must be an integer between 2000 and 2100');
  }
  const picks = resolvePaperDraftTeams(parseAndValidatePaperDraft(options.csv), options.teams);
  const commissioner = options.commissionerUsername ?? 'tom';
  const draftTimestamp = Date.UTC(options.season, 0, 1);
  const statements = [
    '-- Generated completed paper draft migration. Do not edit.',
    '-- Applied atomically by `wrangler d1 migrations apply`; do not use `d1 execute`.',
    '-- Requires manager and team rows to exist; a failed migration is rolled back.',
    `DELETE FROM picks WHERE season_year = ${options.season};`,
    `DELETE FROM draft_order WHERE season_year = ${options.season};`,
  ];

  for (const pick of picks.slice(0, 10)) {
    statements.push(
      `INSERT INTO draft_order (season_year, slot, user_id) VALUES (${options.season}, ${pick.pickNumber}, ${userId(pick.ownerUsername)});`,
    );
  }
  for (const pick of picks) {
    const id = `paper-${options.season}-${String(pick.pickNumber).padStart(3, '0')}`;
    statements.push(
      `INSERT INTO picks (id, season_year, pick_number, user_id, team_id, made_by_user_id, created_at) VALUES (` +
        `${sqlString(id)}, ${options.season}, ${pick.pickNumber}, ${userId(pick.ownerUsername)}, ${pick.teamId}, ` +
        `${userId(commissioner)}, ${draftTimestamp + pick.pickNumber});`,
    );
  }
  statements.push(
    `UPDATE seasons SET draft_status = 'complete', rounds = 10 WHERE year = ${options.season};`,
    '',
  );
  return statements.join('\n');
}
