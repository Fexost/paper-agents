import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const agents = [
  { slug: 'macro', name: 'Macro Agent', layer: 'MACRO' as const, promptFile: 'macro.md' },
  { slug: 'sector', name: 'Sector Agent', layer: 'SECTOR' as const, promptFile: 'sector.md' },
  { slug: 'cio', name: 'CIO Agent', layer: 'DECISION' as const, promptFile: 'cio.md' },
];

async function main() {
  for (const agent of agents) {
    const content = await readFile(
      join(process.cwd(), 'prompts', agent.promptFile),
      'utf8',
    );

    const record = await prisma.agent.upsert({
      where: { slug: agent.slug },
      update: { name: agent.name, layer: agent.layer },
      create: {
        slug: agent.slug,
        name: agent.name,
        layer: agent.layer,
      },
    });

    const existingActive = await prisma.agentPrompt.findFirst({
      where: { agentId: record.id, isActive: true },
    });

    if (!existingActive) {
      await prisma.agentPrompt.create({
        data: {
          agentId: record.id,
          version: 1,
          content,
          isActive: true,
          autoresearchNote: 'Initial seed prompt',
        },
      });
      continue;
    }

    if (
      existingActive.autoresearchNote === 'Initial seed prompt' &&
      existingActive.content.trim() !== content.trim()
    ) {
      const nextVersion =
        (
          await prisma.agentPrompt.aggregate({
            where: { agentId: record.id },
            _max: { version: true },
          })
        )._max.version ?? 0;

      await prisma.$transaction([
        prisma.agentPrompt.updateMany({
          where: { agentId: record.id, isActive: true },
          data: { isActive: false },
        }),
        prisma.agentPrompt.create({
          data: {
            agentId: record.id,
            version: nextVersion + 1,
            content,
            isActive: true,
            autoresearchNote: 'Synced from prompts/ on seed',
          },
        }),
      ]);
    }
  }

  await prisma.paperAccount.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      cashBalance: 100000,
      startingCash: 100000,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
