CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"expires" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" serial PRIMARY KEY,
	"actor" integer NOT NULL,
	"target" integer NOT NULL,
	"action" text NOT NULL,
	"stamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" integer PRIMARY KEY,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"profile" jsonb DEFAULT '{}' NOT NULL,
	"room" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"member" integer NOT NULL,
	"expires" bigint NOT NULL,
	"admin_proof" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_members_id_fkey" FOREIGN KEY ("member") REFERENCES "members"("id");