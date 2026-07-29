CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_year` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_year`) REFERENCES `seasons`(`year`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_season_created_idx` ON `chat_messages` (`season_year`,`created_at`);--> statement-breakpoint
CREATE TABLE `draft_order` (
	`season_year` integer NOT NULL,
	`slot` integer NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`season_year`, `slot`),
	FOREIGN KEY (`season_year`) REFERENCES `seasons`(`year`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_order_season_user_unq` ON `draft_order` (`season_year`,`user_id`);--> statement-breakpoint
CREATE TABLE `game_points` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`season_type` text NOT NULL,
	`team_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`kind` text NOT NULL,
	`beat_top25` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_points_user_idx` ON `game_points` (`season`,`user_id`);--> statement-breakpoint
CREATE INDEX `game_points_week_idx` ON `game_points` (`season`,`week`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`season_type` text NOT NULL,
	`start_date` integer,
	`completed` integer DEFAULT false NOT NULL,
	`home_team_id` integer,
	`away_team_id` integer,
	`home_points` integer,
	`away_points` integer,
	`notes` text,
	`kind` text NOT NULL,
	`venue` text
);
--> statement-breakpoint
CREATE INDEX `games_season_week_idx` ON `games` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `games_season_home_idx` ON `games` (`season`,`home_team_id`);--> statement-breakpoint
CREATE INDEX `games_season_away_idx` ON `games` (`season`,`away_team_id`);--> statement-breakpoint
CREATE INDEX `games_season_start_idx` ON `games` (`season`,`start_date`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`season_year` integer NOT NULL,
	`pick_number` integer NOT NULL,
	`user_id` text NOT NULL,
	`team_id` integer NOT NULL,
	`made_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`season_year`) REFERENCES `seasons`(`year`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`made_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_season_pick_unq` ON `picks` (`season_year`,`pick_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `picks_season_team_unq` ON `picks` (`season_year`,`team_id`);--> statement-breakpoint
CREATE INDEX `picks_season_user_idx` ON `picks` (`season_year`,`user_id`);--> statement-breakpoint
CREATE TABLE `poll_ranks` (
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`season_type` text DEFAULT 'regular' NOT NULL,
	`poll` text NOT NULL,
	`team_id` integer NOT NULL,
	`rank` integer NOT NULL,
	PRIMARY KEY(`season`, `season_type`, `week`, `poll`, `team_id`)
);
--> statement-breakpoint
CREATE INDEX `poll_ranks_lookup_idx` ON `poll_ranks` (`season`,`week`,`team_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`year` integer PRIMARY KEY NOT NULL,
	`draft_status` text DEFAULT 'pending' NOT NULL,
	`rounds` integer DEFAULT 10 NOT NULL,
	`is_current` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_last_seen_idx` ON `sessions` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`last_run_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY NOT NULL,
	`school` text NOT NULL,
	`mascot` text,
	`abbreviation` text,
	`conference` text,
	`division` text,
	`classification` text,
	`color` text,
	`alt_color` text,
	`logo_url` text
);
--> statement-breakpoint
CREATE INDEX `teams_conference_idx` ON `teams` (`conference`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`avatar_hue` integer DEFAULT 0 NOT NULL,
	`is_commissioner` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);