import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/guard';
import { Sms } from './auth/sms.service';
import { Google } from './auth/google';
import { Routing } from './geo/routing';
import { Realtime } from './notify/realtime.service';
import { PushService } from './notify/push.service';
import { NotifyController } from './notify/notify.controller';
import { DevController } from './dev/dev.controller';
import { SecurityLog } from './security/security-log.service';
import { Maintenance } from './security/maintenance.service';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';
import { Matching } from './orders/matching.service';
import { OrdersService } from './orders/orders.service';
import { RatingsService } from './orders/ratings.service';
import { DriverService } from './driver/driver.service';
import { Documents } from './documents/documents.service';
import { DocumentsController } from './documents/documents.controller';
import { UserOrdersController, DriverController, RatingsController } from './orders/orders.controller';

@Module({
  imports: [DbModule],
  controllers: [AuthController, NotifyController, StaffController, ...(process.env.TEST_HOOKS === '1' ? [DevController] : []), UserOrdersController, DriverController, RatingsController, DocumentsController],
  providers: [SecurityLog, Maintenance, AuthService, Sms, Google, Realtime, PushService, StaffService, Routing, Matching, OrdersService, RatingsService, DriverService, Documents, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
