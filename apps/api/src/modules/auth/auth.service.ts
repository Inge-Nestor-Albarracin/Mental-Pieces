import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';

import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { LoginAttemptsService } from './login-attempts.service';

// bcrypt hash (cost 12, same as real accounts) of a random value nobody knows.
// Compared when the account does not exist so response time does not reveal
// which emails are registered.
const TIMING_EQUALIZER_HASH =
  '$2b$12$SP8gFtQrepZwtFyWvjyAseeqqXQ1/UxNWtXbTLVr5VJR1L/M3muES';

const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly attempts: LoginAttemptsService,
  ) {}

  async login(dto: LoginDto) {
    this.attempts.assertNotLocked(dto.email);

    const user = await this.usersService.findByEmailForAuth(dto.email);

    const isPasswordValid = await compare(
      dto.password,
      user?.passwordHash ?? TIMING_EQUALIZER_HASH,
    );

    if (!user || !user.isActive || !isPasswordValid) {
      this.attempts.recordFailure(dto.email);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.attempts.recordSuccess(dto.email);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
