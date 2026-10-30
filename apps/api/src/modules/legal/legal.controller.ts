import { Controller, Get, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { currentDataPolicy } from './data-policy';

// Public: anyone may read the policy before creating an account. Only the
// published text is exposed; nothing about who accepted it.
@Controller('legal')
export class LegalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('data-processing-policy')
  async dataProcessingPolicy() {
    const policy = await currentDataPolicy(this.prisma);
    if (!policy) {
      throw new NotFoundException(
        'La Política de Tratamiento de Datos Personales aún no está publicada.',
      );
    }
    return {
      version: policy.version,
      title: policy.title,
      body: policy.body,
      sha256: policy.sha256,
      publishedAt: policy.publishedAt,
    };
  }
}
