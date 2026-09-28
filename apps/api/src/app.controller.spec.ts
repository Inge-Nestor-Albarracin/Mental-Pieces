import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController (unit)', () => {
  it('returns the greeting without loading configuration or a database', () => {
    const controller = new AppController(new AppService());
    expect(controller.getHello()).toBe('Hello World!');
  });
});
