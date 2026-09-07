-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(255),
    "workspace_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rooms_workspace_id_idx" ON "rooms"("workspace_id");

-- CreateIndex
CREATE INDEX "rooms_host_id_idx" ON "rooms"("host_id");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
