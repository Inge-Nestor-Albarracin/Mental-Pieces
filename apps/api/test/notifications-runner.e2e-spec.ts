import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/database/prisma.service';
import { NotificationsRunnerController } from '../src/modules/push/notifications-runner.controller';
import { NotificationsRunnerService } from '../src/modules/push/notifications-runner.service';
import { PushDispatcher } from '../src/modules/push/push-dispatcher';

// The cron trigger: a shared secret instead of a JWT, 404 when not configured.
// NOTIFICATIONS_ENABLED is unset, so the email run only logs "disabled".

async function appWith(secret: string | undefined) {
  const previous = process.env.NOTIFICATIONS_CRON_SECRET;
  if (secret === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
  else process.env.NOTIFICATIONS_CRON_SECRET = secret;
  const dispatcher = { kick: jest.fn() };
  const module = await Test.createTestingModule({
    controllers: [NotificationsRunnerController],
    providers: [
      NotificationsRunnerService,
      { provide: PrismaService, useValue: {} },
      { provide: PushDispatcher, useValue: dispatcher },
    ],
  }).compile();
  const app: INestApplication<App> = module.createNestApplication();
  await app.init();
  if (previous === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
  else process.env.NOTIFICATIONS_CRON_SECRET = previous;
  return { app, dispatcher };
}

describe('POST /internal/notifications/run (cron trigger)', () => {
  const secret = randomBytes(24).toString('hex');

  it('does not exist without a configured secret', async () => {
    const { app, dispatcher } = await appWith(undefined);
    await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .set('X-Cron-Secret', secret)
      .expect(404);
    expect(dispatcher.kick).not.toHaveBeenCalled();
    await app.close();
  });

  it('ignores a secret that is too short to be safe', async () => {
    const { app } = await appWith('short-secret');
    await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .set('X-Cron-Secret', 'short-secret')
      .expect(404);
    await app.close();
  });

  it('rejects a missing or wrong secret', async () => {
    const { app, dispatcher } = await appWith(secret);
    await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .set('X-Cron-Secret', `${secret.slice(0, -1)}x`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .set('Authorization', `Bearer ${secret}`)
      .expect(401);
    expect(dispatcher.kick).not.toHaveBeenCalled();
    await app.close();
  });

  it('starts a run with the right secret and answers immediately', async () => {
    const { app, dispatcher } = await appWith(secret);
    const response = await request(app.getHttpServer())
      .post('/internal/notifications/run')
      .set('X-Cron-Secret', secret)
      .expect(202);
    expect(response.body).toEqual({ status: 'started' });
    expect(dispatcher.kick).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('only accepts POST', async () => {
    const { app } = await appWith(secret);
    await request(app.getHttpServer())
      .get('/internal/notifications/run')
      .set('X-Cron-Secret', secret)
      .expect(404);
    await app.close();
  });
});
