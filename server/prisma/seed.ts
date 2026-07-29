import { DraftStatus, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SEED_DIR = path.join(__dirname, '..', 'seed_data');

const CURRENT_SEASON = 2026; // drafted in-app; the league starts fresh here.
// v1's 2025 rosters were intentionally not imported. If they're ever wanted,
// user_teams.csv lives in the v1 repo (Talty09/mbl-league) — it keys rosters
// by v1-database UUIDs, so a UUID→email mapping would need to be built.

/** Minimal CSV reader — our seed files have no quoting or embedded commas. */
function readCsv(fileName: string): Record<string, string>[] {
  const filePath = path.join(SEED_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const [headerLine, ...lines] = fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const headers = headerLine.split(',').map((h) => h.trim());
  return lines.map((line) => {
    const values = line.split(',').map((v) => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}

async function seedUsers(): Promise<Map<string, string>> {
  const rows = readCsv('users.csv');
  const passwordHash = await bcrypt.hash(process.env.SEED_DEFAULT_PASSWORD || 'changeme', 10);
  const emailToId = new Map<string, string>();

  for (const [index, row] of rows.entries()) {
    const user = await prisma.user.upsert({
      where: { email: row.email },
      update: {
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
      },
      create: {
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        passwordHash,
        // Distinct hue per manager for oklch avatar colors (design handoff)
        avatarHue: Math.round((360 / rows.length) * index),
      },
    });
    emailToId.set(row.email, user.id);
  }

  console.log(`Seeded ${rows.length} users (default password: set SEED_DEFAULT_PASSWORD, fallback "changeme")`);
  return emailToId;
}

async function seedSeasons(): Promise<void> {
  await prisma.season.upsert({
    where: { year: CURRENT_SEASON },
    update: {},
    create: { year: CURRENT_SEASON, draftStatus: DraftStatus.PENDING },
  });
  console.log(`Seeded season ${CURRENT_SEASON} (pending draft)`);
}

/**
 * Placeholder draft order for the current season: alphabetical by display
 * name. The real order should be set before draft day (commissioner tooling
 * is a TODO).
 */
async function seedDraftSlots(): Promise<void> {
  const existing = await prisma.draftSlot.count({ where: { seasonYear: CURRENT_SEASON } });
  if (existing > 0) {
    console.log(`Draft slots for ${CURRENT_SEASON} already exist — leaving as-is`);
    return;
  }

  const users = await prisma.user.findMany({ orderBy: { displayName: 'asc' } });
  await prisma.draftSlot.createMany({
    data: users.map((user, index) => ({
      seasonYear: CURRENT_SEASON,
      slot: index + 1,
      userId: user.id,
    })),
  });
  console.log(`Seeded ${users.length} draft slots for ${CURRENT_SEASON} (alphabetical placeholder order)`);
}

async function main(): Promise<void> {
  await seedUsers();
  await seedSeasons();
  await seedDraftSlots();
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
