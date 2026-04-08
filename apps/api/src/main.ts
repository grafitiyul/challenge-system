import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as path from 'path';
import * as fs from 'fs';
import * as express from 'express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve uploaded files as static assets
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  // Raise body limit for CSV import payloads (default 100kb is too small).
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Accept any *.railway.app origin so deployment works without FRONTEND_URL env var.
  // For stricter envs, set FRONTEND_URL to an exact origin (e.g. https://web.railway.app).
  app.enableCors({
    origin: (incomingOrigin, callback) => {
      if (!incomingOrigin) {
        // Same-origin requests, server-to-server, curl — allow
        return callback(null, true);
      }
      const configured = process.env['FRONTEND_URL'];
      const allowed = [
        configured,
        'http://localhost:3000',
        'http://localhost:3001',
      ].filter(Boolean) as string[];

      const isAllowed =
        allowed.includes(incomingOrigin) ||
        incomingOrigin.endsWith('.railway.app') ||
        incomingOrigin.endsWith('.up.railway.app');

      callback(null, isAllowed);
    },
    credentials: true,
  });

  // Railway injects PORT at runtime — the app must listen on it.
  // Fallback to API_PORT for local dev, then 3001.
  const port = process.env['PORT'] ?? process.env['API_PORT'] ?? 3001;
  await app.listen(port);

  console.log(`API running on port ${port}`);
}

bootstrap();
