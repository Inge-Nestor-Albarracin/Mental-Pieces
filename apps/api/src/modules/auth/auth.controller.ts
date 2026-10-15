import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { RATE_LIMITS, throttle } from '../../security/rate-limits';

import { JwtAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle(throttle(RATE_LIMITS.login))
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(
    @Req() request: Request & { user: { sub: string; email: string; role: string } },
  ) {
    return {
      id: request.user.sub,
      email: request.user.email,
      role: request.user.role,
    };
  }
}