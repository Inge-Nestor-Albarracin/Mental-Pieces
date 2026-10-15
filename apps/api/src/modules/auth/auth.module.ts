import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginAttemptsService } from './login-attempts.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        secret:
          configService.getOrThrow<string>('JWT_SECRET'),

        signOptions: {
          expiresIn: '15m',
          algorithm: 'HS256',
        },

        // Only accept the algorithm we sign with (no algorithm confusion).
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
    }),
  ],

  controllers: [
    AuthController,
  ],

  providers: [
    AuthService,
    LoginAttemptsService,
    JwtAuthGuard,
    RolesGuard,
  ],

  exports: [
    JwtModule,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}