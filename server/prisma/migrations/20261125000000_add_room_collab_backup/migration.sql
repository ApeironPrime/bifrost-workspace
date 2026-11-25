-- CreateTable
CREATE TABLE IF NOT EXISTS "room_collab_states" (
    "room_id" UUID NOT NULL,
    "messages_json" JSONB NOT NULL DEFAULT '[]',
    "board_json" JSONB NOT NULL DEFAULT '{"items":[],"tombstones":{}}',
    "shared_notes_json" JSONB NOT NULL DEFAULT '{}',
    "hlc" VARCHAR(160),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_collab_states_pkey" PRIMARY KEY ("room_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_room_notes" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "updated_at_ms" DOUBLE PRECISION,
    "hlc" VARCHAR(160),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_room_notes_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_room_notes_user_id_idx" ON "user_room_notes"("user_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "room_collab_states" ADD CONSTRAINT "room_collab_states_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_room_notes" ADD CONSTRAINT "user_room_notes_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_room_notes" ADD CONSTRAINT "user_room_notes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
