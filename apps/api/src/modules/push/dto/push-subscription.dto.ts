import { IsString, Matches, MaxLength } from 'class-validator';

// Flat copy of PushSubscription.toJSON() from the browser. The endpoint host is
// checked against the push-service allow-list in the service (SSRF guard).
export class PushSubscriptionDto {
  @IsString({ message: 'La suscripción no es válida.' })
  @MaxLength(1000, { message: 'La suscripción no es válida.' })
  endpoint!: string;

  @IsString({ message: 'La suscripción no es válida.' })
  @Matches(/^[A-Za-z0-9_-]{80,100}={0,2}$/, {
    message: 'La suscripción no es válida.',
  })
  p256dh!: string;

  @IsString({ message: 'La suscripción no es válida.' })
  @Matches(/^[A-Za-z0-9_-]{16,30}={0,2}$/, {
    message: 'La suscripción no es válida.',
  })
  auth!: string;
}

export class RemovePushSubscriptionDto {
  @IsString({ message: 'La suscripción no es válida.' })
  @MaxLength(1000, { message: 'La suscripción no es válida.' })
  endpoint!: string;
}
