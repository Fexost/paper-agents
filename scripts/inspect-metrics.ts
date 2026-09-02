import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const agents = await prisma.agent.findMany({
    select: { slug: true, rollingSharpe: true, id: true },
  });

  for (const a of agents) {
    const recs = await prisma.recommendation.findMany({
      where: { agentId: a.id, scoredAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        ticker: true,
        isHit: true,
        forwardReturn1d: true,
        createdAt: true,
        direction: true,
      },
    });
    const snap = await prisma.scoreSnapshot.findFirst({
      where: { agentId: a.id },
      orderBy: { snapshotDate: 'desc' },
    });
    const hits = recs.filter((r) => r.isHit).length;
    console.log(
      `--- ${a.slug} rolling=${a.rollingSharpe} snapSharpe=${snap?.sharpe} snapHit=${snap?.hitRate} scored=${recs.length} hits=${hits}`,
    );
  }

  const runs = await prisma.dailyRun.findMany({
    orderBy: [{ runDate: 'desc' }, { cycleNumber: 'asc' }],
    select: { cycleNumber: true, runDate: true, status: true },
  });
  console.log('run dates', runs);

  const cioExp = await prisma.autoresearchExperiment.findFirst({
    where: { agent: { slug: 'cio' } },
    orderBy: { startedAt: 'desc' },
  });
  console.log('cio experiment', cioExp);

  const snaps = await prisma.scoreSnapshot.findMany({
    include: { agent: { select: { slug: true } } },
    orderBy: { snapshotDate: 'desc' },
  });
  console.log('snapshots', snaps);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
