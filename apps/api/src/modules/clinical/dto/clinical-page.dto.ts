import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ClinicalPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}
