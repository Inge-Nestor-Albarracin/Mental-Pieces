import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  ConsentPurpose,
  LegalDocumentKind,
} from '../../../generated/prisma/client';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';

// Data-processing policy: the published version and whether a user accepted it.
// Shared by registration, the patient profile and booking so every path applies
// exactly the same rule. Works with the Prisma client or a transaction client.
type Db = Prisma.TransactionClient | PrismaClient;

export const DATA_POLICY_KIND = LegalDocumentKind.DATA_PROCESSING_POLICY;
export const DATA_POLICY_PURPOSE = ConsentPurpose.ACCOUNT_DATA_PROCESSING;

// The text exactly as stored and hashed: LF line endings, no trailing blanks.
export function normalizePolicyBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trimEnd();
}

export function policySha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

// Version offered to people who accept now: the latest one already published.
export function currentDataPolicy(db: Db, now = new Date()) {
  return db.legalDocument.findFirst({
    where: { kind: DATA_POLICY_KIND, publishedAt: { lte: now } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      version: true,
      title: true,
      body: true,
      sha256: true,
      publishedAt: true,
    },
  });
}

export const POLICY_NOT_PUBLISHED_MESSAGE =
  'La Política de Tratamiento de Datos Personales aún no está publicada; por ahora no es posible aceptarla.';
export const POLICY_VERSION_MESSAGE =
  'La versión de la Política de Tratamiento de Datos Personales no es la vigente. Recarga la página, revísala y acéptala de nuevo.';

// The version the person saw must be the one published now (it may have changed
// while the form was open). Read with the same client as the write.
export async function policyToAccept(db: Db, version: string) {
  const policy = await currentDataPolicy(db);
  if (!policy)
    throw new ServiceUnavailableException(POLICY_NOT_PUBLISHED_MESSAGE);
  if (policy.version !== version.trim()) {
    throw new BadRequestException(POLICY_VERSION_MESSAGE);
  }
  return policy;
}

// A user is covered when they accepted the latest version that requires a new
// authorisation, or any later one. Never assumed: no published policy or no
// consent row means "not accepted".
export async function hasAcceptedDataPolicy(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const required = await db.legalDocument.findFirst({
    where: {
      kind: DATA_POLICY_KIND,
      requiresReacceptance: true,
      publishedAt: { lte: now },
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { publishedAt: true },
  });
  if (!required) return false;

  const consent = await db.dataProcessingConsent.findFirst({
    where: {
      userId,
      purpose: DATA_POLICY_PURPOSE,
      document: {
        kind: DATA_POLICY_KIND,
        publishedAt: { gte: required.publishedAt },
      },
    },
    select: { id: true },
  });
  return consent !== null;
}
