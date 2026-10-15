import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import { RATE_LIMITS, throttle } from '../../security/rate-limits';
import { CreatePatientUserDto } from './dto/create-patient-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Throttle(throttle(RATE_LIMITS.register))
  createPatientUser(@Body() dto: CreatePatientUserDto) {
    return this.usersService.createPatientUser(dto);
  }
}