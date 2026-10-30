-- Data-processing policy (versioned legal text) and verifiable acceptance evidence.
-- Additive only: two new enums, two new tables, constraints and triggers. No existing
-- row is changed; existing patients have no consent row until they accept themselves.

-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('DATA_PROCESSING_POLICY');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('ACCOUNT_DATA_PROCESSING');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('PATIENT_REGISTRATION', 'EXISTING_ACCOUNT');

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "requiresReacceptance" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataProcessingConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataProcessingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocument_kind_publishedAt_idx" ON "LegalDocument"("kind", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_kind_version_key" ON "LegalDocument"("kind", "version");

-- CreateIndex
CREATE INDEX "DataProcessingConsent_userId_acceptedAt_idx" ON "DataProcessingConsent"("userId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataProcessingConsent_userId_documentId_purpose_key" ON "DataProcessingConsent"("userId", "documentId", "purpose");

-- AddForeignKey
ALTER TABLE "DataProcessingConsent" ADD CONSTRAINT "DataProcessingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataProcessingConsent" ADD CONSTRAINT "DataProcessingConsent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity of the published text: non-empty fields and a hash that is exactly the
-- SHA-256 of the stored body (the evidence points to this text, byte for byte).
ALTER TABLE "LegalDocument"
ADD CONSTRAINT "LegalDocument_values"
CHECK (
  length(btrim("version")) > 0
  AND length(btrim("title")) > 0
  AND length(btrim("body")) > 0
  AND "sha256" ~ '^[0-9a-f]{64}$'
  AND "sha256" = encode(sha256(convert_to("body", 'UTF8')), 'hex')
);

-- A published version is never edited: a new text is a new version.
CREATE FUNCTION "mp_legal_document_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LegalDocument rows are immutable; publish a new version instead'
    USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER "LegalDocument_immutable"
BEFORE UPDATE ON "LegalDocument"
FOR EACH ROW EXECUTE FUNCTION "mp_legal_document_immutable"();

-- Acceptance evidence is append-only. The acceptance time is always the database
-- server time (never a client value) and the copied version/hash must match the
-- referenced document.
CREATE FUNCTION "mp_data_consent_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  accepted_document "LegalDocument"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'DataProcessingConsent rows are append-only'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO accepted_document FROM "LegalDocument" WHERE "id" = NEW."documentId";
  IF NOT FOUND
     OR accepted_document."version" <> NEW."documentVersion"
     OR accepted_document."sha256" <> NEW."documentSha256" THEN
    RAISE EXCEPTION 'Consent does not match the accepted document'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW."acceptedAt" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END
$$;

CREATE TRIGGER "DataProcessingConsent_guard"
BEFORE INSERT OR UPDATE ON "DataProcessingConsent"
FOR EACH ROW EXECUTE FUNCTION "mp_data_consent_guard"();

-- Security: same lock-down as 20261015120000. Reachable only through the NestJS API
-- (owner role); Supabase's Data API roles get no access and RLS has no policies.
ALTER TABLE "LegalDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataProcessingConsent" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "LegalDocument" FROM %I', data_api_role);
      EXECUTE format('REVOKE ALL ON TABLE "DataProcessingConsent" FROM %I', data_api_role);
    END IF;
  END LOOP;
END
$$;
