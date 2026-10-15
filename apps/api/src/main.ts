import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Explicit browser origins allowed to call the API. Never "*" with credentials.
function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Body size is limited below; the default parser is replaced to set it.
    bodyParser: false,
  });

  // Security headers (HSTS, nosniff, frame denial, no X-Powered-By, ...).
  app.use(helmet());

  // Behind a reverse proxy/load balancer set TRUST_PROXY to the number of proxies so
  // rate limits see the real client IP. Off by default: X-Forwarded-For is spoofable.
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (Number.isInteger(trustProxy) && trustProxy > 0)
    app.set('trust proxy', trustProxy);

  // Notes allow 10 000 characters; 100 kB covers them and stops oversized payloads.
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '20kb', extended: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: allowedOrigins(),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
