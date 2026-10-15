-- CreateTable
CREATE TABLE "schema_meta" (
    "id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_meta_pkey" PRIMARY KEY ("id")
);
