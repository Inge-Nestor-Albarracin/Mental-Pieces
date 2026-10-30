// Private command line to publish the Data-Processing Policy AFTER legal review.
// There is no HTTP endpoint to publish or edit it. Compiled to dist/src/cli/legal.js.
//
//   node dist/src/cli/legal.js status
//   node dist/src/cli/legal.js publish --file <policy.md> --version <v> --title "<title>" --confirm
//        [--no-reacceptance]   editorial change: accounts that accepted an earlier
//                              version do not need to accept again
//
// A published version is immutable (database trigger): corrections are a new version.
// Uses DATABASE_URL from the environment; output never includes connection strings.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';

import { PrismaService } from '../database/prisma.service';
import {
  DATA_POLICY_KIND,
  currentDataPolicy,
  normalizePolicyBody,
  policySha256,
} from '../modules/legal/data-policy';

const log = (message: string) =>
  console.log(`[legal] ${new Date().toISOString()} ${message}`);

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function status(prisma: PrismaService): Promise<number> {
  const policy = await currentDataPolicy(prisma);
  if (!policy) {
    log(
      'no Data-Processing Policy is published: sign-up and booking stay closed',
    );
    return 0;
  }
  const consents = await prisma.dataProcessingConsent.count({
    where: { documentId: policy.id },
  });
  log(
    `current version ${policy.version} published ${policy.publishedAt.toISOString()} sha256 ${policy.sha256} (${consents} acceptances)`,
  );
  return 0;
}

async function publish(prisma: PrismaService, args: string[]): Promise<number> {
  const file = argValue(args, '--file');
  const version = argValue(args, '--version')?.trim();
  const title = argValue(args, '--title')?.trim();
  if (!file || !version || !title || !args.includes('--confirm')) {
    log(
      'usage: publish --file <policy.md> --version <v> --title "<title>" --confirm',
    );
    return 2;
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(version)) {
    log('version: 1-40 letters, digits, dot, dash or underscore');
    return 2;
  }
  const body = normalizePolicyBody(await readFile(file, 'utf8'));
  if (!body) {
    log('the policy file is empty');
    return 2;
  }
  const exists = await prisma.legalDocument.findUnique({
    where: { kind_version: { kind: DATA_POLICY_KIND, version } },
    select: { id: true },
  });
  if (exists) {
    log(
      `version ${version} already exists; a published text cannot be replaced`,
    );
    return 1;
  }
  const sha256 = policySha256(body);
  const created = await prisma.legalDocument.create({
    data: {
      kind: DATA_POLICY_KIND,
      version,
      title,
      body,
      sha256,
      requiresReacceptance: !args.includes('--no-reacceptance'),
    },
    select: { version: true, publishedAt: true, requiresReacceptance: true },
  });
  log(
    `published version ${created.version} at ${created.publishedAt.toISOString()} sha256 ${sha256} (requires acceptance again: ${created.requiresReacceptance ? 'yes' : 'no'})`,
  );
  return 0;
}

async function main(args: string[]): Promise<number> {
  const command = args[0] ?? 'status';
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    if (command === 'status') return await status(prisma);
    if (command === 'publish') return await publish(prisma, args.slice(1));
    log(`unknown command "${command}". Use: status | publish`);
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log(
      `error ${(error as { name?: string })?.name ?? 'Error'} ${(error as { code?: string })?.code ?? ''}`.trim(),
    );
    process.exitCode = 1;
  });
