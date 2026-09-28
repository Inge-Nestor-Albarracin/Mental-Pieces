import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { Socket } from 'node:net';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Fail before any PostgreSQL or other outbound connection can be opened.
    // Supertest's local HTTP connection happens later, after this spy is restored.
    const connect = jest
      .spyOn(Socket.prototype, 'connect')
      .mockImplementation(() => {
        throw new Error(
          'AppController initialization must not open network connections.',
        );
      });
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [AppController],
        providers: [AppService],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app?.close();
  });
});
