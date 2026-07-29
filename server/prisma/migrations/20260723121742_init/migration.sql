-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETE');

-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_hue" INTEGER NOT NULL DEFAULT 0,
    "is_commissioner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "year" INTEGER NOT NULL,
    "draft_status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "pick_clock_seconds" INTEGER NOT NULL DEFAULT 90,
    "current_pick_started_at" TIMESTAMP(3),

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "draft_slots" (
    "id" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "draft_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_picks" (
    "id" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "pick_number" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" INTEGER NOT NULL,
    "team_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_spots" (
    "id" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" INTEGER NOT NULL,

    CONSTRAINT "roster_spots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "season_year" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "draft_slots_season_year_slot_key" ON "draft_slots"("season_year", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "draft_slots_season_year_user_id_key" ON "draft_slots"("season_year", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_season_year_pick_number_key" ON "draft_picks"("season_year", "pick_number");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_season_year_team_id_key" ON "draft_picks"("season_year", "team_id");

-- CreateIndex
CREATE INDEX "roster_spots_season_year_user_id_idx" ON "roster_spots"("season_year", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roster_spots_season_year_team_id_key" ON "roster_spots"("season_year", "team_id");

-- CreateIndex
CREATE INDEX "chat_messages_season_year_created_at_idx" ON "chat_messages"("season_year", "created_at");

-- AddForeignKey
ALTER TABLE "draft_slots" ADD CONSTRAINT "draft_slots_season_year_fkey" FOREIGN KEY ("season_year") REFERENCES "seasons"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_slots" ADD CONSTRAINT "draft_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_season_year_fkey" FOREIGN KEY ("season_year") REFERENCES "seasons"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_spots" ADD CONSTRAINT "roster_spots_season_year_fkey" FOREIGN KEY ("season_year") REFERENCES "seasons"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_spots" ADD CONSTRAINT "roster_spots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_season_year_fkey" FOREIGN KEY ("season_year") REFERENCES "seasons"("year") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
