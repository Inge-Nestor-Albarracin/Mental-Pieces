import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import { CreatePatientUserDto } from './dto/create-patient-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  createPatientUser(@Body() dto: CreatePatientUserDto) {
    return this.usersService.createPatientUser(dto);
  }
}